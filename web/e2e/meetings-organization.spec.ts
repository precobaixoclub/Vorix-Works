import { expect, test, type Page } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Reorganização de UX — Fase 9: Reuniões. Chromium real, API 100% simulada. Nenhuma gravação real,
 * nenhum microfone acionado, nenhum convite, nenhuma exclusão, nenhuma IA paga: o mock registra toda
 * escrita e os testes exigem que não haja nenhuma.
 */

const OTHER_ID = "ws-qa-casamento";
// Relógio fixo (10h de 23/11/2026, São Paulo): "hoje" e "próximas" não dependem da hora da execução.
const FIXED = new Date("2026-11-23T10:00:00-03:00");
const iso = (minutes: number) => new Date(FIXED.getTime() + minutes * 60_000).toISOString();
const ws = (id: string, name: string) => ({ id, tenantId: TENANT_ID, name, status: "active", settings: {}, createdAt: iso(-90_000), updatedAt: iso(-90_000), campaignIds: [], integrations: [], members: [] });
const WORKSPACES = [ws(WORKSPACE_ID, "Vorix Works"), ws(OTHER_ID, "Casamento São Paulo")];

type Meeting = Record<string, unknown> & { id: string; workspaceId: string; title: string; status: string };
const meeting = (id: string, title: string, over: Record<string, unknown> = {}, workspaceId = WORKSPACE_ID): Meeting => ({
  id, workspaceId, ownerUserId: "user-qa", ownerName: "QA Reviewer", createdByUserId: "user-qa", title, source: "calendar", status: "scheduled", timezone: "America/Sao_Paulo",
  statusChangedAt: iso(-60), createdAt: iso(-3000), updatedAt: iso(-60), participantCount: 0, participants: [], hasRecording: false, recordingBytes: 0, hasAnalysis: false, ...over,
});

const MEETINGS_A: Meeting[] = [
  meeting("m-next", "Alinhamento com a Carla", { scheduledStartAt: iso(120), scheduledEndAt: iso(165), meetingUrl: "https://meet.google.com/abc-defg-hij", participantCount: 2, participants: [{ name: "Carla Mendes" }, { email: "joao@cliente.invalid" }] }),
  meeting("m-later", "Planejamento trimestral", { scheduledStartAt: iso(60 * 30), scheduledEndAt: iso(60 * 31), source: "manual" }),
  meeting("m-rec", "Demonstração ao vivo", { status: "recording", source: "instant", recordingStartedAt: iso(-12), botJoinedAt: iso(-13), meetingUrl: "https://meet.google.com/xyz-abcd-efg" }),
  meeting("m-proc", "Entrevista com fornecedor", { status: "transcribing", hasRecording: true, recordingBytes: 8_000_000, transcriptStatus: "running", source: "upload" }),
  meeting("m-wait", "Visita técnica", { status: "completed", hasRecording: true, recordingBytes: 5_000_000, transcriptStatus: "completed", hasAnalysis: false, source: "upload", statusChangedAt: iso(-300) }),
  meeting("mtg-vendas01-buffet", "Reunião de vendas — Buffet", { status: "completed", hasRecording: true, recordingBytes: 12_000_000, recordingDurationSeconds: 1860, transcriptStatus: "completed", hasAnalysis: true, scheduledStartAt: iso(-1500), statusChangedAt: iso(-100) }),
  meeting("m-fail", "Reunião sem admissão", { status: "failed", failureMessage: "O organizador não admitiu o gravador na reunião.", statusChangedAt: iso(-30), meetingUrl: "https://meet.google.com/fff-gggg-hhh" }),
];
const MEETINGS_B: Meeting[] = [meeting("m-other", "Reunião do outro workspace", { status: "completed", hasRecording: true, transcriptStatus: "completed", hasAnalysis: true }, OTHER_ID)];

