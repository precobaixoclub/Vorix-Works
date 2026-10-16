import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresSolutionEntitlementRepository } from "../dist/infrastructure/storage/postgres/postgres-solution-entitlement-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMeetingRepository } from "../dist/infrastructure/storage/postgres/postgres-meeting-repository.js";
import { PostgresMeetingInsightsRepository } from "../dist/infrastructure/storage/postgres/postgres-meeting-insights-repository.js";
import { LocalObjectStorage } from "../dist/infrastructure/storage/local-object-storage.js";
import { ObjectStorageMeetingMedia } from "../dist/infrastructure/meetings/object-storage-meeting-media.js";
import { SolutionAccessService } from "../dist/application/solutions/solution-access.service.js";
import { processNextMeetingJob } from "../dist/application/meetings/meeting-processing.js";
import { limitsFromEntitlement, requestRecording, uploadMeetingRecording } from "../dist/application/meetings/meeting-use-cases.js";
import {
  addMeetingComment, askMeetings, createCrmTaskFromActionItem, createMeetingClip, createMeetingShare, deleteMeetingComment, exportMeetingMarkdown,
  generateMeetingFollowUp, getMeetingInsights, getMeetingsUsage, getSharedMeeting, keywordTrackerReport, linkMeetingToCrm, purgeMeetingPermanently,
  renameMeetingSpeaker, revokeMeetingShare, saveKeywordTracker, sendMeetingFollowUpWhatsApp, setMeetingSummaryTemplate, updateMeetingPreferences,
} from "../dist/application/meetings/meeting-intelligence.js";
import { computeTalkAnalytics, findKeywordHits, isExternalMeeting, shouldAutoRecord, defaultSpeakerLabel } from "../dist/domain/meetings/meeting-intelligence.js";
import { PROMPT_TEMPLATE_REGISTRY } from "../dist/application/ai-gateway/prompt-template-registry.js";
import { configureObjectUrlSigning, deriveObjectUrlSigningKey } from "../dist/shared/utils/object-url-signing.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Vorix Meetings — inteligência e colaboração (migration 0153). */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let storageDir;
let counter = 0;
const nextId = (prefix) => `${prefix}-i${++counter}`;

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
  storageDir = await mkdtemp(join(tmpdir(), "vorix-meetings-intel-"));
  configureObjectUrlSigning({ publicBaseUrl: "http://localhost:3000/uploads", signingKey: deriveObjectUrlSigningKey("k") });
});
after(async () => {
  await db.stop();
  await rm(storageDir, { recursive: true, force: true });
});

const SEGMENTS = [
  { startMs: 0, endMs: 10_000, speaker: "SPEAKER_00", text: "Bom dia! Qual é o orçamento que vocês têm para o projeto?" },
  { startMs: 10_000, endMs: 40_000, speaker: "SPEAKER_01", text: "Temos cerca de cinquenta mil reais. O concorrente Acme ofereceu um preço menor." },
  { startMs: 40_000, endMs: 50_000, speaker: "SPEAKER_01", text: "A decisão final é da diretora financeira." },
  { startMs: 50_000, endMs: 60_000, speaker: "SPEAKER_00", text: "Combinado, a Ana envia a proposta até sexta-feira." },
];

const storage = () => new LocalObjectStorage({ rootDir: storageDir, publicBaseUrl: "http://localhost:3000/uploads" });
const solutions = () => new SolutionAccessService({ repository: new PostgresSolutionEntitlementRepository(db.pool), cacheTtlMs: 0 });

function fakeAi() {
  const ai = {
    questions: [],
    followUps: [],
    async answerQuestion(input) {
      ai.questions.push(input);
      const first = input.sources[0];
      return { ok: true, answer: { answer: "Cerca de cinquenta mil reais.", found: true, citations: [{ meetingId: first.meetingId, sourceTimestampMs: 10_000, evidence: "Temos cerca de cinquenta mil reais." }] } };
    },
    async generateFollowUp(input) {
      ai.followUps.push(input);
      return { ok: true, draft: { emailSubject: "Resumo da reunião", emailBody: `Olá, ${input.recipientName ?? ""}`, whatsappMessage: "Oi! Seguem os próximos passos." } };
    },
  };
  return ai;
}

