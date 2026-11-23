import { expect, test, type Page } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Reorganização de UX — Fase 3: Início unificado. Chromium real, API 100% mockada (nada sai da
 * máquina). Cobre dados reais por área, ferramentas contratadas/não contratadas, permissões, falha
 * isolada de uma área, estados vazios, ações das pendências, isolamento entre workspaces, volume de
 * requisições e responsividade de 320 px ao desktop.
 */

type SolutionKey = "conversations" | "marketing" | "meetings" | "site";
const OTHER_ID = "ws-qa-casamento";
const ALL: SolutionKey[] = ["conversations", "marketing", "site", "meetings"];
const now = Date.now();
const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
const ws = (id: string, name: string) => ({ id, tenantId: TENANT_ID, name, status: "active", settings: {}, createdAt: at(-500), updatedAt: at(-500), campaignIds: [], integrations: [], members: [] });
const WORKSPACES = [ws(WORKSPACE_ID, "Vorix Works"), ws(OTHER_ID, "Casamento São Paulo")];

type Data = {
  awaitingFirst: number; awaitingAgent: number; backlogTotal: number; queue: number; slaBreached: number; openDeals: number; openValueCents: number;
  meAwaiting: number; connections: unknown[]; unread: unknown[]; tasks: unknown[]; viewed: unknown[]; accepted: unknown[]; posts: unknown[]; meetings: unknown[];
  recentOrders: { orders: unknown[]; total: number }; paidOrders: { orders: unknown[]; total: number }; notifications: unknown[];
};

const destination = (over: Record<string, unknown>) => ({ id: `d-${Math.random()}`, accountId: "acc", network: "instagram", format: "FEED", formatLabel: "Feed", caption: "Coleção de verão", hashtags: [], media: [], audioMode: "NONE", state: "SCHEDULED", attemptCount: 0, actions: [], ...over });
const post = (id: string, state: string, over: Record<string, unknown> = {}, dest: Record<string, unknown> = {}) => ({ id, state, scheduledAt: at(5), createdAt: at(-10), requiresApproval: state === "AWAITING_APPROVAL", history: [], destinations: [destination({ state, ...dest })], ...over });
const order = (id: string, number: number, over: Record<string, unknown> = {}) => ({ id, number, status: "PAID", paymentStatus: "PAID", shippingStatus: "PENDING", source: "site", customerDisplayName: "Ana Souza", createdAt: at(-2), paidAt: at(-1.5), totalCents: 25_990, currency: "BRL", items: [], ...over });

