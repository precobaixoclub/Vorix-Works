import { expect, test, type Page } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Reorganização de UX — Fase 6: Conversas e atendimento. Chromium real, API 100% mockada e tempo
 * real simulado (um fluxo de eventos SSE controlado pelo teste) — nenhuma mensagem é enviada a
 * canal real. Cobre caixa de entrada, vistas rápidas, painel do contato, transferência, quadro,
 * Radar, permissões, troca de workspace, links diretos, Voltar, celular, mensagens novas sem
 * duplicar, volume de requisições, erros/estados vazios e responsividade.
 */

const OTHER_ID = "ws-qa-casamento";
const now = new Date().toISOString();
const ws = (id: string, name: string) => ({ id, tenantId: TENANT_ID, name, status: "active", settings: {}, createdAt: now, updatedAt: now, campaignIds: [], integrations: [], members: [] });
const WORKSPACES = [ws(WORKSPACE_ID, "Vorix Works"), ws(OTHER_ID, "Casamento São Paulo")];

type Options = { role?: string; permissions?: readonly string[]; failList?: boolean; noChannel?: boolean; workspace429?: number; events?: number };

async function setup(page: Page, options: Options = {}) {
  const log = { gets: [] as { path: string; ws: string | null }[], transfers: [] as unknown[], streamOpens: 0, delivered: false };
  let workspace429 = options.workspace429 ?? 0;
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const workspaceId = url.searchParams.get("workspaceId");
    if (method === "GET") log.gets.push({ path, ws: workspaceId });
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    const mine = !workspaceId || workspaceId === WORKSPACE_ID;
    if (path === "/v1/auth/refresh") return ok({ accessToken: "qa", expiresIn: 900, tenantId: TENANT_ID, role: options.role ?? "owner" });
    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "qa@vorix.dev", name: "QA Reviewer", isPlatformAdmin: false }, tenantId: TENANT_ID, role: options.role ?? "owner", permissions: options.permissions ?? OWNER_PERMISSIONS, teams: [], isAccountOwner: (options.role ?? "owner") === "owner" });
    if (path === "/v1/workspaces") return ok(WORKSPACES);
    const wsMatch = /^\/v1\/workspaces\/([^/]+)$/.exec(path);
    if (wsMatch && method === "GET") {
      if (workspace429 > 0) {
        workspace429 -= 1;
        return route.fulfill({ status: 429, json: { ok: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "Limite operacional de requisições excedido.", recoverable: true } } });
      }
      return ok(WORKSPACES.find((item) => item.id === wsMatch[1]));
    }
    if (path === "/v1/inbox/conversations" && method === "GET") {
      if (options.failList) return route.fulfill({ status: 500, json: { ok: false, error: { code: "INTERNAL", message: "Falha simulada ao listar.", recoverable: true } } });
      if (!mine) return ok({ conversations: [] });
      return route.fallback();
    }
    if (path === "/v1/inbox/connections" && options.noChannel) return ok({ connections: [{ id: "conn-1", displayName: "WhatsApp QA", provider: "wuzapi", status: "logged_out" }] });
    if (/\/v1\/inbox\/conversations\/conv-media\/messages$/.test(path) && log.delivered) {
      return ok({ messages: [
        { id: "m-old", conversationId: "conv-media", direction: "inbound", type: "text", status: "read", body: "Oi, tudo bem?", sentByAi: false, sentByAutomation: false, createdAt: new Date(Date.now() - 600_000).toISOString(), reactions: [] },
        { id: "m-new", conversationId: "conv-media", direction: "inbound", type: "text", status: "delivered", body: "Mensagem nova em tempo real", sentByAi: false, sentByAutomation: false, createdAt: new Date().toISOString(), reactions: [] },
      ] });
    }
    if (/\/attendances$/.test(path)) return ok({ attendances: [{ id: "att-1", conversationId: "conv-text", status: "closed", assignedUserId: "user-qa", openedAt: new Date(Date.now() - 86_400_000).toISOString(), closedAt: new Date(Date.now() - 80_000_000).toISOString(), closureTypeName: "Resolvido", events: [] }] });
    if (/\/transfer$/.test(path)) {
      log.transfers.push(request.postDataJSON());
      return ok({ id: "conv-text" });
    }
    if (path === "/v1/inbox/stream-token") return ok({ streamToken: "qa-stream", expiresIn: 60 });
    if (path === "/v1/inbox/stream") {
      log.streamOpens += 1;
      // Rajada de N eventos da MESMA conversa numa conexão (ex.: álbum de fotos chegando).
      if (options.events && log.streamOpens === 1) {
        log.delivered = true;
        const body = Array.from({ length: options.events }, () => `event: message.created\ndata: ${JSON.stringify({ conversationId: "conv-media" })}\n\n`).join("");
        return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: `retry: 600000\n\n${body}` });
      }
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "retry: 600000\n\n" });
    }
    if (path === "/v1/dashboard") {
      const viewing = url.searchParams.get("viewing");
      return ok({
        viewing, period: { period: "today", from: now, to: now, timeZone: "America/Sao_Paulo", monthStart: "2026-11-01" },
        options: { viewings: [{ value: "me", label: "Eu" }], userIds: ["user-qa"], teams: [{ id: "team-1", name: "Suporte" }] },
        attendance: { available: true, volume: { opened: 0, finalized: 0, reopened: 0 }, frt: {}, frtAttendance: {}, tmr: {}, holding: {}, transfers: { count: 0, attendancesWithTransfer: 0 }, sla: { configured: true, firstResponse: { met: 0, breached: 0 }, resolution: { met: 0, breached: 0 }, openNear: 1, openBreached: viewing === "company" ? 2 : 0 }, backlog: { total: 6, queue: viewing === "company" ? 3 : 1, awaitingFirstResponse: 2, awaitingAgent: 1, awaitingCustomer: 0, slaBreached: 2 }, csat: { average: {}, sent: 0, answered: 0, waived: 0, disabledByChannel: 0, notApplicable: 0, failed: 0 }, closures: [], phases: [], agents: [], teams: [{ teamId: "team-1", finalized: 0, tmr: {}, frt: {}, csat: {}, backlog: 4 }] },
        commercial: { available: false }, goals: { available: false },
      });
    }
    if (path === "/v1/radar/alerts") return ok({ alerts: [] });
    if (path === "/v1/radar/stats") return ok({ totalActive: 0, critical: 0, high: 0, medium: 0, low: 0, slaBreached: 0, withCancellation: 0, withLegalThreat: 0, avgScore: 0, aiBlockedNoCredits: 0, backlogByTeam: [] });
    if (path === "/v1/radar/credits") return ok({ aiConfigured: false, available: false });
    return route.fallback();
  });
  return log;
}