const RESULT = {
  executiveSummary: "O cliente aprovou o cardápio e pediu proposta revisada até sexta.",
  topics: ["Cardápio", "Prazo de entrega"], decisions: ["Usar o cardápio B"], actionItems: [{ description: "Enviar proposta revisada", owner: "Ana", dueDate: "sexta" }], nextSteps: ["Agendar degustação"],
  risks: ["Orçamento apertado"], objections: [], openQuestions: ["Quantos convidados?"],
};
const ACTION_ITEMS = [
  { id: "ai-1", type: "decision", description: "Usar o cardápio B", status: "suggested", sourceTimestampMs: 61_000, confidence: 0.82 },
  { id: "ai-2", type: "task", description: "Enviar proposta revisada", assigneeName: "Ana", dueDate: "sexta", status: "suggested" },
  { id: "ai-3", type: "next_step", description: "Agendar degustação", status: "confirmed" },
];
const RECORDING = { id: "rec-1", kind: "original", mimeType: "audio/webm", bytes: 12_000_000, durationSeconds: 1860, checksumSha256: "abc", status: "available", createdAt: iso(-90) };
const TRANSCRIPT = { id: "t-1", status: "completed", language: "pt", segmentCount: 3, attempts: 1 };
const SEGMENTS = [
  { seq: 1, startMs: 0, endMs: 5000, speaker: "spk_0", text: "Bom dia, vamos falar do cardápio." },
  { seq: 2, startMs: 61_000, endMs: 70_000, speaker: "spk_1", text: "Prefiro o cardápio B para o evento." },
  { seq: 3, startMs: 120_000, endMs: 130_000, text: "Trecho sem identificação de quem falou." },
];
const INSIGHTS = {
  summaryTemplate: "general", templates: [{ key: "general", label: "Geral", description: "Resumo geral" }], speakers: [{ key: "spk_0", displayName: "Carla", renamed: true }, { key: "spk_1", displayName: "Cliente", renamed: true }],
  talk: { hasSpeakers: true, totalTalkMs: 14_000, speakers: [], speakerSwitches: 1, questions: 0 }, keywordHits: [], clips: [], comments: [], shares: [],
  crm: { available: false, suggestions: [] }, crmTasks: {}, questions: [], whatsAppAvailable: false, aiAvailable: true,
};

function detailOf(item: Meeting) {
  const { participantCount: _c, hasRecording, recordingBytes: _b, hasAnalysis, transcriptStatus, ...rest } = item as Record<string, unknown> & Meeting;
  const analysis = hasAnalysis ? { id: "an-1", status: "completed", result: RESULT, actionItems: ACTION_ITEMS, creditsCharged: 1, model: "fixture", createdAt: iso(-95) } : undefined;
  return {
    ...rest,
    participants: ((item.participants as { name?: string; email?: string }[]) ?? []).map((participant, index) => ({ id: `p-${index}`, ...participant, role: index ? "attendee" : "organizer" })),
    recordings: hasRecording ? [RECORDING] : [],
    transcript: transcriptStatus ? { ...TRANSCRIPT, status: transcriptStatus } : undefined,
    latestAnalysis: analysis,
    lastCompletedAnalysis: analysis,
  };
}

type Options = {
  solutions?: string[]; role?: string; permissions?: readonly string[];
  google?: "connected" | "not_connected" | "reconnect_required" | "sync_error"; failDashboard?: boolean; failList?: boolean; agendaEmpty?: boolean;
};

