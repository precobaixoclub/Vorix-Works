import { test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { OWNER_PERMISSIONS } from "../e2e/fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "../e2e/fixtures/mock-backend";

/**
 * Capturas REAIS das telas da Vorix para a Biblioteca da marca (motor criativo, modo software).
 *
 * O front-end de verdade (build de produção, `next start`) renderiza dados de DEMONSTRAÇÃO —
 * nenhum dado de cliente, nenhuma chamada real: a API é simulada por `page.route`. Cada captura sai
 * em @2x com o trecho que importa (`focus`, em px da captura) medido pelo próprio DOM, e entra num
 * `manifest.json` com a funcionalidade e as palavras-chave usadas pelo motor para escolher a tela.
 *
 * Rodar: `npx next build && npx next start -p 3001` e, em outro terminal,
 * `npx playwright test -c playwright.capture.config.ts`.
 */

const OUT = "../scripts/editorial/library/vorix-works";
mkdirSync(OUT, { recursive: true });
const FIXED = new Date("2026-11-25T15:40:00-03:00");
const iso = (minutes: number) => new Date(FIXED.getTime() + minutes * 60_000).toISOString();
const DPR = 2;

type Capture = { file: string; feature: string; label: string; keywords: string[]; form: "desktop" | "mobile"; width: number; height: number; devicePixelRatio: number; focus?: { x: number; y: number; w: number; h: number } };
const manifest: Capture[] = [];

test.afterAll(() => {
  const path = `${OUT}/manifest.json`;
  let previous: Capture[] = [];
  try { previous = JSON.parse(readFileSync(path, "utf8")).captures ?? []; } catch { /* primeira captura */ }
  const merged = [...previous.filter((item) => !manifest.some((next) => next.file === item.file)), ...manifest].sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(path, `${JSON.stringify({ source: "demo_environment", note: "Front-end real da Vorix com dados de demonstração (API simulada). Nenhum dado de cliente.", capturedAt: FIXED.toISOString(), captures: merged }, null, 2)}\n`);
});

/** Trecho da funcionalidade em px da captura, sempre dentro da área visível capturada. */
function clampFocus(box: { x: number; y: number; width: number; height: number }, pad: number, viewport: { width: number; height: number }) {
  const x0 = Math.max(0, box.x - pad);
  const y0 = Math.max(0, box.y - pad);
  const x1 = Math.min(viewport.width, box.x + box.width + pad);
  const y1 = Math.min(viewport.height, box.y + box.height + pad);
  return { x: Math.round(x0 * DPR), y: Math.round(y0 * DPR), w: Math.round((x1 - x0) * DPR), h: Math.round((y1 - y0) * DPR) };
}

async function snap(page: Page, entry: Omit<Capture, "width" | "height" | "devicePixelRatio" | "focus">, focusSelector?: () => Promise<{ x: number; y: number; width: number; height: number } | null>) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const viewport = page.viewportSize()!;
  const box = focusSelector ? await focusSelector() : null;
  await page.screenshot({ path: `${OUT}/${entry.file}`, animations: "disabled", caret: "hide" });
  const pad = 18;
  manifest.push({
    ...entry, width: viewport.width * DPR, height: viewport.height * DPR, devicePixelRatio: DPR,
    ...(box ? { focus: clampFocus(box, pad, viewport) } : {}),
  });
}

/** Caixa do elemento, ou null se ele não estiver na tela (a captura segue sem esse trecho). */
const boxOf = (locator: import("@playwright/test").Locator) => locator.boundingBox({ timeout: 1500 }).catch(() => null);
const union = (boxes: Array<{ x: number; y: number; width: number; height: number } | null>) => {
  const valid = boxes.filter((box): box is { x: number; y: number; width: number; height: number } => Boolean(box));
  if (!valid.length) return null;
  const x = Math.min(...valid.map((box) => box.x));
  const y = Math.min(...valid.map((box) => box.y));
  return { x, y, width: Math.max(...valid.map((box) => box.x + box.width)) - x, height: Math.max(...valid.map((box) => box.y + box.height)) - y };
};

// ---------------------------------------------------------------- Conversas

