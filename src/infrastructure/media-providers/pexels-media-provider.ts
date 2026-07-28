import type {
  MediaProviderOrientation,
  MediaProviderPort,
  MediaProviderSearchHit,
  MediaProviderSearchQuery,
} from "../../application/ports/media-provider.port.js";

/**
 * REAL FOOTAGE ACQUISITION — adapter concreto do Pexels atrás de `MediaProviderPort`. Escolhido
 * porque: possui API oficial e documentada (https://www.pexels.com/api/documentation/),
 * oferece vídeos, permite consulta programática por texto/orientação/tamanho, informa autor e
 * página de origem por resultado, licença clara e gratuita para uso comercial (com atribuição
 * obrigatória quando consumido via API — ver `PEXELS_LICENSE`), e autenticação simples por header
 * (sem OAuth). Consultado ao vivo em 2026-07 via WebSearch/WebFetch antes de implementar (não
 * baseado só em conhecimento de treinamento) — ver o relatório final da sprint para as fontes.
 *
 * Nunca faz scraping (só a API oficial), nunca contorna autenticação, nunca baixa de página
 * aleatória — todo download passa pela allowlist de hosts em `PEXELS_DOWNLOAD_HOSTS`
 * (`media-download-security.ts`).
 */

const PEXELS_API_BASE = "https://api.pexels.com";

/**
 * Hosts permitidos para DOWNLOAD (não para a chamada de busca/API em si, que é sempre
 * api.pexels.com). Baseado na documentação oficial (images.pexels.com/videos.pexels.com/
 * static-videos.pexels.com) mais domínios de CDN historicamente usados pelo Pexels para hospedar
 * arquivos de vídeo. O domínio EXATO usado em `video_files[].link` não pôde ser 100% confirmado
 * sem uma chamada real autenticada nesta sessão (sem credencial configurada) — ver limitações no
 * relatório final. Ajustar esta lista após a primeira resposta real, se necessário.
 */
export const PEXELS_DOWNLOAD_HOSTS = [
  "pexels.com",
  "images.pexels.com",
  "videos.pexels.com",
  "static-videos.pexels.com",
  "player.vimeo.com",
];

export const PEXELS_LICENSE = {
  name: "Pexels License",
  url: "https://www.pexels.com/license/",
  allowsCommercialUse: true,
  // Uso direto do arquivo baixado não exige atribuição, mas o consumo VIA API exige um link
  // visível para o Pexels e crédito ao fotógrafo/videomaker quando possível — por isso este
  // adapter (que É consumo via API) sempre marca requiresAttribution: true.
  requiresAttribution: true,
};

function mapOrientation(orientation?: MediaProviderOrientation): string | undefined {
  if (!orientation) return undefined;
  return orientation;
}

function pickBestVideoFile(videoFiles: PexelsVideoFile[], targetOrientation?: MediaProviderOrientation): PexelsVideoFile | undefined {
  if (videoFiles.length === 0) return undefined;
  const withMp4 = videoFiles.filter((file) => file.file_type === "video/mp4");
  const pool = withMp4.length > 0 ? withMp4 : videoFiles;
  const orientedPool = targetOrientation
    ? pool.filter((file) => (targetOrientation === "portrait" ? file.height >= file.width : targetOrientation === "landscape" ? file.width >= file.height : true))
    : pool;
  const finalPool = orientedPool.length > 0 ? orientedPool : pool;
  return [...finalPool].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
}

type PexelsVideoFile = { id: number; quality: string; file_type: string; width: number; height: number; fps?: number; link: string };
type PexelsVideo = {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  image: string;
  user: { id: number; name: string; url: string };
  video_files: PexelsVideoFile[];
};
type PexelsSearchResponse = { page: number; per_page: number; total_results: number; videos: PexelsVideo[] };

function videoToHit(video: PexelsVideo, orientation?: MediaProviderOrientation): MediaProviderSearchHit | undefined {
  const bestFile = pickBestVideoFile(video.video_files, orientation);
  if (!bestFile) return undefined;
  return {
    externalId: String(video.id),
    previewUrl: video.image,
    downloadUrl: bestFile.link,
    author: video.user.name,
    originPageUrl: video.url,
    license: PEXELS_LICENSE,
    width: bestFile.width,
    height: bestFile.height,
    durationSeconds: video.duration,
  };
}