function fakeCrm() {
  const crm = {
    tasks: [],
    contacts: [{ id: "contact-1", name: "Maria Souza", company: "Acme", whatsappPhone: "+5511999990000" }],
    deals: [{ id: "deal-1", title: "Projeto Acme", valueCents: 5_000_000, currency: "BRL", won: false, lost: false, contactId: "contact-1" }],
    async searchContacts({ query }) { return crm.contacts.filter((contact) => contact.name.toLowerCase().includes(query.toLowerCase().split(" ")[0])); },
    async getContact({ contactId }) { return crm.contacts.find((contact) => contact.id === contactId); },
    async listDeals({ contactId }) { return crm.deals.filter((deal) => deal.contactId === contactId); },
    async getDeal({ dealId }) { return crm.deals.find((deal) => deal.id === dealId); },
    async createTask(input) { crm.tasks.push(input); return { taskId: `task-${crm.tasks.length}` }; },
  };
  return crm;
}

async function setup(label, { limits } = {}) {
  const tenantId = `tenant-intel-${label}`;
  await solutions().setEntitlement({ tenantId, solutionKey: "meetings", enabled: true, source: "internal", ...(limits ? { limits } : {}) });
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("ws") }).create({ tenantId, name: label });
  const repository = new PostgresMeetingRepository(db.pool);
  const insights = new PostgresMeetingInsightsRepository(db.pool);
  const ai = fakeAi();
  const crm = fakeCrm();
  const messaging = { sent: [], async listWhatsAppChannels() { return [{ id: "conn-1", label: "Comercial" }]; }, async sendWhatsApp(input) { messaging.sent.push(input); return { conversationId: "conv-1" }; } };
  const deps = {
    repository, insights, ai, crm, messaging,
    media: new ObjectStorageMeetingMedia(storage()),
    limitsFor: async (id) => limitsFromEntitlement((await solutions().getEntitlement(id, "meetings"))?.limits),
    features: { realRecordingEnabled: true },
    idGenerator: nextId,
    now: () => new Date(),
    publicAppUrl: "https://app.vorix.test/",
  };
  const actor = { tenantId, userId: "owner-1", role: "owner" };
  return { tenantId, workspaceId: workspace.id, deps, actor, ai, crm, messaging };
}

/** Reunião com transcrição pronta (com falantes) e análise completa, pelo worker real com motor falso. */
async function meetingWithAnalysis(ctx, { analyzer } = {}) {
  await db.pool.query(`update meeting_jobs set status = 'cancelled' where status in ('queued', 'running')`);
  const meeting = await ctx.deps.repository.create({ id: nextId("meeting"), tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, ownerUserId: "owner-1", createdByUserId: "owner-1", title: "Reunião com a Acme", source: "upload", status: "scheduled", timezone: "America/Sao_Paulo", autoRecord: false, participants: [{ name: "Maria Souza", email: "maria@acme.com", role: "attendee" }] });
  const key = `meetings/${ctx.tenantId}/${ctx.workspaceId}/${meeting.id}/original.wav`;
  const temp = join(storageDir, `${meeting.id}.tmp`);
  await writeFile(temp, Buffer.from("RIFF-fake"));
  await storage().putFile({ key, filePath: temp, contentType: "audio/wav" });
  const recording = await ctx.deps.repository.addRecording({ id: nextId("mrec"), meetingId: meeting.id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, kind: "original", storageKey: key, mimeType: "audio/wav", bytes: 9, checksumSha256: "x" });
  await ctx.deps.repository.transition({ tenantId: ctx.tenantId, meetingId: meeting.id, to: "processing" });
  await ctx.deps.repository.enqueueTranscription({ tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, meetingId: meeting.id, recordingId: recording.id });
  const calls = [];
  const processing = {
    repository: ctx.deps.repository, media: ctx.deps.media, insights: ctx.deps.insights,
    extractor: { async extractWav16kMono({ sourcePath, targetPath }) { await copyFile(sourcePath, targetPath); } },
    engine: { async transcribe() { return { language: "pt", engine: "fake", model: "fake", durationSeconds: 60, processingMs: 5, segments: SEGMENTS, metrics: {} }; } },
    analyzer: analyzer ?? {
      async analyze(input) {
        calls.push(input);
        return { ok: true, model: "fake", output: {
          executiveSummary: "Cliente tem orçamento de cinquenta mil reais.", topics: ["Orçamento"], decisions: [],
          tasks: [{ description: "Enviar a proposta", sourceTimestampMs: 50_000, confidence: 0.9, assigneeName: "Ana", dueDate: "sexta-feira" }],
          nextSteps: [{ description: "Agendar demonstração", sourceTimestampMs: null, confidence: 0.6 }], risks: [], objections: ["Preço do concorrente"], openQuestions: [],
          templateSections: input.template ? input.template.sections.map((section) => ({ title: section.title, content: "Não mencionado na reunião." })) : [],
        } };
      },
    },
    analysisEnabled: true, workerId: "w", leaseMs: 60_000, transcriptionTimeoutMs: 60_000, idGenerator: nextId, now: () => new Date(),
  };
  assert.equal((await processNextMeetingJob(processing, ["transcribe"])).status, "completed");
  assert.equal((await processNextMeetingJob(processing, ["analyze"])).status, "completed");
  return { meeting, recording, processing, calls };
}

