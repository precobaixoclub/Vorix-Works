#!/usr/bin/env node
// Medição controlada do motor de vídeo no VPS, DENTRO de um container temporário limitado
// (docker run --cpus=2 --memory=2g --network=none). Só materiais sintéticos gerados aqui.
// Uso (dentro do container, cwd = pasta do pacote): node run.mjs <images-9x16|images-1x1|images-16x9|footage-9x16>
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { FfmpegEditExecutor } from "./dist/infrastructure/video-editing/ffmpeg-edit-executor.js";
import { probeMedia, analyzeVideo } from "./dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { evaluateVideoQualityGate } from "./dist/application/video-editing/video-quality-gate.js";
import { VIDEO_FORMATS } from "./dist/domain/video-editing/video-edit-plan.js";
import { resolveFfmpegBinaryPath } from "./dist/infrastructure/video-rendering/ffmpeg-binary.js";

const which = process.argv[2] ?? "images-9x16";
const root = resolve(".");
const mat = join(root, "materials");
const ff = resolveFfmpegBinaryPath();
const run = (args) => new Promise((ok, fail) => {
  const child = spawn(ff, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  child.on("close", (code) => (code === 0 ? ok() : fail(new Error(err.slice(-400)))));
});

async function materials() {
  await mkdir(mat, { recursive: true });
  // Fotos sintéticas 3:4 (1440x1920), logo com alfa, trilha, "gravação" 16:9 com tom em pausas.
  await run(["-f", "lavfi", "-i", "testsrc2=s=1440x1920", "-frames:v", "1", "-q:v", "2", join(mat, "photo-ax.jpg")]);
  await run(["-f", "lavfi", "-i", "mandelbrot=s=1440x1920", "-frames:v", "1", "-q:v", "2", join(mat, "photo-bx.jpg")]);
  await run(["-f", "lavfi", "-i", "smptehdbars=s=1440x1920", "-frames:v", "1", "-q:v", "2", join(mat, "photo-cx.jpg")]);
  await run(["-f", "lavfi", "-i", "color=c=black@0.0:s=800x400,format=rgba,drawbox=x=40:y=60:w=720:h=280:color=0xC9A23F@1:t=fill", "-frames:v", "1", join(mat, "logo-x.png")]);
  await run(["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=40", "-ac", "2", join(mat, "song-x.wav")]);
  await run(["-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=40", "-f", "lavfi", "-i", "sine=frequency=300:sample_rate=48000:duration=40", "-af", "volume='if(lt(mod(t,3),2),1,0.02)':eval=frame", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(mat, "take-ax.mp4")]);
}

const text = (size, colorHex, backgroundHex, fontFamily = "Barlow Condensed") => ({ size, colorHex, backgroundHex, bold: true, fontFamily });
function chain(specs) {
  let t = 0;
  return specs.map((spec, index) => {
    const overlap = index > 0 && ["cross_dissolve", "push_left", "push_up", "zoom_in"].includes(spec.transitionIn.type) ? spec.transitionIn.durationSeconds : 0;
    const start = index === 0 ? 0 : t - overlap;
    t = start + spec.durationSeconds;
    return { sourceInSeconds: 0, keepSourceAudio: false, overlays: [], ...spec, recordStartSeconds: Math.round(start * 1000) / 1000 };
  });
}

function imagesPlan(aspect) {
  const fitFor = aspect === "16:9" ? "fit" : "fill";
  const clips = chain([
    { id: "a", assetId: "pa", purpose: "abertura", durationSeconds: 3, motion: { type: "push_in", intensity: 0.35 }, framing: { fit: fitFor, focusX: 0.5, focusY: 0.42 }, transitionIn: { type: "dip_to_black", durationSeconds: 0.5 }, overlays: [{ id: "h", role: "hook", text: "Estampa exclusiva", startOffsetSeconds: 0.3, durationSeconds: 2.5, position: "top", animation: "slide_up", style: text(0.055, "#111111", "#F4EFE6", "DM Serif Display") }] },
    { id: "b", assetId: "pb", purpose: "detalhe", durationSeconds: 3.4, motion: { type: "push_in", intensity: 0.55 }, framing: { fit: fitFor, focusX: 0.5, focusY: 0.36 }, transitionIn: { type: "cross_dissolve", durationSeconds: 0.4 } },
    { id: "c", assetId: "pc", purpose: "cores", durationSeconds: 3.4, motion: { type: "pan_left", intensity: 0.35 }, framing: { fit: fitFor, focusX: 0.5, focusY: 0.42 }, transitionIn: { type: "push_left", durationSeconds: 0.4 }, overlays: [{ id: "t", role: "headline", text: "Três cores", startOffsetSeconds: 0.5, durationSeconds: 2.6, position: "top", animation: "fade", style: text(0.045, "#FFFFFF", "#111111") }] },
    { id: "d", assetId: "pa", purpose: "close", durationSeconds: 2.8, motion: { type: "pull_out", intensity: 0.4 }, framing: { fit: fitFor, focusX: 0.5, focusY: 0.34 }, transitionIn: { type: "zoom_in", durationSeconds: 0.4 } },
    { id: "e", assetId: "card", purpose: "cta", durationSeconds: 4, motion: { type: "static", intensity: 0 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "cross_dissolve", durationSeconds: 0.4 }, overlays: [{ id: "cta", role: "cta", text: "Garanta a sua", startOffsetSeconds: 0.9, durationSeconds: 3.1, position: "bottom", animation: "pop", style: text(0.05, "#111111", "#C9A23F", "DM Serif Display") }] },
  ]);
  const duration = clips.at(-1).recordStartSeconds + clips.at(-1).durationSeconds;
  return {
    version: 1, planId: `vps-${which}`, workspaceId: "ws-vps-measure", mode: "images_ad", aspect, ...VIDEO_FORMATS[aspect], fps: 30, durationSeconds: duration, sourceAudioGainDb: 0, strategy: "medicao", prompt: "medicao",
    assets: [
      { id: "pa", kind: "image", role: "product_photo", fileName: "photo-ax.jpg", width: 1440, height: 1920, protectedFidelity: true },
      { id: "pb", kind: "image", role: "product_photo", fileName: "photo-bx.jpg", width: 1440, height: 1920, protectedFidelity: true },
      { id: "pc", kind: "image", role: "product_photo", fileName: "photo-cx.jpg", width: 1440, height: 1920, protectedFidelity: true },
      { id: "logo", kind: "image", role: "logo", fileName: "logo-x.png", width: 800, height: 400 },
      { id: "card", kind: "card", role: "card", card: { colorHex: "#FBF8F2", gradientToHex: "#EADFCB" } },
      { id: "song", kind: "audio", role: "music", fileName: "song-x.wav", sourceDurationSeconds: 40 },
    ],
    clips,
    logo: { assetId: "logo", placement: "center", scale: aspect === "16:9" ? 0.3 : 0.45, startSeconds: clips.at(-1).recordStartSeconds + 0.3, durationSeconds: duration - clips.at(-1).recordStartSeconds - 0.3 },
    music: { assetId: "song", gainDb: -10, fadeInSeconds: 0.5, fadeOutSeconds: 1.2, duckUnderSpeech: false },
  };
}

function footagePlan() {
  const moments = [[2, 4.2], [8, 7], [17, 4.4], [25, 8.6], [35, 4.5]];
  const specs = moments.map(([sourceIn, duration], index) => ({ id: `m${index}`, assetId: "take", purpose: "fala", sourceInSeconds: sourceIn, durationSeconds: duration, motion: { type: index % 2 ? "static" : "push_in", intensity: 0.12 }, framing: { fit: "fit", focusX: 0.5, focusY: 0.42, zoom: 1.5 }, transitionIn: index === 0 ? { type: "dip_to_black", durationSeconds: 0.3 } : { type: "cut", durationSeconds: 0 }, keepSourceAudio: true, overlays: index === 0 ? [{ id: "h", role: "hook", text: "Gancho de abertura", startOffsetSeconds: 0.2, durationSeconds: 3, position: "top", animation: "pop", style: text(0.058, "#FFFFFF", "#B5546B") }] : [] }));
  specs.push({ id: "cta", assetId: "card", purpose: "cta", durationSeconds: 2.6, motion: { type: "push_in", intensity: 0.15 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "cross_dissolve", durationSeconds: 0.35 }, overlays: [{ id: "cta", role: "cta", text: "Chamada final", startOffsetSeconds: 0.3, durationSeconds: 2.3, position: "center", animation: "pop", style: text(0.06, "#FFFFFF") }] });
  const clips = chain(specs);
  const duration = clips.at(-1).recordStartSeconds + clips.at(-1).durationSeconds;
  // Legendas com palavras cronometradas (sintéticas) em todos os trechos de fala.
  const segments = [];
  for (const clip of clips.filter((c) => c.keepSourceAudio)) {
    for (let t = clip.recordStartSeconds + 0.1; t + 1.8 < clip.recordStartSeconds + clip.durationSeconds; t += 2) {
      const words = ["Legenda", "sincronizada", "palavra", "por", "palavra"].map((w, i) => ({ text: w, startSeconds: +(t + i * 0.34).toFixed(3), endSeconds: +(t + i * 0.34 + 0.3).toFixed(3) }));
      segments.push({ startSeconds: +t.toFixed(3), endSeconds: +(t + 1.8).toFixed(3), text: words.map((w) => w.text).join(" "), words });
    }
  }
  return {
    version: 1, planId: "vps-footage", workspaceId: "ws-vps-measure", mode: "edit_footage", aspect: "9:16", ...VIDEO_FORMATS["9:16"], fps: 30, durationSeconds: duration, sourceAudioGainDb: 0, strategy: "medicao", prompt: "medicao",
    assets: [{ id: "take", kind: "video", role: "footage", fileName: "take-ax.mp4", sourceDurationSeconds: 40, width: 1920, height: 1080 }, { id: "card", kind: "card", role: "card", card: { colorHex: "#C2607A", gradientToHex: "#6E2A3C" } }, { id: "song", kind: "audio", role: "music", fileName: "song-x.wav", sourceDurationSeconds: 40 }],
    clips,
    captions: { enabled: true, style: text(0.046, "#FFFFFF"), position: "bottom", segments },
    music: { assetId: "song", gainDb: -14, fadeInSeconds: 0.4, fadeOutSeconds: 1.2, duckUnderSpeech: true },
  };
}

async function cgroupPeakMb() {
  for (const file of ["/sys/fs/cgroup/memory.peak", "/sys/fs/cgroup/memory/memory.max_usage_in_bytes"]) {
    try {
      return Math.round(Number((await readFile(file, "utf8")).trim()) / 1e6);
    } catch {}
  }
  return null;
}

async function main() {
  const t0 = Date.now();
  await materials();
  const materialsMs = Date.now() - t0;
  const plan = which === "footage-9x16" ? footagePlan() : imagesPlan(which.replace("images-", "").replace("x", ":"));
  const sources = Object.fromEntries(plan.assets.filter((a) => a.fileName).map((a) => [a.id, join(mat, a.fileName)]));
  const executor = new FfmpegEditExecutor({ workRoot: join(root, "work"), ffmpeg: { threads: 2, preset: process.env.PRESET ?? "medium" }, limits: { maxDurationSeconds: 60 } });
  const out = join(root, "out.mp4");
  const t1 = Date.now();
  const result = await executor.execute({ jobId: `vps-${which}`, plan, mediaSources: sources, outputPath: out });
  const renderMs = Date.now() - t1;
  const info = await stat(out);
  const probe = await probeMedia(out);
  const analysis = await analyzeVideo(out, { hasAudio: Boolean(probe.audio) });
  const gate = evaluateVideoQualityGate({ plan, probe: { exists: true, sizeBytes: info.size, ...probe }, analysis, compilerWarnings: result.warnings, brandHasLogo: Boolean(plan.logo) });
  const report = { which, preset: process.env.PRESET ?? "medium", cpusVisible: cpus().length, ffmpeg: result.engine.version, durationSeconds: plan.durationSeconds, materialsMs, renderMs, realtimeFactor: +(plan.durationSeconds / (renderMs / 1000)).toFixed(2), steps: result.details?.steps, sizeMb: +(info.size / 1e6).toFixed(2), containerPeakMemMb: await cgroupPeakMb(), gate: gate.status, failures: gate.failures };
  await writeFile(join(root, `report-${which}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}

main().catch((error) => {
  console.error(`FALHOU: ${error.message}`);
  if (error.logTail) console.error(error.logTail.join(" | "));
  process.exitCode = 1;
});