export class PexelsMediaProvider implements MediaProviderPort {
  readonly providerId = "pexels";
  private readonly apiBase: string;

  /** `baseUrl` só existe para testes apontarem para um servidor HTTP local real (nunca mockado no nível de `fetch`) — em produção é sempre `https://api.pexels.com`. */
  constructor(options?: { baseUrl?: string }) {
    this.apiBase = options?.baseUrl ?? PEXELS_API_BASE;
  }

  isConfigured(): boolean {
    return process.env.MEDIA_PROVIDER === "pexels" && Boolean(process.env.MEDIA_PROVIDER_API_KEY && process.env.MEDIA_PROVIDER_API_KEY.trim().length > 0);
  }

  async search(query: MediaProviderSearchQuery): Promise<MediaProviderSearchHit[]> {
    if (!this.isConfigured()) {
      throw new Error(
        "Provider de mídia externa não configurado. Defina as variáveis de ambiente MEDIA_PROVIDER=pexels e MEDIA_PROVIDER_API_KEY=<sua chave> " +
        "(obtida gratuitamente e instantaneamente em https://www.pexels.com/api/ com uma conta Pexels) para habilitar busca/aquisição de filmagens reais.",
      );
    }

    const params = new URLSearchParams();
    params.set("query", query.text);
    const orientation = mapOrientation(query.orientation);
    if (orientation) params.set("orientation", orientation);
    params.set("per_page", String(Math.min(80, Math.max(1, query.limit ?? 15))));

    const response = await this.callApi(`/videos/search?${params.toString()}`);
    // 401/429 já viram exceção clara dentro de callApi(); qualquer outro status de erro (4xx/5xx)
    // também precisa propagar como erro — nunca deve parecer silenciosamente "0 resultados
    // encontrados" quando na verdade o provider falhou.
    if (!response.ok) throw new Error(`Erro do provider Pexels (HTTP ${response.status}) ao buscar "${query.text}".`);
    const data = (await response.json()) as PexelsSearchResponse;
    return data.videos
      .map((video) => videoToHit(video, query.orientation))
      .filter((hit): hit is MediaProviderSearchHit => hit !== undefined)
      .filter((hit) => (query.minWidth ? (hit.width ?? 0) >= query.minWidth : true))
      .filter((hit) => (query.minHeight ? (hit.height ?? 0) >= query.minHeight : true))
      .filter((hit) => (query.minDurationSeconds ? (hit.durationSeconds ?? 0) >= query.minDurationSeconds : true));
  }

  async getById(externalId: string): Promise<MediaProviderSearchHit | undefined> {
    if (!this.isConfigured()) {
      throw new Error("Provider de mídia externa não configurado. Defina MEDIA_PROVIDER=pexels e MEDIA_PROVIDER_API_KEY.");
    }
    const response = await this.callApi(`/videos/videos/${encodeURIComponent(externalId)}`);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Erro do provider Pexels (HTTP ${response.status}) ao rebuscar o id "${externalId}".`);
    const video = (await response.json()) as PexelsVideo;
    return videoToHit(video);
  }

  /**
   * Nunca loga a API key (nem em texto, nem em erro) — só o path da requisição e o status da
   * resposta. `Authorization` é enviada exatamente como a documentação exige: a chave crua, sem
   * prefixo "Bearer".
   */
  private async callApi(path: string): Promise<Response> {
    const apiKey = process.env.MEDIA_PROVIDER_API_KEY ?? "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${this.apiBase}${path}`, {
        headers: { Authorization: apiKey },
        signal: controller.signal,
      });
      if (response.status === 401) throw new Error("Credencial do Pexels rejeitada (HTTP 401) — confirme MEDIA_PROVIDER_API_KEY.");
      if (response.status === 429) throw new Error("Limite de requisições do Pexels excedido (HTTP 429) — aguarde o reset (ver header X-Ratelimit-Reset) antes de tentar novamente.");
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}