async function setup(page: Page, options: Options = {}) {
  await page.clock.setFixedTime(FIXED);
  const log = { gets: [] as { path: string; ws: string | null; search: string }[], writes: [] as { method: string; path: string }[] };
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const workspaceId = url.searchParams.get("workspaceId");
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    const fail = (status: number, message: string) => route.fulfill({ status, json: { ok: false, error: { code: status === 404 ? "NOT_FOUND" : "INTERNAL", message, recoverable: status >= 500 } } });
    if (method === "GET") log.gets.push({ path, ws: workspaceId, search: url.search });
    else if (path.startsWith("/v1/meetings") || path.startsWith("/v1/meeting-plans")) { log.writes.push({ method, path }); return fail(500, "Escrita bloqueada no teste."); }
    const mine = (workspaceId ?? WORKSPACE_ID) === WORKSPACE_ID;
    const list = mine ? MEETINGS_A : MEETINGS_B;

    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "qa@vorix.dev", name: "QA Reviewer", isPlatformAdmin: false }, tenantId: TENANT_ID, role: options.role ?? "owner", permissions: options.permissions ?? OWNER_PERMISSIONS, teams: [], isAccountOwner: (options.role ?? "owner") === "owner" });
    if (path === "/v1/solutions") return ok({ solutions: (options.solutions ?? ["conversations", "site", "marketing", "meetings"]).map((key) => ({ key, name: key, internal: false })) });
    if (path === "/v1/workspaces") return ok(WORKSPACES);
    const wsMatch = /^\/v1\/workspaces\/([^/]+)$/.exec(path);
    if (wsMatch) return ok(WORKSPACES.find((item) => item.id === wsMatch[1]));

    if (path === "/v1/meetings/dashboard") return options.failDashboard ? fail(500, "Falha simulada no painel de reuniões.") : ok({ meetingsToday: mine ? 2 : 0, meetingsThisWeek: mine ? 5 : 1, recordingNow: mine ? 1 : 0, processing: mine ? 1 : 0, recordedSeconds: 7200, transcriptsAvailable: 2, limits: { maxConcurrentRecordings: 2, monthlyRecordingMinutes: 600, meetingRetentionDays: 90, maxStorageBytes: 1e10 }, realRecordingEnabled: true });
    if (path === "/v1/meetings/recording-capacity") return ok({ planCapacity: 2, tenantHealthyCapacity: 2, tenantAvailableCapacity: 1, planLimit: 2, connectedAccounts: 2, healthyAccounts: 2, busyAccounts: 1, invalidAccounts: 0, tenantEffectiveRecordingCapacity: 2, activeRecordings: 1, availableNow: 1, reserveAccounts: 0, missingAccountsForPlan: 0, canManage: true, knownHumanEmails: [], connectedHumanEmails: [] });
    if (path === "/v1/meetings/google/status") {
      const google = options.google ?? "connected";
      return ok({ configured: true, status: google === "sync_error" ? "connected" : google, googleEmail: google === "not_connected" ? undefined : "agenda@vorix.invalid", lastSyncedAt: iso(-5), ...(google === "sync_error" ? { lastErrorMessage: "Token expirado no Google." } : {}) });
    }
    if (path === "/v1/meetings/google/calendars") return ok({ selectedId: "primary", calendars: [{ id: "primary", name: "Agenda principal", primary: true }] });
    if (path === "/v1/meetings/google/sync-log") return ok([]);
    if (path === "/v1/meetings/zoom/status") return ok({ configured: false, status: "not_connected" });
    if (path === "/v1/meetings/agenda/events") {
      if (options.agendaEmpty || !mine) return ok([]);
      return ok([
        { id: "ev-1", ownerUserId: "user-qa", title: "Alinhamento com a Carla", startAt: iso(120), endAt: iso(165), timezone: "America/Sao_Paulo", allDay: false, attendees: ["carla@cliente.invalid"], status: "confirmed", source: "google", meetLink: "https://meet.google.com/abc-defg-hij", wantsMeetLink: true, syncToGoogle: true, syncState: "ok", meetingId: "m-next" },
        { id: "ev-2", ownerUserId: "user-qa", title: "Planejamento trimestral", startAt: iso(60 * 30), endAt: iso(60 * 31), timezone: "America/Sao_Paulo", allDay: false, attendees: [], status: "confirmed", source: "system", wantsMeetLink: false, syncToGoogle: false },
      ]);
    }
    if (path === "/v1/meetings/questions") return ok([]);
    if (path === "/v1/meetings/preferences") return ok({ autoRecordMode: "off", defaultTemplate: "general", tenant: { consentNoticeEnabled: true, consentMessage: "Esta reunião será gravada." } });
    if (path === "/v1/meetings/usage") return ok({ period: "2026-11", minutesUsed: 120, minutesLimit: 600, storageBytesUsed: 1e8, storageBytesLimit: 1e10, aiAnalyses: 3 });
    if (path === "/v1/meetings/keyword-trackers") return ok([]);
    if (path === "/v1/meetings/recorder-accounts") return ok({ accounts: [], capacity: { planCapacity: 2, tenantHealthyCapacity: 2, tenantAvailableCapacity: 1, planLimit: 2, connectedAccounts: 2, healthyAccounts: 2, busyAccounts: 1, invalidAccounts: 0, tenantEffectiveRecordingCapacity: 2, activeRecordings: 1, availableNow: 1, reserveAccounts: 0, missingAccountsForPlan: 0 }, selfServiceAvailable: true, recorderOnline: true });
    if (path === "/v1/meeting-plans") return ok({ catalog: { trial: { code: "trial", name: "Teste", priceCents: 0, currency: "BRL", recordingMinutes: 60, recordingHours: 1, retentionDays: 7, maxConcurrentRecordings: 1, summary: "Teste", days: 7 }, plans: [] }, subscription: { tenantId: TENANT_ID, planCode: "professional", status: "active", currentPeriodStart: iso(-20000), currentPeriodEnd: iso(20000), cancelAtPeriodEnd: false }, trialAvailable: false, checkoutOpen: false, canManage: true, rules: { exportWindowDays: 30, retentionNoticeDays: [7], maxRecordingMinutes: 240 } });
    if (path === "/v1/meetings") {
      if (options.failList) return fail(500, "Falha simulada ao listar reuniões.");
      const params = url.searchParams;
      let items = [...list];
      if (params.get("status")) items = items.filter((item) => item.status === params.get("status"));
      if (params.get("hasRecording")) items = items.filter((item) => Boolean(item.hasRecording) === (params.get("hasRecording") === "true"));
      if (params.get("hasTranscript")) items = items.filter((item) => (item.transcriptStatus === "completed") === (params.get("hasTranscript") === "true"));
      if (params.get("q")) items = items.filter((item) => item.title.toLowerCase().includes(params.get("q")!.toLowerCase()));
      return ok({ items, total: items.length });
    }
    const detail = /^\/v1\/meetings\/([^/]+)(?:\/(transcript|insights|recordings\/[^/]+\/playback|recorder-eligibility))?$/.exec(path);
    if (detail) {
      // O servidor só devolve reuniões do workspace pedido: id de outro workspace é 404.
      const found = list.find((item) => item.id === detail[1]);
      if (!found) return fail(404, "Reunião não encontrada.");
      if (!detail[2]) return ok(detailOf(found));
      if (detail[2] === "transcript") return ok({ segments: SEGMENTS });
      if (detail[2] === "insights") return ok(INSIGHTS);
      if (detail[2].startsWith("recordings/")) return ok({ url: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=", mimeType: "audio/wav", expiresInSeconds: 600 });
      return ok({ planCapacity: 2, tenantHealthyCapacity: 2, tenantAvailableCapacity: 1, meetingEligibleCapacity: 1, humanIdentityKnown: true, meetingEligibleRecorderCapacity: 1, tenantEffectiveRecordingCapacity: 2, connectedAccounts: 2, knownHumanEmails: [] });
    }
    return route.fallback();
  });
  return log;
}