test("domínio: estatísticas de fala, monólogo, perguntas, palavras monitoradas e regra de gravação automática", () => {
  const talk = computeTalkAnalytics(SEGMENTS, new Map([["SPEAKER_01", "Maria"]]));
  assert.equal(talk.hasSpeakers, true);
  assert.equal(talk.totalTalkMs, 60_000);
  assert.deepEqual(talk.speakers.map((s) => [s.displayName, s.talkMs, s.turns, s.questions]), [["Maria", 40_000, 1, 0], ["Falante 1", 20_000, 2, 1]]);
  assert.equal(talk.longestMonologue.displayName, "Maria");
  assert.equal(talk.longestMonologue.durationMs, 40_000);
  assert.equal(talk.speakerSwitches, 2);
  assert.equal(defaultSpeakerLabel("SPEAKER_02"), "Falante 3");

  const hits = findKeywordHits(SEGMENTS, [{ id: "t1", label: "Concorrentes", terms: ["acme"] }, { id: "t2", label: "Preço", terms: ["preço", "orcamento"] }, { id: "t3", label: "Cancelamento", terms: ["cancelar"] }]);
  assert.deepEqual(hits.map((hit) => [hit.label, hit.count]), [["Concorrentes", 1], ["Preço", 2]]);

  assert.equal(isExternalMeeting("eu@vorix.com", ["colega@vorix.com"]), false);
  assert.equal(isExternalMeeting("eu@vorix.com", ["cliente@acme.com"]), true);
  assert.equal(isExternalMeeting("eu@gmail.com", ["alguem@gmail.com"]), true);
  assert.equal(shouldAutoRecord("external_only", { hasMeetLink: true, ownerEmail: "eu@vorix.com", participantEmails: ["colega@vorix.com"] }), false);
  assert.equal(shouldAutoRecord("all", { hasMeetLink: true, participantEmails: [] }), true);
  assert.equal(shouldAutoRecord("all", { hasMeetLink: false, participantEmails: [] }), false);
});

test("IA: citação sem trecho literal é descartada em 'pergunte à reunião'; modelo de resumo aceita seções", () => {
  const qa = PROMPT_TEMPLATE_REGISTRY.meeting_question_answer;
  const structural = qa.validateStructure({ schemaVersion: 1, answer: "50 mil", found: true, citations: [{ meetingId: "m1", sourceTimestampMs: 10, evidence: "cinquenta mil reais" }, { meetingId: "m1", sourceTimestampMs: 20, evidence: "frase inventada" }], warnings: [] });
  assert.equal(structural.valid, true);
  const semantic = qa.validateSemantics(structural.data, { question: "q", sources: [{ meetingId: "m1", title: "t", segments: [{ startMs: 10, text: "Temos cerca de cinquenta mil reais." }] }] });
  assert.equal(semantic.data.citations.length, 1);
  const prompt = PROMPT_TEMPLATE_REGISTRY.meeting_ai_analysis;
  const userInput = prompt.template.buildUserInput(prompt.buildContext({ title: "t", segments: [], template: { label: "Vendas", sections: [{ title: "Orçamento", instruction: "valores" }] } }));
  assert.match(userInput, /Modelo de resumo: Vendas/);
  assert.equal(prompt.validateStructure({ schemaVersion: 1, executiveSummary: "x", topics: [], decisions: [], tasks: [], nextSteps: [], risks: [], objections: [], openQuestions: [], warnings: [] }).valid, true, "templateSections é opcional (padrão vazio)");
});

