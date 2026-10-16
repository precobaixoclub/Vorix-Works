import { describe, expect, it } from "vitest";
import { filterQuickReplies, quickReplyQuery } from "@/app/workspaces/[workspaceId]/conversas/inbox-essentials";
import type { InboxQuickReply } from "@/features/inbox/types";

const reply = (shortcut: string, body: string): InboxQuickReply => ({ id: shortcut, shortcut, body, createdAt: "", updatedAt: "" });
const items = [reply("bom-dia", "Bom dia! Como posso ajudar?"), reply("pix", "Nossa chave Pix é o CNPJ."), reply("horario", "Atendemos das 8h às 18h, bom atendimento!")];

describe("respostas rápidas no composer", () => {
  it("só ativa quando o rascunho inteiro é /atalho", () => {
    expect(quickReplyQuery("/")).toBe("");
    expect(quickReplyQuery("/Bom")).toBe("bom");
    expect(quickReplyQuery("/bom dia")).toBeUndefined();
    expect(quickReplyQuery("oi /bom")).toBeUndefined();
    expect(quickReplyQuery("")).toBeUndefined();
  });
  it("prioriza atalhos que começam com o termo e também busca no texto", () => {
    expect(filterQuickReplies(items, "").map((item) => item.shortcut)).toEqual(["bom-dia", "pix", "horario"]);
    expect(filterQuickReplies(items, "bom").map((item) => item.shortcut)).toEqual(["bom-dia", "horario"]);
    expect(filterQuickReplies(items, "chave").map((item) => item.shortcut)).toEqual(["pix"]);
  });
});