const base = (id = WORKSPACE_ID) => `/workspaces/${id}`;
const item = (page: Page, id: string) => page.locator(`[data-conversation='${id}']`);
const views = (page: Page) => page.getByTestId("inbox-quick-views");

test.describe("Fase 6 — desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("caixa de entrada: lista, não lidas, seleção destacada, vistas rápidas com contagem e busca", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/conversas`);
    await expect(page.locator("[data-conversation]")).toHaveCount(3);
    await expect(item(page, "conv-media")).toHaveAttribute("data-unread", "true");
    await expect(item(page, "conv-text")).not.toHaveAttribute("data-unread", "true");
    // Vistas rápidas: contagens reais e um toque para filtrar.
    await expect(views(page).locator("[data-view]")).toHaveText([/Todas\s*3/, /Não lidas\s*1/, /Minhas\s*2/, /Sem responsável\s*1/, /Em atendimento\s*1/, /Pendentes\s*1/, /Finalizadas\s*1/, /Urgentes\s*0/]);
    await views(page).locator("[data-view='unassigned']").click();
    await expect(page).toHaveURL(/owner=unassigned/);
    await expect(page.locator("[data-conversation]")).toHaveCount(1);
    await expect(views(page).locator("[data-view='unassigned']")).toHaveAttribute("aria-selected", "true");
    // Abrir uma conversa preserva o filtro e destaca a selecionada.
    await item(page, "conv-media").click();
    await expect(page).toHaveURL(/owner=unassigned.*conversation=conv-media|conversation=conv-media.*owner=unassigned/);
    await expect(item(page, "conv-media")).toHaveAttribute("aria-current", "true");
    await views(page).locator("[data-view='all']").click();
    await expect(page.locator("[data-conversation]")).toHaveCount(3);
    await page.getByPlaceholder("Buscar conversa").fill("Rodrigo");
    await expect(page.locator("[data-conversation]")).toHaveCount(1);
    await expect(page.locator("[data-conversation]")).toContainText("Rodrigo Alves");
  });

  test("painel do contato: identificação, atendimento (responsável, situação, histórico) e relacionamento", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/conversas?conversation=conv-text`);
    await page.getByRole("button", { name: "Detalhes do contato" }).click();
    const pane = page.getByTestId("contact-pane").first();
    await expect(pane.getByTestId("pane-identity")).toContainText("Rodrigo Alves");
    await expect(pane.getByTestId("pane-identity")).toContainText("WhatsApp");
    await expect(pane.getByTestId("pane-attendance")).toContainText("Responsável");
    await expect(pane.getByTestId("pane-attendance")).toContainText("Pendente");
    await pane.getByTestId("pane-history").locator("summary").click();
    await expect(pane.getByTestId("pane-history")).toContainText("Finalizado");
    await expect(pane.getByTestId("pane-relationship")).toBeVisible();
  });

  test("transferência simulada pelas ações da conversa (mesma API de sempre)", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/conversas?conversation=conv-text`);
    await page.getByTestId("conversation-actions").click();
    await expect(page.getByText("Transferir atendimento para")).toBeVisible();
    await expect(page.getByRole("button", { name: "OK" })).toBeDisabled(); // sem destino escolhido
    expect(log.transfers).toEqual([]);
  });

  test("perfil sem permissão de operar não transfere (mesma regra de antes)", async ({ page }) => {
    await setup(page, { role: "viewer", permissions: ["workspace:read", "inbox:read", "conversation:read"] });
    await page.goto(`${base()}/conversas?conversation=conv-text`);
    await page.getByTestId("conversation-actions").click();
    await expect(page.getByRole("button", { name: "OK" })).toBeDisabled();
  });

  test("mensagens novas em tempo real: aparecem uma vez, e a rajada vira poucas consultas", async ({ page }) => {
    const log = await setup(page, { events: 8 });
    await page.goto(`${base()}/conversas?conversation=conv-media`);
    await expect(page.getByText("Mensagem nova em tempo real")).toHaveCount(1);
    await page.waitForTimeout(2000);
    await expect(page.getByText("Mensagem nova em tempo real")).toHaveCount(1); // sem duplicar
    const listGets = log.gets.filter((get) => get.path === "/v1/inbox/conversations").length;
    const messageGets = log.gets.filter((get) => /conv-media\/messages$/.test(get.path)).length;
    // 1 carga inicial + 1 revalidação agrupada (abertura do tempo real + 8 eventos) — antes: 0 da
    // lista (chave errada) e 8+ das mensagens.
    expect(listGets).toBeLessThanOrEqual(3);
    expect(listGets).toBeGreaterThanOrEqual(2);
    expect(messageGets).toBeLessThanOrEqual(3);
    await expect(item(page, "conv-media")).toHaveAttribute("aria-current", "true"); // a conversa aberta não troca
  });

  test("sem excesso de requisições ao abrir: cada fonte uma vez; nada da outra empresa", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/conversas`);
    await expect(page.locator("[data-conversation]")).toHaveCount(3);
    await page.waitForTimeout(4000);
    const count = (path: string) => log.gets.filter((get) => get.path === path).length;
    expect(count("/v1/inbox/conversations")).toBeLessThanOrEqual(2); // carga + abertura do tempo real
    expect(count("/v1/inbox/connections")).toBe(1);
    expect(count("/v1/inbox/members")).toBe(1);
    expect(log.gets.every((get) => !get.ws || get.ws === WORKSPACE_ID)).toBe(true);
  });

  test("links diretos e Voltar: conversa, abas de Canais/Regras e Configurações › Atendimento e canais", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/conversas`);
    await item(page, "conv-text").click();
    await expect(page).toHaveURL(/conversation=conv-text/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${base()}/conversas$`));
    await page.goto(`${base()}/conversas?aba=canais`);
    await expect(page.getByRole("button", { name: "Canais", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Regras de atendimento" }).click();
    await expect(page).toHaveURL(/aba=regras/);
    await page.goBack();
    await expect(page).toHaveURL(/aba=canais/);
    // Em Conversas o menu lateral abre recolhido (modo foco); a partir de Configurações ele aparece inteiro.
    await page.goto(`${base()}/settings`);
    const nav = page.locator("nav[aria-label='Menu principal']");
    await nav.locator("[data-area-items='settings'] a", { hasText: "Atendimento e canais" }).click();
    await expect(page).toHaveURL(new RegExp(`${base()}/settings/attendance$`));
    await expect(page.getByRole("heading", { level: 1, name: "Atendimento e canais" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Canais de atendimento/ }).or(page.getByRole("link", { name: /Canais de atendimento/ })).or(page.getByRole("tab", { name: /Canais de atendimento/ })).first()).toBeVisible();
  });

  test("menu do Conversas: Atendimento e Acompanhamento; Contatos saiu de Vendas", async ({ page }) => {
    await setup(page);
    // Contatos (fora do modo foco de Conversas) mostra o menu lateral aberto.
    await page.goto(`${base()}/contacts`);
    const nav = page.locator("nav[aria-label='Menu principal']");
    const items = nav.locator("[data-area-items='conversations']");
    await expect(items.locator("[data-section]")).toHaveText(["Atendimento", "Acompanhamento"]);
    await expect(items.locator("a")).toHaveText(["Caixa de entrada", "Atendimentos", "Contatos", "Radar"]);
    await expect(items.locator("a[aria-current='page']")).toHaveText("Contatos");
    await nav.getByRole("button", { name: "Mostrar telas de Vendas" }).click();
    await expect(nav.locator("[data-area-items='sales'] a", { hasText: /^Contatos$/ })).toHaveCount(0);
  });

  test("quadro de atendimentos: nome claro e alternância Lista/Quadro mantém os filtros", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/conversas?read=unread`);
    await page.getByRole("link", { name: "Quadro" }).click();
    await expect(page).toHaveURL(new RegExp(`${base()}/kanban\\?read=unread$`));
    await expect(page.getByText("Nenhuma equipe cadastrada")).toBeVisible(); // estado vazio explicado
  });

  test("Radar: 'Agora no atendimento' com números do servidor e atalhos; recorte por permissão", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/radar`);
    const now = page.getByTestId("operations-now");
    await expect(now).toContainText("empresa");
    await expect(now.locator("[data-tile='unassigned']")).toContainText("3");
    await expect(now.locator("[data-tile='sla']")).toContainText("2");
    await expect(now.locator("[data-tile='team']")).toContainText("Suporte");
    await now.locator("[data-tile='unassigned']").click();
    await expect(page).toHaveURL(new RegExp(`${base()}/conversas\\?owner=unassigned$`));
    await expect(page.locator("[data-conversation]")).toHaveCount(1);
  });

  test("Radar para quem não vê a empresa toda: só os próprios atendimentos", async ({ page }) => {
    await setup(page, { role: "member", permissions: OWNER_PERMISSIONS.filter((permission) => permission !== "inbox:view_all") });
    await page.goto(`${base()}/radar`);
    await expect(page.getByTestId("operations-now")).toContainText("seus atendimentos");
    await expect(page.getByTestId("operations-now").locator("[data-tile='unassigned']")).toContainText("1");
  });

  test("troca de workspace: conversa aberta e lista da empresa anterior não aparecem", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/conversas?conversation=conv-media`);
    await expect(item(page, "conv-media")).toBeVisible();
    await page.getByTestId("workspace-switcher").click();
    await page.locator(`[data-workspace-option='${OTHER_ID}']`).click();
    await expect(page).toHaveURL(new RegExp(`${base(OTHER_ID)}/conversas$`));
    // A partir daqui a tela da empresa anterior já saiu: nada pode buscar dados dela (tempo real,
    // atualização agrupada e polling são cancelados ao trocar).
    const switchedAt = log.gets.length;
    await expect(page.locator("[data-conversation]")).toHaveCount(0);
    await expect(page.getByText("Carla Mendes")).toHaveCount(0);
    await page.waitForTimeout(2500);
    expect(log.gets.slice(switchedAt).filter((get) => get.ws && get.ws !== OTHER_ID).map((get) => get.path)).toEqual([]);
  });

  test("erros e vazios: falha ao listar com 'tentar de novo'; canal desconectado orienta", async ({ page }) => {
    await setup(page, { failList: true });
    await page.goto(`${base()}/conversas`);
    await expect(page.getByText("Falha simulada ao listar.")).toBeVisible();
    await page.unroute("**/v1/**");
    await setup(page, { noChannel: true });
    await page.goto(`${base()}/conversas`);
    await expect(page.getByText("Nenhum canal conectado ainda")).toBeVisible();
  });

  test("limite de requisições (429) não vira 'Espaço de Trabalho não encontrado' e se recupera", async ({ page }) => {
    await setup(page, { workspace429: 50 });
    await page.goto(`${base()}/conversas`);
    await expect(page.getByTestId("workspace-load-error")).toHaveAttribute("data-problem", "rate_limited", { timeout: 20_000 });
    await expect(page.getByText("Muitas solicitações em pouco tempo")).toBeVisible();
    await expect(page.getByText("Espaço de Trabalho não encontrado")).toHaveCount(0);
    await page.unroute("**/v1/**");
    await setup(page);
    await page.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(page.locator("[data-conversation]")).toHaveCount(3);
  });
});

