#!/usr/bin/env node
// PROVA TÉCNICA da integração DaVinci (Etapa A). Só passa com o DaVinci Resolve aberto e a ponte
// VorixBridge rodando: gera mídia de teste, monta um plano que exercita projeto, importação,
// timeline, cortes, transições, textos/legendas, logo, trilha, movimento e formato, renderiza um MP4
// real pelo DaVinci e roda o Quality Gate. Nenhuma intervenção manual entre o envio e a entrega.
//
// Uso: npm run build && node scripts/davinci/proof-render.mjs [--aspect 9:16|1:1|16:9] [--ping]
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cpus, freemem, totalmem } from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { defaultBridgeRoot } from "./install-bridge.mjs";
import { FileBridgeClient } from "../../dist/infrastructure/davinci-resolve/file-bridge-client.js";
import { DavinciResolveExecutor } from "../../dist/infrastructure/davinci-resolve/davinci-resolve-executor.js";
import { probeMedia, analyzeVideo, renderContactSheet } from "../../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { evaluateVideoQualityGate } from "../../dist/application/video-editing/video-quality-gate.js";
import { VIDEO_FORMATS } from "../../dist/domain/video-editing/video-edit-plan.js";

const require = createRequire(import.meta.url);
const ffmpeg = resolve(require.resolve("ffmpeg-static/package.json"), "..", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
};

function run(args) {
  return new Promise((ok, fail) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => (code === 0 ? ok() : fail(new Error(err.slice(-800)))));
  });
}

