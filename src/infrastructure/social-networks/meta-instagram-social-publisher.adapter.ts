import type {
  SocialMediaType,
  SocialPostDraft,
  SocialPublicationError,
  SocialPublicationResult,
  SocialPublisherCapabilities,
  SocialPublisherPort,
} from "../../application/ports/social-publisher.port.js";

export type MetaInstagramAdapterDependencies = {
  accessToken: string;
  instagramBusinessAccountId: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  statusPollAttempts?: number;
  statusPollIntervalMs?: number;
};

type GraphErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

const RETRYABLE_GRAPH_ERROR_CODES = new Set([1, 2, 4, 17, 32, 613]);

function resolveDraftMediaType(draft: SocialPostDraft): SocialMediaType {
  return draft.mediaType ?? (draft.assetUris.length > 1 ? "carousel" : "image");
}

function buildCaptionText(draft: SocialPostDraft): string {
  const parts: string[] = [];
  if (draft.caption) parts.push(draft.caption.trim());
  if (draft.cta) parts.push(draft.cta.trim());
  if (draft.hashtags && draft.hashtags.length > 0) {
    parts.push(draft.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" "));
  }
  return parts.filter(Boolean).join("\n\n");
}

function classifyGraphError(payload: GraphErrorPayload | undefined, httpStatus: number): SocialPublicationError {
  const code = payload?.error?.code;
  const message = payload?.error?.message ?? `Falha HTTP ${httpStatus} ao chamar a Instagram Graph API.`;
  const retryable = typeof code === "number" ? RETRYABLE_GRAPH_ERROR_CODES.has(code) : httpStatus >= 500;
  return {
    code: typeof code === "number" ? `META_${code}` : `HTTP_${httpStatus}`,
    message,
    retryable,
  };
}

/**
 * Adapter real de publicação orgânica no Instagram via Instagram Graph API
 * (Content Publishing API). Requer uma conta Instagram Profissional conectada
 * a uma Página do Facebook, um App no Meta for Developers com o produto
 * "Instagram Graph API", e um token de acesso com as permissões
 * `instagram_basic` e `instagram_content_publish`.
 *
 * A API do Meta busca a mídia por URL pública — `draft.assetUris` precisa
 * conter URLs HTTPS acessíveis publicamente, não caminhos locais.
 *
 * Agendamento nativo de posts orgânicos não existe na Graph API pública;
 * `schedule()` retorna um resultado `failed` explicando isso em vez de
 * fingir suporte.
 */
export class MetaInstagramSocialPublisherAdapter implements SocialPublisherPort {
  readonly capabilities: SocialPublisherCapabilities = {
    supportsScheduling: false,
    supportedMediaTypes: {
      instagram: ["image", "carousel", "video"],
    },
  };

  private readonly accessToken: string;
  private readonly igUserId: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly statusPollAttempts: number;
  private readonly statusPollIntervalMs: number;

  constructor(dependencies: MetaInstagramAdapterDependencies) {
    if (!dependencies.accessToken?.trim()) {
      throw new Error("MetaInstagramSocialPublisherAdapter requer accessToken.");
    }
    if (!dependencies.instagramBusinessAccountId?.trim()) {
      throw new Error("MetaInstagramSocialPublisherAdapter requer instagramBusinessAccountId.");
    }
    this.accessToken = dependencies.accessToken;
    this.igUserId = dependencies.instagramBusinessAccountId;
    this.apiVersion = dependencies.apiVersion ?? "v21.0";
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
    this.statusPollAttempts = dependencies.statusPollAttempts ?? 5;
    this.statusPollIntervalMs = dependencies.statusPollIntervalMs ?? 2000;
  }

  async publish(draft: SocialPostDraft): Promise<SocialPublicationResult> {
    if (draft.channel !== "instagram") {
      return {
        channel: draft.channel,
        status: "failed",
        error: {
          code: "UNSUPPORTED_CHANNEL",
          message: `MetaInstagramSocialPublisherAdapter só publica no canal "instagram", recebido "${draft.channel}".`,
          retryable: false,
        },
      };
    }
    const mediaType = resolveDraftMediaType(draft);
    const requiredUri = mediaType === "video" ? draft.videoUri ?? draft.assetUris[0] : draft.assetUris[0];
    if (!requiredUri) {
      return {
        channel: draft.channel,
        status: "failed",
        error: {
          code: "MISSING_ASSET",
          message:
            mediaType === "video"
              ? "Nenhum videoUri fornecido — a Instagram Graph API exige um vídeo publicado em URL pública."
              : "Nenhum assetUri fornecido — a Instagram Graph API exige ao menos uma imagem publicada em URL pública.",
          retryable: false,
        },
      };
    }

    try {
      const caption = buildCaptionText(draft);
      const creationId = await this.createMediaContainer(draft, mediaType, caption);

      await this.waitUntilContainerReady(creationId);

      const mediaId = await this.publishContainer(creationId);
      const permalink = await this.fetchPermalink(mediaId);

      return {
        channel: "instagram",
        status: "published",
        externalId: mediaId,
        url: permalink,
        metadata: { creationId, mediaType },
      };
    } catch (error) {
      const publicationError =
        error instanceof GraphApiError
          ? error.publicationError
          : { code: "UNKNOWN_ERROR", message: (error as Error).message, retryable: false };
      return {
        channel: "instagram",
        status: "failed",
        error: publicationError,
      };
    }
  }

