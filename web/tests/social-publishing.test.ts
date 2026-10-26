import { describe, expect, it } from "vitest";
import { SOLUTION_NAVIGATION } from "../components/workspace-navigation";
import { routeOwner } from "../lib/solutions";
import {
  allowedActions,
  buildComposeRequest,
  compatibleFormats,
  composerBlockers,
  defaultFormat,
  DESTINATION_STATE_META,
  destinationActionLabel,
  destinationStatusLine,
  groupPostsByDay,
  integrationCard,
  monthGrid,
  networkChoices,
  POST_STATE_META,
  previewAspect,
  splitHashtags,
  waitingLabel,
  zonedToUtc,
  type ComposerDraft,
} from "../features/social/presentation";
import type { SocialAccountView, SocialComposerAccount, SocialMediaItem, SocialPostView } from "../features/social/types";

const account = (overrides: Partial<SocialAccountView> = {}): SocialAccountView => ({ id: "acc-1", network: "instagram", username: "loja", status: "HEALTHY", statusLabel: "Conectada", needsReconnect: false, waitingPublications: 0, ...overrides });

const igOption: SocialComposerAccount = {
  accountId: "ig-1",
  network: "instagram",
  username: "loja",
  publishable: true,
  musicSearch: false,
  formats: [
    { format: "feed_image", label: "Imagem no feed", features: ["caption", "hashtags"], maxItems: 1, kinds: ["image"], maxCaptionLength: 2200 },
    { format: "carousel", label: "Carrossel", features: ["caption"], maxItems: 10, kinds: ["image"], maxCaptionLength: 2200 },
    { format: "reel", label: "Reel", features: ["caption", "embeddedAudio"], maxItems: 1, kinds: ["video"], maxCaptionLength: 2200 },
    { format: "story_image", label: "Story (imagem)", features: [], maxItems: 1, kinds: ["image"], maxCaptionLength: 0 },
  ],
};
const ttOption: SocialComposerAccount = { accountId: "tt-1", network: "tiktok", publishable: true, musicSearch: false, formats: [{ format: "short_video", label: "Vídeo curto", features: ["caption"], maxItems: 1, kinds: ["video"], maxCaptionLength: 2200 }] };
const IMAGE: SocialMediaItem = { url: "https://cdn/a.jpg", kind: "image", width: 1080, height: 1350 };
const VIDEO: SocialMediaItem = { url: "https://cdn/v.mp4", kind: "video", width: 1080, height: 1920, durationSec: 20 };

describe("Integrações", () => {
  it("rede sem conta: 'Conectar'; liberação pendente: indisponível com mensagem simples", () => {
    expect(integrationCard("instagram", [], { network: "instagram", canConnect: true })).toMatchObject({ state: "disconnected", primaryAction: "connect" });
    const locked = integrationCard("tiktok", [], { network: "tiktok", canConnect: false, message: "A publicação no TikTok ainda não está liberada para a sua conta." });
    expect(locked.state).toBe("unavailable");
    expect(locked.primaryAction).toBeUndefined();
    expect(locked.message).toContain("ainda não está liberada");
  });

  it("conta conectada e conta que precisa reconectar (com publicações aguardando)", () => {
    expect(integrationCard("instagram", [account()], { network: "instagram", canConnect: true })).toMatchObject({ state: "connected", headline: "Conectado" });
    const attention = integrationCard("instagram", [account({ status: "REAUTH_REQUIRED", statusLabel: "Reconexão necessária", needsReconnect: true, waitingPublications: 3 })], { network: "instagram", canConnect: true });
    expect(attention).toMatchObject({ state: "attention", primaryAction: "reconnect", message: "Sua conta precisa ser reconectada.", waitingPublications: 3 });
    expect(waitingLabel(3)).toBe("3 publicações aguardando reconexão");
    expect(waitingLabel(1)).toBe("1 publicação aguardando reconexão");
    expect(waitingLabel(0)).toBeUndefined();
  });
});

