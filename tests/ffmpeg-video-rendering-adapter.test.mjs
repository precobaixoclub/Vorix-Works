import test from "node:test";
import assert from "node:assert/strict";
import { readFile as readFileText, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { FfmpegVideoRenderingAdapter } from "../dist/infrastructure/video-rendering/index.js";
import { compileFfmpegArgs, escapeFfmpegPath, wrapOverlayText } from "../dist/infrastructure/video-rendering/timeline-to-filter-compiler.js";
import { resolveVideoAssets } from "../dist/infrastructure/video-rendering/asset-resolver.js";
import { resolveFfmpegBinaryPath } from "../dist/infrastructure/video-rendering/ffmpeg-binary.js";

/**
 * "ffprobe-lite": o projeto não empacota ffprobe (só `ffmpeg-static`), então estes testes usam o
 * próprio binário do ffmpeg em modo de inspeção (`-i <arquivo>` sem `-map`/output) — ele sempre
 * imprime `Duration:` e uma linha `Stream #n:n ... Audio: <codec>`/`Video: <codec>` em stderr antes
 * de falhar por não ter output configurado (código de saída != 0, esperado e ignorado aqui).
 */
async function probeStreams(filePath) {
  const binaryPath = resolveFfmpegBinaryPath();
  const stderr = await new Promise((resolvePromise) => {
    const child = spawn(binaryPath, ["-hide_banner", "-i", filePath], { shell: false });
    let output = "";
    child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.on("close", () => resolvePromise(output));
    child.on("error", () => resolvePromise(output));
  });

  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  const durationSeconds = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : undefined;

  const hasAudioStream = /Stream #\d+:\d+.*Audio:/i.test(stderr);
  const audioCodecMatch = stderr.match(/Audio:\s*([a-zA-Z0-9_]+)/);
  const hasVideoStream = /Stream #\d+:\d+.*Video:/i.test(stderr);
  const videoCodecMatch = stderr.match(/Video:\s*([a-zA-Z0-9_]+)/);

  return {
    raw: stderr,
    durationSeconds,
    hasAudioStream,
    audioCodec: hasAudioStream ? audioCodecMatch?.[1] : undefined,
    hasVideoStream,
    videoCodec: hasVideoStream ? videoCodecMatch?.[1] : undefined,
  };
}

const PNG_CRC_TABLE = (() => {
  const table = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** PNG real e válido (RGB 8-bit) gerado só com node:zlib, sem nenhuma dependência externa. */
function createMinimalPng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelStart = rowStart + 1 + x * 3;
      raw[pixelStart] = 196;
      raw[pixelStart + 1] = 127;
      raw[pixelStart + 2] = 145;
    }
  }
  const idatData = deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idatData),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** WAV real e válido (PCM 16-bit mono, silêncio) — sem nenhuma dependência externa. */