const DATA: Record<string, Data> = {
  [WORKSPACE_ID]: {
    awaitingFirst: 2, awaitingAgent: 1, backlogTotal: 5, queue: 1, slaBreached: 1, openDeals: 4, openValueCents: 1_234_500, meAwaiting: 1,
    connections: [{ id: "conn-1", displayName: "WhatsApp Loja", provider: "wuzapi", status: "connected" }],
    unread: [
      { id: "conv-1", connectionId: "conn-1", chatType: "direct", status: "open", unreadCount: 2, isUrgent: false, isPinned: false, aiEnabled: false, automationEnabled: false, contactName: "Carla Mendes", lastMessageAt: at(-0.5) },
      { id: "conv-2", connectionId: "conn-1", chatType: "direct", status: "pending", unreadCount: 1, isUrgent: true, isPinned: false, aiEnabled: false, automationEnabled: false, contactName: "Rodrigo Alves", lastMessageAt: at(-2) },
    ],
    tasks: [
      { id: "task-late", title: "Retornar orçamento do buffet", type: "call", status: "pending", dueAt: at(-50), createdAt: at(-80), updatedAt: at(-80) },
      { id: "task-next", title: "Enviar contrato", type: "email", status: "pending", dueAt: at(30), createdAt: at(-5), updatedAt: at(-5) },
    ],
    viewed: [{ id: "prop-1", title: "Casamento Ana e João", status: "viewed", totalCents: 1_500_000, currency: "BRL", lastViewedAt: at(-4), createdAt: at(-60), updatedAt: at(-4) }],
    accepted: [{ id: "prop-2", title: "Festa de 15 anos", status: "accepted", totalCents: 800_000, currency: "BRL", respondedAt: at(-20), createdAt: at(-90), updatedAt: at(-20) }],
    posts: [
      post("post-sched", "SCHEDULED"),
      post("post-approval", "AWAITING_APPROVAL", {}, { caption: "Bastidores do ateliê" }),
      post("post-failed", "FAILED", { scheduledAt: at(-1) }, { caption: "Promoção de inverno", lastAttemptAt: at(-1), problem: "A conta do Instagram precisa ser reconectada." }),
      post("post-done", "PUBLISHED", { scheduledAt: at(-3) }, { caption: "Novidades da semana", publishedAt: at(-3) }),
    ],
    meetings: [
      { id: "meet-1", title: "Reunião com fornecedor", status: "scheduled", scheduledStartAt: at(3), participantCount: 3, participants: [], statusChangedAt: at(-24) },
      { id: "meet-2", title: "Alinhamento semanal", status: "completed", scheduledStartAt: at(-26), recordingEndedAt: at(-25), participantCount: 4, participants: [], statusChangedAt: at(-25) },
    ],
    recentOrders: { orders: [order("ord-1", 1042)], total: 6 },
    paidOrders: { orders: [order("ord-1", 1042)], total: 2 },
    notifications: [{ id: "n1", userId: "user-qa", title: "Nova mensagem de Carla", sourceType: "inbox", createdAt: at(-1) }, { id: "n2", userId: "user-qa", title: "Proposta visualizada", sourceType: "proposal", createdAt: at(-4) }],
  },
  [OTHER_ID]: {
    awaitingFirst: 0, awaitingAgent: 0, backlogTotal: 0, queue: 0, slaBreached: 0, openDeals: 9, openValueCents: 9_900_000, meAwaiting: 0,
    connections: [{ id: "conn-9", displayName: "WhatsApp Casamento", provider: "wuzapi", status: "connected" }],
    unread: [], tasks: [], viewed: [], accepted: [], posts: [], meetings: [],
    recentOrders: { orders: [], total: 0 }, paidOrders: { orders: [], total: 0 }, notifications: [],
  },
};

type Options = { solutions?: readonly SolutionKey[]; permissions?: readonly string[]; failing?: readonly string[]; override?: Partial<Data> };

