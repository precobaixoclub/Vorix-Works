import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Refação depois da reprovação no WhatsApp (timer a cada 2 min, mesma trava do piloto).
 * A API grava o pedido de refação quando a pessoa responde "2 motivo"; aqui cada marca pega o seu pedido
 * pendente e roda o piloto só para aquela pauta (VORIX_EDITORIAL_IDEA) com o motivo (VORIX_REDO_JOB): o Codex
 * reescreve o texto / troca a peça / ajusta a cena, o Quality Gate confere e a nova versão volta para aprovação.
 * Horário original ainda com folga → agenda para ele; senão → publica assim que for aprovada.
 */

const basedir = new URL("./", import.meta.url);
const agentHome = "/var/lib/vorix-codex";
const container = "zuno-zuno-api-1";
const timezone = "America/Sao_Paulo";
const workspaces = ["workspace-mwmumsxd-fmvh3h", "workspace-mscc9pi2-jkvwbo", "workspace-mwmu8kgf-uhe66l", "workspace-cee-prelaunch-mv47cmfh"];
const localTime = () => new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date()).replace(" ", "T");
const backend = await readFile(new URL("codex-social-backend.mjs", basedir), "utf8");

function run(program, args, { stdin = "", timeout, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(program, args, { stdio: ["pipe", "pipe", "pipe"], ...(env ? { env } : {}) });
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on("data", (bytes) => out.push(bytes));
    child.stderr.on("data", (bytes) => err.push(bytes));
    child.stdin.on("error", () => undefined);
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }); });
    child.stdin.end(stdin);
  });
}

async function callContainer(request) {
  const result = await run("docker", ["exec", "-i", container, "node", "--input-type=module"], { stdin: `const request = ${JSON.stringify(request)};\n${backend}`, timeout: 180000 });
  if (result.code !== 0) throw new Error(result.stderr.trim().split("\n").slice(-3).join(" ") || `código ${result.code}`);
  return JSON.parse(result.stdout.trim().split("\n").at(-1));
}

const minutesUntil = (slot) => (Date.parse(`${slot}:00-03:00`) - Date.now()) / 60000;

/** Horário original com pelo menos 15 min de folga hoje: agenda para ele. Senão: publica quando aprovada. */
function plan(job) {
  const today = localTime().slice(0, 10);
  if (job.slot && job.slot.slice(0, 10) === today && minutesUntil(job.slot) > 15) return { hour: job.slot.slice(11, 13), mode: "schedule" };
  const hour = job.slot?.slice(11, 13);
  return { hour: hour === "12" || hour === "19" ? hour : "19", mode: "publish" };
}

for (const workspaceId of workspaces) {
  for (let round = 0; round < 3; round += 1) {
    let job;
    try {
      ({ job } = await callContainer({ workspaceId, action: "claim_redo" }));
    } catch (error) {
      console.error(JSON.stringify({ workspace: workspaceId, error: `refação: ${error.message}`.slice(0, 400) }));
      break;
    }
    if (!job) break;
    const file = join(agentHome, "jobs", `redo-${job.id}.json`);
    const { hour, mode } = plan(job);
    let failure;
    try {
      await writeFile(file, JSON.stringify(job), { mode: 0o600 });
      // Vídeo (Reels) reprovado: o orquestrador de vídeo refaz a partir da versão reprovada (mesmo Codex, mesma trava).
      const video = Boolean(job.video);
      const result = await run("/usr/bin/node", video ? [new URL("codex-social-video.mjs", basedir).pathname, "redo", workspaceId] : [new URL("codex-social-schedule.mjs", basedir).pathname, hour, mode, workspaceId], {
        timeout: 40 * 60000, env: { ...process.env, VORIX_EDITORIAL_IDEA: job.idea.externalId ?? job.idea.id, VORIX_REDO_JOB: file },
      });
      const last = result.stdout.trim().split("\n").at(-1) ?? "";
      if (result.code !== 0 || !/"(scheduled|submitted)"/.test(last)) {
        const detail = result.stderr.trim().split("\n").at(-1) ?? "";
        let message = detail;
        try { message = JSON.parse(detail).error ?? detail; } catch { /* linha não-JSON */ }
        // Para o aprovador: só a primeira linha, sem rastro técnico ("Error:", pilha, versão do Node).
        failure = (message || `a refação terminou sem publicação (${last.slice(0, 200)})`).replace(/^QUALITY_GATE:\s*/, "")
          .split("\n")[0].replace(/\bError:\s*/g, "").replace(/\bQUALITY_[A-Z_]+:\s*/g, "").trim();
        console.error(JSON.stringify({ workspace: workspaceId, redo: job.id, stderr: result.stderr.trim().split("\n").slice(-25).join("\n").slice(0, 4000) }));
      }
      console.log(JSON.stringify({ time: new Date().toISOString(), workspace: workspaceId, redo: job.id, attempt: job.attempt, mode, hour, ok: !failure, ...(failure ? { error: failure.slice(0, 400) } : {}) }));
    } catch (error) {
      failure = error.message;
    } finally {
      await rm(file, { force: true });
    }
    if (failure) {
      await callContainer({ workspaceId, action: "finish_redo", jobId: job.id, status: "failed", detail: failure.replace(/([?&]sig=)[^&\s]+/g, "$1[redacted]").slice(0, 600) })
        .catch((error) => console.error(JSON.stringify({ workspace: workspaceId, redo: job.id, error: `falha ao registrar: ${error.message}`.slice(0, 300) })));
    }
  }
}