async function makeSources(dir) {
  await mkdir(dir, { recursive: true });
  const files = {
    v1: join(dir, "talk.mp4"),
    p1: join(dir, "product-a.jpg"),
    p2: join(dir, "product-b.jpg"),
    logo: join(dir, "logo.png"),
    song: join(dir, "song.wav"),
  };
  // "Gravação" 16:9 de 20s com áudio (tom com pausas, imitando fala).
  await run(["-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=20", "-f", "lavfi", "-i", "sine=frequency=280:sample_rate=48000:duration=20", "-af", "volume='if(lt(mod(t,3),2),1,0.02)':eval=frame", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", files.v1]);
  await run(["-f", "lavfi", "-i", "smptehdbars=s=1200x1500", "-frames:v", "1", files.p1]);
  await run(["-f", "lavfi", "-i", "mandelbrot=s=1500x1000", "-frames:v", "1", files.p2]);
  await run(["-f", "lavfi", "-i", "color=c=black@0.0:s=800x400,format=rgba,drawbox=x=40:y=60:w=720:h=280:color=0xFF6A00@1:t=fill,drawbox=x=120:y=140:w=560:h=120:color=0xFFFFFF@1:t=fill", "-frames:v", "1", files.logo]);
  await run(["-f", "lavfi", "-i", "aevalsrc=0.25*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*2*t))|0.25*sin(2*PI*330*t)*(0.6+0.4*sin(2*PI*2*t)):s=48000:d=30", files.song]);
  return files;
}

function proofPlan(aspect) {
  const { width, height } = VIDEO_FORMATS[aspect];
  const text = { size: 0.05, colorHex: "#FFFFFF", backgroundHex: "#101010", bold: true };
  return {
    version: 1,
    planId: "proof-a",
    workspaceId: "proof",
    mode: "images_ad",
    aspect,
    width,
    height,
    fps: 30,
    durationSeconds: 15,
    assets: [
      { id: "v1", kind: "video", role: "footage", fileName: "talk-x.mp4", sourceDurationSeconds: 20, width: 1920, height: 1080 },
      { id: "p1", kind: "image", role: "product_photo", fileName: "product-ax.jpg", width: 1200, height: 1500, protectedFidelity: true },
      { id: "p2", kind: "image", role: "product_photo", fileName: "product-bx.jpg", width: 1500, height: 1000 },
      { id: "logo", kind: "image", role: "logo", fileName: "logo-x.png", width: 800, height: 400 },
      { id: "song", kind: "audio", role: "music", fileName: "song-x.wav", sourceDurationSeconds: 30 },
    ],
    clips: [
      { id: "c1", assetId: "v1", purpose: "abertura com fala", sourceInSeconds: 2, durationSeconds: 4, recordStartSeconds: 0, motion: { type: "push_in", intensity: 0.4 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "dip_to_black", durationSeconds: 0.4 }, keepSourceAudio: true, overlays: [{ id: "o1", role: "hook", text: "Prova DaVinci Vorix", startOffsetSeconds: 0.2, durationSeconds: 3.4, position: "top", animation: "slide_up", style: text }] },
      { id: "c2", assetId: "p1", purpose: "produto", sourceInSeconds: 0, durationSeconds: 4, recordStartSeconds: 3.5, motion: { type: "pan_up", intensity: 0.4 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "cross_dissolve", durationSeconds: 0.5 }, keepSourceAudio: false, overlays: [] },
      { id: "c3", assetId: "p2", purpose: "detalhe", sourceInSeconds: 0, durationSeconds: 4, recordStartSeconds: 7, motion: { type: "pan_left", intensity: 0.5 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "push_left", durationSeconds: 0.5 }, keepSourceAudio: false, overlays: [] },
      { id: "c4", assetId: "v1", purpose: "fechamento", sourceInSeconds: 12, durationSeconds: 4.5, recordStartSeconds: 10.5, motion: { type: "static", intensity: 0 }, framing: { fit: "fit", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "zoom_in", durationSeconds: 0.5 }, keepSourceAudio: true, overlays: [{ id: "o2", role: "cta", text: "Compre agora", startOffsetSeconds: 1, durationSeconds: 3.3, position: "bottom", animation: "pop", style: text }] },
    ],
    captions: { enabled: true, style: { size: 0.04, colorHex: "#FFE14D", backgroundHex: "#000000", bold: true }, position: "lower_third", segments: [{ startSeconds: 0.5, endSeconds: 2.4, text: "Legenda sincronizada um" }, { startSeconds: 11, endSeconds: 13.5, text: "Legenda sincronizada dois" }] },
    music: { assetId: "song", gainDb: -16, fadeInSeconds: 0.5, fadeOutSeconds: 1.5, duckUnderSpeech: true },
    logo: { assetId: "logo", placement: "top_right", scale: 0.22, startSeconds: 10.5, durationSeconds: 4.5 },
    sourceAudioGainDb: 0,
    strategy: "prova-tecnica",
    prompt: "Prova técnica da integração DaVinci",
  };
}

async function main() {
  const root = defaultBridgeRoot();
  const client = new FileBridgeClient({ rootDir: root });
  const status = await client.status();
  console.log(`[prova] ponte: ${status.alive ? "viva" : "PARADA"} (raiz ${root}, sinal há ${status.ageMs === null ? "nunca" : `${Math.round(status.ageMs / 1000)}s`})`);
  if (process.argv.includes("--ping")) {
    if (!status.alive) process.exit(2);
    console.log(await client.call({ op: "ping", args: {} }, { timeoutMs: 15_000 }));
    return;
  }
  const aspect = arg("--aspect", "9:16");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve("artifacts", "davinci-proof", `${stamp}-${aspect.replace(":", "x")}`);
  const sources = await makeSources(join(outDir, "sources"));
  const plan = proofPlan(aspect);
  const executor = new DavinciResolveExecutor({ client });
  const output = join(outDir, "proof.mp4");
  const startedAt = Date.now();
  const memBefore = freemem();
  const progress = [];
  let peakRss = 0;
  const sampler = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 500);
  let result;
  try {
    result = await executor.execute({
      jobId: `proof-${Date.now().toString(36)}`,
      plan,
      mediaSources: sources,
      outputPath: output,
      onProgress: (p) => {
        progress.push({ t: Date.now() - startedAt, ...p });
        console.log(`[prova] ${String(p.percent).padStart(3)}% ${p.stage} — ${p.message}`);
      },
    });
  } finally {
    clearInterval(sampler);
  }
  const totalMs = Date.now() - startedAt;
  const info = await stat(output);
  const probe = await probeMedia(output);
  const analysis = await analyzeVideo(output, { hasAudio: true });
  const gate = evaluateVideoQualityGate({ plan, probe: { exists: true, sizeBytes: info.size, ...probe }, analysis, compilerWarnings: result.warnings, requestedDurationSeconds: 15, brandHasLogo: true });
  await renderContactSheet(output, join(outDir, "contact-sheet.png"), { everySeconds: 1.25, columns: 4, tileWidth: aspect === "16:9" ? 480 : 270, maxTiles: 12 });
  const report = { aspect, totalMs, timings: result.timings, engine: result.engine, operationsSent: result.operationsSent, warnings: result.warnings, probe, analysis, gate, progress, machine: { cpus: cpus()[0]?.model, cores: cpus().length, totalMemGb: +(totalmem() / 1e9).toFixed(1), freeMemBeforeGb: +(memBefore / 1e9).toFixed(1), freeMemAfterGb: +(freemem() / 1e9).toFixed(1), nodePeakRssMb: Math.round(peakRss / 1e6) } };
  await writeFile(join(outDir, "plan.json"), JSON.stringify(plan, null, 2));
  await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`[prova] MP4: ${output} (${(info.size / 1e6).toFixed(2)} MB) em ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`[prova] Quality Gate: ${gate.status}`);
  for (const check of gate.checks) console.log(`   ${check.status.padEnd(6)} ${check.label} — ${check.detail}`);
  if (gate.status !== "ready_for_review") process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[prova] FALHOU: ${error.name}: ${error.message}`);
  process.exitCode = 1;
});
