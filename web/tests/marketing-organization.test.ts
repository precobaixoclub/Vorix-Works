import { describe, expect, it } from "vitest";
import { buildCalendarItems, countByStatus, filterCalendarItems, groupByDay, inRange, monthCells, PLANNING_STATUSES, rangeFor, shiftCursor, startOfWeek } from "../features/marketing/calendar-model";
import { brandChecklist, brandProgress, brandSwatches } from "../features/brand-profile/checklist";
import { derivePublicationStatus, type UnifiedPublication } from "../features/publication-history/types";
import { groupStatus } from "../features/publication-history/content-groups";
import type { EditorialIdea } from "../features/editorial-ideas/api";

const pub = (over: Partial<UnifiedPublication>): UnifiedPublication => ({ id: "p1", network: "instagram", placement: "feed", text: "Coleção nova\nlinha 2", media: { imageUrls: ["https://cdn/a.jpg"] }, state: "scheduled", createdAt: "2026-11-20T10:00:00Z", scheduledAt: "2026-11-25T15:00:00Z", ...over });
const idea = (over: Partial<EditorialIdea>): EditorialIdea => ({ id: "i1", externalId: "e", title: "Vestido do mês", category: "", commercialObjective: "", targetAudience: "", concept: "", keyMessage: "", format: "single_image", approach: "", visualDirection: "", narrativeStructure: "", caption: "", cta: "", priority: "normal", status: "available", statusChangedAt: "2026-11-01", ...over });

describe("Fase 5 — status de publicação: aguardando aprovação separado (só o do compositor social)", () => {
  it("AWAITING_APPROVAL do compositor não vira 'Agendado'; o 'waiting_for_approval' legado segue como antes", () => {
    expect(derivePublicationStatus({ state: "awaiting_approval", scheduledAt: "2026-12-01T10:00:00Z" })).toBe("awaiting_approval");
    expect(derivePublicationStatus({ state: "waiting_for_approval", scheduledAt: "2026-12-01T10:00:00Z" })).toBe("scheduled");
    expect(derivePublicationStatus({ state: "failed", scheduledAt: "2026-12-01T10:00:00Z" })).toBe("failed");
    expect(groupStatus([pub({ state: "awaiting_approval" }), pub({ network: "facebook", state: "awaiting_approval" })])).toBe("awaiting_approval");
  });
});

describe("Fase 5 — calendário único", () => {
  it("post social em várias redes vira UMA entrada com as redes; legado fica por rede", () => {
    const items = buildCalendarItems([
      pub({ id: "s1", source: "social", network: "instagram" }),
      pub({ id: "s1", source: "social", network: "facebook", state: "failed" }),
      pub({ id: "t1", network: "tiktok", state: "published", scheduledAt: undefined, publishedAt: "2026-11-22T12:00:00Z" }),
    ], []);
    expect(items.map((item) => [item.key, item.status, item.networks])).toEqual([
      ["tiktok:t1", "published", ["tiktok"]],
      ["social:s1", "failed", ["instagram", "facebook"]], // a situação mais urgente aparece
    ]);
    const social = items[1]!;
    expect(social.kind === "publication" && social.social && social.postId).toBe("s1");
    expect(social.kind === "publication" && social.thumb).toBe("https://cdn/a.jpg");
    expect(social.title).toBe("Coleção nova");
  });

  it("rascunho sem data real não entra; ideia com data editorial entra como planejamento, não como publicação", () => {
    const items = buildCalendarItems([pub({ id: "d", state: "draft", scheduledAt: undefined })], [
      idea({ id: "a", scheduledDate: "2026-11-27" }),
      idea({ id: "b", status: "in_production", suggestedDate: "2026-11-28" }),
      idea({ id: "c", status: "produced", scheduledDate: "2026-11-29" }),
      idea({ id: "sem-data" }),
      idea({ id: "pub", status: "published", scheduledDate: "2026-11-30" }),
      idea({ id: "arq", status: "archived", scheduledDate: "2026-11-30" }),
    ]);
    expect(items.map((item) => [item.key, item.kind, item.status])).toEqual([
      ["idea:a", "idea", "planned"],
      ["idea:b", "idea", "in_production"],
      ["idea:c", "idea", "awaiting_review"],
    ]);
    for (const item of items) expect(PLANNING_STATUSES.has(item.status)).toBe(true);
    // data editorial "AAAA-MM-DD" cai no mesmo dia em qualquer fuso
    expect(items[0]!.date.getDate()).toBe(27);
    expect(items[0]!.networks).toEqual([]);
  });

  it("filtros: ideias podem ser ocultadas; filtro de rede mostra só publicações; filtro de status exato", () => {
    const items = buildCalendarItems([pub({ id: "s1", source: "social" }), pub({ id: "t1", network: "tiktok", state: "failed" })], [idea({ scheduledDate: "2026-11-27" })]);
    expect(filterCalendarItems(items, { network: "all", status: "all", showIdeas: true })).toHaveLength(3);
    expect(filterCalendarItems(items, { network: "all", status: "all", showIdeas: false }).every((item) => item.kind === "publication")).toBe(true);
    expect(filterCalendarItems(items, { network: "tiktok", status: "all", showIdeas: true }).map((item) => item.key)).toEqual(["tiktok:t1"]);
    expect(filterCalendarItems(items, { network: "all", status: "planned", showIdeas: true }).map((item) => item.key)).toEqual(["idea:i1"]);
    expect(countByStatus(items)).toEqual({ scheduled: 1, failed: 1, planned: 1 });
  });

  it("períodos: mês com semanas completas (seg–dom), semana, navegação e agenda por dia", () => {
    const cursor = new Date(2026, 10, 15);
    const cells = monthCells(cursor);
    expect(cells.length % 7).toBe(0);
    expect(cells[0]!.getDay()).toBe(1);
    expect(cells[cells.length - 1]!.getDay()).toBe(0);
    expect(startOfWeek(new Date(2026, 10, 23)).getDate()).toBe(23); // segunda
    const month = rangeFor(cursor, "month");
    expect([month.from.getDate(), month.to.getMonth()]).toEqual([1, 11]);
    expect(month.label).toBe("Novembro de 2026");
    expect(rangeFor(new Date(2026, 10, 23), "week").label).toMatch(/^23 de nov\.? – 29 de nov\.?$/);
    expect(rangeFor(cursor, "week").to.getTime() - rangeFor(cursor, "week").from.getTime()).toBe(7 * 86_400_000);
    expect(shiftCursor(cursor, "month", 1).getMonth()).toBe(11);
    expect(shiftCursor(cursor, "week", -1).getDate()).toBe(8);
    const items = buildCalendarItems([pub({ id: "a", scheduledAt: "2026-11-25T10:00:00" }), pub({ id: "b", scheduledAt: "2026-11-25T18:00:00" }), pub({ id: "c", scheduledAt: "2026-12-02T10:00:00" })], []);
    expect(inRange(items, month).map((item) => item.key)).toEqual(["instagram:a", "instagram:b"]);
    expect(groupByDay(inRange(items, month)).map((group) => group.items.length)).toEqual([2]);
  });
});