test("modelo de resumo de vendas vai para a análise com os nomes dos falantes; painel mostra falantes e estatísticas", async () => {
  const ctx = await setup("template");
  const first = await meetingWithAnalysis(ctx);
  await renameMeetingSpeaker(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: first.meeting.id, speakerKey: "SPEAKER_01", displayName: "Maria (Acme)" });
  await assert.rejects(renameMeetingSpeaker(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: first.meeting.id, speakerKey: "SPEAKER_09", displayName: "X" }), /MEETING_NOT_FOUND/);

  const result = await setMeetingSummaryTemplate(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: first.meeting.id, template: "sales", reanalyze: true });
  assert.equal(result.reanalysisQueued, true);
  assert.equal((await processNextMeetingJob(first.processing, ["analyze"])).status, "completed");
  const call = first.calls.at(-1);
  assert.equal(call.template.key, "sales");
  assert.ok(call.template.sections.some((section) => section.title.startsWith("Orçamento")));
  assert.ok(call.segments.some((segment) => segment.speaker === "Maria (Acme)"), "o nome dado ao falante vai para a IA");

  const view = await getMeetingInsights(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: first.meeting.id });
  assert.equal(view.summaryTemplate, "sales");
  assert.deepEqual(view.speakers.map((s) => [s.key, s.displayName, s.renamed]), [["SPEAKER_00", "Falante 1", false], ["SPEAKER_01", "Maria (Acme)", true]]);
  assert.equal(view.talk.speakers[0].displayName, "Maria (Acme)");
  assert.equal(view.crm.suggestions[0]?.id, "contact-1", "sugere o contato do CRM pelo nome do participante");
  const detail = await ctx.deps.repository.getDetail({ tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, meetingId: first.meeting.id });
  assert.equal(detail.lastCompletedAnalysis.result.template, "sales");
  assert.equal(detail.lastCompletedAnalysis.result.templateSections.length, 6);
});

test("pergunte à reunião (uma e todas), follow-up e envio por WhatsApp", async () => {
  const ctx = await setup("ask");
  const { meeting } = await meetingWithAnalysis(ctx);
  const single = await askMeetings(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, question: "Qual o orçamento do cliente?" });
  assert.equal(single.answer.found, true);
  assert.equal(ctx.ai.questions[0].sources.length, 1);
  assert.equal(ctx.ai.questions[0].sources[0].segments.length, 4);

  const across = await askMeetings(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, question: "o que falaram do concorrente acme?" });
  assert.equal(across.meetingId, undefined);
  assert.ok(ctx.ai.questions[1].sources[0].segments.some((segment) => segment.text.includes("Acme")), "busca os trechos relevantes de todas as reuniões");
  const nothing = await askMeetings(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, question: "xilofone paralelepípedo" });
  assert.equal(nothing.answer.found, false);
  assert.equal(ctx.ai.questions.length, 2, "sem trecho relevante não gasta crédito com IA");

  const draft = await generateMeetingFollowUp(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, recipientName: "Maria" });
  assert.equal(draft.emailSubject, "Resumo da reunião");
  assert.equal(ctx.ai.followUps[0].tasks[0].description, "Enviar a proposta");
  assert.equal((await getMeetingInsights(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id })).followUp.whatsappMessage, "Oi! Seguem os próximos passos.");

  await sendMeetingFollowUpWhatsApp(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, connectionId: "conn-1", contactId: "contact-1", message: draft.whatsappMessage });
  assert.equal(ctx.messaging.sent[0].phone, "+5511999990000");
  await assert.rejects(sendMeetingFollowUpWhatsApp(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, connectionId: "conn-1", message: "oi" }), /WhatsApp do destinatário/);
});

