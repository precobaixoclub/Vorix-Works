import { spawn } from "node:child_process";
import { chown, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { addToReviewQueue, reviewSkipIds } from "./creative-pipeline.mjs";
import { conceptImagePrompt, conceptImageSchema, directorPrompt, directorSchema, redoPrompt, redoSchema, reviewOutcome, reviewPrompt, reviewSchema, scopedReason, targetSecondsFor, toDraft } from "./video-director.mjs";

/**
 * Piloto automático — RAMO DE VÍDEO (Reels) a partir das pautas "video" do Bolsão. Não é um segundo piloto:
 * mesmo Codex (usuário vorix-codex, login do ChatGPT), mesmo backend no container da API, mesma fila de
 * revisão manual, mesma aprovação pelo WhatsApp e mesma refação. Não mexe na seleção nem nos horários das
 * imagens/carrosséis (12h/19h): o vídeo tem chave e horário próprios (20h).
 *
 * Fluxo: pauta → materiais (anexos, catálogo, capturas; sem nada, imagens conceituais do Codex) → Codex
 * planeja o rascunho → fila do motor de vídeo (worker FFmpeg, um render por vez, recursos limitados) →
 * Quality Gate técnico → revisão editorial do Codex sobre a prancha de quadros (até 1 ajuste) → agenda o
 * Reels com o hash do MP4 → a marca aprova pelo WhatsApp → publica exatamente o arquivo aprovado.
 *
 * Uso: node codex-social-video.mjs run|validate [workspace]   ·   node codex-social-video.mjs redo <workspace> (VORIX_REDO_JOB)
 */

const basedir = new URL("./", import.meta.url);
const agentHome = "/var/lib/vorix-codex";
const generatedDir = join(agentHome, ".codex/generated_images");
const executable = "/opt/vorix-editorial/tools/node_modules/.bin/codex";
const container = process.env.VORIX_VIDEO_CONTAINER || "zuno-zuno-api-1";
const timezone = "America/Sao_Paulo";
const VIDEO_HOUR = "20";
const workspaces = ["workspace-mwmumsxd-fmvh3h", "workspace-mscc9pi2-jkvwbo", "workspace-mwmu8kgf-uhe66l", "workspace-cee-prelaunch-mv47cmfh"];
const [mode = "run", workspace] = process.argv.slice(2);
if (!["run", "validate", "redo"].includes(mode) || (workspace && !workspaces.includes(workspace)) || (mode === "redo" && !workspace)) throw new Error("Uso: node codex-social-video.mjs run|validate [workspace] · redo <workspace>");
const backend = await readFile(new URL("codex-social-backend.mjs", basedir), "utf8");
const agent = ["-u", "vorix-codex", "--", "env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", `HOME=${agentHome}`, `CODEX_HOME=${agentHome}/.codex`, executable];
const localTime = () => new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date()).replace(" ", "T");
const log = (entry) => console.error(JSON.stringify({ time: new Date().toISOString(), ...entry }));

