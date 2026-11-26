// Cliente da ponte, executor DaVinci e Quality Gate contra o SIMULADOR da ponte (não é a prova ao
// vivo — essa é scripts/davinci/proof-render.mjs com o DaVinci aberto).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileBridgeClient, DavinciBridgeUnavailableError, DavinciBridgeTimeoutError, DavinciOperationError, DavinciCancelledError } from "../dist/infrastructure/davinci-resolve/file-bridge-client.js";
import { DavinciResolveExecutor, InsufficientDiskSpaceError, RenderFailedError } from "../dist/infrastructure/davinci-resolve/davinci-resolve-executor.js";
import { BridgeArgumentError } from "../dist/infrastructure/davinci-resolve/bridge-protocol.js";
import { probeMedia, analyzeVideo, parseProbe, parseAnalysis } from "../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { evaluateVideoQualityGate } from "../dist/application/video-editing/video-quality-gate.js";
import { FakeDavinciBridge, makeVideo, makeTone, cleanup } from "./helpers/fake-davinci-bridge.mjs";
import { imagesAdPlan } from "./helpers/video-edit-fixtures.mjs";

function setup(behavior) {
  const root = mkdtempSync(join(tmpdir(), "vorix-bridge-"));
  const bridge = new FakeDavinciBridge(root, behavior);
  const client = new FileBridgeClient({ rootDir: root, pollIntervalMs: 20, heartbeatMaxAgeMs: 3_000 });
  return { root, bridge, client };
}

/** Mídia de origem fora da pasta da ponte (como viria do storage do workspace). */
async function sources(dir) {
  const files = { p1: "a.jpg", p2: "b.jpg", p3: "c.png", logo: "l.png" };
  const map = {};
  for (const [id, name] of Object.entries(files)) {
    const path = join(dir, name);
    writeFileSync(path, Buffer.alloc(2048, 1));
    map[id] = path;
  }
  map.song = join(dir, "s.wav");
  await makeTone(map.song);
  return map;
}

test("ponte nunca iniciada e ponte parada são detectadas antes de qualquer envio", async () => {
  const { root, client } = setup();
  await assert.rejects(client.assertAlive(), DavinciBridgeUnavailableError);
  writeFileSync(join(root, "status.json"), JSON.stringify({ state: "stopped", protocol: 1 }));
  assert.equal((await client.status()).alive, false);
  await cleanup(root);
});

test("versão de protocolo incompatível é recusada", async () => {
  const { root, bridge, client } = setup({ protocol: 9 });
  await bridge.start();
  await assert.rejects(client.assertAlive(), /incompatível/);
  await bridge.stop();
  await cleanup(root);
});

test("operação inválida é recusada antes de ir ao disco", async () => {
  const { root, client } = setup();
  await assert.rejects(client.call({ op: "run_lua", args: { code: "x" } }), BridgeArgumentError);
  assert.equal(existsSync(join(root, "inbox", "request.json")), false);
  await cleanup(root);
});

test("timeout retira o pedido para a ponte não executá-lo depois", async () => {
  const { root, bridge, client } = setup({ hangOp: "save_project" });
  await bridge.start();
  await assert.rejects(client.call({ op: "save_project", args: {} }, { timeoutMs: 300 }), DavinciBridgeTimeoutError);
  assert.equal(existsSync(join(root, "inbox", "request.json")), false);
  await bridge.stop();
  await cleanup(root);
});

test("chamadas concorrentes são serializadas (um pedido por vez)", async () => {
  const { root, bridge, client } = setup();
  await bridge.start();
  const results = await Promise.all([client.call({ op: "ping", args: {} }), client.call({ op: "save_project", args: {} }), client.call({ op: "ping", args: {} })]);
  assert.equal(results.length, 3);
  assert.deepEqual(bridge.received.map((request) => request.op), ["ping", "save_project", "ping"]);
  await bridge.stop();
  await cleanup(root);
});

test("erro da ponte vira DavinciOperationError com a mensagem do DaVinci", async () => {
  const { root, bridge, client } = setup({ failOp: "save_project" });
  await bridge.start();
  await assert.rejects(client.call({ op: "save_project", args: {} }), (error) => error instanceof DavinciOperationError && /falha simulada/.test(error.message));
  await bridge.stop();
  await cleanup(root);
});

