import { describe, expect, it, vi } from "vitest";
import { unstable_serialize } from "swr";
import { createCoalescer, fallbackInterval, isConversationListKey, isConversationMessagesKey, isRealtimeHealthy, reconnectDelayMs, setRealtimeHealthy, subscribeRealtimeHealth } from "../features/inbox/realtime";
import { activeQuickView, applyQuickView, QUICK_VIEWS, quickViewCounts } from "../features/inbox/quick-views";
import { DEFAULT_INBOX_FILTERS } from "../features/inbox/inbox-filters";
import { classifyWorkspaceError, WORKSPACE_LOAD_MESSAGE } from "../lib/workspace-load-error";
import { ApiError } from "../lib/api-error";
import { operationsTiles } from "../components/inbox/OperationsNow";
import type { InboxConversation } from "../features/inbox/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const conv = (over: Partial<InboxConversation>): InboxConversation => ({ id: "c", connectionId: "k", chatType: "direct", status: "open", unreadCount: 0, isUrgent: false, isPinned: false, aiEnabled: false, automationEnabled: false, ...over }) as any;

describe("Fase 6 — tempo real: causa do atraso da lista e da rajada de requisições", () => {
  it("REGRESSÃO: a chave de 3 partes que o SSE usava NUNCA batia com a lista guardada (4 partes, contato undefined)", () => {
    const listKey = ["inbox-conversations", "ws-1", "all", undefined];
    expect(unstable_serialize(["inbox-conversations", "ws-1", "all"])).not.toBe(unstable_serialize(listKey));
    // O matcher novo pega a lista de verdade — e todas as variações (filtros, contato, Início).
    expect(isConversationListKey(listKey, "ws-1")).toBe(true);
    expect(isConversationListKey(["inbox-conversations", "ws-1", "unread", undefined], "ws-1")).toBe(true);
    expect(isConversationListKey(["inbox-conversations", "ws-1", "all", "contact-9"], "ws-1")).toBe(true);
    // Nunca de outra empresa nem de outra coisa.
    expect(isConversationListKey(["inbox-conversations", "ws-2", "all", undefined], "ws-1")).toBe(false);
    expect(isConversationListKey(["inbox-conversation-messages", "ws-1", "c1", 50], "ws-1")).toBe(false);
    expect(isConversationListKey("inbox-conversations", "ws-1")).toBe(false);
    expect(isConversationMessagesKey(["inbox-conversation-messages", "ws-1", "c1", 100], "ws-1", "c1")).toBe(true);
    expect(isConversationMessagesKey(["inbox-conversation-messages", "ws-1", "c2", 50], "ws-1", "c1")).toBe(false);
  });

  it("rajada de eventos vira UMA busca por janela, sempre depois do último evento (nada se perde)", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const coalescer = createCoalescer(run, 700);
    for (let index = 0; index < 10; index += 1) coalescer.schedule(); // álbum de 10 fotos
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(700);
    expect(run).toHaveBeenCalledTimes(1);
    coalescer.schedule();
    vi.advanceTimersByTime(700);
    expect(run).toHaveBeenCalledTimes(2);
    coalescer.schedule();
    coalescer.cancel(); // desmontou/trocou de workspace: não busca dados velhos
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("REGRESSÃO: funciona com os temporizadores reais (sem 'Illegal invocation' do setTimeout)", async () => {
    const run = vi.fn();
    const realSetTimeout = globalThis.setTimeout;
    // Simula o navegador ANTES de criar o agrupador: setTimeout não aceita `this` de outro objeto.
    globalThis.setTimeout = function (this: unknown, ...args: Parameters<typeof setTimeout>) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return realSetTimeout(...args);
    } as typeof setTimeout;
    try {
      const coalescer = createCoalescer(run, 5);
      expect(() => coalescer.schedule()).not.toThrow();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    await new Promise((resolve) => realSetTimeout(resolve, 20));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reconexão com espera crescente (5s → 60s) em vez de 5s fixo para sempre", () => {
    expect([0, 1, 2, 3, 4, 10].map(reconnectDelayMs)).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it("polling vira rede de segurança só com o tempo real saudável; por workspace", () => {
    expect(fallbackInterval(30_000, false)).toBe(30_000);
    expect(fallbackInterval(20_000, true)).toBe(90_000);
    const listener = vi.fn();
    const unsubscribe = subscribeRealtimeHealth(listener);
    setRealtimeHealthy("ws-a", true);
    setRealtimeHealthy("ws-a", true); // sem mudança, sem aviso
    expect(isRealtimeHealthy("ws-a")).toBe(true);
    expect(isRealtimeHealthy("ws-b")).toBe(false);
    setRealtimeHealthy("ws-a", false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

describe("Fase 6 — vistas rápidas (só combinações dos filtros reais)", () => {
  const list = [
    conv({ id: "a", unreadCount: 2, status: "open" }),
    conv({ id: "b", assignedUserId: "me", status: "open" }),
    conv({ id: "c", status: "pending", isUrgent: true }),
    conv({ id: "d", status: "resolved", assignedUserId: "outra" }),
  ];
  it("contagens por vista sobre a lista carregada", () => {
    expect(quickViewCounts(list, DEFAULT_INBOX_FILTERS, "me")).toEqual({ all: 4, unread: 1, mine: 1, unassigned: 2, open: 2, pending: 1, resolved: 1, urgent: 1 });
  });
  it("escolher uma vista troca só os campos das vistas e preserva os outros filtros (canal, etiqueta, período)", () => {
    const current = { ...DEFAULT_INBOX_FILTERS, channel: "instagram" as const, owner: "me", period: "7d" as const };
    const next = applyQuickView(current, "unassigned");
    expect(next).toMatchObject({ owner: "unassigned", channel: "instagram", period: "7d", status: "all", read: "all", urgent: false });
    expect(activeQuickView(next)).toBe("unassigned");
    expect(activeQuickView(applyQuickView(next, "all"))).toBe("all");
    expect(activeQuickView({ ...DEFAULT_INBOX_FILTERS, owner: "me", status: "open" })).toBeUndefined(); // filtro avançado misto
    expect(QUICK_VIEWS.map((view) => view.label)).toEqual(["Todas", "Não lidas", "Minhas", "Sem responsável", "Em atendimento", "Pendentes", "Finalizadas", "Urgentes"]);
  });
  it("contagem respeita os outros filtros ativos", () => {
    expect(quickViewCounts([conv({ id: "x", connectionProvider: "instagram", unreadCount: 1 }), conv({ id: "y", unreadCount: 1 })], { ...DEFAULT_INBOX_FILTERS, channel: "instagram" }, undefined).unread).toBe(1);
  });
});

describe("Fase 6 — 'Espaço de trabalho não encontrado' só quando é verdade", () => {
  it("404/403 = não encontrado; 429, rede e falhas temporárias = tentar de novo", () => {
    expect(classifyWorkspaceError(new ApiError("WORKSPACE_NOT_FOUND", "x", 404, false))).toBe("not_found");
    expect(classifyWorkspaceError(new ApiError("FORBIDDEN", "x", 403, false))).toBe("not_found");
    expect(classifyWorkspaceError(new ApiError("RATE_LIMIT_EXCEEDED", "Limite operacional de requisições excedido.", 429, true))).toBe("rate_limited");
    expect(classifyWorkspaceError(new ApiError("NETWORK_ERROR", "x", 0, true))).toBe("offline");
    expect(classifyWorkspaceError(new ApiError("INTERNAL", "x", 500, true))).toBe("unavailable");
    expect(classifyWorkspaceError(new TypeError("Failed to fetch"))).toBe("offline");
    expect(WORKSPACE_LOAD_MESSAGE.rate_limited.retry).toBe(true);
    expect(WORKSPACE_LOAD_MESSAGE.not_found.retry).toBe(false);
  });
});

describe("Fase 6 — Agora no atendimento (números do servidor, sem recalcular)", () => {
  const attendance = { backlog: { total: 9, queue: 3, awaitingFirstResponse: 2, awaitingAgent: 1, awaitingCustomer: 0, slaBreached: 1 }, sla: { configured: true, openBreached: 1, openNear: 2, firstResponse: { met: 0, breached: 0 }, resolution: { met: 0, breached: 0 } }, teams: [{ teamId: "t1", backlog: 2 }, { teamId: "t2", backlog: 5 }, { teamId: "t3", backlog: 0 }] } as any;
  it("aguardando, sem responsável, prazo vencido e equipe mais cheia, cada um com o destino certo", () => {
    const tiles = operationsTiles(attendance, new Map([["t2", "Suporte"]]));
    expect(tiles.map((tile) => [tile.key, tile.value, tile.href])).toEqual([
      ["waiting", 3, "/conversas?read=unread"],
      ["unassigned", 3, "/conversas?owner=unassigned"],
      ["sla", 1, "/conversas"],
      ["team", 5, "/kanban?team=t2"],
    ]);
    expect(tiles[3]!.hint).toBe("Suporte");
    expect(tiles[2]!.tone).toBe("critical");
  });
  it("sem SLA configurado não inventa prazo; sem fila em equipe não destaca equipe", () => {
    const tiles = operationsTiles({ ...attendance, sla: { ...attendance.sla, configured: false }, teams: [{ teamId: "t1", backlog: 0 }] }, new Map());
    expect(tiles.map((tile) => tile.key)).toEqual(["waiting", "unassigned"]);
  });
});
