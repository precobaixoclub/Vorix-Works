import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentPipeline, CONTENT_STAGE_LABEL, stageOfIdea, stageOfSocialPost } from "../features/marketing/content-stages";
import { composeRedirectHref, createHref, publishFromReviewHref, resolveCreateMode } from "../features/marketing/create-routes";
import { composerDraftKey, isEmptyDraft, parseSavedDraft, readComposerDraft, serializeDraft, writeComposerDraft, clearComposerDraft } from "../features/social/composer-draft";
import { editorialDateLabel, pickableIdeas } from "../features/editorial-ideas/picker-model";
import type { ComposerDraft } from "../features/social/presentation";
import type { EditorialIdea } from "../features/editorial-ideas/api";
import type { SocialPostState } from "../features/social/types";

const empty: ComposerDraft = { caption: "", hashtags: "", media: [], destinations: [], when: { mode: "now" } };

describe("Fase 4 — etapas do conteúdo com nomes em português (estados reais, sem mudar contrato)", () => {
  it("toda publicação social vira uma etapa compreensível", () => {
    const states: SocialPostState[] = ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED", "PUBLISHING", "PUBLISHED", "PARTIAL_SUCCESS", "FAILED", "RECONCILIATION_REQUIRED", "WAITING_REAUTH", "CANCELLED"];
    expect(states.map((state) => CONTENT_STAGE_LABEL[stageOfSocialPost(state)])).toEqual(["Rascunho", "Aguardando aprovação", "Agendado", "Publicando", "Publicado", "Falhou", "Falhou", "Falhou", "Falhou", "Cancelado"]);
  });

  it("ideia do Bolsão: disponível é ideia pendente; produzida aguarda aprovação", () => {
    expect(stageOfIdea("available")).toBe("idea");
    expect(stageOfIdea("in_production")).toBe("in_production");
    expect(stageOfIdea("produced")).toBe("awaiting_approval");
    expect(stageOfIdea("approved")).toBe("approved");
    expect(stageOfIdea("published")).toBe("published");
    expect(stageOfIdea("archived")).toBe("archived");
  });

  it("jornada conta cada etapa e aponta para a tela certa; fonte ausente = sem número (nunca 0 falso)", () => {
    const steps = contentPipeline({
      ideas: [{ status: "available" }, { status: "available" }, { status: "in_production" }, { status: "produced" }],
      posts: [{ state: "AWAITING_APPROVAL" }, { state: "SCHEDULED" }, { state: "PUBLISHED" }, { state: "PARTIAL_SUCCESS" }, { state: "FAILED" }],
    });
    expect(steps.map((step) => [step.key, step.count, step.href])).toEqual([
      ["ideas", 2, "/ideias"],
      ["in_production", 1, "/production"],
      ["review", 2, "/review"],
      ["scheduled", 1, "/calendar"],
      ["published", 1, "/campaigns?status=published"],
      ["failed", 2, "/campaigns?status=failed"],
    ]);
    expect(contentPipeline({}).map((step) => step.count)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(contentPipeline({ ideas: [] }).find((step) => step.key === "review")!.count).toBe(0);
  });
});

describe("Fase 4 — endereços de Criar conteúdo (links antigos preservados)", () => {
  const mode = (query: string) => resolveCreateMode(new URLSearchParams(query));
  it("modo explícito, links antigos de IA e do compositor", () => {
    expect(mode("")).toBeUndefined();
    expect(mode("modo=ia")).toBe("ia");
    expect(mode("modo=pronto")).toBe("pronto");
    expect(mode("draft=Promo%C3%A7%C3%A3o")).toBe("ia");
    expect(mode("format=carousel&aspectRatio=4:5")).toBe("ia");
    expect(mode("media=https://x/y.jpg&caption=oi&source=run-1")).toBe("pronto");
    expect(mode("modo=outro")).toBeUndefined();
  });

  it("/social/compose → /create?modo=pronto com mídia, legenda e origem intactas", () => {
    const href = composeRedirectHref("ws-1", "media=https%3A%2F%2Fcdn%2Fa.jpg&media=https%3A%2F%2Fcdn%2Fb.jpg&caption=Ol%C3%A1&source=run-7");
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/workspaces/ws-1/create");
    expect(url.searchParams.get("modo")).toBe("pronto");
    expect(url.searchParams.getAll("media")).toEqual(["https://cdn/a.jpg", "https://cdn/b.jpg"]);
    expect(url.searchParams.get("caption")).toBe("Olá");
    expect(url.searchParams.get("source")).toBe("run-7");
    expect(composeRedirectHref("ws-1", "")).toBe("/workspaces/ws-1/create?modo=pronto");
    expect(composeRedirectHref("ws-1", "modo=ia&caption=x")).toBe("/workspaces/ws-1/create?modo=pronto&caption=x");
  });

  it("Revisão → publicar a peça aprovada no compositor; sem legenda placeholder", () => {
    const url = new URL(publishFromReviewHref("ws-1", "run-9", ["https://cdn/p.png"], "Sem descrição."), "http://x");
    expect(url.searchParams.get("modo")).toBe("pronto");
    expect(url.searchParams.get("caption")).toBeNull();
    expect(url.searchParams.get("source")).toBe("run-9");
    expect(createHref("ws-2")).toBe("/workspaces/ws-2/create");
    expect(createHref("ws-2", "ia")).toBe("/workspaces/ws-2/create?modo=ia");
  });
});

describe("Fase 4 — rascunho do compositor (neste dispositivo, por workspace)", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { window?: unknown }).window = { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) } };
  });
  afterEach(() => { delete (globalThis as { window?: unknown }).window; });

  const filled: ComposerDraft = { ...empty, caption: "Coleção nova", media: [{ url: "https://cdn/a.jpg", kind: "image" }], destinations: [{ accountId: "acc-ig", network: "instagram", format: "feed_image", customize: false, caption: "Coleção nova", hashtags: "" }], when: { mode: "schedule", date: "2026-12-01", time: "10:00", timezone: "America/Sao_Paulo" } };

  it("rascunho vazio não é salvo como conteúdo", () => {
    expect(isEmptyDraft(empty)).toBe(true);
    expect(isEmptyDraft({ ...empty, hashtags: "#a" })).toBe(false);
    expect(isEmptyDraft(filled)).toBe(false);
  });

  it("salvar e recuperar devolvem o mesmo rascunho; cada workspace tem o seu", () => {
    expect(writeComposerDraft("ws-a", filled)).toBe(true);
    expect(readComposerDraft("ws-a")?.draft).toEqual(filled);
    expect(readComposerDraft("ws-b")).toBeUndefined();
    expect(composerDraftKey("ws-a")).not.toBe(composerDraftKey("ws-b"));
    clearComposerDraft("ws-a");
    expect(readComposerDraft("ws-a")).toBeUndefined();
  });

  it("conteúdo corrompido ou de formato antigo é ignorado; mídia inválida é descartada", () => {
    expect(parseSavedDraft("{não é json")).toBeUndefined();
    expect(parseSavedDraft(JSON.stringify({ savedAt: "x", draft: { caption: 1 } }))).toBeUndefined();
    const parsed = parseSavedDraft(JSON.stringify({ savedAt: "2026-11-23T10:00:00Z", draft: { ...filled, media: [{ url: "https://cdn/a.jpg", kind: "image" }, { url: 5 }, { url: "x", kind: "pdf" }] } }));
    expect(parsed?.draft.media).toEqual([{ url: "https://cdn/a.jpg", kind: "image" }]);
    expect(JSON.parse(serializeDraft(filled, new Date("2026-11-23T10:00:00Z"))).savedAt).toBe("2026-11-23T10:00:00.000Z");
  });

  it("sem armazenamento disponível: não quebra, só avisa que não salvou", () => {
    (globalThis as { window?: unknown }).window = { localStorage: { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); }, removeItem: () => { throw new Error("bloqueado"); } } };
    expect(writeComposerDraft("ws-a", filled)).toBe(false);
    expect(readComposerDraft("ws-a")).toBeUndefined();
    expect(() => clearComposerDraft("ws-a")).not.toThrow();
  });
});