const MEMBERS = [
  { userId: "user-qa", email: "bruno@demo.vorix", name: "Bruno Lima", role: "owner" },
  { userId: "user-ana", email: "ana@demo.vorix", name: "Ana Ribeiro", role: "member" },
  { userId: "user-caio", email: "caio@demo.vorix", name: "Caio Martins", role: "member" },
];
const conversation = (id: string, name: string, over: Record<string, unknown>) => ({
  id, connectionId: "conn-1", chatType: "direct", contactId: `c-${id}`, status: "open", assignedUserId: "user-qa", lastMessageAt: iso(-3), unreadCount: 0,
  aiEnabled: false, automationEnabled: false, contactName: name, contactPhone: "+5511990000000", ...over,
});
const CONVERSATIONS = [
  conversation("conv-juliana", "Juliana Prado", { lastMessageAt: iso(-2), unreadCount: 1, lastMessagePreview: { type: "text", direction: "inbound", body: "Pode ser no sábado de manhã?" } }),
  conversation("conv-marcos", "Marcos Teixeira", { lastMessageAt: iso(-14), assignedUserId: "user-ana", lastMessagePreview: { type: "text", direction: "outbound", body: "Te envio a proposta ainda hoje." } }),
  conversation("conv-patricia", "Patrícia Gomes", { lastMessageAt: iso(-31), status: "pending", unreadCount: 2, assignedUserId: undefined, lastMessagePreview: { type: "text", direction: "inbound", body: "Vocês atendem em Campinas?" } }),
  conversation("conv-rafael", "Rafael Souza", { lastMessageAt: iso(-58), assignedUserId: "user-caio", lastMessagePreview: { type: "text", direction: "inbound", body: "Perfeito, obrigado!" } }),
  conversation("conv-lais", "Laís Andrade", { lastMessageAt: iso(-95), status: "resolved", lastMessagePreview: { type: "text", direction: "inbound", body: "Recebi o pedido, tudo certo." } }),
];
const text = (id: string, direction: "inbound" | "outbound", body: string, minutes: number) => ({ id, conversationId: "conv-juliana", direction, type: "text", status: direction === "outbound" ? "read" : "read", body, sentByAi: false, sentByAutomation: false, reactions: [], createdAt: iso(minutes) });
const JULIANA_MESSAGES = [
  text("j1", "inbound", "Oi! Ontem falei com a Ana sobre o orçamento das 3 mesas de jantar.", -1440),
  text("j2", "outbound", "Oi, Juliana! Isso, a Ana me passou tudo: madeira freijó, 6 lugares, entrega em Moema.", -1435),
  text("j3", "inbound", "Isso mesmo. Já paguei o sinal pelo Pix.", -1430),
  text("j4", "outbound", "Confirmado aqui ✅ Falta só combinar o dia da entrega.", -12),
  text("j5", "inbound", "Pode ser no sábado de manhã?", -2),
];
const JULIANA_EVENTS = [
  { id: "e1", conversationId: "conv-juliana", type: "took_over", performedBy: "user-ana", createdAt: iso(-2900) },
  { id: "e2", conversationId: "conv-juliana", type: "note_added", performedBy: "user-ana", metadata: { text: "Cliente quer 3 mesas freijó (6 lugares). Sinal de 30% pago. Prefere entrega no fim de semana." }, createdAt: iso(-1500) },
  { id: "e3", conversationId: "conv-juliana", type: "transferred", performedBy: "user-ana", fromUserId: "user-ana", toUserId: "user-qa", createdAt: iso(-1438) },
];

async function conversasSetup(page: Page) {
  await page.clock.setFixedTime(FIXED);
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "bruno@demo.vorix", name: "Bruno Lima", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", permissions: OWNER_PERMISSIONS, teams: [], isAccountOwner: true });
    if (path === `/v1/workspaces/${WORKSPACE_ID}`) return ok({ id: WORKSPACE_ID, tenantId: TENANT_ID, name: "Móveis Aurora", status: "active", settings: {}, createdAt: iso(-90000), updatedAt: iso(-90000), campaignIds: [], integrations: [], members: [] });
    if (path === "/v1/inbox/conversations") return ok({ conversations: CONVERSATIONS });
    if (path === "/v1/inbox/members") return ok({ members: MEMBERS });
    if (path === "/v1/inbox/connections") return ok({ connections: [{ id: "conn-1", displayName: "WhatsApp Móveis Aurora", provider: "wuzapi", phoneNumber: "+5511990000000", status: "connected", connectionHealth: "healthy" }] });
    if (/\/v1\/inbox\/conversations\/conv-juliana\/messages$/.test(path)) return ok({ messages: JULIANA_MESSAGES });
    if (/\/v1\/inbox\/conversations\/conv-juliana\/events$/.test(path)) return ok({ events: JULIANA_EVENTS });
    if (/\/v1\/inbox\/conversations\/[^/]+\/(messages|events)$/.test(path)) return ok(path.endsWith("messages") ? { messages: [] } : { events: [] });
    return route.fallback();
  });
}