describe("Fase 5 — Marca e identidade em 8 partes", () => {
  const loaded = { profile: true, identity: true, assets: true, guidelines: true };
  it("marca vazia: tudo pendente e 3 partes essenciais faltando", () => {
    const items = brandChecklist({ profile: {} as never, identity: null, assets: [], guidelines: "", loaded });
    expect(items.map((item) => item.key)).toEqual(["company", "positioning", "logo", "colors", "typography", "materials", "guidelines", "rules"]);
    expect(items.every((item) => item.status === "pending")).toBe(true);
    expect(brandProgress(items)).toEqual({ done: 0, total: 8, missingRequired: 3 });
  });

  it("dados reais preenchem cada parte; cores proibidas não contam como cor da marca, contam como regra", () => {
    const items = brandChecklist({
      profile: { brandName: "Vorix", targetAudience: "Noivas" } as never,
      identity: { colors: [{ hex: "#112233", role: "PRIMARY" }, { hex: "#FF0000", role: "FORBIDDEN" }], logos: [], imageStyles: [], forbiddenPatterns: [], preferredPatterns: [], schemaVersion: 1, version: 1, updatedAt: "" },
      assets: [{ id: "a", kind: "logo", status: "active" }, { id: "b", kind: "product", status: "active" }, { id: "c", kind: "photo", status: "archived" }] as never,
      guidelines: "Sempre luz natural",
      loaded,
    });
    const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
    expect(byKey.company!.status).toBe("done");
    expect(byKey.positioning!.status).toBe("done");
    expect(byKey.logo).toMatchObject({ status: "done", detail: "1 logo(s)" });
    expect(byKey.colors).toMatchObject({ status: "done", detail: "1 cor(es)" });
    expect(byKey.materials).toMatchObject({ status: "done", detail: "1 material(is)" });
    expect(byKey.guidelines!.status).toBe("done");
    expect(byKey.rules!.status).toBe("done");
    expect(byKey.typography!.status).toBe("pending");
    expect(brandProgress(items)).toEqual({ done: 7, total: 8, missingRequired: 0 });
  });

  it("fonte ainda carregando nunca vira 'pendente' falso", () => {
    const items = brandChecklist({ loaded: { profile: false, identity: false, assets: false, guidelines: false } });
    expect(items.every((item) => item.status === "unknown")).toBe(true);
    expect(brandProgress(items).missingRequired).toBe(0);
  });

  it("prévia de cores: identidade estruturada (sem proibidas) ou, na falta, cores do perfil; só hex válido", () => {
    expect(brandSwatches({ colors: [{ hex: "#112233", role: "PRIMARY" }, { hex: "#FF0000", role: "FORBIDDEN" }] } as never, null)).toEqual(["#112233"]);
    expect(brandSwatches(null, { brandColors: ["#ABCDEF", "azul"] } as never)).toEqual(["#ABCDEF"]);
  });
});