test("executor: isola a mídia na pasta do job, acompanha o render e entrega o MP4", async () => {
  const { root, bridge, client } = setup({ renderSteps: ["Rendering", "Rendering", "Complete"], video: { width: 1080, height: 1920, fps: 30, seconds: 15 } });
  const src = mkdtempSync(join(tmpdir(), "vorix-src-"));
  await bridge.start();
  const executor = new DavinciResolveExecutor({ client, renderPollMs: 20, minFreeBytes: 1 });
  const stages = [];
  const output = join(src, "final.mp4");
  const result = await executor.execute({ jobId: "job-exec-1", plan: imagesAdPlan(), mediaSources: await sources(src), outputPath: output, onProgress: (p) => stages.push(p.stage) });

  assert.equal(result.outputPath, output);
  assert.ok(result.sizeBytes > 10_000);
  assert.equal(result.engine.codec, "H264");
  for (const stage of ["validating", "connecting", "staging", "building_timeline", "rendering", "verifying", "done"]) assert.ok(stages.includes(stage), stage);
  // Só nomes simples, dentro da pasta do job, chegam à ponte
  const jobFiles = readdirSync(join(root, "jobs", "job-exec-1")).sort();
  assert.deepEqual(jobFiles, ["logo-x.png", "output", "photo-ax.jpg", "photo-bx.jpg", "photo-cx.png", "song-x.wav", "vorix-music-prepared.wav", "vorix-text-carrier.png"].sort());
  const imports = bridge.received.find((request) => request.op === "import_media").args.files;
  assert.ok(imports.every((file) => !file.includes("/") && !file.includes("\\")));
  assert.equal(bridge.received.at(-1).op, "close_project");

  // Quality Gate sobre o MP4 real
  const probe = await probeMedia(output);
  const analysis = await analyzeVideo(output, { hasAudio: true });
  const gate = evaluateVideoQualityGate({ plan: imagesAdPlan(), probe: { exists: true, sizeBytes: result.sizeBytes, ...probe }, analysis, compilerWarnings: result.warnings, requestedDurationSeconds: 15, brandHasLogo: true });
  assert.equal(gate.status, "ready_for_review", gate.failures.join("\n"));
  await bridge.stop();
  await cleanup(root);
  await cleanup(src);
});

test("executor: mídia obrigatória ausente falha antes de tocar no DaVinci", async () => {
  const { root, bridge, client } = setup();
  const src = mkdtempSync(join(tmpdir(), "vorix-src-"));
  await bridge.start();
  const map = await sources(src);
  delete map.p2;
  const executor = new DavinciResolveExecutor({ client, minFreeBytes: 1 });
  await assert.rejects(executor.execute({ jobId: "job-exec-2", plan: imagesAdPlan(), mediaSources: map, outputPath: join(src, "x.mp4") }), /Mídia obrigatória ausente/);
  assert.ok(!bridge.received.some((request) => request.op === "create_project"));
  await bridge.stop();
  await cleanup(root);
  await cleanup(src);
});

test("executor: sem espaço em disco o job para antes de copiar mídia", async () => {
  const { root, bridge, client } = setup();
  const src = mkdtempSync(join(tmpdir(), "vorix-src-"));
  await bridge.start();
  const executor = new DavinciResolveExecutor({ client, minFreeBytes: 1e18 });
  await assert.rejects(executor.execute({ jobId: "job-exec-3", plan: imagesAdPlan(), mediaSources: await sources(src), outputPath: join(src, "x.mp4") }), InsufficientDiskSpaceError);
  assert.equal(readdirSync(join(root, "jobs", "job-exec-3")).filter((name) => name !== "output").length, 0);
  await bridge.stop();
  await cleanup(root);
  await cleanup(src);
});

test("executor: render que falha no DaVinci fecha o projeto e reporta", async () => {
  const { root, bridge, client } = setup({ renderSteps: ["Rendering", "Failed"], produce: false });
  const src = mkdtempSync(join(tmpdir(), "vorix-src-"));
  await bridge.start();
  const executor = new DavinciResolveExecutor({ client, renderPollMs: 20, minFreeBytes: 1 });
  await assert.rejects(executor.execute({ jobId: "job-exec-4", plan: imagesAdPlan(), mediaSources: await sources(src), outputPath: join(src, "x.mp4") }), RenderFailedError);
  assert.equal(bridge.received.at(-1).op, "close_project");
  await bridge.stop();
  await cleanup(root);
  await cleanup(src);
});