test.describe("Conversas", () => {
  test("atendimento pelo WhatsApp com histórico e responsável (desktop)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await conversasSetup(page);
    await page.goto(`/workspaces/${WORKSPACE_ID}/conversas?conversation=conv-juliana`);
    await page.getByText("Pode ser no sábado de manhã?").last().waitFor();
    await snap(page, { file: "conversas-continuidade.png", feature: "continuidade_atendimento", label: "Histórico e continuidade do atendimento", form: "desktop",
      keywords: ["historico", "continuidade", "transferencia", "transferiu", "repasse", "responsavel", "contexto", "nota interna", "proximo atendente", "muda de pessoa"] },
    async () => union([
      await boxOf(page.getByText(/NOTA INTERNA/i).first()),
      await boxOf(page.getByText("Cliente quer 3 mesas freijó").first()),
      await boxOf(page.getByText(/transferido de/).first()),
      await boxOf(page.getByText("Oi, Juliana! Isso, a Ana me passou tudo").first()),
      await boxOf(page.getByText("Pode ser no sábado de manhã?").last()),
    ]));
    await snap(page, { file: "conversas-whatsapp.png", feature: "atendimento_whatsapp", label: "Atendimento pelo WhatsApp", form: "desktop",
      keywords: ["whatsapp", "atendimento", "mensagens", "conversa", "caixa de entrada", "inbox", "responder", "cliente", "equipe"] },
    async () => union([
      await boxOf(page.getByText("Oi! Ontem falei com a Ana").first()),
      await boxOf(page.getByText("Oi, Juliana! Isso, a Ana me passou tudo").first()),
      await boxOf(page.getByText("Pode ser no sábado de manhã?").last()),
    ]));
  });

  test("conversa no celular", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await conversasSetup(page);
    await page.goto(`/workspaces/${WORKSPACE_ID}/conversas?conversation=conv-juliana`);
    await page.getByText("Pode ser no sábado de manhã?").last().waitFor();
    await snap(page, { file: "conversas-celular.png", feature: "atendimento_whatsapp", label: "Conversa do WhatsApp no celular", form: "mobile",
      keywords: ["whatsapp", "celular", "mensagens", "atendimento", "cliente", "responder"] });
  });
});

// ---------------------------------------------------------------- Reuniões