function processOutput(program, args, stdin, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const errors = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Tempo limite em ${program}`)); }, timeout);
    child.stdout.on("data", (bytes) => out.push(bytes));
    child.stderr.on("data", (bytes) => errors.push(bytes));
    child.stdin.on("error", () => undefined);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString("utf8").trim());
      else reject(new Error(Buffer.concat(errors).toString("utf8").trim().split("\n").slice(-5).join("\n") || `Processo retornou código ${code}`));
    });
    child.stdin.end(stdin);
  });
}

async function callContainer(request) {
  const response = await processOutput("docker", ["exec", "-i", container, "node", "--input-type=module"], `const request = ${JSON.stringify(request)};\n${backend}`, 240000);
  return JSON.parse(response.split("\n").at(-1));
}

/** Codex não interativo (recurso oficial `codex exec`), sandbox só leitura, saída por schema. */
async function codex(jobDir, { prompt, schema, images = [], timeout = 240000, generate = false }) {
  const schemaFile = join(jobDir, `schema-${Date.now()}.json`);
  await writeFile(schemaFile, JSON.stringify(schema), { mode: 0o644 });
  const args = [...agent, "--ask-for-approval", "never", "exec", "--model", "gpt-6.2-sol", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check",
    "--cd", jobDir, "--json", "--output-schema", schemaFile, ...images.flatMap((path) => ["--image", path]), "-"];
  const started = Date.now();
  const events = await processOutput("runuser", args, generate ? prompt : `${prompt}\nNão gere imagens e não execute comandos.`, timeout);
  const last = events.split("\n").flatMap((line) => {
    try { const event = JSON.parse(line); return event.type === "item.completed" && event.item?.type === "agent_message" ? [event.item.text] : []; } catch { return []; }
  }).at(-1);
  if (!last) throw new Error("O Codex não devolveu resposta");
  return { output: JSON.parse(last), ms: Date.now() - started };
}

async function jobDirectory(prefix) {
  const dir = await mkdtemp(join(agentHome, "jobs", `${prefix}-`));
  const user = (await readFile("/etc/passwd", "utf8")).split("\n").find((line) => line.startsWith("vorix-codex:"))?.split(":");
  if (!user) throw new Error("Usuário dedicado do Codex indisponível");
  await chown(dir, Number(user[2]), Number(user[3]));
  return dir;
}

const reviewFile = join(agentHome, "review-queue.json");
const readReviewQueue = async () => { try { return JSON.parse(await readFile(reviewFile, "utf8")); } catch { return []; } };
async function sendToReview(workspaceId, entry) {
  if (mode === "validate") return;
  const { queue, added } = addToReviewQueue(await readReviewQueue(), { workspaceId, ...entry, at: new Date().toISOString() });
  if (!added) return;
  await writeFile(reviewFile, JSON.stringify(queue, null, 2), { mode: 0o640 });
  await callContainer({ workspaceId, action: "video_report", ideaId: entry.ideaId, idea: entry.idea, detail: entry.reason }).catch(() => log({ workspace: workspaceId, error: "Falha ao registrar o alerta do vídeo" }));
}

/** Espera a versão sair da fila do worker (render limitado, um por vez). */
async function waitVersion(workspaceId, versionId, timeoutMs = 30 * 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await callContainer({ workspaceId, action: "video_status", versionId });
    if (!["queued", "planning", "rendering", "verifying"].includes(status.status)) {
      return ["ready_for_review", "needs_revision"].includes(status.status) && status.stage !== "awaiting_draft"
        ? callContainer({ workspaceId, action: "video_status", versionId, withMedia: true }) : status;
    }
    if (Date.now() > deadline) throw new Error(`O vídeo não ficou pronto em ${Math.round(timeoutMs / 60000)} min (fila do worker)`);
    await new Promise((done) => setTimeout(done, 20000));
  }
}

/** Imagens conceituais (cenário "só a ideia"): Codex gera, o backend guarda no storage do workspace. */
async function conceptImages(jobDir, workspaceId, selection, operations) {
  const materials = [];
  for (let index = 1; index <= 2; index += 1) {
    const { output, ms } = await codex(jobDir, { prompt: conceptImagePrompt({ selection, index, total: 2 }), schema: conceptImageSchema, generate: true, timeout: 300000 });
    if (!isAbsolute(output.image ?? "")) throw new Error("Caminho da imagem gerada inválido");
    const asset = await realpath(output.image);
    const path = relative(await realpath(generatedDir), asset);
    if (!path || path.startsWith(`..${sep}`) || isAbsolute(path) || !/\.(png|jpe?g|webp)$/i.test(asset)) throw new Error("Arquivo fora do diretório de imagens geradas");
    const bytes = await readFile(asset);
    const stored = await callContainer({ workspaceId, action: "video_upload", ideaId: selection.idea.id, data: bytes.toString("base64") });
    materials.push({ id: `M${index}`, objectKey: stored.objectKey, kind: "image", role: "generated", label: index === 1 ? "imagem conceitual de abertura (IA)" : "imagem conceitual de apoio (IA)", width: stored.width, height: stored.height, thumb: bytes.toString("base64") });
    operations.push({ step: `imagem conceitual ${index}`, engine: "codex:ferramenta nativa de imagem", durationMs: ms });
  }
  return materials;
}

async function writeImages(jobDir, materials) {
  const files = [];
  for (const [index, material] of materials.entries()) {
    if (!material.thumb) continue;
    const file = join(jobDir, `material-${index + 1}.jpg`);
    await writeFile(file, Buffer.from(material.thumb, "base64"), { mode: 0o644 });
    files.push(file);
  }
  return files;
}

async function sheetFile(jobDir, status, name) {
  if (!status.output?.sheet) return undefined;
  const file = join(jobDir, name);
  await writeFile(file, Buffer.from(status.output.sheet, "base64"), { mode: 0o644 });
  return file;
}

/** Revisão editorial do Codex sobre a prancha. Sem prancha ou sem resposta: inconclusiva (não agenda). */
async function editorialReview(jobDir, selection, status, operations) {
  const sheet = await sheetFile(jobDir, status, `prancha-${status.number}.jpg`);
  if (!sheet || !status.plan) return { verdict: "inconclusive", findings: ["prancha de quadros indisponível"] };
  try {
    const { output, ms } = await codex(jobDir, { prompt: reviewPrompt({ selection, plan: status.plan, gate: status.gate }), schema: reviewSchema, images: [sheet], timeout: 180000 });
    const outcome = reviewOutcome(output);
    operations.push({ step: `revisão editorial v${status.number}`, engine: "codex", durationMs: ms, outcome: outcome.verdict });
    return outcome;
  } catch (error) {
    operations.push({ step: `revisão editorial v${status.number}`, engine: "codex", outcome: "failed", detail: error.message.slice(0, 200) });
    return { verdict: "inconclusive", findings: [error.message.slice(0, 200)] };
  }
}

/**
 * Nova versão por um pedido de ajuste (revisão do Codex ou reprovação do cliente), com o escopo decidido e
 * registrado: pontual (só o citado muda) ou abrangente (ritmo/organização/composição). Recusa por mexer
 * fora do escopo volta UMA vez ao Codex com o motivo exato; o limite de refações do cliente segue o da API.
 */
async function reviseWithScope(workspaceId, fromVersionId, request, operations, makeDraft) {
  const scoped = scopedReason(request);
  operations.push({ step: "escopo do ajuste", ...scoped.trace });
  let correction;
  for (let round = 0; round < 2; round += 1) {
    const draft = await makeDraft(correction);
    const revised = await callContainer({ workspaceId, action: "video_revise", versionId: fromVersionId, reason: scoped.reason, draft }).catch((error) => ({ error: error.message }));
    if (!revised.versionId) {
      operations.push({ step: "nova versão", outcome: "failed", detail: String(revised.error).slice(0, 200) });
      return { error: revised.error, scoped };
    }
    const status = await waitVersion(workspaceId, revised.versionId);
    operations.push({ step: `nova versão v${status.number}`, outcome: status.status, detail: String(status.error ?? (status.warnings ?? []).find((item) => item.startsWith("refação")) ?? "").slice(0, 300) });
    if (status.status === "ready_for_review" || round === 1 || !/não pedia/.test(status.error ?? "")) return { status, scoped };
    correction = `a versão anterior foi recusada: ${status.error}. Mantenha IDÊNTICO tudo o que o pedido não citou.`;
  }
  return { scoped };
}

function slotFor() {
  const now = localTime();
  const today = `${now.slice(0, 10)}T${VIDEO_HOUR}:00`;
  if (now < `${now.slice(0, 10)}T${String(Number(VIDEO_HOUR) - 1).padStart(2, "0")}:30`) return today;
  const tomorrow = new Date(Date.parse(`${now.slice(0, 10)}T12:00:00-03:00`) + 86400000).toISOString().slice(0, 10);
  return `${tomorrow}T${VIDEO_HOUR}:00`;
}

async function runWorkspace(workspaceId) {
  const slot = slotFor();
  const selection = await callContainer({ workspaceId, action: "video_select", date: slot.slice(0, 10), skipIdeaIds: reviewSkipIds(await readReviewQueue(), workspaceId) });
  if (selection.empty) return { brand: selection.brand, empty: true, videoIdeas: selection.videoIdeas };
  const idea = selection.idea;
  const operations = [];
  const jobDir = await jobDirectory("video");
  const started = Date.now();
  try {
    let status;
    let materials = selection.materials ?? [];
    if (selection.resume) {
      // Vídeo desta pauta já em produção (rodada anterior interrompida): continua dele.
      status = await waitVersion(workspaceId, selection.resume.versionId);
    } else {
      if (!materials.length) materials = await conceptImages(jobDir, workspaceId, selection, operations);
      const speech = materials.some((material) => material.kind === "video");
      const settings = { targetDurationSeconds: targetSecondsFor(idea, { speech }), editing: "dinamico", transitions: "moderadas", captions: true, music: Boolean(selection.musicAvailable) };
      const queueMaterials = materials.map(({ objectKey, role, label }) => ({ objectKey, role, label }));
      if (speech) {
        // Gravação com fala: o worker transcreve primeiro; o Codex escolhe as frases pelos ids.
        const queued = await callContainer({ workspaceId, action: "video_queue", ideaId: idea.id, updatedAt: idea.updatedAt, materials: queueMaterials, settings, draft: null });
        status = await waitVersion(workspaceId, queued.versionId);
        if (status.stage !== "awaiting_draft") throw new Error(status.error ?? "A transcrição da gravação falhou");
      }
      const images = await writeImages(jobDir, materials);
      // Versão só de transcrição: as tentativas de plano partem dela (a fala não é transcrita de novo).
      const transcribed = status?.stage === "awaiting_draft" ? status : undefined;
      let correction;
      for (let round = 0; round < 2; round += 1) {
        const { output, ms } = await codex(jobDir, { prompt: directorPrompt({ selection, materials, sentences: transcribed?.sentences ?? [], targetSeconds: settings.targetDurationSeconds, correction }), schema: directorSchema, images });
        operations.push({ step: round ? "plano (correção)" : "plano", engine: "codex", durationMs: ms });
        const draft = toDraft(output);
        try {
          const queued = transcribed
            ? await callContainer({ workspaceId, action: "video_revise", versionId: transcribed.versionId, reason: selection.request, draft })
            : await callContainer({ workspaceId, action: "video_queue", ideaId: idea.id, updatedAt: idea.updatedAt, materials: queueMaterials, settings, draft });
          status = await waitVersion(workspaceId, queued.versionId);
        } catch (error) {
          status = { status: "failed", error: error.message };
        }
        if (status.status !== "failed") break;
        correction = `${status.error ?? ""} ${(status.warnings ?? []).join("; ")}`.trim().slice(0, 900);
        log({ workspace: workspaceId, idea: idea.externalId, step: "plano recusado", detail: correction });
      }
    }
    if (status.status !== "ready_for_review") throw new Error(`QUALITY_GATE: ${status.error ?? status.message ?? `vídeo ${status.status}`} ${(status.gate?.failures ?? []).join("; ")}`.trim());
    // Revisão editorial (até 1 ajuste). Inconclusiva ou reprovada: revisão manual, nunca agenda sozinha.
    let review = await editorialReview(jobDir, selection, status, operations);
    if (review.verdict === "revise" && review.revisionRequest) {
      const pictures = await writeImages(jobDir, selection.materials ?? materials);
      const base = status;
      const result = await reviseWithScope(workspaceId, base.versionId, { reason: review.revisionRequest, scope: review.scope, from: "revisao" }, operations, async (correction) => {
        const { output, ms } = await codex(jobDir, { prompt: `${directorPrompt({ selection, materials: selection.materials ?? materials, sentences: [], targetSeconds: targetSecondsFor(idea) })}\n\nRASCUNHO ATUAL (JSON do motor): ${JSON.stringify(base.draft)}\nAJUSTE PEDIDO PELA REVISÃO (${review.scope}): ${review.revisionRequest}\n${review.scope === "abrangente" ? "Ajuste abrangente: pode reorganizar ritmo, ordem e composição." : "Ajuste pontual: mude só o que foi pedido e mantenha o resto IDÊNTICO."}${correction ? `\nCORREÇÃO: ${correction}` : ""}\nDevolva o rascunho completo.`, schema: directorSchema, images: pictures });
        operations.push({ step: "ajuste da revisão", engine: "codex", durationMs: ms });
        return toDraft(output);
      });
      if (result.status?.status === "ready_for_review") {
        status = result.status;
        review = await editorialReview(jobDir, selection, status, operations);
      }
    }
    if (review.verdict !== "approve") throw new Error(`QUALITY_GATE: revisão editorial ${review.verdict} — ${review.findings.join("; ")}`.slice(0, 600));
    const result = await callContainer({ workspaceId, action: mode === "validate" ? "video_validate" : "video_schedule", ideaId: idea.id, updatedAt: idea.updatedAt, versionId: status.versionId, sha256: status.output.sha256, slot,
      review: { verdict: review.verdict, findings: review.findings }, trace: { operations, totalMs: Date.now() - started } });
    return { brand: selection.brand, idea: idea.externalId, versionId: status.versionId, durationSeconds: status.plan?.durationSeconds, strategy: status.plan?.strategy, sha256: status.output.sha256, review: review.verdict, operations, totalMs: Date.now() - started, ...result };
  } catch (error) {
    const reason = error.message.replace(/^QUALITY_GATE:\s*/, "").slice(0, 600);
    await sendToReview(workspaceId, { ideaId: idea.id, idea: idea.externalId, reason: `vídeo: ${reason}` });
    error.message = `${error.message} [${idea.externalId}]`;
    throw error;
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}

/** Refação de vídeo reprovado no WhatsApp (chamada por codex-social-redo.mjs, sob a trava do piloto). */
async function redoWorkspace(workspaceId) {
  const job = JSON.parse(await readFile(process.env.VORIX_REDO_JOB, "utf8"));
  if (!job.video?.versionId) throw new Error("Refação sem a versão do vídeo reprovado");
  const jobDir = await jobDirectory("video-redo");
  const operations = [];
  try {
    const previous = await callContainer({ workspaceId, action: "video_status", versionId: job.video.versionId, withMedia: true });
    if (job.video.sha256 && previous.output?.sha256 && previous.output.sha256 !== job.video.sha256) throw new Error("A versão reprovada não confere com a enviada ao cliente");
    const sheet = await sheetFile(jobDir, previous, "reprovado.jpg");
    const materials = Object.values(previous.draft?.scenes ?? []).map((scene) => scene.materialId).filter((id, index, all) => id !== "CARD" && all.indexOf(id) === index).map((id) => ({ id, kind: "image", role: "material" }));
    let output;
    const first = await codex(jobDir, { prompt: redoPrompt({ job, previousDraft: previous.draft, materials }), schema: redoSchema, images: sheet ? [sheet] : [] });
    output = first.output;
    operations.push({ step: "refação (plano)", engine: "codex", durationMs: first.ms });
    let firstDraft = toDraft(output.draft);
    const result = await reviseWithScope(workspaceId, previous.versionId, { reason: job.reason, scope: output.scope, justification: output.scopeJustification, from: "cliente" }, operations, async (correction) => {
      if (!correction) return firstDraft;
      const again = await codex(jobDir, { prompt: `${redoPrompt({ job, previousDraft: previous.draft, materials })}\nCORREÇÃO: ${correction}`, schema: redoSchema, images: sheet ? [sheet] : [] });
      operations.push({ step: "refação (correção do escopo)", engine: "codex", durationMs: again.ms });
      output = again.output;
      return toDraft(again.output.draft);
    });
    const status = result.status;
    if (!status || status.status !== "ready_for_review") throw new Error(status?.error ?? result.error ?? `a nova versão ficou ${status?.status}`);
    const selection = { brand: job.brand ?? "a marca", idea: job.idea };
    const review = await editorialReview(jobDir, selection, status, operations);
    if (review.verdict !== "approve") throw new Error(`revisão editorial ${review.verdict} — ${review.findings.join("; ")}`.slice(0, 400));
    const now = localTime();
    const scheduleAt = job.slot && job.slot > now && (Date.parse(`${job.slot}:00-03:00`) - Date.now()) / 60000 > 15 ? job.slot : undefined;
    const ideaState = await callContainer({ workspaceId, action: "video_idea", ideaId: job.idea.id });
    if (ideaState.status !== "available") throw new Error("A pauta não está mais disponível no Bolsão");
    return callContainer({ workspaceId, action: "video_schedule", ideaId: job.idea.id, updatedAt: ideaState.updatedAt, versionId: status.versionId, sha256: status.output.sha256,
      slot: scheduleAt ?? `${now.slice(0, 10)}T${VIDEO_HOUR}:00`, publishNow: !scheduleAt, redoJobId: job.id, changeSummary: String(output.changeSummary ?? "").slice(0, 240),
      review: { verdict: review.verdict, findings: review.findings }, trace: { operations } });
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}

if (mode === "redo") {
  console.log(JSON.stringify({ time: new Date().toISOString(), workspace, ...await redoWorkspace(workspace) }));
} else {
  try { await processOutput("runuser", [...agent, "login", "status"], "", 15000); } catch (error) { throw new Error(`Codex sem login: ${error.message}`); }
  // Sequencial: o worker renderiza um vídeo por vez; uma marca não espera a outra numa fila maior.
  for (const workspaceId of workspace ? [workspace] : workspaces) {
    try {
      console.log(JSON.stringify({ time: new Date().toISOString(), workspace: workspaceId, mode, ...await runWorkspace(workspaceId) }));
    } catch (error) {
      process.exitCode = 1;
      log({ workspace: workspaceId, error: error.message.replace(/([?&]sig=)[^&\s]+/g, "$1[redacted]").slice(0, 800) });
    }
  }
}