describe("Composer", () => {
  it("rede sem conta ou com conta doente fica desabilitada com motivo e atalho para conectar", () => {
    const choices = networkChoices([igOption, { ...ttOption, publishable: false, warning: "Sua conta do TikTok precisa ser reconectada." }], "ws-1");
    expect(choices.find((choice) => choice.network === "instagram")).toMatchObject({ selectable: true });
    expect(choices.find((choice) => choice.network === "facebook")).toMatchObject({ selectable: false, cta: { label: "Conectar Facebook", href: "/workspaces/ws-1/social/integrations" } });
    expect(choices.find((choice) => choice.network === "tiktok")).toMatchObject({ selectable: false, reason: "Sua conta do TikTok precisa ser reconectada.", cta: { label: "Reconectar TikTok" } });
  });

  it("capabilities controlam os formatos oferecidos (sem paridade presumida entre redes)", () => {
    expect(compatibleFormats(igOption, [IMAGE]).map((format) => format.format)).toEqual(["feed_image", "story_image"]);
    expect(compatibleFormats(igOption, [IMAGE, IMAGE]).map((format) => format.format)).toEqual(["carousel"]);
    expect(compatibleFormats(igOption, [VIDEO]).map((format) => format.format)).toEqual(["reel"]);
    expect(compatibleFormats(ttOption, [IMAGE])).toEqual([]);
    expect(defaultFormat(igOption, [VIDEO])).toBe("reel");
    expect(defaultFormat(igOption, [IMAGE, IMAGE])).toBe("carousel");
    expect(defaultFormat(ttOption, [VIDEO])).toBe("short_video");
  });

  it("monta o pedido: legenda base + personalização por rede; agendamento no fuso do workspace", () => {
    const draft: ComposerDraft = {
      caption: "Oferta",
      hashtags: "#promo, novidade",
      media: [VIDEO],
      destinations: [
        { accountId: "ig-1", network: "instagram", format: "reel", customize: false, caption: "", hashtags: "" },
        { accountId: "tt-1", network: "tiktok", format: "short_video", customize: true, caption: "Legenda TikTok", hashtags: "#tiktok" },
      ],
      when: { mode: "schedule", date: "2026-11-01", time: "10:00", timezone: "America/Sao_Paulo" },
      sourceExecutionRunId: "run-9",
    };
    const request = buildComposeRequest("ws-1", draft, "key-1");
    expect(request.base).toEqual({ caption: "Oferta", hashtags: ["promo", "novidade"], media: [VIDEO] });
    expect(request.destinations).toEqual([{ accountId: "ig-1", format: "reel" }, { accountId: "tt-1", format: "short_video", caption: "Legenda TikTok", hashtags: ["tiktok"] }]);
    expect(request.when).toEqual({ mode: "schedule", localDateTime: "2026-11-01T10:00", timezone: "America/Sao_Paulo" });
    expect(request.source).toEqual({ executionRunId: "run-9" });
    expect(splitHashtags("#a #a b,c ## d!")).toEqual(["a", "b", "c"]);
  });

  it("bloqueia o envio sem rede, sem mídia ou com horário no passado", () => {
    const base: ComposerDraft = { caption: "", hashtags: "", media: [], destinations: [], when: { mode: "now" } };
    expect(composerBlockers(base)).toEqual(["Escolha ao menos uma rede.", "Adicione uma imagem ou vídeo."]);
    const past: ComposerDraft = { ...base, media: [IMAGE], destinations: [{ accountId: "ig-1", network: "instagram", format: "feed_image", customize: false, caption: "", hashtags: "" }], when: { mode: "schedule", date: "2020-01-01", time: "10:00", timezone: "America/Sao_Paulo" } };
    expect(composerBlockers(past)).toEqual(["Escolha um horário no futuro."]);
  });

  it("prévia usa a proporção do formato", () => {
    expect(previewAspect("reel", [VIDEO])).toBe("9 / 16");
    expect(previewAspect("story_image", [IMAGE])).toBe("9 / 16");
    expect(previewAspect("feed_image", [IMAGE])).toBe("1080 / 1350");
    expect(previewAspect("feed_image", [{ ...IMAGE, width: 1000, height: 3000 }])).toBe("4 / 5");
  });
});

describe("Calendário e estados", () => {
  const post = (overrides: Partial<SocialPostView>): SocialPostView => ({ id: "p", state: "SCHEDULED", createdAt: "2026-11-01T10:00:00.000Z", requiresApproval: false, destinations: [], history: [], ...overrides });

  it("agrupa por dia no fuso do workspace (não UTC)", () => {
    const late = post({ id: "late", scheduledAt: "2026-11-02T01:30:00.000Z" });
    const groups = groupPostsByDay([late], "America/Sao_Paulo");
    expect([...groups.keys()]).toEqual(["2026-11-01"]);
    expect(zonedToUtc("2026-11-01T22:30", "America/Sao_Paulo").toISOString()).toBe("2026-11-02T01:30:00.000Z");
  });

  it("grade do mês começa no dia da semana certo", () => {
    const weeks = monthGrid(2026, 11);
    expect(weeks[0]![0]).toBe("2026-11-01");
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
  });

  it("rótulos compreensíveis: parcial, confirmação pendente, aguardando reconexão", () => {
    expect(POST_STATE_META.PARTIAL_SUCCESS.label).toBe("Parcial");
    expect(POST_STATE_META.RECONCILIATION_REQUIRED.label).toBe("Confirmação pendente");
    expect(DESTINATION_STATE_META.RECONCILIATION_REQUIRED.label).toBe("Confirmação de publicação pendente");
    expect(destinationStatusLine("instagram", "WAITING_REAUTH")).toBe("Aguardando reconexão do Instagram");
    expect(destinationStatusLine("tiktok", "FAILED")).toBe("TikTok — Falhou");
    expect(destinationActionLabel("retry", "tiktok")).toBe("Tentar novamente no TikTok");
  });

  it("RBAC: ações só aparecem para quem pode", () => {
    const editor = new Set(["marketing:social_read", "marketing:social_publish", "marketing:social_schedule"]);
    const viewer = new Set(["marketing:social_read"]);
    expect(allowedActions(["retry", "cancel", "reconnect", "resolve_unknown"], (permission) => editor.has(permission))).toEqual(["retry", "cancel", "resolve_unknown"]);
    expect(allowedActions(["retry", "cancel", "reconnect"], (permission) => viewer.has(permission))).toEqual([]);
  });
});

describe("Navegação", () => {
  it("Marketing tem a seção Redes sociais e /social pertence ao Marketing", () => {
    const section = SOLUTION_NAVIGATION.marketing.sections.find((item) => item.label === "REDES SOCIAIS");
    expect(section?.items.map((item) => item.href)).toEqual(["/social/compose", "/social/calendar", "/social/integrations"]);
    expect(SOLUTION_NAVIGATION.marketing.mobileMenu.some((group) => group.items.some((item) => item.href === "/social/integrations"))).toBe(true);
    expect(routeOwner("/workspaces/ws-1/social/compose", "/workspaces/ws-1")).toBe("marketing");
  });
});
