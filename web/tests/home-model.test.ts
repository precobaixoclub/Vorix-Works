import { describe, expect, it } from "vitest";
import {
  buildActivity,
  conversationAttention,
  createOptions,
  greetingFor,
  meetingsAttention,
  moduleAccess,
  ordersAttention,
  postsAwaitingApproval,
  quickLinks,
  relativeTime,
  salesAttention,
  scheduledPosts,
  socialAttention,
  sortAttention,
  todayLabel,
  upcomingMeetings,
  type AttentionItem,
} from "../features/home/model";
import type { SolutionKey } from "../lib/solutions";

const NOW = new Date("2026-11-23T12:00:00.000Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();
const ALL: SolutionKey[] = ["conversations", "marketing", "site", "meetings"];
const everything = () => true;
const nothing = () => false;
const only = (...permissions: string[]) => (permission: string) => permissions.includes(permission);

/* eslint-disable @typescript-eslint/no-explicit-any */
const conversation = (over: Record<string, unknown>) => ({ id: "c1", connectionId: "k1", chatType: "direct", status: "open", unreadCount: 1, isUrgent: false, isPinned: false, aiEnabled: false, automationEnabled: false, contactName: "Carla", lastMessageAt: at(-1), ...over }) as any;
const task = (over: Record<string, unknown>) => ({ id: "t1", title: "Ligar para cliente", status: "pending", type: "call", dueAt: at(-48), createdAt: at(-72), updatedAt: at(-72), ...over }) as any;
const post = (over: Record<string, unknown>, destination: Record<string, unknown> = {}) => ({ id: "p1", state: "SCHEDULED", scheduledAt: at(5), createdAt: at(-5), requiresApproval: false, history: [], destinations: [{ id: "d1", accountId: "a1", network: "instagram", format: "FEED", formatLabel: "Feed", caption: "Lançamento da coleção\nsegunda linha", hashtags: [], media: [], audioMode: "NONE", state: "SCHEDULED", attemptCount: 0, actions: [], ...destination }], ...over }) as any;
const meeting = (over: Record<string, unknown>) => ({ id: "m1", title: "Alinhamento", status: "scheduled", scheduledStartAt: at(3), participantCount: 2, participants: [], statusChangedAt: at(-1), ...over }) as any;
const order = (over: Record<string, unknown>) => ({ id: "o1", number: 1042, status: "PAID", customerDisplayName: "Ana", createdAt: at(-2), paidAt: at(-1), ...over }) as any;
const proposal = (over: Record<string, unknown>) => ({ id: "pr1", title: "Proposta Casamento", status: "viewed", totalCents: 100_00, currency: "BRL", lastViewedAt: at(-3), createdAt: at(-30), updatedAt: at(-3), ...over }) as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("Início — o que aparece para cada conta e perfil", () => {
  it("ferramenta não contratada some; contratada sem permissão é explicada; com permissão aparece", () => {
    expect(moduleAccess("marketing", ["conversations"], everything)).toBe("hidden");
    expect(moduleAccess("site", ["site"], only("site:read"))).toBe("no_permission");
    expect(moduleAccess("site", ["site"], only("order:read"))).toBe("visible");
    expect(moduleAccess("sales", ["conversations"], only("deal:read"))).toBe("visible");
    expect(moduleAccess("sales", ["site"], everything)).toBe("hidden");
    expect(moduleAccess("conversations", ["conversations"], nothing)).toBe("no_permission");
  });

  it("+ Criar só oferece o que a conta tem E o perfil pode criar", () => {
    expect(createOptions(ALL, everything).map((option) => option.key)).toEqual(["content", "idea", "post", "deal", "proposal", "task", "contact", "meeting", "product"]);
    expect(createOptions(["conversations"], only("deal:manage")).map((option) => option.key)).toEqual(["deal"]);
    expect(createOptions(["meetings"], only("meeting:read")).map((option) => option.key)).toEqual([]);
    expect(createOptions(["site"], only("product:manage")).find((option) => option.key === "product")?.href).toBe("/site/products");
    expect(createOptions(["marketing"], nothing).map((option) => option.key)).toEqual(["content", "idea"]);
  });

  it("acessos rápidos respeitam ferramenta e permissão", () => {
    expect(quickLinks(ALL, everything).map((link) => link.key)).toEqual(["conversas", "deals", "create", "calendar", "site", "meetings"]);
    expect(quickLinks(["conversations"], only("inbox:read")).map((link) => link.key)).toEqual(["conversas"]);
    expect(quickLinks(["meetings"], nothing)).toEqual([]);
  });

  it("todo link do Início é relativo ao workspace atual (nunca aponta para outro espaço)", () => {
    const hrefs = [
      ...createOptions(ALL, everything).map((item) => item.href),
      ...quickLinks(ALL, everything).map((item) => item.href),
      ...conversationAttention({ conversations: [conversation({})], connections: [{ id: "k1", displayName: "Loja", status: "disconnected" } as never] }).map((item) => item.href),
      ...socialAttention([post({ state: "FAILED" })]).map((item) => item.href),
      ...ordersAttention([order({})]).map((item) => item.href),
    ];
    for (const href of hrefs) {
      expect(href.startsWith("/")).toBe(true);
      expect(href).not.toMatch(/workspaces/);
    }
  });
});

describe("Início — Precisa da sua atenção", () => {
  it("Conversas: canal desconectado, SLA vencido e clientes esperando (só não lidas e não resolvidas)", () => {
    const items = conversationAttention({
      conversations: [conversation({ id: "a" }), conversation({ id: "b", unreadCount: 0 }), conversation({ id: "c", status: "resolved" }), conversation({ id: "d", isUrgent: true, contactName: undefined, contactPhone: "+55 11 9999" })],
      connections: [{ id: "k1", displayName: "Loja", status: "connected" }, { id: "k2", displayName: "Suporte", status: "logged_out" }] as never,
      attendance: { sla: { configured: true, openBreached: 2 } } as never,
    });
    expect(items.map((item) => item.id)).toEqual(["connection-k2", "sla-breached", "conversation-a", "conversation-d"]);
    expect(items[0]!.badge).toBe("disconnected");
    expect(items[1]!.title).toBe("2 atendimentos com prazo de resposta vencido");
    expect(items[2]!.href).toBe("/conversas?conversation=a");
    expect(items[3]!.badge).toBe("urgent");
    expect(items[3]!.title).toBe("+55 11 9999 aguardando resposta");
  });

  it("SLA não configurado não vira pendência (sem regra, sem prioridade)", () => {
    expect(conversationAttention({ attendance: { sla: { configured: false, openBreached: 5 } } as never })).toEqual([]);
  });

  it("Vendas: só tarefa realmente atrasada, com a ação Concluir; proposta vista; sugestões com aplicar/descartar", () => {
    const items = salesAttention({
      tasks: [task({ id: "late" }), task({ id: "today", dueAt: at(1) }), task({ id: "nodate", dueAt: undefined })],
      proposalsViewed: [proposal({})],
      suggestions: [{ id: "s1", title: "Ofereça desconto", rationale: "Cliente parado há 10 dias" } as never],
      dealsWithoutNextAction: 3,
      now: NOW,
    });
    expect(items.map((item) => item.id)).toEqual(["task-late", "proposal-pr1", "deals-without-next-action", "suggestion-s1"]);
    expect(items[0]).toMatchObject({ badge: "overdue", action: { kind: "complete_task", id: "late" } });
    expect(items[1]!.href).toBe("/proposals?proposal=pr1");
    expect(items[2]!.title).toBe("3 oportunidades sem próxima atividade");
    expect(items[3]).toMatchObject({ action: { kind: "accept_suggestion", id: "s1" }, secondary: { kind: "dismiss_suggestion", id: "s1" } });
  });

  it("Marketing: falha de publicação (com o problema) e aprovação pendente; publicada não é pendência", () => {
    const items = socialAttention([
      post({ id: "f", state: "FAILED" }, { problem: "Token expirado" }),
      post({ id: "w", state: "AWAITING_APPROVAL" }),
      post({ id: "ok", state: "PUBLISHED" }),
      post({ id: "s", state: "SCHEDULED" }),
    ]);
    expect(items.map((item) => item.id)).toEqual(["post-f", "post-w"]);
    expect(items[0]).toMatchObject({ badge: "failed", context: "Token expirado", title: "Falha ao publicar: Lançamento da coleção", href: "/calendar?post=f" });
    expect(items[1]!.badge).toBeUndefined();
  });

  it("Reuniões: só as agendadas das próximas 24 h", () => {
    const items = meetingsAttention([meeting({ id: "soon" }), meeting({ id: "later", scheduledStartAt: at(30) }), meeting({ id: "past", scheduledStartAt: at(-2) }), meeting({ id: "done", status: "completed" })], NOW);
    expect(items.map((item) => item.id)).toEqual(["meeting-soon"]);
    expect(items[0]!.href).toBe("/meetings/central/soon");
  });

  it("Site: pedido pago aguardando preparação abre o pedido", () => {
    expect(ordersAttention([order({})])[0]).toMatchObject({ title: "Pedido #1042 pago, aguardando preparação", href: "/site/pedidos?pedido=o1" });
  });

  it("ordem: falha > desconectado > SLA > atrasada > urgente > o resto; mais antigo primeiro; sem duplicata", () => {
    const item = (id: string, badge?: AttentionItem["badge"], hours = 0): AttentionItem => ({ id, module: "sales", title: id, href: "/", at: at(hours), ...(badge ? { badge } : {}) });
    const sorted = sortAttention([item("plain-new", undefined, -1), item("urgent", "urgent"), item("plain-old", undefined, -10), item("overdue", "overdue"), item("failed", "failed"), item("failed", "failed"), item("sla", "sla"), item("disc", "disconnected")]);
    expect(sorted.map((entry) => entry.id)).toEqual(["failed", "disc", "sla", "overdue", "urgent", "plain-old", "plain-new"]);
  });
});

describe("Início — resumo e atividade", () => {
  it("publicações agendadas futuras em ordem; aguardando aprovação contadas à parte", () => {
    const posts = [post({ id: "b", scheduledAt: at(10) }), post({ id: "a", scheduledAt: at(2) }), post({ id: "past", scheduledAt: at(-2) }), post({ id: "w", state: "AWAITING_APPROVAL" })];
    expect(scheduledPosts(posts, NOW).map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(postsAwaitingApproval(posts)).toBe(1);
    expect(scheduledPosts(undefined, NOW)).toEqual([]);
  });

  it("próximas reuniões: só agendadas e futuras, da mais próxima para a mais distante", () => {
    expect(upcomingMeetings([meeting({ id: "x", scheduledStartAt: at(40) }), meeting({ id: "y", scheduledStartAt: at(1) }), meeting({ id: "z", status: "cancelled" })], NOW).map((entry) => entry.id)).toEqual(["y", "x"]);
  });

  it("atividade: só fatos reais dos últimos 7 dias, mais recente primeiro, com limite", () => {
    const items = buildActivity({
      posts: [post({ id: "pub", state: "PUBLISHED" }, { publishedAt: at(-2) }), post({ id: "sched" }), post({ id: "old", state: "PUBLISHED" }, { publishedAt: at(-24 * 9) })],
      meetings: [meeting({ id: "done", status: "completed", recordingEndedAt: at(-5) }), meeting({ id: "next" })],
      orders: [order({ id: "o", createdAt: at(-1) })],
      proposalsAccepted: [proposal({ id: "acc", status: "accepted", respondedAt: at(-30) })],
      now: NOW,
    });
    expect(items.map((item) => item.id)).toEqual(["order-o", "post-pub", "meeting-done", "proposal-acc"]);
    expect(items[1]).toMatchObject({ title: "Conteúdo publicado", context: "Lançamento da coleção · Instagram" });
    expect(buildActivity({ orders: [order({ id: "1" }), order({ id: "2" }), order({ id: "3" })], now: NOW, limit: 2 })).toHaveLength(2);
    expect(buildActivity({ now: NOW })).toEqual([]);
  });

  it("textos do cabeçalho e tempo relativo em português", () => {
    expect(greetingFor(new Date(2026, 10, 23, 9))).toBe("Bom dia");
    expect(greetingFor(new Date(2026, 10, 23, 14))).toBe("Boa tarde");
    expect(greetingFor(new Date(2026, 10, 23, 20))).toBe("Boa noite");
    expect(todayLabel(new Date(2026, 10, 23, 9))).toBe("Segunda-feira, 23 de novembro");
    expect(relativeTime(at(0), NOW)).toBe("agora");
    expect(relativeTime(at(-0.5), NOW)).toBe("há 30 min");
    expect(relativeTime(at(2), NOW)).toBe("em 2 h");
    expect(relativeTime(at(-24), NOW)).toBe("ontem");
    expect(relativeTime(at(72), NOW)).toBe("em 3 dias");
    expect(relativeTime(undefined, NOW)).toBe("");
  });
});
