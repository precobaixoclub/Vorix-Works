// Motores de transcrição do Vorix Meetings: seleção pelo painel (local por padrão, OpenAI só por
// escolha explícita), proteção do host e os dois motores locais com processos falsos (sem modelo).
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

import { ConfiguredTranscriptionEngine } from "../dist/application/meetings/transcription-engine-selector.js";
import { checkHostCapacity } from "../dist/infrastructure/meetings/host-resource-guard.js";
import { WhisperCppTranscriptionEngine } from "../dist/infrastructure/meetings/whisper-cpp-engine.js";
import { FasterWhisperTranscriptionEngine } from "../dist/infrastructure/meetings/faster-whisper-engine.js";

const run = promisify(execFile);
const result = (engine) => ({ language: "pt", engine, model: "m", durationSeconds: 1, processingMs: 1, segments: [], metrics: {} });
const engineThat = (name, calls) => ({ async transcribe() { calls.push(name); return result(name); } });

test("SELEÇÃO: usa o motor do painel; sem configuração legível cai no LOCAL — nunca na OpenAI", async () => {
  const calls = [];
  const engines = { LOCAL_FASTER_WHISPER: engineThat("local", calls), LOCAL_WHISPER_CPP: engineThat("economico", calls), OPENAI_OPTIONAL: engineThat("openai", calls) };
  await new ConfiguredTranscriptionEngine({ selected: async () => "LOCAL_WHISPER_CPP", engines }).transcribe({ wavPath: "x", timeoutMs: 1 });
  await new ConfiguredTranscriptionEngine({ selected: async () => { throw new Error("banco fora"); }, engines }).transcribe({ wavPath: "x", timeoutMs: 1 });
  assert.deepEqual(calls, ["economico", "local"]);
  await assert.rejects(
    new ConfiguredTranscriptionEngine({ selected: async () => "LOCAL_WHISPER_CPP", engines: { LOCAL_FASTER_WHISPER: engines.LOCAL_FASTER_WHISPER } }).transcribe({ wavPath: "x", timeoutMs: 1 }),
    (error) => error.retryable === false && /Local econômico.*não está instalado/.test(error.message),
  );
});

test("PROTEÇÃO DO HOST: memória baixa, pressão de CPU/memória ou carga alta seguram a transcrição", async () => {
  const limits = { minAvailableMemoryMb: 900, maxCpuPressurePct: 40, maxMemoryPressurePct: 10, maxLoadPerCpu: 1.5 };
  const host = ({ memMb = 1500, cpu = "0.50", mem = "0.00", load = 0.5, cpus = 2 } = {}) => {
    const files = {
      "/proc/meminfo": `MemTotal: 2014000 kB\nMemAvailable:   ${memMb * 1024} kB\n`,
      "/proc/pressure/cpu": `some avg10=${cpu} avg60=0 avg300=0 total=1`,
      "/proc/pressure/memory": `some avg10=${mem} avg60=0 avg300=0 total=1\nfull avg10=0 avg60=0 avg300=0 total=0`,
    };
    return { read: async (path) => { if (!(path in files)) throw new Error("ENOENT"); return files[path]; }, loadavg: () => [load, 0, 0], cpus: () => cpus };
  };
  assert.deepEqual(await checkHostCapacity(limits, host()), { ok: true });
  assert.match((await checkHostCapacity(limits, host({ memMb: 590 }))).reason, /memória disponível 590 MB < 900 MB/);
  assert.match((await checkHostCapacity(limits, host({ cpu: "63.10" }))).reason, /pressão de CPU 63.10%/);
  assert.match((await checkHostCapacity(limits, host({ mem: "22.00" }))).reason, /pressão de memória/);
  assert.match((await checkHostCapacity(limits, host({ load: 4, cpus: 2 }))).reason, /carga 2.00 por CPU/);
  // Fora do Linux (sem /proc): só a carga conta.
  assert.deepEqual(await checkHostCapacity(limits, { read: async () => { throw new Error("ENOENT"); }, loadavg: () => [0, 0, 0], cpus: () => 4 }), { ok: true });
});