const MEETING = {
  id: "mtg-demo", workspaceId: WORKSPACE_ID, ownerUserId: "user-qa", ownerName: "Bruno Lima", createdByUserId: "user-qa", title: "Apresentação comercial — Clínica Bem-Estar",
  source: "calendar", status: "completed", timezone: "America/Sao_Paulo", statusChangedAt: iso(-100), createdAt: iso(-3000), updatedAt: iso(-100), scheduledStartAt: iso(-160), recordingDurationSeconds: 2460,
  participants: [{ id: "p-0", name: "Bruno Lima", role: "organizer" }, { id: "p-1", name: "Dra. Helena Rocha", role: "attendee" }, { id: "p-2", name: "Marcelo Dias", role: "attendee" }],
};
const RESULT = {
  executiveSummary: "A clínica quer centralizar o atendimento do WhatsApp das 3 recepcionistas e reduzir faltas em consultas. Aprovaram o teste de 14 dias e pediram a proposta com o plano para 3 usuários.",
  topics: ["Atendimento no WhatsApp", "Confirmação de consultas", "Integração com a agenda"],
  decisions: ["Iniciar o teste com as 3 recepcionistas", "Usar confirmação automática 24h antes"],
  actionItems: [{ description: "Enviar proposta do plano para 3 usuários", owner: "Bruno", dueDate: "sexta" }, { description: "Configurar o número oficial no teste", owner: "Marcelo", dueDate: "segunda" }],
  nextSteps: ["Reunião de acompanhamento em 7 dias"], risks: ["Equipe com pouco tempo para treinamento"], objections: ["Preço por usuário"], openQuestions: ["Quantos números de WhatsApp serão conectados?"],
};
const ACTION_ITEMS = [
  { id: "ai-1", type: "decision", description: "Iniciar o teste com as 3 recepcionistas", status: "confirmed", sourceTimestampMs: 812_000, confidence: 0.91 },
  { id: "ai-2", type: "decision", description: "Usar confirmação automática 24h antes", status: "suggested", sourceTimestampMs: 1_240_000, confidence: 0.86 },
  { id: "ai-3", type: "task", description: "Enviar proposta do plano para 3 usuários", assigneeName: "Bruno", dueDate: "sexta", status: "suggested" },
  { id: "ai-4", type: "next_step", description: "Reunião de acompanhamento em 7 dias", status: "confirmed" },
];
const SEGMENTS = [
  { seq: 1, startMs: 0, endMs: 9_000, speaker: "spk_0", text: "Obrigado pelo tempo de vocês. Hoje a ideia é mostrar como fica o atendimento das recepcionistas num lugar só." },
  { seq: 2, startMs: 9_500, endMs: 21_000, speaker: "spk_1", text: "Hoje cada uma usa o próprio celular. Quando alguém falta, ninguém sabe o que foi combinado com o paciente." },
  { seq: 3, startMs: 21_500, endMs: 33_000, speaker: "spk_0", text: "Na Vorix a conversa fica com a clínica: quem assume vê o histórico inteiro e as notas internas." },
  { seq: 4, startMs: 33_500, endMs: 44_000, speaker: "spk_2", text: "E dá para confirmar a consulta automaticamente um dia antes?" },
  { seq: 5, startMs: 44_500, endMs: 56_000, speaker: "spk_0", text: "Dá, sim. A confirmação sai pelo WhatsApp e a resposta do paciente volta para a mesma conversa." },
  { seq: 6, startMs: 56_500, endMs: 66_000, speaker: "spk_1", text: "Então vamos começar o teste com as três recepcionistas." },
];
const INSIGHTS = {
  summaryTemplate: "sales", templates: [{ key: "sales", label: "Vendas", description: "Reunião comercial" }],
  speakers: [{ key: "spk_0", displayName: "Bruno Lima", renamed: true }, { key: "spk_1", displayName: "Dra. Helena Rocha", renamed: true }, { key: "spk_2", displayName: "Marcelo Dias", renamed: true }],
  talk: { hasSpeakers: true, totalTalkMs: 66_000, speakers: [], speakerSwitches: 5, questions: 1 }, keywordHits: [], clips: [], comments: [], shares: [],
  crm: { available: false, suggestions: [] }, crmTasks: {}, questions: [], whatsAppAvailable: false, aiAvailable: true,
};

async function meetingsSetup(page: Page) {
  await page.clock.setFixedTime(FIXED);
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "bruno@demo.vorix", name: "Bruno Lima", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", permissions: OWNER_PERMISSIONS, teams: [], isAccountOwner: true });
    if (path === "/v1/solutions") return ok({ solutions: ["conversations", "marketing", "meetings"].map((key) => ({ key, name: key, internal: false })) });
    if (path === `/v1/workspaces/${WORKSPACE_ID}`) return ok({ id: WORKSPACE_ID, tenantId: TENANT_ID, name: "Vorix Works", status: "active", settings: {}, createdAt: iso(-90000), updatedAt: iso(-90000), campaignIds: [], integrations: [], members: [] });
    if (path === "/v1/meetings/mtg-demo") {
      const analysis = { id: "an-1", status: "completed", result: RESULT, actionItems: ACTION_ITEMS, creditsCharged: 1, model: "fixture", createdAt: iso(-95) };
      return ok({ ...MEETING, recordings: [{ id: "rec-1", kind: "original", mimeType: "audio/webm", bytes: 18_000_000, durationSeconds: 2460, checksumSha256: "abc", status: "available", createdAt: iso(-90) }], transcript: { id: "t-1", status: "completed", language: "pt", segmentCount: SEGMENTS.length, attempts: 1 }, latestAnalysis: analysis, lastCompletedAnalysis: analysis });
    }
    if (path === "/v1/meetings/mtg-demo/transcript") return ok({ segments: SEGMENTS });
    if (path === "/v1/meetings/mtg-demo/insights") return ok(INSIGHTS);
    if (/^\/v1\/meetings\/mtg-demo\/recordings\/[^/]+\/playback$/.test(path)) return ok({ url: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=", mimeType: "audio/wav", expiresInSeconds: 600 });
    if (path === "/v1/meetings/mtg-demo/recorder-eligibility") return ok({ planCapacity: 2, tenantHealthyCapacity: 2, tenantAvailableCapacity: 1, meetingEligibleCapacity: 1, humanIdentityKnown: true, meetingEligibleRecorderCapacity: 1, tenantEffectiveRecordingCapacity: 2, connectedAccounts: 2, knownHumanEmails: [] });
    if (path.startsWith("/v1/meetings")) return ok([]);
    return route.fallback();
  });
}

