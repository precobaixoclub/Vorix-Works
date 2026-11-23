import { describe, expect, it } from "vitest";
import { inProposalView, originLabel, PROPOSAL_VIEWS, proposalViewCounts, siteOrderOf } from "../features/sales/sales-model";
import type { ProposalStatus } from "../features/crm/types";

describe("Fase 7 — origem das oportunidades (só o que o servidor gravou)", () => {
  it("rótulos das origens reais; sem origem não inventa 'cadastro manual'", () => {
    expect(originLabel("site_checkout")).toBe("Site (pedido da loja)");
    expect(originLabel("whatsapp")).toBe("Atendimento (WhatsApp)");
    expect(originLabel("indicação")).toBe("Indicação");
    expect(originLabel("")).toBeUndefined();
    expect(originLabel(undefined)).toBeUndefined();
  });
  it("pedido do Site só pelo vínculo gravado (customFields.commerceOrderId), nunca por coincidência", () => {
    expect(siteOrderOf({ origin: "site_checkout", customFields: { commerceOrderId: "ord-1", commerceOrderNumber: 1042 } })).toEqual({ id: "ord-1", number: 1042 });
    expect(siteOrderOf({ origin: "site_checkout", customFields: {} })).toBeUndefined();
    expect(siteOrderOf({ origin: "whatsapp", customFields: { commerceOrderId: 5 } })).toBeUndefined();
  });
});

describe("Fase 7 — visões de propostas pelas situações reais", () => {
  const all: ProposalStatus[] = ["draft", "pending_approval", "approved", "sent", "viewed", "accepted", "invoiced", "rejected", "expired", "cancelled", "superseded"];
  it("toda situação real cai em exatamente uma visão (além de 'Todas')", () => {
    for (const status of all) {
      const views = PROPOSAL_VIEWS.filter((view) => view.key !== "all" && inProposalView({ status }, view.key));
      expect(views.map((view) => view.key), status).toHaveLength(1);
    }
  });
  it("'Precisam de acompanhamento' = vista sem resposta; contagem nunca conta a mesma proposta duas vezes", () => {
    const counts = proposalViewCounts([{ id: "a", status: "viewed" }, { id: "a", status: "viewed" }, { id: "b", status: "sent" }, { id: "c", status: "invoiced" }, { id: "d", status: "draft" }]);
    expect(counts).toEqual({ all: 4, drafting: 1, sent: 1, follow_up: 1, accepted: 1, rejected: 0, expired: 0, closed: 0 });
  });
});