test("CRM: vincula contato + oportunidade e a tarefa da reunião vira tarefa real (uma vez só)", async () => {
  const ctx = await setup("crm");
  const { meeting } = await meetingWithAnalysis(ctx);
  await assert.rejects(linkMeetingToCrm(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, contactId: "nope" }), /MEETING_NOT_FOUND/);
  await linkMeetingToCrm(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, contactId: "contact-1", dealId: "deal-1" });

  const detail = await ctx.deps.repository.getDetail({ tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, meetingId: meeting.id });
  const task = detail.lastCompletedAnalysis.actionItems.find((item) => item.type === "task");
  const created = await createCrmTaskFromActionItem(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, itemId: task.id, dueAt: "2026-10-23T12:00:00.000Z" });
  const again = await createCrmTaskFromActionItem(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, itemId: task.id });
  assert.equal(again.taskId, created.taskId);
  assert.equal(ctx.crm.tasks.length, 1);
  assert.equal(ctx.crm.tasks[0].contactId, "contact-1");
  assert.equal(ctx.crm.tasks[0].dealId, "deal-1");
  assert.match(ctx.crm.tasks[0].description, /Reunião com a Acme.*00:50.*Ana.*sexta-feira/);
  const view = await getMeetingInsights(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id });
  assert.equal(view.crm.contact.id, "contact-1");
  assert.equal(view.crmTasks[task.id], created.taskId);
  const confirmed = (await ctx.deps.repository.getDetail({ tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, meetingId: meeting.id })).lastCompletedAnalysis.actionItems.find((item) => item.id === task.id);
  assert.equal(confirmed.status, "confirmed");
});

test("link público: token só existe na criação, respeita o que foi liberado, expira e pode ser revogado", async () => {
  const ctx = await setup("share");
  const { meeting } = await meetingWithAnalysis(ctx);
  await renameMeetingSpeaker(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, speakerKey: "SPEAKER_00", displayName: "Vendedor" });
  const { share, url } = await createMeetingShare(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, includeTranscript: true, includeRecording: false });
  assert.match(url, /^https:\/\/app\.vorix\.test\/r\/[A-Za-z0-9_-]{30,}$/);
  const token = url.split("/r/")[1];
  const stored = await db.pool.query("select token_hash from meeting_shares where id = $1", [share.id]);
  assert.notEqual(stored.rows[0].token_hash, token, "o banco guarda só o hash");

  const view = await getSharedMeeting(ctx.deps, { token });
  assert.equal(view.title, "Reunião com a Acme");
  assert.equal(view.summary.executiveSummary, "Cliente tem orçamento de cinquenta mil reais.");
  assert.equal(view.transcript[0].speaker, "Vendedor");
  assert.equal(view.recording, undefined);
  await assert.rejects(getSharedMeeting(ctx.deps, { token: "x".repeat(32) }), /MEETING_NOT_FOUND/);

  const withVideo = await createMeetingShare(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, includeTranscript: false, includeRecording: true, expiresInDays: 1 });
  const videoView = await getSharedMeeting(ctx.deps, { token: withVideo.url.split("/r/")[1] });
  assert.equal(videoView.transcript, undefined);
  assert.ok(videoView.recording.url);
  const expired = await getSharedMeeting({ ...ctx.deps, now: () => new Date(Date.now() + 3 * 86_400_000) }, { token: withVideo.url.split("/r/")[1] }).catch((error) => error);
  assert.match(String(expired), /MEETING_NOT_FOUND/);

  await revokeMeetingShare(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, shareId: share.id });
  await assert.rejects(getSharedMeeting(ctx.deps, { token }), /MEETING_NOT_FOUND/);
  assert.equal((await db.pool.query("select view_count from meeting_shares where id = $1", [share.id])).rows[0].view_count, 1);
});