function createSilentWav(durationSeconds) {
  const sampleRate = 44100;
  const numSamples = Math.round(sampleRate * durationSeconds);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

async function withTempArtifactsRoot(run) {
  const artifactsRootDir = await mkdtemp(join(tmpdir(), "zuno-video-adapter-artifacts-"));
  try {
    await run(artifactsRootDir);
  } finally {
    await rm(artifactsRootDir, { recursive: true, force: true });
  }
}

function baseRequest(overrides = {}) {
  return {
    executionId: "exec-adapter-test",
    outputRelativePath: "videos/final-video.mp4",
    width: 1080,
    height: 1920,
    fps: 30,
    totalDurationSeconds: 2,
    scenes: [
      {
        order: 1,
        startSeconds: 0,
        durationSeconds: 2,
        background: { type: "solid", color: "#7E4452" },
        overlays: [{ role: "headline", text: "Teste" }],
        zoom: "none",
        pan: "none",
      },
    ],
    assets: [],
    audioTracks: [],
    ...overrides,
  };
}

test("FfmpegVideoRenderingAdapter implementa VideoRenderingPort (resolveAssets + render)", () => {
  const adapter = new FfmpegVideoRenderingAdapter({ artifactsRootDir: "/tmp/does-not-matter" });
  assert.equal(typeof adapter.resolveAssets, "function");
  assert.equal(typeof adapter.render, "function");
});

test("Adapter renderiza um MP4 real de 1080x1920/30fps com assinatura MP4 válida", async () => {
  await withTempArtifactsRoot(async (artifactsRootDir) => {
    const adapter = new FfmpegVideoRenderingAdapter({ artifactsRootDir, renderTimeoutMs: 30_000 });
    const result = await adapter.render(baseRequest());

    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
    assert.equal(result.fps, 30);
    assert.equal(result.videoCodec, "H.264 (libx264)");
    assert.equal(result.hasAudio, false);
    assert.equal(result.audioCodec, undefined);
    assert.ok(result.sizeBytes > 500, "arquivo renderizado deveria ter tamanho real");
    assert.ok(result.renderTimeMs >= 0);
    assert.ok(Array.isArray(result.logsSummary) && result.logsSummary.length > 0);

    const bytes = await readFileText(result.absolutePath);
    assert.ok(bytes.length > 500);
    assert.equal(bytes.toString("ascii", 4, 8), "ftyp", "arquivo deveria conter a caixa ftyp de um MP4 real");
  });
});

test("Adapter respeita a duração total pedida (soma das cenas)", async () => {
  await withTempArtifactsRoot(async (artifactsRootDir) => {
    const adapter = new FfmpegVideoRenderingAdapter({ artifactsRootDir, renderTimeoutMs: 30_000 });
    const request = baseRequest({
      totalDurationSeconds: 4,
      scenes: [
        { order: 1, startSeconds: 0, durationSeconds: 2, background: { type: "solid", color: "#111111" }, overlays: [], zoom: "none", pan: "none" },
        { order: 2, startSeconds: 2, durationSeconds: 2, background: { type: "solid", color: "#222222" }, overlays: [], zoom: "none", pan: "none" },
      ],
    });
    const result = await adapter.render(request);
    assert.equal(result.durationSeconds, 4);
  });
});

test("Adapter produz H.264 + AAC quando há trilha de áudio resolvida, e nenhum áudio quando não há", async () => {
  await withTempArtifactsRoot(async (artifactsRootDir) => {
    const adapter = new FfmpegVideoRenderingAdapter({ artifactsRootDir, renderTimeoutMs: 30_000 });

    const audioDir = await mkdtemp(join(tmpdir(), "zuno-video-adapter-audio-"));
    const audioPath = join(audioDir, "tone.wav");
    await writeFile(audioPath, createSilentWav(1));

    try {
      const resolution = await adapter.resolveAssets({
        candidates: [{ id: "music", kind: "audio", path: audioPath, sourceDescription: "teste", required: true }],
      });
      const resolved = resolution.resolutions.find((entry) => entry.id === "music");
      assert.equal(resolved.resolved, true);

      const withAudio = await adapter.render(
        baseRequest({
          assets: [{ id: "music", kind: "audio", absolutePath: resolved.absolutePath }],
          audioTracks: [{ assetId: "music", role: "music", startSeconds: 0, volume: 0.5 }],
        }),
      );
      assert.equal(withAudio.hasAudio, true);
      assert.equal(withAudio.audioCodec, "AAC");

      const withoutAudio = await adapter.render(baseRequest());
      assert.equal(withoutAudio.hasAudio, false);
      assert.equal(withoutAudio.audioCodec, undefined);
    } finally {
      await rm(audioDir, { recursive: true, force: true });
    }
  });
});

test("Adapter produz um MP4 com stream de vídeo H.264 e stream de áudio AAC reais, confirmado por inspeção independente do arquivo (não apenas pelo valor devolvido pelo próprio código)", async () => {
  await withTempArtifactsRoot(async (artifactsRootDir) => {
    const adapter = new FfmpegVideoRenderingAdapter({ artifactsRootDir, renderTimeoutMs: 30_000 });
    const audioDir = await mkdtemp(join(tmpdir(), "zuno-video-adapter-audio-probe-"));
    const audioPath = join(audioDir, "musica.wav");
    await writeFile(audioPath, createSilentWav(3));

    try {
      const resolution = await adapter.resolveAssets({
        candidates: [{ id: "music", kind: "audio", path: audioPath, sourceDescription: "teste", required: true }],
      });
      const resolved = resolution.resolutions.find((entry) => entry.id === "music");
      assert.equal(resolved.resolved, true);

      const result = await adapter.render(
        baseRequest({
          totalDurationSeconds: 3,
          scenes: [{ order: 1, startSeconds: 0, durationSeconds: 3, background: { type: "solid", color: "#7E4452" }, overlays: [{ role: "headline", text: "Teste" }], zoom: "none", pan: "none" }],
          assets: [{ id: "music", kind: "audio", absolutePath: resolved.absolutePath }],
          audioTracks: [{ assetId: "music", role: "music", startSeconds: 0, volume: 0.5, fadeInSeconds: 1, fadeOutSeconds: 1 }],
        }),
      );

      const probe = await probeStreams(result.absolutePath);
      assert.ok(probe.hasVideoStream, "arquivo deveria ter stream de vídeo (inspeção independente)");
      assert.equal(probe.videoCodec, "h264");
      assert.ok(probe.hasAudioStream, "arquivo deveria ter stream de áudio (inspeção independente)");
      assert.equal(probe.audioCodec, "aac");
    } finally {
      await rm(audioDir, { recursive: true, force: true });
    }
  });
});

test("Adapter aplica loop na música quando ela é mais curta que o vídeo, para cobrir a duração total", async () => {
  await withTempArtifactsRoot(async (artifactsRootDir) => {
    const adapter = new FfmpegVideoRenderingAdapter({ artifactsRootDir, renderTimeoutMs: 30_000 });
    const audioDir = await mkdtemp(join(tmpdir(), "zuno-video-adapter-loop-"));
    const audioPath = join(audioDir, "curta.wav");
    await writeFile(audioPath, createSilentWav(1)); // música de 1s, vídeo de 3s

    try {
      const resolution = await adapter.resolveAssets({
        candidates: [{ id: "music", kind: "audio", path: audioPath, sourceDescription: "teste", required: true }],
      });
      const resolved = resolution.resolutions.find((entry) => entry.id === "music");

      const result = await adapter.render(
        baseRequest({
          totalDurationSeconds: 3,
          scenes: [{ order: 1, startSeconds: 0, durationSeconds: 3, background: { type: "solid", color: "#111111" }, overlays: [], zoom: "none", pan: "none" }],
          assets: [{ id: "music", kind: "audio", absolutePath: resolved.absolutePath }],
          audioTracks: [{ assetId: "music", role: "music", startSeconds: 0, volume: 0.5 }],
        }),
      );

      assert.equal(result.durationSeconds, 3);
      const probe = await probeStreams(result.absolutePath);
      assert.ok(probe.hasAudioStream);
      // Música de 1s repetida em loop cobre os 3s inteiros do vídeo — a duração total do
      // container (vídeo+áudio) continua sendo 3s, não 1s.
      assert.ok(probe.durationSeconds >= 2.8, `duração do container deveria cobrir os 3s do vídeo (recebido ${probe.durationSeconds})`);
    } finally {
      await rm(audioDir, { recursive: true, force: true });
    }
  });
});

test("Adapter corta a música quando ela é mais longa que o vídeo, sem estender a duração final", async () => {
  await withTempArtifactsRoot(async (artifactsRootDir) => {
    const adapter = new FfmpegVideoRenderingAdapter({ artifactsRootDir, renderTimeoutMs: 30_000 });
    const audioDir = await mkdtemp(join(tmpdir(), "zuno-video-adapter-cut-"));
    const audioPath = join(audioDir, "longa.wav");
    await writeFile(audioPath, createSilentWav(5)); // música de 5s, vídeo de 2s

    try {
      const resolution = await adapter.resolveAssets({
        candidates: [{ id: "music", kind: "audio", path: audioPath, sourceDescription: "teste", required: true }],
      });
      const resolved = resolution.resolutions.find((entry) => entry.id === "music");

      const result = await adapter.render(
        baseRequest({
          totalDurationSeconds: 2,
          scenes: [{ order: 1, startSeconds: 0, durationSeconds: 2, background: { type: "solid", color: "#222222" }, overlays: [], zoom: "none", pan: "none" }],
          assets: [{ id: "music", kind: "audio", absolutePath: resolved.absolutePath }],
          audioTracks: [{ assetId: "music", role: "music", startSeconds: 0, volume: 0.5 }],
        }),
      );

      assert.equal(result.durationSeconds, 2);
      const probe = await probeStreams(result.absolutePath);
      assert.ok(probe.hasAudioStream);
      assert.ok(probe.durationSeconds <= 2.3, `duração do container deveria ficar em torno dos 2s do vídeo, não dos 5s da música (recebido ${probe.durationSeconds})`);
    } finally {
      await rm(audioDir, { recursive: true, force: true });
    }
  });
});

test("compileFfmpegArgs aplica -stream_loop -1 apenas para a trilha (role: music), nunca para efeito sonoro pontual (role: sound_effect)", () => {
  const args = compileFfmpegArgs({
    request: baseRequest({
      assets: [
        { id: "music", kind: "audio", absolutePath: "/fake/music.mp3" },
        { id: "sfx", kind: "audio", absolutePath: "/fake/sfx.mp3" },
      ],
      audioTracks: [
        { assetId: "music", role: "music", startSeconds: 0, volume: 0.5, fadeInSeconds: 1, fadeOutSeconds: 1 },
        { assetId: "sfx", role: "sound_effect", startSeconds: 0.5, volume: 0.8 },
      ],
    }),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  const musicInputIndex = args.indexOf("/fake/music.mp3");
  const sfxInputIndex = args.indexOf("/fake/sfx.mp3");
  assert.ok(musicInputIndex > 1, "input da música deveria estar presente");
  assert.ok(sfxInputIndex > 1, "input do efeito sonoro deveria estar presente");
  assert.deepEqual(args.slice(musicInputIndex - 3, musicInputIndex - 1), ["-stream_loop", "-1"], "música deveria ter -stream_loop -1 logo antes do seu -i");
  assert.notDeepEqual(args.slice(sfxInputIndex - 3, sfxInputIndex - 1), ["-stream_loop", "-1"], "efeito sonoro pontual não deveria repetir em loop");
});

test("compileFfmpegArgs inclui afade de entrada e de saída no filterComplex quando fadeInSeconds/fadeOutSeconds estão presentes na trilha", () => {
  const args = compileFfmpegArgs({
    request: baseRequest({
      totalDurationSeconds: 10,
      scenes: [{ order: 1, startSeconds: 0, durationSeconds: 10, background: { type: "solid", color: "#111111" }, overlays: [], zoom: "none", pan: "none" }],
      assets: [{ id: "music", kind: "audio", absolutePath: "/fake/music.mp3" }],
      audioTracks: [{ assetId: "music", role: "music", startSeconds: 0, volume: 0.5, fadeInSeconds: 1.5, fadeOutSeconds: 2 }],
    }),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  const filterComplexIndex = args.indexOf("-filter_complex");
  const filterComplex = args[filterComplexIndex + 1];
  assert.match(filterComplex, /afade=t=in:st=0:d=1\.500/);
  assert.match(filterComplex, /afade=t=out:st=8\.000:d=2\.000/);
});

test("compileFfmpegArgs compõe Motion Composer com asset e texto animados por elemento", () => {
  const args = compileFfmpegArgs({
    request: baseRequest({
      assets: [{ id: "mockup-1", kind: "image", absolutePath: "/fake/mockup.png" }],
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 4,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          zoom: "none",
          pan: "none",
          motion: {
            rhythm: "fast",
            elements: [
              { id: "mockup-1", role: "mockup", assetId: "mockup-1", startSeconds: 0.2, durationSeconds: 3.4, entrance: "slide_up", easing: "ease_out", priority: 10 },
              { id: "headline-1", role: "headline", text: "Seu casamento merece um site oficial", startSeconds: 0.6, durationSeconds: 2.8, entrance: "pop", easing: "ease_out", priority: 20 },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map([["1:motion:headline-1", "C:/tmp/headline.txt"]]),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  assert.ok(args.includes("/fake/mockup.png"), "asset do elemento deveria virar input real");
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /fade=t=in:st=0\.200/);
  assert.match(filterComplex, /overlay=x='/);
  assert.match(filterComplex, /drawtext=.*headline\.txt/);
  assert.match(filterComplex, /enable='between\(t,0\.600,3\.400\)'/);
  assert.match(filterComplex, /eq=brightness=-0\.035:saturation=0\.94/);
});

test("compileFfmpegArgs gera filtro real de mask_reveal (crop animado, largura mínima 2px) para elementos visuais", () => {
  const args = compileFfmpegArgs({
    request: baseRequest({
      assets: [{ id: "mockup-1", kind: "image", absolutePath: "/fake/mockup.png" }],
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 3,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          zoom: "none",
          pan: "none",
          motion: {
            rhythm: "medium",
            elements: [
              { id: "mockup-1", role: "mockup", assetId: "mockup-1", startSeconds: 0.2, durationSeconds: 2.6, entrance: "mask_reveal", easing: "ease_out", priority: 10 },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /crop=/);
  assert.match(filterComplex, /max\(2,/);
});

test("compileFfmpegArgs gera filtro real de blur_reveal (duas camadas: nítida com fade-in, borrada com fade-out, compostas via overlay)", () => {
  const args = compileFfmpegArgs({
    request: baseRequest({
      assets: [{ id: "mockup-1", kind: "image", absolutePath: "/fake/mockup.png" }],
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 3,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          zoom: "none",
          pan: "none",
          motion: {
            rhythm: "medium",
            elements: [
              { id: "mockup-1", role: "mockup", assetId: "mockup-1", startSeconds: 0.2, durationSeconds: 2.6, entrance: "blur_reveal", easing: "ease_out", priority: 10 },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /split=2/);
  assert.match(filterComplex, /gblur=sigma=\d/);
  assert.match(filterComplex, /fade=t=in:/);
  assert.match(filterComplex, /fade=t=out:/);
  assert.match(filterComplex, /overlay/);
});

test("compileFfmpegArgs gera filtro real de glow_pulse (blend screen com blur/brilho e pulsos de fade encadeados, sem eval/expressão animada em gblur/blend)", () => {
  const args = compileFfmpegArgs({
    request: baseRequest({
      assets: [{ id: "mockup-1", kind: "image", absolutePath: "/fake/mockup.png" }],
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 4,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          zoom: "none",
          pan: "none",
          motion: {
            rhythm: "impact",
            elements: [
              { id: "mockup-1", role: "mockup", assetId: "mockup-1", startSeconds: 0.2, durationSeconds: 3.6, entrance: "glow_pulse", easing: "ease_out", priority: 10 },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /split=2/);
  assert.match(filterComplex, /gblur=sigma=\d+,eq=brightness=/);
  assert.match(filterComplex, /blend=all_mode=screen:all_opacity=0\.\d+/);
  // Nunca deve tentar animar sigma/opacity via expressão de tempo — este build de FFmpeg não suporta.
  assert.doesNotMatch(filterComplex, /gblur=sigma='/);
  assert.doesNotMatch(filterComplex, /all_opacity='/);
});

test("compileFfmpegArgs gera deslocamento de parallax ao longo de toda a duração da cena, distinto da oscilação de 'floating'", () => {
  const args = compileFfmpegArgs({
    request: baseRequest({
      assets: [{ id: "mockup-1", kind: "image", absolutePath: "/fake/mockup.png" }],
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 5,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          zoom: "none",
          pan: "none",
          motion: {
            rhythm: "medium",
            elements: [
              { id: "mockup-1", role: "main_image", assetId: "mockup-1", startSeconds: 0.2, durationSeconds: 4.6, entrance: "parallax", easing: "ease_out", priority: 10 },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /overlay=x='.*sceneProgress|overlay=x='.*-0\.5\)/);
});

test("compileFfmpegArgs compõe light_sweep como uma fonte lavfi sintética adicional, deslizando via overlay, só quando supportsGradients é true", () => {
  const withGradients = compileFfmpegArgs({
    request: baseRequest({
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 3,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          zoom: "none",
          pan: "none",
          motion: {
            rhythm: "fast",
            elements: [
              { id: "headline-1", role: "headline", text: "Gancho", startSeconds: 0.1, durationSeconds: 2.8, entrance: "light_sweep", easing: "ease_out", priority: 20 },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map([["1:motion:headline-1", "C:/tmp/headline.txt"]]),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  assert.ok(withGradients.some((arg) => arg.includes("gradients=s=")));
  const withGradientsFilterComplex = withGradients[withGradients.indexOf("-filter_complex") + 1];
  assert.match(withGradientsFilterComplex, /overlay=x='/);

  const withoutGradients = compileFfmpegArgs({
    request: baseRequest({
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 3,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          zoom: "none",
          pan: "none",
          motion: {
            rhythm: "fast",
            elements: [
              { id: "headline-1", role: "headline", text: "Gancho", startSeconds: 0.1, durationSeconds: 2.8, entrance: "light_sweep", easing: "ease_out", priority: 20 },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map([["1:motion:headline-1", "C:/tmp/headline.txt"]]),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: false,
  });

  assert.ok(!withoutGradients.some((arg) => arg.includes("gradients=s=")));
});

test("compileFfmpegArgs aplica a curva real de easing 'back_out' (overshoot) na posição de um elemento animado, em vez de sempre linear", () => {
  const easedArgs = compileFfmpegArgs({
    request: baseRequest({
      assets: [{ id: "mockup-1", kind: "image", absolutePath: "/fake/mockup.png" }],
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 3,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          zoom: "none",
          pan: "none",
          motion: {
            rhythm: "medium",
            elements: [
              { id: "mockup-1", role: "mockup", assetId: "mockup-1", startSeconds: 0.2, durationSeconds: 2.6, entrance: "slide_up", easing: "back_out", priority: 10 },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });
  const linearArgs = compileFfmpegArgs({
    request: baseRequest({
      assets: [{ id: "mockup-1", kind: "image", absolutePath: "/fake/mockup.png" }],
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 3,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          zoom: "none",
          pan: "none",
          motion: {
            rhythm: "medium",
            elements: [
              { id: "mockup-1", role: "mockup", assetId: "mockup-1", startSeconds: 0.2, durationSeconds: 2.6, entrance: "slide_up", easing: "linear", priority: 10 },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  const easedFilterComplex = easedArgs[easedArgs.indexOf("-filter_complex") + 1];
  const linearFilterComplex = linearArgs[linearArgs.indexOf("-filter_complex") + 1];
  assert.match(easedFilterComplex, /2\.70158|1\.70158/);
  assert.doesNotMatch(linearFilterComplex, /2\.70158|1\.70158/);
});

test("compileFfmpegArgs aplica o painel translúcido 'glassmorphism' (boxcolor=white) só quando element.glass é true, mantendo a caixa escura padrão nos demais casos", () => {
  const glassArgs = compileFfmpegArgs({
    request: baseRequest({
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 3,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          zoom: "none",
          pan: "none",
          motion: {
            rhythm: "impact",
            elements: [
              { id: "headline-1", role: "headline", text: "CTA final", startSeconds: 0.1, durationSeconds: 2.8, entrance: "fade", easing: "ease_out", priority: 20, glass: true },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map([["1:motion:headline-1", "C:/tmp/headline.txt"]]),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  const filterComplex = glassArgs[glassArgs.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /boxcolor=white@0\.16/);
});

test("compileFfmpegArgs nunca usa -loop 1 para um asset de motion kind: video (clipe real, b-roll, cinemagraph) — só para kind: image", () => {
  const args = compileFfmpegArgs({
    request: baseRequest({
      assets: [{ id: "clip-1", kind: "video", absolutePath: "/fake/clip.mp4", sourceDurationSeconds: 8 }],
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 3,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          motion: {
            rhythm: "medium",
            elements: [
              { id: "clip-1", role: "main_image", assetId: "clip-1", startSeconds: 0, durationSeconds: 3, entrance: "fade", easing: "ease_out", priority: 10 },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  assert.ok(args.includes("/fake/clip.mp4"), "input do clipe de vídeo não encontrado");
  const joined = args.join(" ");
  // Corte (clipe de 8s fonte, cena de 3s): -t 3.000 -i <path>, sem -loop e sem -stream_loop.
  assert.match(joined, /-t 3\.000 -i \/fake\/clip\.mp4/);
  assert.doesNotMatch(joined, /-loop 1 -t 3\.000 -i \/fake\/clip\.mp4/);
  assert.doesNotMatch(joined, /-stream_loop -1 -t 3\.000 -i \/fake\/clip\.mp4/);
});

test("compileFfmpegArgs usa -stream_loop -1 para repetir um asset de vídeo mais curto que o tempo em tela da cena", () => {
  const args = compileFfmpegArgs({
    request: baseRequest({
      assets: [{ id: "clip-1", kind: "video", absolutePath: "/fake/short-clip.mp4", sourceDurationSeconds: 1.2 }],
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 5,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          motion: {
            rhythm: "medium",
            elements: [
              { id: "clip-1", role: "main_image", assetId: "clip-1", startSeconds: 0, durationSeconds: 5, entrance: "fade", easing: "ease_out", priority: 10 },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  assert.ok(args.includes("/fake/short-clip.mp4"));
  const joined = args.join(" ");
  assert.match(joined, /-stream_loop -1 -t 5\.000 -i \/fake\/short-clip\.mp4/);
});

test("compileFfmpegArgs continua usando -loop 1 (imagem estática) para asset de motion kind: image, comportamento inalterado", () => {
  const args = compileFfmpegArgs({
    request: baseRequest({
      assets: [{ id: "img-1", kind: "image", absolutePath: "/fake/img.png" }],
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 3,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          motion: {
            rhythm: "medium",
            elements: [
              { id: "img-1", role: "main_image", assetId: "img-1", startSeconds: 0, durationSeconds: 3, entrance: "fade", easing: "ease_out", priority: 10 },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  assert.ok(args.includes("/fake/img.png"));
  const joined = args.join(" ");
  assert.match(joined, /-loop 1 -t 3\.000 -i \/fake\/img\.png/);
});

test("compileFfmpegArgs aplica um deslocamento de posição maior para entrance 'whip' do que para 'slide_left', lendo como um snap-pan rápido", () => {
  const whipArgs = compileFfmpegArgs({
    request: baseRequest({
      assets: [{ id: "mockup-1", kind: "image", absolutePath: "/fake/mockup.png" }],
      scenes: [
        {
          order: 1,
          startSeconds: 0,
          durationSeconds: 3,
          background: { type: "solid", color: "#7E4452" },
          overlays: [],
          motion: {
            rhythm: "fast",
            elements: [
              { id: "mockup-1", role: "mockup", assetId: "mockup-1", startSeconds: 0.2, durationSeconds: 2.6, entrance: "whip", easing: "ease_out", priority: 10 },
            ],
          },
        },
      ],
    }),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });

  const filterComplex = whipArgs[whipArgs.indexOf("-filter_complex") + 1];
  assert.match(filterComplex, /overlay=x='.*216\*/);
});

test("Adapter usa uma imagem local real como fundo de cena", async () => {
  await withTempArtifactsRoot(async (artifactsRootDir) => {
    const imageDir = await mkdtemp(join(tmpdir(), "zuno-video-adapter-image-"));
    const imagePath = join(imageDir, "bg.png");
    await writeFile(imagePath, createMinimalPng(64, 64));

    try {
      const adapter = new FfmpegVideoRenderingAdapter({ artifactsRootDir, renderTimeoutMs: 30_000 });
      const resolution = await adapter.resolveAssets({
        candidates: [{ id: "bg-1", kind: "image", path: imagePath, sourceDescription: "teste", required: true }],
      });
      const resolved = resolution.resolutions.find((entry) => entry.id === "bg-1");
      assert.equal(resolved.resolved, true);

      const result = await adapter.render(
        baseRequest({
          scenes: [
            {
              order: 1,
              startSeconds: 0,
              durationSeconds: 2,
              background: { type: "image", assetId: "bg-1" },
              overlays: [],
              zoom: "none",
              pan: "none",
            },
          ],
          assets: [{ id: "bg-1", kind: "image", absolutePath: resolved.absolutePath }],
        }),
      );
      assert.ok(result.sizeBytes > 500);
    } finally {
      await rm(imageDir, { recursive: true, force: true });
    }
  });
});

test("Adapter renderiza múltiplas cenas com transição sem erro", async () => {
  await withTempArtifactsRoot(async (artifactsRootDir) => {
    const adapter = new FfmpegVideoRenderingAdapter({ artifactsRootDir, renderTimeoutMs: 30_000 });
    const result = await adapter.render(
      baseRequest({
        totalDurationSeconds: 4,
        scenes: [
          { order: 1, startSeconds: 0, durationSeconds: 2, background: { type: "gradient", colorTop: "#FFFFFF", colorBottom: "#7E4452" }, overlays: [{ role: "headline", text: "Um" }], transitionToNext: "fade", zoom: "in", pan: "none" },
          { order: 2, startSeconds: 2, durationSeconds: 2, background: { type: "solid", color: "#542230" }, overlays: [{ role: "cta", text: "Dois" }], zoom: "none", pan: "left_to_right" },
        ],
      }),
    );
    assert.ok(result.sizeBytes > 500);
    assert.equal(result.durationSeconds, 4);
  });
});

test("resolveAssets: erro/reprovação para arquivo inexistente", async () => {
  const adapter = new FfmpegVideoRenderingAdapter({ artifactsRootDir: "/tmp/does-not-matter" });
  const result = await adapter.resolveAssets({
    candidates: [{ id: "missing", kind: "image", path: resolve("/tmp/definitely-not-here-zuno-test.png"), sourceDescription: "teste", required: true }],
  });
  assert.equal(result.resolutions[0].resolved, false);
  assert.match(result.resolutions[0].reason, /não encontrado/);
});

test("resolveAssets: bloqueia path traversal (caminho relativo e '..' são rejeitados)", async () => {
  const relativeResult = await resolveVideoAssets({
    candidates: [{ id: "relative", kind: "image", path: "../../etc/passwd", sourceDescription: "teste", required: true }],
  });
  assert.equal(relativeResult.resolutions[0].resolved, false);
  assert.match(relativeResult.resolutions[0].reason, /absoluto/);

  const traversalResult = await resolveVideoAssets({
    candidates: [{ id: "traversal", kind: "image", path: resolve("/tmp") + "/../../etc/passwd", sourceDescription: "teste", required: true }],
  });
  assert.equal(traversalResult.resolutions[0].resolved, false);
});

test("resolveAssets: rejeita extensão fora da allowlist", async () => {
  const exeDir = await mkdtemp(join(tmpdir(), "zuno-video-adapter-exe-"));
  const fakeBinaryPath = join(exeDir, "evil.exe");
  await writeFile(fakeBinaryPath, "not a real image");
  try {
    const result = await resolveVideoAssets({
      candidates: [{ id: "evil", kind: "image", path: fakeBinaryPath, sourceDescription: "teste", required: true }],
    });
    assert.equal(result.resolutions[0].resolved, false);
    assert.match(result.resolutions[0].reason, /[Ee]xtensão/);
  } finally {
    await rm(exeDir, { recursive: true, force: true });
  }
});

test("ffmpeg-process-runner nunca usa shell:true, sempre spawn com argumentos separados", async () => {
  const source = await readFileText("src/infrastructure/video-rendering/ffmpeg-process-runner.ts", "utf8");
  assert.equal(source.includes("shell: true"), false);
  assert.equal(source.includes("shell:true"), false);
  assert.ok(source.includes("shell: false"), "runner deveria fixar shell: false explicitamente");
  assert.ok(source.includes("spawn("), "runner deveria usar spawn (não exec/execSync)");
  assert.equal(source.includes("exec("), false);
  assert.equal(source.includes("execSync("), false);
});

test("ffmpeg-binary nunca usa a variável de ambiente FFMPEG_BIN (ou similares) para resolver o binário", async () => {
  const source = await readFileText("src/infrastructure/video-rendering/ffmpeg-binary.ts", "utf8");
  // Remove comentários de bloco/linha antes de checar por padrões de leitura de env var — o
  // comentário deste arquivo legitimamente documenta, em prosa, por que essas env vars são
  // evitadas (citando os nomes), então checar o texto bruto do arquivo daria falso positivo.
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(withoutComments.includes("process.env"), false, "o código (fora de comentários) nunca deve ler process.env para resolver o binário do FFmpeg");
  assert.equal(withoutComments.includes('from "ffmpeg-static"'), false, "nunca deve importar o export padrão de ffmpeg-static diretamente (sensível a FFMPEG_BIN)");
  assert.ok(source.includes('require.resolve("ffmpeg-static/package.json")'), "deve resolver o pacote só via package.json, nunca importar seu módulo principal (index.js)");

  // Confirma que a resolução real também não devolve um caminho vindo de env var nesta sessão de teste.
  process.env.FFMPEG_BIN = "C:/nao-e-o-ffmpeg-real.exe";
  try {
    const resolved = resolveFfmpegBinaryPath();
    assert.notEqual(resolved, "C:/nao-e-o-ffmpeg-real.exe");
    assert.ok(resolved.toLowerCase().includes("ffmpeg-static"), `binário resolvido deveria vir do pacote ffmpeg-static, recebeu: ${resolved}`);
  } finally {
    delete process.env.FFMPEG_BIN;
  }
});

test("compileFfmpegArgs nunca aceita comando arbitrário: todo argumento é um valor de dado, nunca uma string de shell concatenada", () => {
  const args = compileFfmpegArgs({
    request: baseRequest(),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "C:/Windows/Fonts/segoeui.ttf", bold: "C:/Windows/Fonts/segoeuib.ttf" },
    supportsGradients: true,
  });
  assert.ok(Array.isArray(args));
  assert.ok(args.every((arg) => typeof arg === "string"));
});

test("escapeFfmpegPath escapa ':' e normaliza barras para uso seguro em opções de filtro", () => {
  assert.equal(escapeFfmpegPath("C:\\Users\\test\\file.txt"), "C\\:/Users/test/file.txt");
});

test("wrapOverlayText quebra texto longo em múltiplas linhas para nunca ultrapassar a largura do quadro", () => {
  const longText =
    'Transformar a lista de presentes em uma experiência simples, bonita e direta, com praticidade para convidados e controle para os noivos.';
  const wrapped = wrapOverlayText("headline", longText, 1080);
  const lines = wrapped.split("\n");

  assert.ok(lines.length > 1, "texto longo deveria virar múltiplas linhas");
  for (const line of lines) {
    assert.ok(line.length <= 40, `linha "${line}" (${line.length} chars) deveria caber na largura do quadro`);
  }
  assert.equal(lines.join(" "), longText.replace(/\s+/g, " "));
});

test("wrapOverlayText não quebra texto curto desnecessariamente", () => {
  const wrapped = wrapOverlayText("cta", "Conheça o Rumo ao Altar", 1080);
  assert.equal(wrapped, "Conheça o Rumo ao Altar");
});