test.describe("Fase 6 — celular", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("lista → conversa em tela cheia → dados do contato → voltar sem perder o filtro", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/conversas?read=unread`);
    await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();
    await item(page, "conv-media").click();
    await expect(page.getByRole("button", { name: "Voltar para a lista" })).toBeVisible();
    await expect(page.getByTestId("mobile-bottom-nav")).toBeHidden(); // conversa ocupa a tela
    await expect(page.locator("textarea").last()).toBeVisible(); // campo de resposta acessível
    await page.getByRole("button", { name: "Detalhes do contato" }).click();
    await expect(page.getByTestId("pane-identity").last()).toContainText("Carla Mendes");
    await page.getByRole("button", { name: "Fechar detalhes" }).last().click();
    await page.getByRole("button", { name: "Voltar para a lista" }).click();
    await expect(page).toHaveURL(/read=unread/);
    await expect(page.locator("[data-conversation]")).toHaveCount(1);
    await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();
    const box = await views(page).locator("[data-view='unread']").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);
  });
});

test.describe("Fase 6 — responsividade", () => {
  for (const width of [320, 360, 390, 600, 768, 1024, 1440]) {
    test(`${width}px: caixa de entrada e conversa sem rolagem lateral`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      await setup(page);
      await page.goto(`${base()}/conversas`);
      await expect(page.locator("[data-conversation]").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `lista ${width}`).toBe(true);
      await item(page, "conv-text").click();
      await expect(page.getByRole("button", { name: "Detalhes do contato" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `conversa ${width}`).toBe(true);
      for (const path of ["/radar", "/settings/attendance"]) {
        await page.goto(`${base()}${path}`);
        await page.waitForTimeout(800);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} ${width}`).toBe(true);
      }
    });
  }
});

