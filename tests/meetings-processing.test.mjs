import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresSolutionEntitlementRepository } from "../dist/infrastructure/storage/postgres/postgres-solution-entitlement-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMeetingRepository } from "../dist/infrastructure/storage/postgres/postgres-meeting-repository.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresAiProvidersRepository } from "../dist/infrastructure/storage/postgres/postgres-ai-providers-repository.js";
import { LocalObjectStorage } from "../dist/infrastructure/storage/local-object-storage.js";
import { ObjectStorageMeetingMedia } from "../dist/infrastructure/meetings/object-storage-meeting-media.js";
import { AiGatewayMeetingAnalyzer } from "../dist/infrastructure/ai-gateway/meeting-analyzer-adapter.js";
import { CreditGatedAiGateway } from "../dist/application/ai-gateway/credit-gated-ai-gateway.js";
import { CreditAccountingService } from "../dist/application/ai-providers/credit-accounting.service.js";
import { PROMPT_TEMPLATE_REGISTRY } from "../dist/application/ai-gateway/prompt-template-registry.js";
import { SolutionAccessService } from "../dist/application/solutions/solution-access.service.js";
import { evaluateAutoRecordings, processNextMeetingJob, purgeExpiredRecordings } from "../dist/application/meetings/meeting-processing.js";
import { limitsFromEntitlement, reanalyzeMeeting, retranscribeMeeting } from "../dist/application/meetings/meeting-use-cases.js";
import { configureObjectUrlSigning, deriveObjectUrlSigningKey } from "../dist/shared/utils/object-url-signing.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Processamento do Vorix Meetings (worker): fila com lease/heartbeat, recuperação após crash,
 * idempotência por gravação, transcrição que substitui segmentos, análise de IA pelo gate de
 * créditos REAL (CreditGatedAiGateway + CreditAccountingService sobre o banco) com um provider
 * falso que conta chamadas, retenção e preparação de auto-gravação.
 *
 * O motor de transcrição aqui é falso de propósito (a suíte não depende de Python/modelo); a
 * transcrição REAL com faster-whisper é verificada à parte, ponta a ponta.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let storageDir;