async function setup(page: Page, options: Options = {}) {
  const solutions = options.solutions ?? ALL;
  const permissions = options.permissions ?? [...OWNER_PERMISSIONS, "order:read"];
  const failing = new Set(options.failing ?? []);
  const requests: { path: string; workspaceId: string | null; method: string; query: URLSearchParams }[] = [];
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const workspaceId = url.searchParams.get("workspaceId");
    requests.push({ path, workspaceId, method, query: url.searchParams });
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    const data = { ...DATA[workspaceId ?? WORKSPACE_ID]!, ...(workspaceId === WORKSPACE_ID || !workspaceId ? options.override : {}) };
    const fail = (key: string) => (failing.has(key) ? route.fulfill({ status: 500, json: { ok: false, error: { code: "INTERNAL", message: "falha simulada", recoverable: true } } }) : undefined);

    if (path === "/v1/auth/refresh") return ok({ accessToken: "qa", expiresIn: 900, tenantId: TENANT_ID, role: "owner" });
    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "qa@vorix.dev", name: "Marina Costa", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", permissions, teams: [], isAccountOwner: true });
    if (path === "/v1/solutions") return ok({ solutions: solutions.map((key) => ({ key, name: key, internal: false })) });
    if (path === "/v1/workspaces") return ok(WORKSPACES);
    const wsMatch = /^\/v1\/workspaces\/([^/]+)$/.exec(path);
    if (wsMatch) return ok(WORKSPACES.find((item) => item.id === wsMatch[1]));
    if (path === "/v1/inbox/status") return ok({ enabled: true });
    if (path === "/v1/dashboard") {
      const viewing = url.searchParams.get("viewing");
      const awaitingFirst = viewing === "me" ? data.meAwaiting : data.awaitingFirst;
      const awaitingAgent = viewing === "me" ? 0 : data.awaitingAgent;
      return fail("dashboard") ?? ok({
        viewing,
        period: { period: url.searchParams.get("period"), from: at(-12), to: at(12), timeZone: "America/Sao_Paulo", monthStart: "2026-11-01" },
        options: { viewings: [{ value: "me", label: "Eu" }, { value: "company", label: "Empresa inteira" }], userIds: ["user-qa"], teams: [] },
        attendance: {
          available: true, volume: { opened: 3, finalized: 2, reopened: 0 }, frt: {}, frtAttendance: {}, tmr: {}, holding: {}, transfers: { count: 0, attendancesWithTransfer: 0 },
          sla: { configured: true, firstResponse: { met: 1, breached: 0 }, resolution: { met: 0, breached: 0 }, openNear: 0, openBreached: viewing === "me" ? 0 : data.slaBreached },
          backlog: { total: data.backlogTotal, queue: data.queue, awaitingFirstResponse: awaitingFirst, awaitingAgent, awaitingCustomer: 0, slaBreached: data.slaBreached },
          csat: { average: {}, sent: 0, answered: 0, waived: 0, disabledByChannel: 0, notApplicable: 0, failed: 0 }, closures: [], phases: [], agents: [], teams: [],
        },
        commercial: { available: true, open: { count: data.openDeals, valueCents: data.openValueCents }, pipelineByStage: [], won: { count: 0, valueCents: 0 }, lost: { count: 0, valueCents: 0, reasons: [] }, proposals: { created: 0, sent: 0, accepted: 0, declined: 0, convertedToSale: 0 }, sellers: [] },
        goals: { available: false },
      });
    }
    if (path === "/v1/inbox/connections") return fail("connections") ?? ok({ connections: data.connections });
    if (path === "/v1/inbox/conversations") return fail("conversations") ?? ok({ conversations: data.unread });
    if (path === "/v1/tasks" && method === "GET") return fail("tasks") ?? ok(data.tasks);
    if (/^\/v1\/tasks\/[^/]+\/complete$/.test(path)) {
      const id = path.split("/")[3];
      DATA[WORKSPACE_ID]!.tasks = DATA[WORKSPACE_ID]!.tasks.filter((item) => (item as { id: string }).id !== id);
      return ok({ id, status: "completed" });
    }
    if (path === "/v1/proposals") return ok(url.searchParams.get("status") === "accepted" ? data.accepted : data.viewed);
    if (path === "/v1/commercial-suggestions") return ok([]);
    if (path === "/v1/commercial-metrics") return ok({ dealsCreatedCount: 3, openPipelineValueCents: data.openValueCents, wonCount: 0, wonValueCents: 0, lostCount: 0, proposalsSentCount: 0, proposalsAcceptedCount: 0, dealsWithoutNextActionCount: workspaceId === WORKSPACE_ID ? 2 : 0, stageAging: [], lossReasons: [], revenueByOrigin: [] });
    if (path === "/v1/social/posts") return fail("social") ?? ok({ posts: data.posts });
    if (path === "/v1/meetings") return fail("meetings") ?? ok({ items: data.meetings, total: data.meetings.length });
    if (path === "/v1/commerce/orders") return fail("orders") ?? ok(url.searchParams.get("status") === "PAID" ? data.paidOrders : data.recentOrders);
    if (path === "/v1/onboarding") return ok({ status: "completed", completedSteps: ["company", "commercial", "team", "channel"] });
    if (path === "/v1/notifications") return ok({ notifications: data.notifications });
    return route.fallback();
  });
  return { requests };
}

const base = (id = WORKSPACE_ID) => `/workspaces/${id}`;
const card = (page: Page, id: string) => page.locator(`[data-summary='${id}']`);
const summaryIds = (page: Page) => page.locator("[data-summary]").evaluateAll((els) => els.map((el) => el.getAttribute("data-summary")));