test("exportação Markdown, trechos, comentários, palavras monitoradas e preferências", async () => {
  const ctx = await setup("collab");
  const { meeting } = await meetingWithAnalysis(ctx);
  const file = await exportMeetingMarkdown(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, includeTranscript: true });
  assert.equal(file.fileName, "reuniao-com-a-acme.md");
  assert.match(file.content, /^# Reunião com a Acme/);
  assert.match(file.content, /## Tarefas\n\n- Enviar a proposta — Ana \(prazo: sexta-feira\)/);
  assert.match(file.content, /\*\*\[00:10\] Falante 2:\*\* Temos cerca/);

  await assert.rejects(createMeetingClip(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, startMs: 5000, endMs: 4000, title: "x" }), /MEETING_INVALID_INPUT/);
  await createMeetingClip(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, startMs: 10_000, endMs: 40_000, title: "Orçamento do cliente" });
  const comment = await addMeetingComment(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, text: "Atenção ao concorrente", atMs: 10_000 });
  const viewer = { ...ctx.actor, userId: "viewer-2", role: "viewer" };
  await assert.rejects(deleteMeetingComment(ctx.deps, viewer, { workspaceId: ctx.workspaceId, meetingId: meeting.id, commentId: comment.id }), /MEETING_NOT_FOUND/);
  await deleteMeetingComment(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, commentId: comment.id });

  await saveKeywordTracker(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, label: "Concorrentes", terms: ["Acme", " acme ", "Globex"] });
  await assert.rejects(saveKeywordTracker(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, label: "concorrentes", terms: ["x1"] }), /Já existe/);
  const view = await getMeetingInsights(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id });
  assert.equal(view.clips.length, 1);
  assert.equal(view.comments.length, 0);
  assert.deepEqual(view.keywordHits.map((hit) => [hit.label, hit.count]), [["Concorrentes", 1]]);
  const report = await keywordTrackerReport(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId });
  assert.deepEqual(report.map((row) => [row.label, row.meetings, row.mentions]), [["Concorrentes", 1, 1]]);

  const preferences = await updateMeetingPreferences(ctx.deps, ctx.actor, { autoRecordMode: "external_only", defaultTemplate: "support", consentMessage: "Gravando para o resumo." });
  assert.equal(preferences.autoRecordMode, "external_only");
  assert.equal(preferences.tenant.consentMessage, "Gravando para o resumo.");
  await assert.rejects(updateMeetingPreferences(ctx.deps, viewer, { consentNoticeEnabled: false }), /administradores/);
});

test("limite mensal de minutos recusa upload e gravação; uso aparece no painel", async () => {
  const ctx = await setup("quota", { limits: { monthlyRecordingMinutes: 1 } });
  await meetingWithAnalysis(ctx);
  const usage = await getMeetingsUsage(ctx.deps, ctx.actor);
  assert.equal(usage.minutesUsed, 1);
  assert.equal(usage.minutesLimit, 1);
  const temp = join(storageDir, "quota.wav");
  await writeFile(temp, Buffer.from("RIFF"));
  await assert.rejects(uploadMeetingRecording(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, file: { tempFilePath: temp, fileName: "a.wav", mimeType: "audio/wav", bytes: 4, sha256: "x" } }), /minutos de gravação/);
  const meeting = await ctx.deps.repository.create({ id: nextId("meeting"), tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, ownerUserId: "owner-1", createdByUserId: "owner-1", title: "Call", source: "external_link", status: "scheduled", meetingUrl: "https://meet.google.com/abc-defg-hij", timezone: "America/Sao_Paulo", autoRecord: false, humanJoinAccountEmail: "eu@vorix.com", humanJoinIdentitySource: "explicit", participants: [] });
  const refused = await requestRecording(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id });
  assert.equal(refused.reason, "MINUTES_QUOTA_REACHED");
});

test("exclusão definitiva (LGPD) apaga a reunião e a mídia, exigindo o título exato", async () => {
  const ctx = await setup("purge");
  const { meeting, recording } = await meetingWithAnalysis(ctx);
  await assert.rejects(purgeMeetingPermanently(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, confirmTitle: "outro" }), /título exato/);
  const viewer = { ...ctx.actor, role: "viewer" };
  await assert.rejects(purgeMeetingPermanently(ctx.deps, viewer, { workspaceId: ctx.workspaceId, meetingId: meeting.id, confirmTitle: meeting.title }), /MEETING_NOT_FOUND/);
  await purgeMeetingPermanently(ctx.deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id, confirmTitle: "Reunião com a Acme" });
  assert.equal((await db.pool.query("select count(*)::int as n from meetings where id = $1", [meeting.id])).rows[0].n, 0);
  assert.equal((await db.pool.query("select count(*)::int as n from meeting_transcript_segments where meeting_id = $1", [meeting.id])).rows[0].n, 0);
  assert.equal(await storage().exists?.(recording.storageKey) ?? false, false);
  const audit = await db.pool.query("select count(*)::int as n from meeting_audit_log where tenant_id = $1 and action = 'meeting.purged_permanently'", [ctx.tenantId]);
  assert.equal(audit.rows[0].n, 1);
});