async function wav(dir, seconds) {
  const path = join(dir, "audio-16k.wav");
  await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=300:duration=${seconds}`, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", path]);
  return path;
}

const FAKE_WHISPER_CLI = (logPath) => `import { writeFileSync, appendFileSync } from "node:fs";
const a = process.argv.slice(2); const arg = (flag) => a[a.indexOf(flag) + 1];
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ l: arg("-l"), t: arg("-t"), bs: arg("-bs"), vad: a.includes("--vad"), m: arg("-m").replace(/^.*[\\\\/]/, "") }) + "\\n");
writeFileSync(arg("-of") + ".json", JSON.stringify({ result: { language: "pt" }, transcription: [{ offsets: { from: 1000, to: 2500 }, text: " olá " }, { offsets: { from: 3000, to: 3200 }, text: "[MÚSICA]" }] }));`;

test("WHISPER.CPP (econômico): áudio em partes, tempos somados, idioma da 1ª parte, modelo baixado UMA vez", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vorix-wcpp-"));
  try {
    const audio = await wav(dir, 25);
    const cli = join(dir, "fake-whisper-cli.mjs");
    const logPath = join(dir, "calls.log");
    await writeFile(cli, FAKE_WHISPER_CLI(logPath));
    const downloads = [];
    const fetchImpl = async (url) => { downloads.push(url.split("/").pop()); return new Response("modelo"); };
    const engine = new WhisperCppTranscriptionEngine({ command: process.execPath, commandArgs: [cli], ffmpegPath, model: "ggml-base-q5_1.bin", modelDir: join(dir, "models"), vadModel: "ggml-silero-v5.1.2.bin", threads: 1, chunkSeconds: 10, fetchImpl });
    const first = await engine.transcribe({ wavPath: audio, timeoutMs: 60_000 });
    assert.deepEqual(first.segments.map((segment) => segment.text), ["olá", "olá", "olá"], "marcações como [MÚSICA] são descartadas");
    // Cada parte começa onde a anterior terminou de fato (o ffmpeg corta PCM em blocos de pacote,
    // ~10,1 s): o deslocamento usa a duração REAL de cada parte, não o valor nominal.
    const starts = first.segments.map((segment) => segment.startMs);
    assert.equal(starts[0], 1000);
    assert.ok(starts[1] >= 11000 && starts[1] <= 11300 && starts[2] >= 21000 && starts[2] <= 21600, String(starts));
    assert.ok(first.segments.every((segment) => segment.endMs - segment.startMs === 1500));
    assert.deepEqual([first.engine, first.model, first.language, Math.round(first.durationSeconds)], ["whisper.cpp", "base-q5_1", "pt", 25]);
    const calls = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(calls.map((call) => call.l), ["auto", "pt", "pt"], "idioma detectado na 1ª parte vale para as demais");
    assert.ok(calls.every((call) => call.t === "1" && call.bs === "1" && call.vad && call.m === "ggml-base-q5_1.bin"));
    await engine.transcribe({ wavPath: audio, timeoutMs: 60_000 });
    assert.deepEqual(downloads.sort(), ["ggml-base-q5_1.bin", "ggml-silero-v5.1.2.bin"], "modelo e VAD baixados uma única vez e reaproveitados");
    assert.deepEqual((await readdir(dir)).filter((name) => name.includes("parts")), [], "partes temporárias apagadas");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FASTER-WHISPER (padrão): parâmetros econômicos; falta de memória vira erro claro e reagendável", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vorix-fw-"));
  try {
    const script = join(dir, "fake_transcribe.mjs");
    await writeFile(script, `import { writeFileSync } from "node:fs";
const a = process.argv.slice(2); const arg = (flag) => a[a.indexOf(flag) + 1];
if (process.env.FAKE_OOM) process.exit(137);
writeFileSync(arg("--output"), JSON.stringify({ language: "pt", duration_seconds: 600, model: arg("--model"), segments: [{ start: 1, end: 2, text: " oi ", avg_logprob: -0.2 }], metrics: { args: a.join(" ") } }));`);
    const engine = new FasterWhisperTranscriptionEngine({ pythonPath: process.execPath, scriptPath: script, model: "small", computeType: "int8", cpuThreads: 1, beamSize: 1, chunkSeconds: 600 });
    const output = await engine.transcribe({ wavPath: join(dir, "audio.wav"), timeoutMs: 30_000 });
    assert.match(output.metrics.args, /--model small --compute-type int8 --threads 1 --beam-size 1 --language auto --chunk-seconds 600/);
    assert.deepEqual(output.segments, [{ startMs: 1000, endMs: 2000, text: "oi", confidence: 0.8187 }]);
    process.env.FAKE_OOM = "1";
    await assert.rejects(engine.transcribe({ wavPath: join(dir, "audio.wav"), timeoutMs: 30_000 }), (error) => error.retryable === true && /falta de memória/.test(error.message));
  } finally {
    delete process.env.FAKE_OOM;
    await rm(dir, { recursive: true, force: true });
  }
});
