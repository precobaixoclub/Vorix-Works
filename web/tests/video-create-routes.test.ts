import { describe, expect, it } from "vitest";
import { createHref, resolveCreateMode } from "@/features/marketing/create-routes";

describe("Criar vídeo com IA — rota", () => {
  it("abre o modo vídeo pelo parâmetro e monta o link do projeto", () => {
    expect(resolveCreateMode(new URLSearchParams("modo=video"))).toBe("video");
    expect(createHref("ws-1", "video", new URLSearchParams({ projeto: "vproj-1" }))).toBe("/workspaces/ws-1/create?modo=video&projeto=vproj-1");
  });
});
