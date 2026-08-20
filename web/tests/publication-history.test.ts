import { describe, expect, it } from "vitest";
import { legacyNetworkPublishHref } from "../features/publication-history/legacy-routes";
import { contentTypeOf, derivePublicationStatus } from "../features/publication-history/types";

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

describe("legacyNetworkPublishHref", () => {
  it("mantem rotas antigas apontando para Publicar com rede selecionada", () => {
    expect(legacyNetworkPublishHref("workspace-1", "facebook")).toBe("/workspaces/workspace-1/publish?network=facebook");
    expect(legacyNetworkPublishHref("workspace-1", "instagram")).toBe("/workspaces/workspace-1/publish?network=instagram");
    expect(legacyNetworkPublishHref("workspace-1", "tiktok")).toBe("/workspaces/workspace-1/publish?network=tiktok");
  });
});