  async schedule(draft: SocialPostDraft): Promise<SocialPublicationResult> {
    return {
      channel: draft.channel,
      status: "failed",
      scheduledAt: draft.scheduledAt,
      error: {
        code: "SCHEDULING_NOT_SUPPORTED",
        message:
          "A Instagram Graph API não oferece agendamento nativo para publicações orgânicas. " +
          "Chame publish() no horário desejado a partir de um agendador externo (cron/job), em vez de scheduled_publish_time.",
        retryable: false,
      },
    };
  }

  private async createMediaContainer(draft: SocialPostDraft, mediaType: SocialMediaType, caption: string): Promise<string> {
    if (mediaType === "video") {
      return this.createVideoContainer(draft.videoUri ?? draft.assetUris[0], caption, draft.thumbnailUri);
    }
    if (mediaType === "carousel") {
      return this.createCarouselContainer(draft.assetUris, caption);
    }
    return this.createSingleImageContainer(draft.assetUris[0], caption);
  }

  private async createSingleImageContainer(imageUrl: string, caption: string): Promise<string> {
    const response = await this.graphPost(`${this.igUserId}/media`, {
      image_url: imageUrl,
      caption,
    });
    return response.id as string;
  }

  private async createCarouselContainer(imageUrls: string[], caption: string): Promise<string> {
    const childIds: string[] = [];
    for (const imageUrl of imageUrls) {
      const child = await this.graphPost(`${this.igUserId}/media`, {
        image_url: imageUrl,
        is_carousel_item: "true",
      });
      childIds.push(child.id as string);
    }
    const parent = await this.graphPost(`${this.igUserId}/media`, {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption,
    });
    return parent.id as string;
  }

  private async createVideoContainer(videoUrl: string, caption: string, thumbnailUrl?: string): Promise<string> {
    const body: Record<string, string> = {
      media_type: "REELS",
      video_url: videoUrl,
      caption,
    };
    if (thumbnailUrl) body.cover_url = thumbnailUrl;
    const response = await this.graphPost(`${this.igUserId}/media`, body);
    return response.id as string;
  }

  private async waitUntilContainerReady(creationId: string): Promise<void> {
    for (let attempt = 0; attempt < this.statusPollAttempts; attempt += 1) {
      const status = await this.graphGet(creationId, { fields: "status_code" });
      const statusCode = status.status_code as string | undefined;
      if (statusCode === "FINISHED" || statusCode === undefined) return;
      if (statusCode === "ERROR" || statusCode === "EXPIRED") {
        throw new GraphApiError({
          code: `CONTAINER_${statusCode}`,
          message: `O container de mídia ${creationId} terminou com status ${statusCode}.`,
          retryable: false,
        });
      }
      if (attempt < this.statusPollAttempts - 1) {
        await this.delay(this.statusPollIntervalMs);
      }
    }
  }

  private async publishContainer(creationId: string): Promise<string> {
    const response = await this.graphPost(`${this.igUserId}/media_publish`, {
      creation_id: creationId,
    });
    return response.id as string;
  }

  private async fetchPermalink(mediaId: string): Promise<string | undefined> {
    try {
      const response = await this.graphGet(mediaId, { fields: "permalink" });
      return response.permalink as string | undefined;
    } catch {
      return undefined;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async graphPost(path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${path}`;
    const params = new URLSearchParams({ ...body, access_token: this.accessToken });
    const response = await this.fetchImpl(url, { method: "POST", body: params });
    return this.parseGraphResponse(response);
  }

  private async graphGet(path: string, query: Record<string, string>): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ ...query, access_token: this.accessToken });
    const url = `https://graph.facebook.com/${this.apiVersion}/${path}?${params.toString()}`;
    const response = await this.fetchImpl(url, { method: "GET" });
    return this.parseGraphResponse(response);
  }

  private async parseGraphResponse(response: Response): Promise<Record<string, unknown>> {
    const payload = (await response.json().catch(() => ({}))) as GraphErrorPayload & Record<string, unknown>;
    if (!response.ok || payload.error) {
      throw new GraphApiError(classifyGraphError(payload, response.status));
    }
    return payload;
  }
}

class GraphApiError extends Error {
  readonly publicationError: SocialPublicationError;

  constructor(publicationError: SocialPublicationError) {
    super(publicationError.message);
    this.name = "GraphApiError";
    this.publicationError = publicationError;
  }
}