describe("Fase 4 — escolher ideia do Bolsão", () => {
  const idea = (over: Partial<EditorialIdea>): EditorialIdea => ({ id: "i", externalId: "e", title: "Ideia", category: "Moda", commercialObjective: "", targetAudience: "", concept: "", keyMessage: "", format: "single_image", approach: "", visualDirection: "", narrativeStructure: "", caption: "", cta: "", priority: "normal", status: "available", statusChangedAt: "2026-11-01", ...over });

  it("só pendentes; data editorial mais próxima primeiro; prioridade desempata; busca por título/tema", () => {
    const ideas = [
      idea({ id: "sem-data", title: "Bastidores" }),
      idea({ id: "dez", title: "Natal", scheduledDate: "2026-12-20" }),
      idea({ id: "nov", title: "Black Friday", suggestedDate: "2026-11-27" }),
      idea({ id: "nov-high", title: "Cupom", suggestedDate: "2026-11-27", priority: "high" }),
      idea({ id: "usada", title: "Antiga", status: "published" }),
      idea({ id: "producao", title: "Em produção", status: "in_production" }),
    ];
    expect(pickableIdeas(ideas, "").map((item) => item.id)).toEqual(["nov-high", "nov", "dez", "sem-data"]);
    expect(pickableIdeas(ideas, "NATAL").map((item) => item.id)).toEqual(["dez"]);
    expect(pickableIdeas(ideas, "moda").length).toBe(4);
  });

  it("data editorial é rotulada à parte (planejamento, não a data de publicação)", () => {
    expect(editorialDateLabel({ scheduledDate: "2026-12-20" })).toBe("20/12");
    expect(editorialDateLabel({ suggestedDate: "2026-11-27T00:00:00Z" })).toBe("27/11");
    expect(editorialDateLabel({})).toBeUndefined();
  });
});