test.describe("Reuniões", () => {
  test.use({ timezoneId: "America/Sao_Paulo" });
  test("resumo, decisões e transcrição da reunião", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await meetingsSetup(page);
    await page.goto(`/workspaces/${WORKSPACE_ID}/meetings/central/mtg-demo?secao=resumo`);
    await page.getByText("A clínica quer centralizar").first().waitFor();
    await snap(page, { file: "reunioes-resumo.png", feature: "reunioes_analise", label: "Resumo e decisões da reunião gravada", form: "desktop",
      keywords: ["reuniao", "reunioes", "gravacao", "gravador", "resumo", "decisoes", "ata", "analise", "ia", "proximos passos", "tarefas"] },
    async () => union([await boxOf(page.getByText("A clínica quer centralizar").first()), await boxOf(page.getByTestId("summary-next"))]));
    await page.goto(`/workspaces/${WORKSPACE_ID}/meetings/central/mtg-demo?secao=transcript`);
    await page.getByTestId("transcript-segments").waitFor();
    await snap(page, { file: "reunioes-transcricao.png", feature: "reunioes_analise", label: "Transcrição da reunião com quem falou", form: "desktop",
      keywords: ["transcricao", "transcrita", "reuniao", "gravacao", "falou", "trechos", "registro"] },
    async () => page.getByTestId("transcript-segments").boundingBox());
  });
});

// ---------------------------------------------------------------- Marketing

const ymd = "2026-11-25";
const idea = (id: string, title: string, status: string, over: Record<string, unknown> = {}) => ({ id, externalId: id, title, category: "Conteúdo", commercialObjective: "Gerar demanda", targetAudience: "Pequenas empresas", concept: "", keyMessage: title, format: "single_image", approach: "Educativo", visualDirection: "", narrativeStructure: "", caption: "", cta: "Saiba mais", priority: "normal", status, statusChangedAt: iso(0), ...over });
const IDEAS = [
  idea("i1", "3 sinais de que seu atendimento depende de uma pessoa só", "available", { scheduledDate: ymd, format: "carousel", carouselScript: [{ headline: "Sinal 1", body: "" }, { headline: "Sinal 2", body: "" }], referenceImages: ["https://cdn.example.test/arte-1.png"] }),
  idea("i2", "O que muda quando o histórico fica com a empresa", "available", { scheduledDate: "2026-11-26", referenceImages: ["https://cdn.example.test/arte-4.png"] }),
  idea("i3", "Como responder mais rápido sem parecer robô", "in_production", { scheduledDate: "2026-11-27", referenceImages: ["https://cdn.example.test/arte-6.png"] }),
  idea("i4", "Reunião boa termina com decisão registrada", "available", { scheduledDate: "2026-11-28", referenceImages: ["https://cdn.example.test/arte-2.png"] }),
  idea("i5", "Bastidores: como a equipe usa notas internas", "produced"),
];