test.describe("Início unificado — desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("conta completa: cabeçalho, resumo com dados reais, pendências, atividade, atalhos e + Criar", async ({ page }) => {
    await setup(page);
    await page.goto(base());
    const home = page.getByTestId("workspace-home");
    await expect(home.getByRole("heading", { level: 1 })).toContainText("Marina");
    await expect(home).toContainText("Panorama de Vorix Works");
    await expect.poll(() => summaryIds(page)).toEqual(["conversations-waiting", "conversations-active", "sales-open", "sales-tasks", "marketing-scheduled", "marketing-approval", "meetings-upcoming", "site-orders"]);
    // Empresa inteira por padrão (o perfil pode): 2 sem 1ª resposta + 1 aguardando atendente.
    await expect(card(page, "conversations-waiting")).toContainText("3");
    await expect(card(page, "conversations-waiting")).toContainText("1 com prazo vencido");
    await expect(card(page, "sales-open")).toContainText("4");
    await expect(card(page, "sales-open")).toContainText("12.345,00");
    await expect(card(page, "sales-tasks")).toContainText("1");
    await expect(card(page, "sales-tasks")).toContainText("2 pendente(s)");
    await expect(card(page, "marketing-scheduled")).toContainText("1");
    await expect(card(page, "meetings-upcoming")).toContainText("Reunião com fornecedor");
    await expect(card(page, "site-orders")).toContainText("6");
    await expect(card(page, "site-orders")).toContainText("2 pago(s) aguardando preparação");

    const attention = page.getByTestId("attention-list");
    await expect(attention.locator("[data-attention]").first()).toHaveAttribute("data-attention", "post-post-failed");
    await expect(attention).toContainText("Falhou");
    await expect(attention).toContainText("Carla Mendes aguardando resposta");
    await expect(attention).toContainText("Rodrigo Alves aguardando resposta");
    await expect(attention).toContainText("Urgente");
    await expect(attention).toContainText("Retornar orçamento do buffet");
    // A lista mostra 7 de início; o resto fica a um clique.
    await expect(attention.locator("[data-attention]")).toHaveCount(7);
    await page.getByRole("button", { name: /Ver todas as 10 pendências/ }).click();
    await expect(attention).toContainText("2 oportunidades sem próxima atividade");
    await expect(attention).toContainText("Aguardando aprovação: Bastidores do ateliê");
    await expect(attention).toContainText("Reunião: Reunião com fornecedor");
    await expect(attention).toContainText("Pedido #1042 pago, aguardando preparação");

    const activity = page.getByTestId("activity-list");
    await expect(activity).toContainText("Conteúdo publicado");
    await expect(activity).toContainText("Proposta aceita");
    await expect(activity).toContainText("Reunião concluída");
    await expect(activity).toContainText("Pedido #1042 recebido");

    await expect(page.getByTestId("quick-links").locator("a")).toHaveText(["Abrir conversas", "Oportunidades", "Criar conteúdo", "Calendário", "Editor do site", "Reuniões"]);
    await page.getByTestId("home-create").click();
    await expect(page.getByTestId("home-create-menu").locator("[data-create]")).toHaveCount(9);
    await page.keyboard.press("Escape");

    // Notificações: o atalho abre o mesmo sino do topo.
    await expect(page.getByTestId("home-notifications")).toContainText("2");
    await page.getByTestId("home-notifications").click();
    await expect(page.getByText("Nova mensagem de Carla")).toBeVisible();
  });

  test("cada pendência abre a tela certa (deep link) e Voltar retorna ao Início", async ({ page }) => {
    await setup(page);
    await page.goto(base());
    await page.locator("[data-attention='order-ord-1'] a").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/site/pedidos\\?pedido=ord-1$`));
    await page.goBack();
    await expect(page.getByTestId("workspace-home")).toBeVisible();
    await page.locator("[data-attention='conversation-conv-1'] a").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/conversas\\?conversation=conv-1$`));
    await page.goBack();
    await page.getByRole("button", { name: /Ver todas as/ }).click();
    for (const [id, href] of [["post-post-failed", "/calendar?post=post-failed"], ["proposal-prop-1", "/proposals?proposal=prop-1"], ["meeting-meet-1", "/meetings/central/meet-1"], ["task-task-late", "/tasks?visao=atrasadas"]]) {
      await expect(page.locator(`[data-attention='${id}'] a`)).toHaveAttribute("href", `${base()}${href}`);
    }
  });

  test("ação existente preservada: concluir tarefa atrasada direto do Início", async ({ page }) => {
    const { requests } = await setup(page);
    await page.goto(base());
    await page.locator("[data-attention='task-task-late']").getByRole("button", { name: "Concluir" }).click();
    await expect(page.locator("[data-attention='task-task-late']")).toHaveCount(0);
    expect(requests.filter((request) => request.method === "POST" && request.path.endsWith("/complete")).map((request) => request.path)).toEqual(["/v1/tasks/task-late/complete"]);
    DATA[WORKSPACE_ID]!.tasks = [
      { id: "task-late", title: "Retornar orçamento do buffet", type: "call", status: "pending", dueAt: at(-50), createdAt: at(-80), updatedAt: at(-80) },
      { id: "task-next", title: "Enviar contrato", type: "email", status: "pending", dueAt: at(30), createdAt: at(-5), updatedAt: at(-5) },
    ];
  });

  test("recorte Empresa / Só eu troca os números sem recarregar a página", async ({ page }) => {
    await setup(page);
    await page.goto(base());
    await expect(card(page, "conversations-waiting")).toContainText("3");
    await page.getByRole("button", { name: "Só eu" }).click();
    await expect(card(page, "conversations-waiting")).toContainText("1");
    await expect(page.getByRole("button", { name: "Só eu" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Empresa" }).click();
    await expect(card(page, "conversations-waiting")).toContainText("3");
  });

  test("sem excesso de requisições: cada fonte uma vez, nada de polling, painel detalhado só quando aberto", async ({ page }) => {
    const { requests } = await setup(page);
    await page.goto(base());
    await expect(card(page, "site-orders")).toContainText("6");
    await page.waitForTimeout(6000);
    const gets = requests.filter((request) => request.method === "GET");
    const count = (path: string, filter?: (query: URLSearchParams) => boolean) => gets.filter((request) => request.path === path && (!filter || filter(request.query))).length;
    expect(count("/v1/dashboard")).toBe(2); // "me" (descobre o recorte) + "company"
    for (const path of ["/v1/inbox/connections", "/v1/inbox/conversations", "/v1/tasks", "/v1/commercial-suggestions", "/v1/commercial-metrics", "/v1/social/posts", "/v1/meetings"]) expect(count(path), path).toBe(1);
    expect(count("/v1/proposals")).toBe(2); // vistas + aceitas
    expect(count("/v1/commerce/orders")).toBe(2); // últimos 7 dias + pagos
    expect(gets.every((request) => !request.workspaceId || request.workspaceId === WORKSPACE_ID)).toBe(true);
    expect(gets.some((request) => request.path === "/v1/dashboard" && request.query.get("period") === "this_month")).toBe(false);
    await page.getByTestId("home-detailed-toggle").click();
    await expect.poll(() => requests.some((request) => request.path === "/v1/dashboard" && request.query.get("period") === "this_month")).toBe(true);
  });

  test("falha do Marketing não derruba o resto; tentar de novo recupera", async ({ page }) => {
    const failing = ["social"];
    await setup(page, { failing });
    await page.goto(base());
    await expect(card(page, "marketing-scheduled")).toHaveAttribute("data-state", "error");
    await expect(card(page, "marketing-scheduled")).toContainText("Não foi possível carregar");
    await expect(card(page, "sales-open")).toContainText("4");
    await expect(card(page, "site-orders")).toContainText("6");
    await expect(page.locator("[data-issue='marketing']")).toBeVisible();
    await expect(page.getByTestId("attention-list")).toContainText("Carla Mendes aguardando resposta");
    failing.length = 0;
    await page.unroute("**/v1/**");
    await setup(page);
    await card(page, "marketing-scheduled").getByRole("button", { name: "Tentar de novo" }).click();
    await expect(card(page, "marketing-scheduled")).toContainText("1");
  });

  test("resposta fora do formato numa área não derruba o Início (só aquela área fica indisponível)", async ({ page }) => {
    await setup(page);
    await page.route("**/v1/commerce/orders**", (route) => route.fulfill({ json: { ok: true, data: [] } }));
    await page.route("**/v1/social/posts**", (route) => route.fulfill({ json: { ok: true, data: "inesperado" } }));
    await page.route("**/v1/notifications**", (route) => route.fulfill({ json: { ok: true, data: [] } }));
    await page.goto(base());
    await expect(card(page, "sales-open")).toContainText("4");
    await expect(card(page, "site-orders")).toContainText("indisponível");
    await expect(card(page, "marketing-scheduled")).toContainText("Seu calendário de publicações está vazio.");
    await expect(page.getByTestId("attention-list")).toContainText("Carla Mendes aguardando resposta");
  });

  test("ferramenta sem permissão é explicada e não é consultada", async ({ page }) => {
    const permissions = OWNER_PERMISSIONS.filter((permission) => !permission.startsWith("marketing:social"));
    const { requests } = await setup(page, { permissions });
    await page.goto(base());
    await expect(card(page, "site-orders")).toContainText("Seu perfil não tem acesso");
    await expect(card(page, "marketing-scheduled")).toContainText("Seu perfil não tem acesso");
    await expect(card(page, "sales-open")).toContainText("4");
    await page.waitForTimeout(1500);
    expect(requests.some((request) => request.path === "/v1/commerce/orders" || request.path === "/v1/social/posts")).toBe(false);
  });

  test("estados vazios orientam em vez de mostrar zero", async ({ page }) => {
    await setup(page, { override: { connections: [], posts: [], meetings: [], unread: [] } });
    await page.goto(base());
    await expect(card(page, "conversations-waiting")).toContainText("Você ainda não conectou um canal de atendimento.");
    await expect(card(page, "conversations-waiting").getByRole("link", { name: /Conectar canal/ })).toHaveAttribute("href", `${base()}/conversas`);
    await expect(card(page, "marketing-scheduled")).toContainText("Seu calendário de publicações está vazio.");
    await expect(card(page, "marketing-scheduled").getByRole("link", { name: /Agendar publicação/ })).toBeVisible();
    await expect(card(page, "meetings-upcoming")).toContainText("Você ainda não possui reuniões agendadas.");
  });

  test("troca de workspace isola os dados: nada da empresa anterior aparece nem é consultado", async ({ page }) => {
    const { requests } = await setup(page);
    await page.goto(base());
    await expect(card(page, "sales-open")).toContainText("4");
    await page.getByTestId("workspace-switcher").click();
    const switchedAt = requests.length;
    await page.locator(`[data-workspace-option='${OTHER_ID}']`).click();
    await expect(page).toHaveURL(new RegExp(`${base(OTHER_ID)}$`));
    await expect(page.getByTestId("workspace-home")).toContainText("Panorama de Casamento São Paulo");
    await expect(card(page, "sales-open")).toContainText("9");
    await expect(card(page, "conversations-waiting")).toContainText("0");
    await expect(page.getByTestId("workspace-home")).not.toContainText("Carla Mendes");
    await expect(page.getByTestId("workspace-home")).not.toContainText("Retornar orçamento");
    await expect(page.locator("[data-summary='marketing-approval']")).toHaveCount(0);
    await page.waitForTimeout(1000);
    const after = requests.slice(switchedAt).filter((request) => request.workspaceId);
    expect(after.length).toBeGreaterThan(5);
    expect(after.filter((request) => request.workspaceId !== OTHER_ID).map((request) => request.path)).toEqual([]);
  });

  test("conta só com Conversas: nada de Marketing, Site ou Reuniões", async ({ page }) => {
    const { requests } = await setup(page, { solutions: ["conversations"] });
    await page.goto(base());
    await expect.poll(() => summaryIds(page)).toEqual(["conversations-waiting", "conversations-active", "sales-open", "sales-tasks"]);
    await expect(page.getByTestId("quick-links").locator("a")).toHaveText(["Abrir conversas", "Oportunidades"]);
    await page.getByTestId("home-create").click();
    await expect(page.getByTestId("home-create-menu").locator("[data-create]")).toHaveText([/Oportunidade/, /Proposta/, /Tarefa/, /Contato/, /Produto/]);
    expect(requests.some((request) => ["/v1/social/posts", "/v1/meetings", "/v1/commerce/orders"].includes(request.path))).toBe(false);
  });

  test("conta só com Reuniões: o Início existe (sem redirecionar) e mostra só Reuniões", async ({ page }) => {
    const { requests } = await setup(page, { solutions: ["meetings"] });
    await page.goto(base());
    await expect(page).toHaveURL(new RegExp(`${base()}$`));
    await expect.poll(() => summaryIds(page)).toEqual(["meetings-upcoming"]);
// Fase 12: Resultados (central de indicadores) existe para toda conta com alguma ferramenta.
    await expect(page.locator("nav[aria-label='Menu principal'] [data-area]")).toHaveText(["Início", "Reuniões", "Resultados", "Configurações"]);
    await expect(page.getByTestId("home-detailed-toggle")).toHaveCount(0);
    await expect(page.getByTestId("activity-list")).toContainText("Reunião concluída");
    expect(requests.some((request) => ["/v1/dashboard", "/v1/tasks", "/v1/social/posts", "/v1/commerce/orders", "/v1/inbox/conversations"].includes(request.path))).toBe(false);
  });
});

test.describe("Início unificado — responsividade", () => {
  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    test(`${width}px: sem rolagem lateral; no celular as pendências vêm antes do resumo`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await setup(page);
      await page.goto(base());
      await expect(card(page, "site-orders")).toContainText("6");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const attentionTop = (await page.getByTestId("home-attention").boundingBox())!.y;
      const summaryTop = (await page.getByTestId("home-summary").boundingBox())!.y;
      if (width < 1024) expect(attentionTop).toBeLessThan(summaryTop);
      else expect(summaryTop).toBeLessThan(attentionTop);
      // Nada sai da tela nem se sobrepõe na grade de indicadores.
      const boxes = await page.locator("[data-summary]").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((box) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom })));
      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
      for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!, b = boxes[j]!;
        const overlap = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        expect(overlap).toBe(false);
      }
      if (width < 768) await expect(page.getByTestId("mobile-bottom-nav").locator("[data-area='home']")).toHaveAttribute("aria-current", "page");
      await page.getByTestId("home-create").click();
      const menu = await page.getByTestId("home-create-menu").boundingBox();
      expect(menu!.x).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
    });
  }
});

// Capturas para o relatório (só roda com HOME_CAPTURE_DIR definido; dados 100% simulados).
test.describe("capturas do Início", () => {
  test.skip(!process.env.HOME_CAPTURE_DIR, "defina HOME_CAPTURE_DIR para gerar as capturas");
  for (const [name, width, height] of [["desktop", 1440, 1000], ["tablet", 768, 1024], ["celular", 390, 844]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${name} ${scheme}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: scheme });
        await page.addInitScript((theme) => window.localStorage.setItem("theme", theme), scheme);
        await setup(page);
        await page.goto(base());
        await expect(card(page, "site-orders")).toContainText("6");
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${process.env.HOME_CAPTURE_DIR}/inicio-${name}-${scheme === "light" ? "claro" : "escuro"}.png`, fullPage: true });
      });
    }
  }
});