let counter = 0;
const nextId = (prefix) => `${prefix}-p${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55764 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
  storageDir = await mkdtemp(join(tmpdir(), "vorix-meetings-proc-"));
  configureObjectUrlSigning({ publicBaseUrl: "http://localhost:3000/uploads", signingKey: deriveObjectUrlSigningKey("k") });
});
after(async () => {
  await db.stop();
  await rm(storageDir, { recursive: true, force: true });
});

const repository = () => new PostgresMeetingRepository(db.pool);
const storage = () => new LocalObjectStorage({ rootDir: storageDir, publicBaseUrl: "http://localhost:3000/uploads" });
const media = () => new ObjectStorageMeetingMedia(storage());
const solutions = () => new SolutionAccessService({ repository: new PostgresSolutionEntitlementRepository(db.pool), cacheTtlMs: 0 });

async function setupTenant(label, { credits = 50, limits } = {}) {
  const tenantId = `tenant-proc-${label}`;
  await solutions().setEntitlement({ tenantId, solutionKey: "meetings", enabled: true, source: "internal", ...(limits ? { limits } : {}) });
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("ws") }).create({ tenantId, name: label });
  await db.pool.query(
    `insert into tenant_billing (tenant_id, plan_code, monthly_credits_quota, credits_extra, subscription_status, price_multiplier, monthly_publications_quota) values ($1, 'PRO', $2, 0, 'active', 2, 0)`,
    [tenantId, credits],
  );
  return { tenantId, workspaceId: workspace.id };
}

/** O worker é global (pega qualquer job da fila): cada teste começa com a fila limpa. */
async function clearQueue() {
  await db.pool.query(`update meeting_jobs set status = 'cancelled' where status in ('queued', 'running')`);
}

/** Reunião com uma gravação REAL no storage (arquivo qualquer — o extrator falso só copia). */
async function meetingWithRecording(account, title = "Reunião de alinhamento") {
  await clearQueue();
  const repo = repository();
  const meeting = await repo.create({ id: nextId("meeting"), tenantId: account.tenantId, workspaceId: account.workspaceId, ownerUserId: "u1", createdByUserId: "u1", title, source: "upload", status: "scheduled", timezone: "America/Sao_Paulo", autoRecord: false, participants: [] });
  const key = `meetings/${account.tenantId}/${account.workspaceId}/${meeting.id}/original.wav`;
  const temp = join(storageDir, `${meeting.id}.tmp`);
  await writeFile(temp, Buffer.from("RIFF-fake-audio"));
  await storage().putFile({ key, filePath: temp, contentType: "audio/wav" });
  const recording = await repo.addRecording({ id: nextId("mrec"), meetingId: meeting.id, tenantId: account.tenantId, workspaceId: account.workspaceId, kind: "original", storageKey: key, mimeType: "audio/wav", bytes: 15, checksumSha256: "x" });
  await repo.transition({ tenantId: account.tenantId, meetingId: meeting.id, to: "processing" });
  return { meeting, recording };
}

const SEGMENTS = [
  { startMs: 0, endMs: 8960, text: "Bom dia a todos. Hoje vamos revisar o cronograma do projeto.", confidence: 0.91 },
  { startMs: 8960, endMs: 17600, text: "Decidimos adiar o lançamento para o dia 20 de novembro. A Ana vai enviar a proposta revisada até sexta-feira.", confidence: 0.9 },
  { startMs: 17600, endMs: 24600, text: "O Bruno fica responsável por validar o orçamento com o financeiro.", confidence: 0.88 },
  { startMs: 24600, endMs: 31400, text: "O principal risco é o atraso do fornecedor. Ainda não sabemos se o cliente aprova o novo prazo.", confidence: 0.85 },
];

const fakeExtractor = { async extractWav16kMono({ sourcePath, targetPath }) { await copyFile(sourcePath, targetPath); } };
function fakeEngine(segments = SEGMENTS) {
  const engine = { calls: 0, async transcribe() { engine.calls += 1; return { language: "pt", engine: "fake-engine", model: "fake", durationSeconds: 32.4, processingMs: 10, segments, metrics: { real_time_factor: 0.22 } }; } };
  return engine;
}

/** Provider falso por trás do gate REAL: conta chamadas e devolve a análise estruturada. */
function fakeProvider(mode = "ok") {
  const provider = {
    calls: 0,
    mode,
    async execute(request) {
      provider.calls += 1;
      if (provider.mode === "down") return { ok: false, error: { category: "provider_unavailable", message: "Anthropic fora do ar", retryable: true, provider: "anthropic", model: "claude-haiku-4-5-20251001" } };
      return {
        ok: true,
        data: {
          operation: request.operation,
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
          output: {
            schemaVersion: 1,
            executiveSummary: "Revisão do cronograma: lançamento adiado para 20 de novembro.",
            topics: ["Cronograma", "Orçamento"],
            decisions: [{ description: "Adiar o lançamento para 20 de novembro", evidence: "Decidimos adiar o lançamento para o dia 20 de novembro.", sourceTimestampMs: 8960, confidence: 0.95 }],
            tasks: [
              { description: "Enviar a proposta revisada", evidence: "A Ana vai enviar a proposta revisada até sexta-feira.", sourceTimestampMs: 8960, confidence: 0.9, assigneeName: "Ana", dueDate: "sexta-feira" },
              { description: "Validar o orçamento com o financeiro", evidence: "O Bruno fica responsável por validar o orçamento com o financeiro.", sourceTimestampMs: 17600, confidence: 0.9, assigneeName: "Bruno", dueDate: null },
            ],
            nextSteps: [],
            risks: ["Atraso do fornecedor"],
            objections: [],
            openQuestions: ["O cliente aprova o novo prazo?"],
            warnings: [],
          },
          validated: true,
          usage: { inputTokens: 900, outputTokens: 300, totalTokens: 1200, estimatedCost: 0.0024, currency: "USD", providerReported: true },
          latencyMs: 50,
          finishReason: "stop",
          warnings: [],
          traceId: "t1",
        },
      };
    },
  };
  return provider;
}

function gatedAnalyzer(provider) {
  const creditAccounting = new CreditAccountingService({ platformBillingRepository: new PostgresPlatformBillingRepository(db.pool), aiProvidersRepository: new PostgresAiProvidersRepository(db.pool), idGenerator: nextId });
  return new AiGatewayMeetingAnalyzer(new CreditGatedAiGateway({ inner: provider, creditAccounting, now: () => new Date() }));
}

function processingDeps(overrides = {}) {
  return { repository: repository(), media: media(), extractor: fakeExtractor, engine: fakeEngine(), analysisEnabled: true, workerId: "worker-1", leaseMs: 60_000, transcriptionTimeoutMs: 60_000, idGenerator: nextId, now: () => new Date(), ...overrides };
}

async function creditsConsumed(tenantId) {
  const result = await db.pool.query(`select coalesce(sum(credits_consumed), 0)::int as n from tenant_ai_usage_monthly where tenant_id = $1`, [tenantId]);
  return result.rows[0].n;
}

// --- Fila --------------------------------------------------------------------------------------

test("FILA: worker morre depois do claim → lease expira → outro worker recupera; o antigo não grava mais nada", async () => {
  const account = await setupTenant("lease");
  const { meeting, recording } = await meetingWithRecording(account);
  const repo = repository();
  await repo.enqueueTranscription({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id, recordingId: recording.id });
  const claimed = await repo.claimJob({ kinds: ["transcribe"], workerId: "worker-morto", leaseMs: 100 });
  assert.equal(claimed.attempts, 1);
  assert.equal(await repo.claimJob({ kinds: ["transcribe"], workerId: "worker-2", leaseMs: 100 }), undefined, "lease ativo: ninguém mais pega");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const recovered = await repo.claimJob({ kinds: ["transcribe"], workerId: "worker-2", leaseMs: 60_000 });
  assert.equal(recovered.id, claimed.id);
  assert.equal(recovered.attempts, 2);
  assert.equal(await repo.completeJob({ jobId: claimed.id, workerId: "worker-morto" }), false, "o worker antigo perdeu o job");
  assert.equal(await repo.heartbeatJob({ jobId: claimed.id, workerId: "worker-morto", leaseMs: 1000 }), false);
  assert.equal(await repo.completeJob({ jobId: claimed.id, workerId: "worker-2" }), true);
  const job = (await db.pool.query(`select status, claimed_at, heartbeat_at from meeting_jobs where id = $1`, [claimed.id])).rows[0];
  assert.equal(job.status, "completed");
  assert.ok(job.claimed_at && job.heartbeat_at);
});

test("FILA: tentativas esgotadas por crashes viram FAILED — nunca fica travado para sempre", async () => {
  const account = await setupTenant("exhaust");
  const { meeting, recording } = await meetingWithRecording(account);
  const repo = repository();
  const { jobId } = await repo.enqueueTranscription({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id, recordingId: recording.id });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const job = await repo.claimJob({ kinds: ["transcribe"], workerId: `w${attempt}`, leaseMs: 30 });
    assert.equal(job.attempts, attempt);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  assert.equal(await repo.claimJob({ kinds: ["transcribe"], workerId: "w4", leaseMs: 30 }), undefined);
  const job = (await db.pool.query(`select status, last_error from meeting_jobs where id = $1`, [jobId])).rows[0];
  assert.equal(job.status, "failed");
  assert.match(job.last_error, /tentativas esgotadas/);
});

test("IDEMPOTÊNCIA: uma gravação nunca tem duas transcrições ativas ao mesmo tempo", async () => {
  const account = await setupTenant("idem");
  const { meeting, recording } = await meetingWithRecording(account);
  const repo = repository();
  const first = await repo.enqueueTranscription({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id, recordingId: recording.id });
  const again = await repo.enqueueTranscription({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id, recordingId: recording.id });
  assert.equal(again.jobId, first.jobId);
  assert.equal(again.alreadyActive, true);
  const actor = { tenantId: account.tenantId, userId: "u1", role: "owner" };
  const viaApi = await retranscribeMeeting({ repository: repo, media: media(), limitsFor: async () => limitsFromEntitlement(undefined), features: { realRecordingEnabled: false }, idGenerator: nextId, now: () => new Date() }, actor, { workspaceId: account.workspaceId, meetingId: meeting.id });
  assert.equal(viaApi.alreadyQueued, true);
  await assert.rejects(
    db.pool.query(`insert into meeting_jobs (id, tenant_id, workspace_id, meeting_id, recording_id, kind, idempotency_key) values ('dup', $1, $2, $3, $4, 'transcribe', 'dup-key')`, [account.tenantId, account.workspaceId, meeting.id, recording.id]),
    /duplicate key|unique/i,
    "o índice único é a barreira final",
  );
});

// --- Transcrição → análise ----------------------------------------------------------------------

test("TRANSCRIÇÃO: segmentos com timestamp/confiança, pesquisáveis; retranscrever SUBSTITUI (sem duplicar); enfileira a análise", async () => {
  const account = await setupTenant("transcribe");
  const { meeting, recording } = await meetingWithRecording(account);
  const repo = repository();
  await repo.enqueueTranscription({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id, recordingId: recording.id });
  const engine = fakeEngine();
  const outcome = await processNextMeetingJob(processingDeps({ engine }), ["transcribe"]);
  assert.equal(outcome.status, "completed");
  const segments = await repo.getTranscriptSegments({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id });
  assert.equal(segments.length, 4);
  assert.deepEqual([segments[1].startMs, segments[1].endMs, segments[1].confidence], [8960, 17600, 0.9]);
  const detail = await repo.getDetail({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id });
  assert.equal(detail.status, "analyzing");
  assert.equal(detail.transcript.status, "completed");
  assert.equal(detail.recordings[0].durationSeconds, 32.4, "duração gravada a partir do áudio real");
  const search = await repo.list({ tenantId: account.tenantId, workspaceId: account.workspaceId, query: "fornecedor", limit: 10, offset: 0 });
  assert.equal(search.total, 1, "texto pesquisável");
  const analyzeJobs = await db.pool.query(`select count(*)::int as n from meeting_jobs where meeting_id = $1 and kind = 'analyze' and status = 'queued'`, [meeting.id]);
  assert.equal(analyzeJobs.rows[0].n, 1, "transcrição termina enfileirando a análise (operação separada)");

  // Retranscrever: substitui.
  await repo.enqueueTranscription({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id, recordingId: recording.id });
  await processNextMeetingJob(processingDeps({ engine: fakeEngine(SEGMENTS.slice(0, 2)) }), ["transcribe"]);
  const after = await repo.getTranscriptSegments({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id });
  assert.equal(after.length, 2, "segmentos substituídos, nunca acumulados");
  const transcripts = await db.pool.query(`select count(*)::int as n from meeting_transcripts where meeting_id = $1`, [meeting.id]);
  assert.equal(transcripts.rows[0].n, 1);
});

test("TRANSCRIÇÃO: gravação removida = falha definitiva explícita (sem tentar de novo); falha transitória volta para a fila", async () => {
  const account = await setupTenant("transcribe-fail");
  const { meeting, recording } = await meetingWithRecording(account);
  const repo = repository();
  await repo.enqueueTranscription({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id, recordingId: recording.id });
  const flaky = { calls: 0, async transcribe() { flaky.calls += 1; throw new Error("modelo travou"); } };
  const first = await processNextMeetingJob(processingDeps({ engine: flaky }), ["transcribe"]);
  assert.equal(first.status, "retry");
  const queued = (await db.pool.query(`select status, run_at > now() as delayed from meeting_jobs where meeting_id = $1 and kind = 'transcribe'`, [meeting.id])).rows[0];
  assert.deepEqual([queued.status, queued.delayed], ["queued", true], "backoff antes da próxima tentativa");

  await db.pool.query(`update meeting_recordings set status = 'purged' where id = $1`, [recording.id]);
  await db.pool.query(`update meeting_jobs set run_at = now() where meeting_id = $1`, [meeting.id]);
  const second = await processNextMeetingJob(processingDeps(), ["transcribe"]);
  assert.equal(second.status, "failed");
  const detail = await repo.getDetail({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id });
  assert.equal(detail.status, "failed");
  assert.equal(detail.failureCode, "TRANSCRIPTION_FAILED");
  assert.equal(detail.transcript.status, "failed");
});

test("IA + CRÉDITOS: com saldo → 1 chamada, crédito consumido pelo catálogo central, itens estruturados persistidos", async () => {
  const account = await setupTenant("ai-ok", { credits: 50 });
  const { meeting, recording } = await meetingWithRecording(account);
  const repo = repository();
  await repo.enqueueTranscription({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id, recordingId: recording.id });
  await processNextMeetingJob(processingDeps(), ["transcribe"]);
  const provider = fakeProvider();
  const outcome = await processNextMeetingJob(processingDeps({ analyzer: gatedAnalyzer(provider) }), ["analyze"]);
  assert.equal(outcome.status, "completed");
  assert.equal(provider.calls, 1);
  const cost = (await db.pool.query(`select credits_cost from ai_operation_types where code = 'meeting_ai_analysis'`)).rows[0].credits_cost;
  assert.equal(await creditsConsumed(account.tenantId), cost, "consumo = custo do catálogo (editável), não um número no código");
  const detail = await repo.getDetail({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id });
  assert.equal(detail.status, "completed");
  assert.equal(detail.latestAnalysis.status, "completed");
  assert.equal(detail.latestAnalysis.creditsCharged, cost);
  assert.match(detail.latestAnalysis.result.executiveSummary, /20 de novembro/);
  const items = detail.latestAnalysis.actionItems;
  assert.deepEqual(items.map((item) => item.type).sort(), ["decision", "task", "task"]);
  const ana = items.find((item) => item.assigneeName === "Ana");
  assert.deepEqual([ana.dueDate, ana.sourceTimestampMs, ana.confidence, ana.status], ["sexta-feira", 8960, 0.9, "suggested"], "nada vira tarefa real sem confirmação");

  // Reanalisar consome crédito de novo (quando realmente executa).
  const actor = { tenantId: account.tenantId, userId: "u1", role: "owner" };
  await reanalyzeMeeting({ repository: repo, media: media(), limitsFor: async () => limitsFromEntitlement(undefined), features: { realRecordingEnabled: false }, idGenerator: nextId, now: () => new Date() }, actor, { workspaceId: account.workspaceId, meetingId: meeting.id });
  await processNextMeetingJob(processingDeps({ analyzer: gatedAnalyzer(provider) }), ["analyze"]);
  assert.equal(provider.calls, 2);
  assert.equal(await creditsConsumed(account.tenantId), cost * 2);
  const analyses = await repo.listAnalyses({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id });
  assert.equal(analyses.length, 2, "a análise anterior é preservada");
});

test("IA SEM CRÉDITOS: zero chamadas ao provider, BLOCKED_NO_CREDITS, transcrição e análise anterior preservadas", async () => {
  const account = await setupTenant("ai-zero", { credits: 50 });
  const { meeting, recording } = await meetingWithRecording(account);
  const repo = repository();
  await repo.enqueueTranscription({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id, recordingId: recording.id });
  await processNextMeetingJob(processingDeps(), ["transcribe"]);
  const provider = fakeProvider();
  await processNextMeetingJob(processingDeps({ analyzer: gatedAnalyzer(provider) }), ["analyze"]);
  assert.equal(provider.calls, 1);
  await db.pool.query(`update tenant_billing set monthly_credits_quota = 0, credits_extra = 0 where tenant_id = $1`, [account.tenantId]);
  const actor = { tenantId: account.tenantId, userId: "u1", role: "owner" };
  await reanalyzeMeeting({ repository: repo, media: media(), limitsFor: async () => limitsFromEntitlement(undefined), features: { realRecordingEnabled: false }, idGenerator: nextId, now: () => new Date() }, actor, { workspaceId: account.workspaceId, meetingId: meeting.id });
  const consumedBefore = await creditsConsumed(account.tenantId);
  const outcome = await processNextMeetingJob(processingDeps({ analyzer: gatedAnalyzer(provider) }), ["analyze"]);
  assert.equal(outcome.status, "completed", "bloqueio por crédito não é erro de processamento");
  assert.equal(provider.calls, 1, "ZERO chamadas novas ao provider");
  assert.equal(await creditsConsumed(account.tenantId), consumedBefore, "nada debitado");
  const analyses = await repo.listAnalyses({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id });
  assert.deepEqual(analyses.map((analysis) => analysis.status), ["blocked_no_credits", "completed"], "anterior preservada");
  const detail = await repo.getDetail({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id });
  assert.equal(detail.status, "completed");
  assert.equal(detail.transcript.status, "completed");
  assert.equal(detail.recordings[0].status, "available");
});

test("IA com provider fora do ar: nenhum crédito cobrado, tenta de novo com backoff e, esgotado, registra a falha", async () => {
  const account = await setupTenant("ai-down", { credits: 50 });
  const { meeting, recording } = await meetingWithRecording(account);
  const repo = repository();
  await repo.enqueueTranscription({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id, recordingId: recording.id });
  await processNextMeetingJob(processingDeps(), ["transcribe"]);
  const provider = fakeProvider("down");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await db.pool.query(`update meeting_jobs set run_at = now() where meeting_id = $1 and kind = 'analyze'`, [meeting.id]);
    const outcome = await processNextMeetingJob(processingDeps({ analyzer: gatedAnalyzer(provider) }), ["analyze"]);
    assert.equal(outcome.status, attempt < 3 ? "retry" : "failed");
  }
  assert.equal(provider.calls, 3);
  assert.equal(await creditsConsumed(account.tenantId), 0, "falha do provider nunca consome crédito");
  const detail = await repo.getDetail({ tenantId: account.tenantId, workspaceId: account.workspaceId, meetingId: meeting.id });
  assert.equal(detail.latestAnalysis.status, "failed");
  assert.equal(detail.status, "completed", "a reunião segue utilizável com a transcrição");
});

test("IA anti-alucinação: item sem trecho literal da transcrição é descartado; timestamp fora da reunião é removido", () => {
  const entry = PROMPT_TEMPLATE_REGISTRY.meeting_ai_analysis;
  const structural = entry.validateStructure({
    schemaVersion: 1,
    executiveSummary: "Resumo.",
    topics: [],
    decisions: [
      { description: "Adiar o lançamento", evidence: "Decidimos adiar o lançamento", sourceTimestampMs: 8960, confidence: 0.9 },
      { description: "Contratar mais 3 pessoas", evidence: "vamos contratar três pessoas", sourceTimestampMs: 1000, confidence: 0.6 },
    ],
    tasks: [{ description: "Validar orçamento", evidence: "validar o orçamento com o financeiro", sourceTimestampMs: 999999999, confidence: 0.8, assigneeName: "Bruno", dueDate: null }],
    nextSteps: [],
    risks: [],
    objections: [],
    openQuestions: [],
    warnings: [],
  });
  assert.equal(structural.valid, true);
  const semantic = entry.validateSemantics(structural.data, { title: "x", language: "pt", durationMs: 31400, segments: SEGMENTS });
  assert.deepEqual(semantic.data.decisions.map((item) => item.description), ["Adiar o lançamento"], "decisão inventada descartada");
  assert.equal(semantic.data.tasks[0].sourceTimestampMs, null, "timestamp impossível removido");
  assert.ok(semantic.warnings.some((warning) => warning.startsWith("decision_evidence_not_grounded")));
});

// --- Retenção e auto-gravação -------------------------------------------------------------------

test("RETENÇÃO: arquivo vencido removido; metadados, transcrição e auditoria preservados; respeita meetingRetentionDays do plano", async () => {
  const short = await setupTenant("ret-short");
  const long = await setupTenant("ret-long", { limits: { meetingRetentionDays: 365 } });
  const expired = await meetingWithRecording(short);
  const kept = await meetingWithRecording(long);
  await db.pool.query(`update meeting_recordings set created_at = now() - interval '100 days' where id = any($1)`, [[expired.recording.id, kept.recording.id]]);
  await db.pool.query(`insert into meeting_transcripts (id, meeting_id, tenant_id, status) values ('tr-ret', $1, $2, 'completed')`, [expired.meeting.id, short.tenantId]);
  const result = await purgeExpiredRecordings({ repository: repository(), media: media(), now: () => new Date() }, { defaultRetentionDays: 90, limit: 50 });
  assert.equal(result.purged, 1);
  await assert.rejects(stat(join(storageDir, expired.recording.storageKey)), /ENOENT/, "arquivo físico removido");
  await stat(join(storageDir, kept.recording.storageKey));
  const row = (await db.pool.query(`select status, purged_at, bytes from meeting_recordings where id = $1`, [expired.recording.id])).rows[0];
  assert.equal(row.status, "purged");
  assert.ok(row.purged_at);
  assert.equal(Number(row.bytes), 15, "metadados preservados");
  assert.equal((await db.pool.query(`select count(*)::int as n from meeting_transcripts where meeting_id = $1`, [expired.meeting.id])).rows[0].n, 1, "transcrição preservada");
  const audit = await db.pool.query(`select details from meeting_audit_log where meeting_id = $1 and action = 'recording.purged'`, [expired.meeting.id]);
  assert.equal(audit.rows[0].details.retentionDays, 90);
  const again = await purgeExpiredRecordings({ repository: repository(), media: media(), now: () => new Date() }, { defaultRetentionDays: 90, limit: 50 });
  assert.equal(again.purged, 0, "idempotente");
});

test("AUTO-GRAVAÇÃO (preparação): reunião elegível na janela → RECORDING_DISABLED uma única vez; fora da janela não é tocada", async () => {
  const account = await setupTenant("auto-rec");
  const repo = repository();
  const soon = await repo.create({ id: nextId("meeting"), tenantId: account.tenantId, workspaceId: account.workspaceId, ownerUserId: "u1", createdByUserId: "u1", title: "Daily", source: "calendar", status: "scheduled", meetingUrl: "https://meet.google.com/abc-defg-hij", scheduledStartAt: new Date(Date.now() + 60_000).toISOString(), timezone: "America/Sao_Paulo", autoRecord: true, joinBeforeMinutes: 2, participants: [] });
  const later = await repo.create({ id: nextId("meeting"), tenantId: account.tenantId, workspaceId: account.workspaceId, ownerUserId: "u1", createdByUserId: "u1", title: "Semana que vem", source: "calendar", status: "scheduled", meetingUrl: "https://meet.google.com/abc-defg-hij", scheduledStartAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), timezone: "America/Sao_Paulo", autoRecord: true, participants: [] });
  const input = { defaults: { joinBeforeMinutes: 2, joinGraceMinutes: 10 }, realRecordingEnabled: false, limitsFor: async () => limitsFromEntitlement(undefined), limit: 50 };
  const first = await evaluateAutoRecordings({ repository: repo, now: () => new Date() }, input);
  assert.deepEqual(first.outcomes, { RECORDING_DISABLED: 1 });
  const second = await evaluateAutoRecordings({ repository: repo, now: () => new Date() }, input);
  assert.equal(second.evaluated, 0, "uma única vez");
  const rows = (await db.pool.query(`select id, status, auto_record_outcome from meetings where id = any($1) order by id`, [[soon.id, later.id]])).rows;
  const soonRow = rows.find((row) => row.id === soon.id);
  assert.deepEqual([soonRow.status, soonRow.auto_record_outcome], ["scheduled", "RECORDING_DISABLED"], "nunca simula gravação");
  assert.equal(rows.find((row) => row.id === later.id).auto_record_outcome, null);
  const jobs = await db.pool.query(`select count(*)::int as n from meeting_jobs where meeting_id = $1 and kind = 'record'`, [soon.id]);
  assert.equal(jobs.rows[0].n, 0, "nenhum job de gravação criado");
});