const destination = (id: string, network: string, state: string, caption: string, image: number, scheduledAt: string) => ({ id, accountId: `acc-${network}`, network, username: "vorixworks", format: "feed_image", formatLabel: "Imagem no feed", caption, hashtags: [], media: [{ url: `https://cdn.example.test/arte-${image}.png`, kind: "image" }], audioMode: "NONE", state, attemptCount: 0, actions: [], scheduledAt });
const post = (id: string, state: string, day: number, hour: number, caption: string, image: number) => {
  const at = new Date(`2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00-03:00`).toISOString();
  return { id, state, scheduledAt: at, timezone: "America/Sao_Paulo", createdAt: iso(-3000), requiresApproval: false, history: [], destinations: [destination(`${id}-ig`, "instagram", state, caption, image, at), destination(`${id}-fb`, "facebook", state, caption, image, at)] };
};
const POSTS = [
  post("p1", "PUBLISHED", 18, 12, "O atendimento muda de pessoa. O histórico continua.", 1), post("p2", "PUBLISHED", 19, 19, "Reunião boa termina com decisão registrada.", 2),
  post("p3", "PUBLISHED", 21, 12, "3 sinais de que seu atendimento depende de uma pessoa só", 3), post("p4", "PUBLISHED", 24, 19, "Como responder mais rápido sem parecer robô", 4),
  post("p5", "SCHEDULED", 26, 12, "O que muda quando o histórico fica com a empresa", 5), post("p6", "SCHEDULED", 27, 19, "Sua equipe sabe o que foi combinado ontem?", 6),
  post("p7", "SCHEDULED", 28, 12, "Do WhatsApp ao funil sem copiar e colar", 7),
];
const ART = ["#9333EA", "#B990FC", "#1F2937", "#6D28D9", "#7C3AED", "#A855F7", "#4C1D95"];

async function marketingSetup(page: Page) {
  await page.route("https://cdn.example.test/**", async (route) => {
    const index = Number(/arte-(\d+)/.exec(route.request().url())?.[1] ?? 1) - 1;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B0F19"/><stop offset="1" stop-color="${ART[index % ART.length]}"/></linearGradient></defs><rect width="320" height="400" fill="url(#g)"/><rect x="28" y="40" width="150" height="14" rx="7" fill="#fff" fill-opacity="0.9"/><rect x="28" y="66" width="210" height="14" rx="7" fill="#fff" fill-opacity="0.6"/><rect x="40" y="200" width="240" height="160" rx="12" fill="#121224" stroke="#B990FC" stroke-opacity="0.6"/></svg>`;
    await route.fulfill({ contentType: "image/svg+xml", body: svg });
  });
  await page.clock.setFixedTime(FIXED);
  await loginCookie(page.context());
  await mockConversasBackend(page);
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (path === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "bruno@demo.vorix", name: "Bruno Lima", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", permissions: OWNER_PERMISSIONS, teams: [], isAccountOwner: true });
    if (path === "/v1/solutions") return ok({ solutions: ["conversations", "marketing"].map((key) => ({ key, name: key, internal: false })) });
    if (path === `/v1/workspaces/${WORKSPACE_ID}`) return ok({ id: WORKSPACE_ID, tenantId: TENANT_ID, name: "Vorix Works", status: "active", settings: {}, createdAt: iso(-90000), updatedAt: iso(-90000), campaignIds: [], integrations: [], members: [] });
    if (path === "/v1/editorial-ideas") return ok(IDEAS);
    if (path === "/v1/social/posts") return ok({ posts: POSTS });
    if (path === "/v1/social/settings") return ok({ timezone: "America/Sao_Paulo", networks: [] });
    return route.fallback();
  });
}

test.describe("Marketing", () => {
  test("Calendário com as publicações produzidas e agendadas", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await marketingSetup(page);
    await page.goto(`/workspaces/${WORKSPACE_ID}/calendar`);
    await page.getByText("O que muda quando o histórico").first().waitFor();
    await snap(page, { file: "marketing-calendario.png", feature: "conteudo_ia", label: "Calendário de conteúdos produzidos e agendados", form: "desktop",
      keywords: ["conteudo", "conteudos", "marketing", "calendario", "agendamento", "publicacao", "redes sociais", "instagram", "facebook", "post", "producao", "ia"] },
    async () => boxOf(page.getByTestId("calendar-month").first()));
  });

  test("Bolsão de ideias com pautas prontas", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await marketingSetup(page);
    await page.goto(`/workspaces/${WORKSPACE_ID}/ideias`);
    await page.getByText("O que muda quando o histórico fica com a empresa").first().waitFor();
    await snap(page, { file: "marketing-bolsao.png", feature: "conteudo_ia", label: "Bolsão de ideias e produção de conteúdo", form: "desktop",
      keywords: ["conteudo", "conteudos", "marketing", "ideias", "pautas", "bolsao", "producao", "redes sociais", "instagram", "post", "ia", "calendario"] },
    async () => union([await boxOf(page.locator("article").filter({ hasText: "3 sinais de que seu atendimento" }).first()), await boxOf(page.locator("article").filter({ hasText: "Reunião boa termina com decisão" }).first())]));
  });
});