const base = (id = WORKSPACE_ID) => `/workspaces/${id}`;
const nav = (page: Page) => page.locator("nav[aria-label='Menu principal']");
const VIEWER = OWNER_PERMISSIONS.filter((permission) => !/^meeting:(create|record|analyze|delete|manage)/.test(permission));

test.use({ timezoneId: "America/Sao_Paulo" });

test.describe("Fase 9 — Reuniões", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("visão geral: próxima reunião, hoje, em andamento, atividade recente e como gravar", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/meetings`);
    await expect(page.getByRole("heading", { name: "Reuniões", exact: true })).toBeVisible();
    const upcoming = page.getByTestId("upcoming-meetings");
    await expect(upcoming.getByTestId("upcoming-row")).toHaveCount(2);
    await expect(upcoming.getByTestId("upcoming-row").first()).toContainText("Alinhamento com a Carla");
    await expect(upcoming.getByTestId("upcoming-row").first()).toContainText("Carla Mendes");
    await expect(upcoming.getByTestId("today-count")).toHaveText("1 reunião ainda hoje");
    await expect(upcoming.getByRole("link", { name: "Entrar" }).first()).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
    await expect(upcoming.locator("[data-calendar='connected']")).toContainText("agenda@vorix.invalid");
    const progress = page.getByTestId("in-progress");
    await expect(progress).toContainText("Demonstração ao vivo");
    await expect(progress).toContainText("Entrevista com fornecedor");
    await expect(progress).toContainText("Transcrição pronta — aguardando análise");
    const recent = page.getByTestId("recent-activity");
    await expect(recent.getByTestId("activity-row").first()).toContainText("Reunião sem admissão");
    await expect(recent).toContainText("Reunião de vendas — Buffet");
    await expect(recent.locator("[data-availability='analysis'][data-on='true']")).toHaveCount(1);
    const how = page.getByTestId("how-to-record");
    await expect(how.getByRole("button", { name: "Gravar reunião do Meet" })).toBeVisible();
    await expect(how.getByRole("button", { name: "Gravar pelo microfone" })).toBeVisible();
    await expect(how.getByRole("button", { name: "Enviar gravação" })).toBeVisible();
    // Abrir a gravação presencial NÃO aciona o microfone: só "Pronto para gravar".
    await how.getByRole("button", { name: "Gravar pelo microfone" }).click();
    await expect(page.getByRole("dialog", { name: "Gravar reunião presencial" })).toBeVisible();
    await expect(page.getByTestId("in-person-state")).toHaveAttribute("data-state", "idle");
    await expect(page.getByText("O resultado aparece em Gravações.")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();
    // Listas e indicadores nunca baixam transcrição.
    expect(log.gets.filter((get) => get.path.endsWith("/transcript"))).toEqual([]);
    expect(log.writes).toEqual([]);
  });

  test("navegador sem gravação de áudio: explica a limitação e não mostra o botão", async ({ page }) => {
    await page.addInitScript(() => { delete (window as { MediaRecorder?: unknown }).MediaRecorder; });
    await setup(page);
    await page.goto(`${base()}/meetings`);
    await expect(page.getByTestId("mic-unsupported")).toContainText("não consegue gravar áudio");
    await expect(page.getByRole("button", { name: "Gravar pelo microfone" })).toHaveCount(0);
  });

  test("menu: Visão geral, Agenda, Gravações e Análises + bloco de configurações; Configurações › Reuniões", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/meetings/agenda`);
    const items = nav(page).locator("[data-area-items='meetings'] a");
    await expect(items).toHaveText(["Visão geral", "Agenda", "Gravações", "Análises", "Preferências", "Agenda e integrações", "Contas de gravação"]);
    await expect(nav(page).locator("[data-area-items='meetings'] a[aria-current='page']")).toHaveText("Agenda");
    for (const [label, path] of [["Gravações", "/meetings/central"], ["Análises", "/meetings/ask"], ["Visão geral", "/meetings"]] as const) {
      await items.filter({ hasText: label }).click();
      await expect(page).toHaveURL(new RegExp(`${base()}${path}$`));
    }
    await page.goto(`${base()}/settings`);
    await expect(nav(page).locator("[data-area-items='settings'] a").filter({ hasText: "Reuniões" })).toHaveAttribute("href", `${base()}/meetings/settings`);
  });

  test("gravações: visões pelo endereço, agendada não aparece como gravada, link antigo /recordings", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/meetings`);
    await page.goto(`${base()}/meetings/central`);
    await expect(page.getByRole("heading", { name: "Gravações", exact: true })).toBeVisible();
    await expect(page.getByTestId("meeting-row")).toHaveCount(7);
    const scheduled = page.getByTestId("meeting-row").filter({ hasText: "Alinhamento com a Carla" });
    await expect(scheduled.locator("[data-availability='scheduled']")).toHaveText("Agendada — ainda não gravada");
    await expect(scheduled.locator("[data-availability='recording']")).toHaveCount(0);

    await page.getByTestId("library-views").getByRole("button", { name: "Gravadas" }).click();
    await expect(page).toHaveURL(/visao=gravadas/);
    await expect(page.getByTestId("meeting-row")).toHaveCount(3);
    expect(log.gets.some((get) => get.path === "/v1/meetings" && get.search.includes("hasRecording=true"))).toBe(true);
    await expect(page.locator("#meetings-recording")).toHaveCount(0);

    await page.getByTestId("library-views").getByRole("button", { name: "Com análise da IA" }).click();
    await expect(page.getByTestId("meeting-row")).toHaveCount(1);
    await expect(page.getByTestId("meeting-row")).toContainText("Reunião de vendas — Buffet");
    await page.getByTestId("library-views").getByRole("button", { name: "Com falha" }).click();
    await expect(page.getByTestId("meeting-row")).toHaveCount(1);
    // Trocar de visão não empilha histórico: Voltar sai da biblioteca.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${base()}/meetings$`));

    await page.goto(`${base()}/meetings/recordings`);
    await expect(page).toHaveURL(new RegExp(`${base()}/meetings/central\\?visao=gravadas$`));
    await expect(page.getByTestId("library-views").locator("[aria-current='true']")).toHaveText("Gravadas");
    await expect(nav(page).locator("[data-area-items='meetings'] a[aria-current='page']")).toHaveText("Gravações");
  });

  test("busca na biblioteca usa a busca existente", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/meetings/central`);
    await page.getByLabel("Buscar reuniões").fill("buffet");
    await expect(page.getByTestId("meeting-row")).toHaveCount(1);
    expect(log.gets.some((get) => get.path === "/v1/meetings" && get.search.includes("q=buffet"))).toBe(true);
  });

  test("detalhe com gravação: andamento, seções agrupadas, transcrição sob demanda com busca e cópia", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const log = await setup(page);
    await page.goto(`${base()}/meetings/central`);
    await page.goto(`${base()}/meetings/central/mtg-vendas01-buffet`);
    await expect(page.getByRole("heading", { name: "Reunião de vendas — Buffet" })).toBeVisible();
    const timeline = page.getByTestId("processing-timeline");
    await expect(timeline.locator("[data-state='done']")).toHaveCount(3);
    await expect(page.getByTestId("meeting-player")).toBeVisible();
    const sectionNav = page.getByRole("navigation", { name: "Navegação da seção" });
    for (const group of ["Reunião", "Gravação e transcrição", "Análise da IA", "Ações"]) await expect(sectionNav.getByText(group, { exact: true })).toBeVisible();
    // Sem abrir a Transcrição, o texto completo não é baixado.
    await page.waitForTimeout(800);
    expect(log.gets.filter((get) => get.path.endsWith("/transcript"))).toEqual([]);

    await sectionNav.getByRole("button", { name: "Transcrição" }).click();
    await expect(page).toHaveURL(/secao=transcript/);
    const segments = page.getByTestId("transcript-segments").locator("li");
    await expect(segments).toHaveCount(3);
    await expect(segments.nth(1)).toContainText("Cliente:");
    // Trecho sem falante identificado não ganha nome inventado.
    await expect(segments.nth(2)).toHaveText("2:00Trecho sem identificação de quem falou.");
    await page.getByLabel("Buscar na transcrição").fill("cardápio B");
    await expect(segments).toHaveCount(1);
    await page.getByRole("button", { name: "Copiar trechos" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("[1:01] Cliente: Prefiro o cardápio B para o evento.");
    // Trocar de seção substitui o endereço: Voltar sai da reunião.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${base()}/meetings/central$`));
    expect(log.writes).toEqual([]);
  });

  test("análise: síntese, assuntos, pontos de atenção; decisões e próximos passos como sugestões", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/meetings/central/mtg-vendas01-buffet?secao=resumo`);
    await expect(page.getByText("O cliente aprovou o cardápio")).toBeVisible();
    await expect(page.getByText("Principais assuntos")).toBeVisible();
    await expect(page.getByTestId("summary-attention")).toContainText("Orçamento apertado");
    await expect(page.getByTestId("summary-attention")).toContainText("Quantos convidados?");
    await page.getByTestId("summary-next").getByRole("button", { name: "Decisões e próximos passos (3)" }).click();
    await expect(page).toHaveURL(/secao=actions/);
    await expect(page.getByTestId("action-items-note")).toContainText("Nada vira tarefa ou decisão oficial sem a sua confirmação");
    const items = page.getByTestId("meeting-action-items");
    await expect(items.locator("section")).toHaveCount(3);
    await expect(items.locator("[data-group='Decisões']")).toContainText("Sugerido");
    await expect(items.locator("[data-group='Tarefas']")).toContainText("Responsável citado: Ana");
    await expect(items.locator("[data-group='Próximos passos']")).toContainText("Confirmado");
    await expect(items.getByRole("button", { name: "Confirmar" })).toHaveCount(2);
    expect(log.writes).toEqual([]);
  });

  test("reunião só agendada: sem seções vazias, sem andamento; gravar está à mão (sem disparar)", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/meetings/central/m-next`);
    const sectionNav = page.getByRole("navigation", { name: "Navegação da seção" });
    await expect(sectionNav.getByRole("button")).toHaveText(["Visão geral", "Participantes", "Gravação", "CRM", "Informações técnicas"]);
    await expect(page.getByTestId("processing-timeline")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Gravar reunião" })).toBeVisible();
    // Link para seção que não se aplica abre a visão geral.
    await page.goto(`${base()}/meetings/central/m-next?secao=transcricao`);
    await expect(sectionNav.locator("button[aria-current='page']")).toHaveText("Visão geral");
  });

  test("estados de processamento e falha", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/meetings/central/m-proc`);
    await expect(page.getByTestId("processing-timeline").locator("[data-step='transcript']")).toHaveAttribute("data-state", "current");
    await page.goto(`${base()}/meetings/central/m-fail`);
    await expect(page.getByText("O organizador não admitiu o gravador na reunião.").first()).toBeVisible();
    await expect(page.getByTestId("processing-timeline").locator("[data-step='recording']")).toHaveAttribute("data-state", "failed");
    await page.goto(`${base()}/meetings/central/m-rec`);
    await expect(page.getByTestId("live-recording-panel")).toContainText("Gravando");
    await expect(page.getByTestId("processing-timeline").locator("[data-step='recording']")).toHaveAttribute("data-state", "current");
  });

  test("agenda: Google conectado, evento com link de participação e acesso à reunião", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/meetings/agenda`);
    await expect(page.getByTestId("calendar-status")).toHaveAttribute("data-state", "connected");
    await page.getByRole("tab", { name: "Lista" }).click();
    await page.getByTestId("agenda-event").filter({ hasText: "Alinhamento com a Carla" }).click();
    const dialog = page.getByRole("dialog", { name: "Alinhamento com a Carla" });
    await expect(dialog.getByTestId("agenda-join")).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
    await expect(dialog.getByRole("link", { name: "Abrir reunião" })).toHaveAttribute("href", `${base()}/meetings/central/m-next`);
  });

  for (const [google, state, text] of [["not_connected", "disconnected", "Google Agenda não conectada"], ["reconnect_required", "reconnect", "precisa ser reconectada"], ["sync_error", "sync-error", "Token expirado no Google."]] as const) {
    test(`agenda: Google ${google} é explicado`, async ({ page }) => {
      await setup(page, { google });
      await page.goto(`${base()}/meetings/agenda`);
      const status = state === "reconnect" ? page.getByTestId("google-reconnect-banner") : page.getByTestId("calendar-status");
      await expect(status).toHaveAttribute("data-state", state);
      await expect(status).toContainText(text);
    });
  }

  test("agenda vazia no período", async ({ page }) => {
    await setup(page, { agendaEmpty: true });
    await page.goto(`${base()}/meetings/agenda`);
    await expect(page.getByTestId("agenda-empty")).toContainText("Nenhuma reunião neste período.");
  });

  test("análises: reuniões com resumo abrem direto no resumo; perguntas continuam", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/meetings/ask`);
    await expect(page.getByRole("heading", { name: "Análises", exact: true })).toBeVisible();
    const rows = page.getByTestId("analyzed-meetings").getByTestId("analyzed-row");
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId("analyzed-meetings")).toContainText("1 reunião aguarda análise");
    await rows.first().click();
    await expect(page).toHaveURL(/mtg-vendas01-buffet\?secao=summary/);
    await expect(page.getByText("O cliente aprovou o cardápio")).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Pergunte às reuniões" })).toBeVisible();
  });

  test("preferências: configurações relacionadas e plano por acesso contextual", async ({ page }) => {
    await setup(page);
    await page.goto(`${base()}/meetings/settings`);
    const links = page.getByTestId("meetings-settings-links");
    await expect(links.getByRole("link", { name: "Agenda e integrações" })).toHaveAttribute("href", `${base()}/meetings/integrations`);
    await expect(links.getByRole("link", { name: "Contas de gravação" })).toHaveAttribute("href", `${base()}/meetings/recorder-accounts`);
    // Fase 10: o plano de Reuniões mora em Conta e assinatura (âncora do cartão).
    await expect(links.getByRole("link", { name: "Plano e cobrança" })).toHaveAttribute("href", `${base()}/settings/plano#plano-reunioes`);
    await expect(page.getByTestId("meetings-plan-link").getByRole("link")).toHaveAttribute("href", `${base()}/settings/plano#plano-reunioes`);
  });

  test("somente leitura: consulta tudo, sem gravar, excluir ou perguntar à IA", async ({ page }) => {
    const log = await setup(page, { role: "viewer", permissions: VIEWER });
    await page.goto(`${base()}/meetings`);
    await expect(page.getByText("Seu perfil permite consultar as reuniões, mas não gravar.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Gravar/ })).toHaveCount(0);
    await page.goto(`${base()}/meetings/central`);
    await expect(page.getByTestId("meeting-row")).toHaveCount(7);
    await expect(page.getByRole("button", { name: /Gravar|Enviar gravação/ })).toHaveCount(0);
    await page.goto(`${base()}/meetings/central/mtg-vendas01-buffet?secao=summary`);
    await expect(page.getByText("O cliente aprovou o cardápio")).toBeVisible();
    await expect(page.getByRole("button", { name: "Excluir" })).toHaveCount(0);
    await page.goto(`${base()}/meetings/agenda`);
    await expect(page.getByRole("button", { name: "Nova reunião" })).toHaveCount(0);
    expect(log.writes).toEqual([]);
  });

  test("workspace só com Reuniões: menu enxuto e telas funcionando", async ({ page }) => {
    await setup(page, { solutions: ["meetings"] });
    await page.goto(`${base()}/meetings`);
// Fase 12: Resultados (central de indicadores) existe para toda conta com alguma ferramenta.
    await expect(nav(page).locator("[data-area]")).toHaveText(["Início", "Reuniões", "Resultados", "Configurações"]);
    await expect(page.getByTestId("upcoming-meetings").getByTestId("upcoming-row")).toHaveCount(2);
  });

  test("troca de workspace: a biblioteca mostra só o novo workspace e não consulta o anterior", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base()}/meetings/central`);
    await expect(page.getByTestId("meeting-row")).toHaveCount(7);
    await page.getByTestId("workspace-switcher").click();
    await page.locator(`[data-workspace-option='${OTHER_ID}']`).click();
    await expect(page).toHaveURL(new RegExp(`${base(OTHER_ID)}/meetings/central`));
    const switchedAt = log.gets.length;
    await expect(page.getByTestId("meeting-row")).toHaveCount(1);
    await expect(page.getByText("Reunião do outro workspace")).toBeVisible();
    await expect(page.getByText("Reunião de vendas — Buffet")).toHaveCount(0);
    await page.waitForTimeout(1000);
    expect(log.gets.slice(switchedAt).filter((get) => get.path.startsWith("/v1/meetings") && get.ws && get.ws !== OTHER_ID).map((get) => get.path)).toEqual([]);
  });

  test("isolamento: id de outro workspace não abre e não fica consultando a API sem fim", async ({ page }) => {
    const log = await setup(page);
    await page.goto(`${base(OTHER_ID)}/meetings/central/mtg-vendas01-buffet`);
    await expect(page.getByText("Reunião não encontrada")).toBeVisible();
    await expect(page.getByText("O cliente aprovou o cardápio")).toHaveCount(0);
    // Antes da Fase 9 o SWR repetia o 404 indefinidamente (1ª repetição em 2,5–7,5 s).
    await page.waitForTimeout(8000);
    expect(log.gets.filter((get) => get.path === "/v1/meetings/mtg-vendas01-buffet").length).toBe(1);
    expect(log.gets.filter((get) => get.path.endsWith("/transcript"))).toEqual([]);
  });

  test("erros de carregamento são explicados com Tentar de novo", async ({ page }) => {
    await setup(page, { failDashboard: true, failList: true });
    await page.goto(`${base()}/meetings`);
    await expect(page.getByText("Falha simulada no painel de reuniões.")).toBeVisible();
    await expect(page.getByText("Falha simulada ao listar reuniões.").first()).toBeVisible();
    await page.goto(`${base()}/meetings/central`);
    await expect(page.getByText("Falha simulada ao listar reuniões.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar de novo" }).first()).toBeVisible();
  });
});

test.describe("Fase 9 — responsividade", () => {
  for (const width of [320, 360, 390, 600, 768, 1024, 1440]) {
    test(`${width}px: visão geral, agenda, gravações, detalhe e análises sem rolagem lateral (claro e escuro)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      await setup(page);
      for (const theme of ["light", "dark"]) {
        await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
        for (const path of ["/meetings", "/meetings/agenda", "/meetings/central", "/meetings/central/mtg-vendas01-buffet?secao=transcript", "/meetings/central/mtg-vendas01-buffet?secao=actions", "/meetings/ask"]) {
          await page.goto(`${base()}${path}`);
          await page.waitForTimeout(600);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${path} ${width} ${theme}`).toBe(true);
        }
      }
      if (width < 640) {
        // Celular: agenda abre em Lista e a biblioteca em cartões.
        await page.goto(`${base()}/meetings/agenda`);
        await expect(page.getByTestId("agenda-view-list")).toBeVisible();
      }
      if (width < 768) {
        await page.goto(`${base()}/meetings/central`);
        await expect(page.getByTestId("meeting-cards")).toBeVisible();
        await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();
      }
    });
  }
});

// Capturas para o relatório (só com PHASE9_CAPTURE_DIR; dados 100% simulados).
test.describe("capturas da Fase 9", () => {
  test.skip(!process.env.PHASE9_CAPTURE_DIR, "defina PHASE9_CAPTURE_DIR para gerar as capturas");
  const shots = [
    ["visao-geral-desktop", "/meetings", 1440, "light"],
    ["agenda-desktop", "/meetings/agenda", 1440, "dark"],
    ["gravacoes-desktop", "/meetings/central", 1440, "light"],
    ["detalhe-resumo-desktop", "/meetings/central/mtg-vendas01-buffet?secao=summary", 1440, "light"],
    ["detalhe-decisoes-desktop", "/meetings/central/mtg-vendas01-buffet?secao=actions", 1440, "dark"],
    ["analises-desktop", "/meetings/ask", 1440, "light"],
    ["visao-geral-tablet", "/meetings", 768, "dark"],
    ["detalhe-transcricao-tablet", "/meetings/central/mtg-vendas01-buffet?secao=transcript", 1024, "light"],
    ["visao-geral-celular", "/meetings", 390, "light"],
    ["agenda-celular", "/meetings/agenda", 390, "dark"],
    ["gravacoes-celular", "/meetings/central", 360, "light"],
    ["detalhe-celular", "/meetings/central/mtg-vendas01-buffet?secao=summary", 390, "dark"],
  ] as const;
  for (const [name, path, width, theme] of shots) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
      await setup(page);
      await page.goto(`${base()}${path}`);
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${process.env.PHASE9_CAPTURE_DIR}/${name}.png` });
    });
  }
});
