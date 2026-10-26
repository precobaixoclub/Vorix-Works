import { describe, expect, it } from "vitest";
import { buildComposeRequest, composerBlockers, defaultFormat, type ComposerDraft } from "../features/social/presentation";
import type { SocialComposerAccount } from "../features/social/types";

const draft: ComposerDraft = { caption: "Texto orgânico", hashtags: "teste", media: [], when: { mode: "now" }, destinations: [{ accountId: "fb", network: "facebook", format: "feed_text", customize: false, caption: "", hashtags: "" }] };
describe("Capabilities e seleção de áudio", () => {
  it("permite texto no Facebook; valida legenda e mantém mídia obrigatória nos demais formatos", () => {
    expect(composerBlockers(draft)).toEqual([]);
    expect(composerBlockers({ ...draft, caption: "" })).toContain("Escreva o texto da publicação.");
    expect(composerBlockers({ ...draft, destinations: [{ ...draft.destinations[0]!, format: "feed_image" }] })).toContain("Adicione uma imagem ou vídeo.");
    const account: SocialComposerAccount = { accountId: "fb", network: "facebook", publishable: true, musicSearch: false, formats: [{ format: "feed_text", label: "Texto", features: ["caption"], kinds: [], maxItems: 0, maxCaptionLength: 5000 }] };
    expect(defaultFormat(account, [])).toBe("feed_text");
  });
  it("persiste música nativa e trecho por destino, separando áudio já incorporado ao vídeo", () => {
    const music = { musicId: "track-12", title: "Disponível", artist: "Artista", segmentStartSec: 12, segmentDurationSec: 15 };
    const withAudio: ComposerDraft = { ...draft, media: [{ kind: "video", url: "https://cdn.example.test/v.mp4", hasAudio: true }], destinations: [{ ...draft.destinations[0]!, format: "reel", music }, { accountId: "tt", network: "tiktok", format: "short_video", customize: false, caption: "", hashtags: "" }] };
    const request = buildComposeRequest("workspace", withAudio, "idempotency");
    expect(request.destinations[0]).toMatchObject({ music, audioMode: "NATIVE_PLATFORM_MUSIC" });
    expect(request.destinations[1]).toMatchObject({ audioMode: "EMBEDDED_AUDIO" });
    expect(request.destinations[1]).not.toHaveProperty("music");
  });
});