test("executor: cancelamento durante o render para o DaVinci", async () => {
  const { root, bridge, client } = setup({ renderSteps: ["Rendering"], produce: false });
  const src = mkdtempSync(join(tmpdir(), "vorix-src-"));
  await bridge.start();
  const executor = new DavinciResolveExecutor({ client, renderPollMs: 20, minFreeBytes: 1 });
  const controller = new AbortController();
  const run = executor.execute({ jobId: "job-exec-5", plan: imagesAdPlan(), mediaSources: await sources(src), outputPath: join(src, "x.mp4"), signal: controller.signal, onProgress: (p) => { if (p.stage === "rendering" && p.percent > 30) controller.abort(); } });
  await assert.rejects(run, DavinciCancelledError);
  const ops = bridge.received.map((request) => request.op);
  assert.ok(ops.includes("stop_render"));
  assert.equal(ops.at(-1), "close_project");
  await bridge.stop();
  await cleanup(root);
  await cleanup(src);
});

test("executor: render que nunca termina estoura o timeout e é interrompido", async () => {
  const { root, bridge, client } = setup({ renderSteps: ["Rendering"], produce: false });
  const src = mkdtempSync(join(tmpdir(), "vorix-src-"));
  await bridge.start();
  const executor = new DavinciResolveExecutor({ client, renderPollMs: 20, minFreeBytes: 1, minRenderTimeoutMs: 300, renderTimeoutFactor: 0 });
  await assert.rejects(executor.execute({ jobId: "job-exec-6", plan: imagesAdPlan(), mediaSources: await sources(src), outputPath: join(src, "x.mp4") }), /excedeu/);
  assert.ok(bridge.received.some((request) => request.op === "stop_render"));
  await bridge.stop();
  await cleanup(root);
  await cleanup(src);
});

test("Quality Gate reprova preto inesperado, resolução e duração erradas", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vorix-qg-"));
  const file = join(dir, "bad.mp4");
  await makeVideo(file, { width: 1080, height: 1080, fps: 30, seconds: 6, blackFirst: 3 });
  const probe = await probeMedia(file);
  const analysis = await analyzeVideo(file, { hasAudio: true });
  assert.ok(analysis.blackSegments.length >= 1);
  const plan = imagesAdPlan();
  plan.clips[0].transitionIn = { type: "cut", durationSeconds: 0 };
  const gate = evaluateVideoQualityGate({ plan, probe: { exists: true, sizeBytes: 50_000, ...probe }, analysis, compilerWarnings: [], brandHasLogo: false });
  assert.equal(gate.status, "needs_revision");
  const failed = gate.checks.filter((check) => check.status === "fail").map((check) => check.id);
  for (const id of ["resolution", "duration", "black"]) assert.ok(failed.includes(id), id);
  await cleanup(dir);
});

test("Quality Gate: arquivo ausente reprova; parsers leem a saída do FFmpeg", () => {
  const gate = evaluateVideoQualityGate({ plan: imagesAdPlan(), probe: { exists: false, sizeBytes: 0, durationSeconds: null }, analysis: null, compilerWarnings: [], brandHasLogo: false });
  assert.equal(gate.status, "needs_revision");
  const probe = parseProbe("Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':\n  Duration: 00:00:15.03, start: 0.000000, bitrate: 900 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1080x1920 [SAR 1:1 DAR 9:16], 800 kb/s, 30 fps, 30 tbr, 15360 tbn (default)\n  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 96 kb/s (default)");
  assert.equal(probe.durationSeconds, 15.03);
  assert.deepEqual([probe.video.width, probe.video.height, probe.video.fps, probe.video.codec], [1080, 1920, 30, "h264"]);
  assert.equal(probe.audio.codec, "aac");
  const analysis = parseAnalysis("[blackdetect @ 0x1] black_start:0 black_end:0.5 black_duration:0.5\n[silencedetect @ 0x2] silence_start: 3.2\n[silencedetect @ 0x2] silence_end: 5.1 | silence_duration: 1.9\n[Parsed_volumedetect_0 @ 0x3] mean_volume: -21.4 dB\n[Parsed_volumedetect_0 @ 0x3] max_volume: -2.0 dB");
  assert.deepEqual(analysis.blackSegments, [{ start: 0, end: 0.5 }]);
  assert.deepEqual(analysis.silenceSegments, [{ start: 3.2, end: 5.1 }]);
  assert.equal(analysis.meanVolumeDb, -21.4);
});
