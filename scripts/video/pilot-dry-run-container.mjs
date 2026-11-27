// ENSAIO DO PILOTO (lado do container) — roda DENTRO de um container temporário criado da imagem do
// video-worker, com o dist novo montado. Recebe `const request = {...}` antes deste código (mesmo padrão do
// backend do piloto). Nada é gravado no banco nem na fila: o repositório é em memória (estado em
// /work/state), as saídas vão para /work/out e os materiais locais vêm de /materials.
//
// Ações: render (rascunho → plano → FFmpeg → Quality Gate → prancha, com as dependências do worker de
// produção), social_validate (validação do Reels nas contas da marca, sem publicar) e approval_preview
// (texto do pedido de aprovação pelo WhatsApp e se o vídeo vai anexado ou por link).
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";

const STATE = "/work/state";
const OUT = "/work/out";

async function render() {
  const { InMemoryVideoProjectRepository } = await import("./dist/infrastructure/storage/in-memory-video-project-repository.js");
  const { processNextVideoVersion, videoSheetKey, videoSourcePreviewKey } = await import("./dist/application/video-editing/process-video-version.js");
  const { createVideoWorkerRuntime } = await import("./dist/interfaces/worker/video-worker-runtime.js");
  const { buildSentences } = await import("./dist/application/video-editing/transcript-tools.js");
  await mkdir(STATE, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const statePath = join(STATE, `${request.projectId}.json`);
  const state = existsSync(statePath) ? JSON.parse(await readFile(statePath, "utf8")) : { project: undefined, versions: [] };
  const now = new Date().toISOString();
  state.project ??= {
    id: request.projectId, tenantId: "tenant-vorix", workspaceId: request.workspaceId, title: request.title ?? "ensaio", mode: request.materials.some((m) => m.kind === "video") ? "edit_footage" : "images_ad", aspect: "9:16",
    settings: { ...request.settings, origin: { kind: "editorial_pilot", ideaId: request.ideaId ?? "ensaio" } },
    materials: request.materials.map((m) => ({ id: m.id, objectKey: m.objectKey, kind: m.kind, role: m.role, ...(m.label ? { label: m.label } : {}), contentType: m.kind === "video" ? "video/mp4" : "image/jpeg" })),
    transcripts: {}, createdAt: now, updatedAt: now,
  };
  const repository = new InMemoryVideoProjectRepository();
  repository.projects.set(state.project.id, state.project);
  for (const version of state.versions) repository.versions.set(version.id, version);
  const version = { id: request.versionId, projectId: state.project.id, tenantId: "tenant-vorix", workspaceId: request.workspaceId, number: state.versions.length + 1, request: request.request,
    status: "queued", progress: 0, warnings: [], attempts: 0, maxAttempts: 2, cancelRequested: false, createdAt: now, updatedAt: now,
    ...(request.parentVersionId ? { parentVersionId: request.parentVersionId } : {}), ...(request.draft ? { draft: request.draft } : {}) };
  repository.versions.set(version.id, version);

  const runtime = await createVideoWorkerRuntime({ workerId: "ensaio-piloto" });
  const download = runtime.deps.downloadObject;
  runtime.deps.repository = repository;
  runtime.deps.downloadObject = (key, destination) => (key.startsWith("local/") ? copyFile(join("/materials", basename(key)), destination) : download(key, destination));
  runtime.deps.uploadFile = (key, file) => copyFile(file, join(OUT, basename(key)));
  const logs = [];
  runtime.deps.log = (message, details) => logs.push({ message, ...details });
  const started = Date.now();
  try {
    await processNextVideoVersion(runtime.deps);
  } finally {
    await runtime.close();
  }
  const done = repository.versions.get(version.id);
  const project = repository.projects.get(state.project.id);
  state.project = project;
  state.versions = [...repository.versions.values()];
  await writeFile(statePath, JSON.stringify(state));
  const result = { versionId: done.id, number: done.number, status: done.status, stage: done.stage, error: done.error, message: done.message, warnings: done.warnings, gate: done.gate, draft: done.draft, renderMs: done.renderMs, totalMs: Date.now() - started, usage: done.usage, logs };
  if (done.plan) {
    result.plan = { strategy: done.plan.strategy, durationSeconds: done.plan.durationSeconds, music: Boolean(done.plan.music), clips: done.plan.clips.map((clip) => ({ id: clip.id, purpose: clip.purpose, assetId: clip.assetId, layout: clip.layout ?? "full", motion: clip.motion.type, region: clip.framing.region, transition: clip.transitionIn.type, recordStartSeconds: clip.recordStartSeconds, durationSeconds: clip.durationSeconds, texts: clip.overlays.map((overlay) => overlay.text) })) };
    await writeFile(join(OUT, `plan-${done.id}.json`), JSON.stringify(done.plan, null, 2));
  }
  const mp4 = join(OUT, `video-${done.id}.mp4`);
  if (existsSync(mp4)) {
    const bytes = await readFile(mp4);
    result.output = { file: basename(mp4), sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: (await stat(mp4)).size };
    const sheet = join(OUT, basename(videoSheetKey("tenant-vorix", request.workspaceId, done.id)));
    if (existsSync(sheet)) result.output.sheet = (await readFile(sheet)).toString("base64");
  }
  if (done.stage === "awaiting_draft") {
    result.sentences = buildSentences(Object.entries(project.transcripts).map(([materialId, transcript]) => ({ materialId, transcript }))).map((s) => ({ id: s.id, materialId: s.materialId, start: s.start, end: s.end, text: s.text }));
    result.sourcePreviews = {};
    for (const material of project.materials.filter((m) => m.kind === "video")) {
      const sheet = join(OUT, basename(videoSourcePreviewKey("tenant-vorix", request.workspaceId, request.projectId, material.id)));
      if (existsSync(sheet)) result.sourcePreviews[material.id] = (await readFile(sheet)).toString("base64");
    }
  }
  return result;
}

async function socialValidate() {
  const { buildApiContainer } = await import("./dist/interfaces/api/di/container.js");
  const { loadApiConfig } = await import("./dist/interfaces/api/config/api-config.js");
  const c = buildApiContainer(loadApiConfig());
  try {
    const scope = { tenantId: "tenant-vorix", workspaceId: request.workspaceId };
    const options = await c.social.posts.composerOptions(scope);
    const accounts = request.accounts.map((id) => options.find((account) => account.accountId === id));
    // Igual ao backend: Reels só nas contas que aceitam o formato.
    const reel = accounts.filter((account) => account?.formats?.some((item) => item.format === "reel"));
    const checks = await c.social.posts.validate({ ...scope, base: { caption: request.caption, media: request.media }, destinations: reel.map((account) => ({ accountId: account.accountId, format: "reel" })) });
    return { skippedNetworks: accounts.filter((account) => !reel.includes(account)).map((account) => account?.network), accounts: accounts.map((account) => ({ id: account?.accountId, network: account?.network, publishable: account?.publishable, reel: Boolean(account?.formats?.some((item) => item.format === "reel")) })), checks: checks.map((check) => ({ network: check.network, format: check.format, issues: check.issues.map((issue) => issue.message), warnings: check.warnings })) };
  } finally {
    await c.pool?.end().catch(() => undefined);
    await c.identity?.pool?.end().catch(() => undefined);
  }
}

async function approvalPreview() {
  const { approvalRequestText } = await import("./dist/application/approvals/whatsapp-approval.js");
  const file = join(OUT, request.file);
  const size = (await stat(file)).size;
  const attached = size <= 15 * 1024 * 1024;
  return { sizeBytes: size, delivery: attached ? "vídeo anexado no WhatsApp" : "link assinado do mesmo arquivo",
    text: approvalRequestText({ brand: request.brand, code: "TESTE", networks: request.networks ?? ["instagram"], when: request.when, caption: request.caption, screens: 0, video: attached ? {} : { link: "https://…/assets/…-video-<hash>.mp4?sig=…" } }) };
}

/** Só leitura: a marca exige aprovação pelo WhatsApp antes de publicar? (a trava real do agendamento) */
async function approvalRule() {
  const { buildApiContainer } = await import("./dist/interfaces/api/di/container.js");
  const { loadApiConfig } = await import("./dist/interfaces/api/config/api-config.js");
  const c = buildApiContainer(loadApiConfig());
  try {
    const out = {};
    for (const workspaceId of request.workspaces) out[workspaceId] = c.whatsappApprovals ? await c.whatsappApprovals.requiresApproval({ tenantId: "tenant-vorix", workspaceId }) : "serviço indisponível";
    return out;
  } finally {
    await c.pool?.end().catch(() => undefined);
    await c.identity?.pool?.end().catch(() => undefined);
  }
}

const actions = { render, social_validate: socialValidate, approval_preview: approvalPreview, approval_rule: approvalRule };
try {
  console.log(JSON.stringify(await actions[request.action]()));
} catch (error) {
  console.error(String(error?.stack ?? error).slice(0, 2000));
  process.exitCode = 1;
}