test("Google Meet nativo: cliente lê registro, transcrição e nomes; agendador importa e gera análise", async () => {
  const { GoogleMeetTranscriptClient } = await import("../dist/infrastructure/meetings/google-meet-transcript-client.js");
  const { importDueNativeTranscripts, importNativeTranscriptForActor } = await import("../dist/application/meetings/meet-native-import.js");
  const base = "https://meet.test/v2";
  const t0 = Date.now() - 60 * 60_000;
  const at = (seconds) => new Date(t0 + seconds * 1000).toISOString();
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url.includes("/conferenceRecords?")) {
      assert.match(decodeURIComponent(url.replaceAll("+", " ")), /space\.meeting_code = "abc-defg-hij"/);
      return json({ conferenceRecords: [{ name: "conferenceRecords/r1", startTime: at(0), endTime: at(1800) }] });
    }
    if (url.endsWith("/conferenceRecords/r1/transcripts")) return json({ transcripts: [{ name: "conferenceRecords/r1/transcripts/t1", state: "FILE_GENERATED" }] });
    if (url.includes("/transcripts/t1/entries")) return json({ transcriptEntries: [
      { participant: "conferenceRecords/r1/participants/p1", text: "Bom dia, vamos falar do orçamento.", languageCode: "pt-BR", startTime: at(5), endTime: at(9) },
      { participant: "conferenceRecords/r1/participants/p2", text: "Temos cinquenta mil reais.", startTime: at(10), endTime: at(14) },
    ] });
    if (url.endsWith("/participants/p1")) return json({ signedinUser: { displayName: "Ana Vendas" } });
    if (url.endsWith("/participants/p2")) return json({}, 404);
    return json({}, 404);
  };
  const client = new GoogleMeetTranscriptClient({ apiBaseUrl: base, httpClient: fakeFetch });
  const found = await client.findTranscript({ accessToken: "tok", meetingCode: "abc-defg-hij" });
  assert.equal(found.entries.length, 2);
  assert.deepEqual(found.entries.map((entry) => [entry.startMs, entry.speaker]), [[5000, "Ana Vendas"], [10_000, "Participante 1"]]);
  assert.equal(found.language, "pt");
  const denied = await new GoogleMeetTranscriptClient({ apiBaseUrl: base, httpClient: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "insufficient scopes" } }) }) }).findTranscript({ accessToken: "tok", meetingCode: "abc-defg-hij" });
  assert.equal(denied.unavailable, "no_access");

  const ctx = await setup("native");
  await db.pool.query(`update meeting_jobs set status = 'cancelled' where status in ('queued', 'running')`);
  const ended = new Date(Date.now() - 30 * 60_000);
  const meeting = await ctx.deps.repository.create({ id: nextId("meeting"), tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, ownerUserId: "owner-1", createdByUserId: "owner-1", title: "Call nativa", source: "external_link", status: "scheduled", meetingUrl: "https://meet.google.com/abc-defg-hij", scheduledStartAt: new Date(ended.getTime() - 30 * 60_000).toISOString(), scheduledEndAt: ended.toISOString(), timezone: "America/Sao_Paulo", autoRecord: false, participants: [] });
  const nativeDeps = { repository: ctx.deps.repository, insights: ctx.deps.insights, meet: client, tokens: { async getAccessToken() { return { ok: true, accessToken: "tok" }; } }, analysisEnabled: true, now: () => new Date() };

  const outcomes = await importDueNativeTranscripts(nativeDeps, { limit: 10 });
  assert.equal(outcomes.imported, 1, JSON.stringify(outcomes) + JSON.stringify((await db.pool.query("select * from meeting_native_imports")).rows));
  const detail = await ctx.deps.repository.getDetail({ tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, meetingId: meeting.id });
  assert.equal(detail.transcript.status, "completed");
  assert.equal(detail.transcript.engine, "google-meet");
  assert.equal(detail.status, "analyzing");
  const segments = await ctx.deps.repository.getTranscriptSegments({ tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, meetingId: meeting.id });
  assert.equal(segments[0].speaker, "Ana Vendas");
  assert.deepEqual(await importDueNativeTranscripts(nativeDeps, { limit: 10 }), {}, "não importa de novo");
  await assert.rejects(importNativeTranscriptForActor(nativeDeps, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: meeting.id }), /já tem transcrição/);

  const disconnected = await ctx.deps.repository.create({ id: nextId("meeting"), tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, ownerUserId: "owner-1", createdByUserId: "owner-1", title: "Sem Google", source: "external_link", status: "scheduled", meetingUrl: "https://meet.google.com/xyz-abcd-efg", timezone: "America/Sao_Paulo", autoRecord: false, participants: [] });
  const outcome = await importNativeTranscriptForActor({ ...nativeDeps, tokens: { async getAccessToken() { return { ok: false, reason: "revoked", message: "x" }; } } }, ctx.actor, { workspaceId: ctx.workspaceId, meetingId: disconnected.id });
  assert.equal(outcome.status, "not_connected");
});

