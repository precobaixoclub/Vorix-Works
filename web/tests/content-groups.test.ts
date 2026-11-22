import { describe, expect, it } from "vitest";
import { groupPublications, groupStatus } from "../features/publication-history/content-groups";
import type { UnifiedPublication } from "../features/publication-history/types";

const post = (network: UnifiedPublication["network"], id: string, overrides: Partial<UnifiedPublication> = {}): UnifiedPublication => ({
  id,
  network,
  placement: "feed",
  text: "A conversa acabou. O contexto precisa ficar.",
  media: { imageUrls: ["https://api.vorixworks.com/uploads/t/w/arte.jpg?exp=1&sig=a"] },
  state: "published",
  createdAt: "2026-11-21T14:10:00.000Z",
  publishedAt: "2026-11-21T14:10:30.000Z",
  ...overrides,
});

describe("conteúdos: uma peça, várias redes", () => {
  it("a mesma peça no Instagram e no Facebook vira um conteúdo só", () => {
    const groups = groupPublications([
      post("instagram", "ig-1"),
      post("facebook", "fb-1", { createdAt: "2026-11-21T14:10:05.000Z", media: { imageUrls: ["https://api.vorixworks.com/uploads/t/w/arte.jpg?exp=2&sig=b"] } }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.networks.sort()).toEqual(["facebook", "instagram"]);
  });

  it("legenda diferente, outro dia ou a mesma rede de novo continuam separados", () => {
    expect(groupPublications([post("instagram", "a"), post("facebook", "b", { text: "Outra legenda" })])).toHaveLength(2);
    expect(groupPublications([post("instagram", "a"), post("facebook", "b", { createdAt: "2026-11-22T14:10:00.000Z" })])).toHaveLength(2);
    expect(groupPublications([post("youtube", "a"), post("youtube", "b")])).toHaveLength(2);
  });

  it("mesma legenda com mídia diferente não junta", () => {
    expect(groupPublications([post("instagram", "a"), post("facebook", "b", { media: { imageUrls: ["https://api.vorixworks.com/uploads/t/w/outra.jpg"] } })])).toHaveLength(2);
  });

  it("publicado em uma rede e falhou em outra conta como publicado (o detalhe mostra a falha)", () => {
    expect(groupStatus([post("instagram", "a"), post("facebook", "b", { state: "failed" })])).toBe("published");
    expect(groupStatus([post("instagram", "a", { state: "failed" })])).toBe("failed");
  });
});
