import { describe, expect, it } from "vitest";
import { legacyNetworkPublishHref } from "../features/publication-history/legacy-routes";
import { mergePublicationFeeds, socialPostsToPublications } from "../features/publication-history/social-mapper";
import { contentTypeOf, derivePublicationStatus } from "../features/publication-history/types";
import type { SocialDestinationView, SocialPostView } from "../features/social/types";

describe("derivePublicationStatus", () => {
  it("mostra agendado antes de estados brutos de rascunho/aprovacao", () => {
    expect(derivePublicationStatus({ state: "draft", scheduledAt: "2026-08-20T18:00:00.000Z" })).toBe("scheduled");
    expect(derivePublicationStatus({ state: "waiting_for_approval", scheduledAt: "2026-08-20T18:00:00.000Z" })).toBe("scheduled");
  });

  it("normaliza os estados principais da publicacao", () => {
    expect(derivePublicationStatus({ state: "confirmed_published" })).toBe("published");
    expect(derivePublicationStatus({ state: "dead_lettered" })).toBe("failed");
    expect(derivePublicationStatus({ state: "skipped" })).toBe("cancelled");
    expect(derivePublicationStatus({ state: "dispatched" })).toBe("publishing");
  });
});

describe("contentTypeOf", () => {
  it("classifica midias para filtros da biblioteca de conteudos", () => {
    expect(contentTypeOf({ media: { videoUrl: "https://cdn/video.mp4", imageUrls: [] } })).toBe("video");
    expect(contentTypeOf({ media: { imageUrls: ["https://cdn/1.png", "https://cdn/2.png"] } })).toBe("carousel");
    expect(contentTypeOf({ media: { imageUrls: ["https://cdn/1.png"] } })).toBe("image");
    expect(contentTypeOf({ media: { imageUrls: [] } })).toBe("text");
  });
});

function destination(patch: Partial<SocialDestinationView>): SocialDestinationView {
  return {
    id: "dest-1",
    accountId: "acc-1",
    network: "instagram",
    format: "feed_image",
    formatLabel: "Imagem",
    caption: "Legenda",
    hashtags: [],
    media: [{ url: "https://cdn/img.png", kind: "image" }],
    audioMode: "NONE" as SocialDestinationView["audioMode"],
    attemptCount: 0,
    state: "PUBLISHED" as SocialDestinationView["state"],
    actions: [],
    ...patch,
  };
}

function post(patch: Partial<SocialPostView>): SocialPostView {
  return { id: "post-1", state: "PUBLISHED" as SocialPostView["state"], createdAt: "2026-11-17T02:00:00.000Z", requiresApproval: false, destinations: [destination({})], history: [], ...patch };
}

describe("socialPostsToPublications", () => {
  it("gera uma linha por destino com a midia e a rede reais (IG + FB do mesmo post)", () => {
    const rows = socialPostsToPublications([
      post({ id: "p1", destinations: [
        destination({ id: "d-ig", network: "instagram", media: [{ url: "https://cdn/ig.png", kind: "image" }], externalUrl: "https://instagram.com/p/abc", publishedAt: "2026-11-17T02:05:00.000Z" }),
        destination({ id: "d-fb", network: "facebook", media: [{ url: "https://cdn/fb.png", kind: "image" }], externalUrl: "https://facebook.com/123", publishedAt: "2026-11-17T02:06:00.000Z" }),
      ] }),
    ], ["instagram", "facebook"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "p1", network: "instagram", state: "published", externalUrl: "https://instagram.com/p/abc" });
    expect(rows[0]!.media.imageUrls).toEqual(["https://cdn/ig.png"]);
    expect(rows[1]).toMatchObject({ id: "p1", network: "facebook", externalUrl: "https://facebook.com/123" });
  });

  it("extrai video (com capa) e normaliza o estado para minusculas", () => {
    const rows = socialPostsToPublications([
      post({ destinations: [destination({ format: "story_video", state: "PUBLISHING" as SocialDestinationView["state"], media: [{ url: "https://cdn/v.mp4", kind: "video", coverUrl: "https://cdn/cover.jpg" }] })] }),
    ]);
    expect(rows[0]!.media).toEqual({ videoUrl: "https://cdn/v.mp4", imageUrls: [], thumbnailUrl: "https://cdn/cover.jpg" });
    expect(rows[0]!.placement).toBe("story");
    expect(rows[0]!.state).toBe("publishing");
  });

  it("permite filtrar redes explicitamente quando solicitado", () => {
    const rows = socialPostsToPublications([
      post({ destinations: [destination({ network: "tiktok" }), destination({ network: "instagram" })] }),
    ], ["instagram", "facebook"]);
    expect(rows.map((row) => row.network)).toEqual(["instagram"]);
  });
});

describe("mergePublicationFeeds", () => {
  it("prioriza vídeo, legenda e link reais do YouTube sem duplicar o resumo legado", () => {
    const social = socialPostsToPublications([post({ id: "youtube-1", destinations: [destination({ network: "youtube", format: "short_video", caption: "Meu Short", media: [{ kind: "video", url: "https://cdn.test/short.mp4" }], externalUrl: "https://youtube.com/shorts/abc" })] })]);
    const legacy = [{ ...social[0]!, text: "", media: { imageUrls: [] } }];
    const merged = mergePublicationFeeds(legacy, social);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ text: "Meu Short", media: { videoUrl: "https://cdn.test/short.mp4" }, externalUrl: "https://youtube.com/shorts/abc" });
    expect(contentTypeOf(merged[0]!)).toBe("video");
  });
  it("preserva publicações legadas e destinos diferentes do mesmo post", () => {
    const social = socialPostsToPublications([post({ destinations: [destination({ network: "youtube", format: "short_video", media: [{ kind: "video", url: "https://cdn.test/short.mp4" }] })] })]);
    const legacy = [{ ...social[0]!, network: "tiktok" as const }, { ...social[0]!, id: "older-youtube", createdAt: "2026-01-01T00:00:00Z" }];
    const merged = mergePublicationFeeds(legacy, social);
    expect(merged).toHaveLength(3);
    expect(merged.at(-1)?.id).toBe("older-youtube");
  });
});

describe("legacyNetworkPublishHref", () => {
  it("mantem rotas antigas apontando para Publicar com rede selecionada", () => {
    expect(legacyNetworkPublishHref("workspace-1", "facebook")).toBe("/workspaces/workspace-1/publish?network=facebook");
    expect(legacyNetworkPublishHref("workspace-1", "instagram")).toBe("/workspaces/workspace-1/publish?network=instagram");
    expect(legacyNetworkPublishHref("workspace-1", "tiktok")).toBe("/workspaces/workspace-1/publish?network=tiktok");
  });
});