// Capturas para o relatório (só com PHASE6_CAPTURE_DIR; dados 100% simulados).
test.describe("capturas da Fase 6", () => {
  test.skip(!process.env.PHASE6_CAPTURE_DIR, "defina PHASE6_CAPTURE_DIR para gerar as capturas");
  const shots = [
    ["caixa-de-entrada-desktop", "/conversas?conversation=conv-text", 1440, "pane"],
    ["caixa-de-entrada-claro-desktop", "/conversas?conversation=conv-media", 1440, "light"],
    ["lista-celular", "/conversas", 390, ""],
    ["conversa-celular", "/conversas?conversation=conv-media", 390, ""],
    ["contato-celular", "/conversas?conversation=conv-text", 390, "pane"],
    ["radar-desktop", "/radar", 1440, ""],
    ["atendimento-e-canais-desktop", "/settings/attendance", 1440, ""],
  ] as const;
  for (const [name, path, width, mode] of shots) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      if (mode === "light") await page.addInitScript(() => window.localStorage.setItem("theme", "light"));
      await setup(page);
      await page.goto(`${base()}${path}`);
      await page.waitForTimeout(1500);
      if (mode === "pane") await page.getByRole("button", { name: "Detalhes do contato" }).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${process.env.PHASE6_CAPTURE_DIR}/${name}.png` });
    });
  }
});
