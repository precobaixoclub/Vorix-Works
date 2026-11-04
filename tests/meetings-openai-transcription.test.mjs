// Transcrição de reuniões pela OpenAI: o servidor só corta o áudio (ffmpeg) e envia as partes; os
// tempos de cada parte são somados para o player continuar sincronizado. Sem rede: fetch falso.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

import { OpenAiTranscriptionEngine } from "../dist/infrastructure/meetings/openai-transcription-engine.js";

const run = promisify(execFile);

async function wav(seconds) {
  const dir = await mkdtemp(join(tmpdir(), "vorix-openai-transcription-"));
  const path = join(dir, "audio.wav");
  await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-ac", "1", "-ar", "16000", path]);
  return { dir, path };
}

function fakeOpenAi(respond) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const form = init.body;
    const file = form.get("file");
    calls.push({ url, auth: init.headers.authorization, model: form.get("model"), format: form.get("response_format"), language: form.get("language"), bytes: file.size, type: file.type });
    return respond(calls.length - 1);
  };
  return { calls, fetchImpl };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("OPENAI: corta em partes, envia cada uma e soma os tempos para manter o player sincronizado", async () => {
  const audio = await wav(25);
  try {
    const { calls, fetchImpl } = fakeOpenAi((index) => json({ language: "portuguese", duration: index < 2 ? 10 : 5, segments: [{ start: 1, end: 3.5, text: ` parte ${index + 1} `, avg_logprob: -0.1 }, { start: 4, end: 4.2, text: "   " }] }));
    const engine = new OpenAiTranscriptionEngine({ ffmpegPath, getApiKey: async () => "sk-teste", chunkSeconds: 10, fetchImpl });
    const result = await engine.transcribe({ wavPath: audio.path, language: "pt", timeoutMs: 60_000 });

    assert.equal(calls.length, 3, "25 s em partes de 10 s");
    for (const call of calls) {
      assert.equal(call.url, "https://api.openai.com/v1/audio/transcriptions");
      assert.equal(call.auth, "Bearer sk-teste");
      assert.deepEqual([call.model, call.format, call.language, call.type], ["whisper-1", "verbose_json", "pt", "audio/mpeg"]);
      assert.ok(call.bytes > 0 && call.bytes < 100_000, "parte comprimida (MP3 32 kbit/s), não o WAV");
    }
    assert.deepEqual(result.segments.map(({ startMs, endMs, text }) => [startMs, endMs, text]), [[1000, 3500, "parte 1"], [11000, 13500, "parte 2"], [21000, 23500, "parte 3"]]);
    assert.equal(result.segments[0].confidence, 0.9048);
    assert.deepEqual([result.engine, result.model, result.language, result.durationSeconds], ["openai", "whisper-1", "pt", 25]);
    assert.equal(result.metrics.chunks, 3);
    assert.equal(result.metrics.estimated_cost_usd, 0.0025);
    assert.deepEqual((await readdir(audio.dir)).sort(), ["audio.wav"], "partes temporárias apagadas");
  } finally {
    await rm(audio.dir, { recursive: true, force: true });
  }
});

test("OPENAI (opcional): sem chave não chama a API nem repete; chave recusada e instabilidade viram erros claros", async () => {
  const audio = await wav(3);
  try {
    const noKey = new OpenAiTranscriptionEngine({ ffmpegPath, getApiKey: async () => undefined, fetchImpl: async () => assert.fail("não chama a API sem chave") });
    await assert.rejects(noKey.transcribe({ wavPath: audio.path, timeoutMs: 30_000 }), (error) => error.retryable === false && /não há chave cadastrada/.test(error.message));

    const refused = new OpenAiTranscriptionEngine({ ffmpegPath, getApiKey: async () => "sk-errada", fetchImpl: async () => json({ error: { message: "invalid key" } }, 401) });
    await assert.rejects(refused.transcribe({ wavPath: audio.path, timeoutMs: 30_000 }), (error) => error.retryable === false && /recusada/.test(error.message));

    const busy = new OpenAiTranscriptionEngine({ ffmpegPath, getApiKey: async () => "sk-teste", fetchImpl: async () => json({ error: { message: "rate limit" } }, 429) });
    await assert.rejects(busy.transcribe({ wavPath: audio.path, timeoutMs: 30_000 }), (error) => error.retryable === true && /HTTP 429/.test(error.message));

    const offline = new OpenAiTranscriptionEngine({ ffmpegPath, getApiKey: async () => "sk-teste", fetchImpl: async () => { throw new TypeError("fetch failed"); } });
    await assert.rejects(offline.transcribe({ wavPath: audio.path, timeoutMs: 30_000 }), (error) => error.retryable === true && /conexão/.test(error.message));
  } finally {
    await rm(audio.dir, { recursive: true, force: true });
  }
});