test("Zoom: lê o VTT com nomes; importa a gravação usando a transcrição do Zoom (ou enfileira a nossa) e nunca duplica", async () => {
  const { parseZoomVtt } = await import("../dist/domain/meetings/zoom-transcript.js");
  const { importZoomRecording, listZoomRecordings } = await import("../dist/application/meetings/zoom-import.js");
  const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.500\nAna Lima: Bom dia a todos.\n\n2\n00:00:05.000 --> 00:00:09.000\nBruno: Vamos falar do contrato.\n\n3\n00:00:10.000 --> 00:00:12.000\nTexto sem nome\n";
  assert.deepEqual(parseZoomVtt(vtt), [
    { startMs: 1000, endMs: 4500, speaker: "Ana Lima", text: "Bom dia a todos." },
    { startMs: 5000, endMs: 9000, speaker: "Bruno", text: "Vamos falar do contrato." },
    { startMs: 10_000, endMs: 12_000, text: "Texto sem nome" },
  ]);

  const ctx = await setup("zoom");
  await db.pool.query(`update meeting_jobs set status = 'cancelled' where status in ('queued', 'running')`);
  const recordings = {
    "uuid-with-vtt": { uuid: "uuid-with-vtt", topic: "Kickoff com cliente", start_time: new Date().toISOString(), duration: 30, recording_files: [{ file_type: "M4A", download_url: "https://zoom.test/a.m4a", status: "completed", file_size: 10 }, { file_type: "TRANSCRIPT", download_url: "https://zoom.test/t.vtt", status: "completed" }] },
    "uuid-audio-only": { uuid: "uuid-audio-only", topic: "Daily", start_time: new Date().toISOString(), duration: 15, recording_files: [{ file_type: "MP4", recording_type: "shared_screen_with_speaker_view", download_url: "https://zoom.test/v.mp4", status: "completed", file_size: 10 }] },
  };
  const zoom = {
    async getAccessToken() { return { ok: true, accessToken: "zt" }; },
    async listRecordings() { return Object.values(recordings); },
    async getMeetingRecordings({ meetingUuid }) { return recordings[meetingUuid]; },
    async downloadToFile({ targetPath }) { await writeFile(targetPath, Buffer.from("ZOOM-AUDIO")); return 10; },
    async downloadText() { return vtt; },
  };
  const deps = { ...ctx.deps, zoomAuth: zoom, zoom, maxUploadBytes: 1_000_000, analysisEnabled: true };

  const withVtt = await importZoomRecording(deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingUuid: "uuid-with-vtt" });
  assert.equal(withVtt.title, "Kickoff com cliente");
  assert.equal(withVtt.transcript.status, "completed");
  assert.equal(withVtt.transcript.engine, "zoom");
  assert.equal(withVtt.status, "analyzing");
  assert.equal(withVtt.recordings[0].mimeType, "audio/mp4");
  const segments = await ctx.deps.repository.getTranscriptSegments({ tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, meetingId: withVtt.id });
  assert.equal(segments[0].speaker, "Ana Lima");

  const again = await importZoomRecording(deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingUuid: "uuid-with-vtt" });
  assert.equal(again.id, withVtt.id, "importar de novo devolve a mesma reunião");

  const audioOnly = await importZoomRecording(deps, ctx.actor, { workspaceId: ctx.workspaceId, meetingUuid: "uuid-audio-only" });
  assert.equal(audioOnly.recordings[0].mimeType, "video/mp4");
  assert.equal(audioOnly.transcript.status, "queued", "sem transcrição do Zoom, entra na transcrição do Vorix");

  const listed = await listZoomRecordings(deps, ctx.actor, { workspaceId: ctx.workspaceId });
  assert.deepEqual(listed.map((item) => [item.uuid, item.hasTranscript, item.importedMeetingId]), [["uuid-with-vtt", true, withVtt.id], ["uuid-audio-only", false, audioOnly.id]]);
});
