import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

const execFileAsync = promisify(execFile);
const CLI_ENTRYPOINT = resolve("dist/interfaces/cli/index.js");

async function withTempCliEnv(run) {
  const dataDir = await mkdtemp(join(tmpdir(), "zuno-cli-data-"));
  const artifactsDir = await mkdtemp(join(tmpdir(), "zuno-cli-artifacts-"));
  try {
    // ZUNO_ICARO_MODE=fake: este arquivo testa o comportamento geral da CLI (aprovação humana,
    // geração assistida de imagem/vídeo, publicação, etc.), não o conteúdo de texto em si — por
    // isso fixa o `DeterministicFakeIcaroProvider` explicitamente (uso "testes automatizados",
    // exatamente o caso previsto). O comportamento do Developer Assisted Mode para texto (modo
    // padrão real da CLI) tem sua própria suíte dedicada em `tests/developer-assisted-icaro.test.mjs`.
    await run({
      dataDir,
      artifactsDir,
      env: { ...process.env, ZUNO_DATA_DIR: dataDir, ZUNO_ARTIFACTS_DIR: artifactsDir, ZUNO_ICARO_MODE: "fake" },
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(artifactsDir, { recursive: true, force: true });
  }
}

function extractExecutionId(stdout) {
  const match = stdout.match(/Execução (\S+) —/);
  assert.ok(match, `stdout deveria conter o id da execução: ${stdout}`);
  return match[1];
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
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ byte) & 0xff];
  }
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

/** PNG real e válido (RGB 8-bit), só com node:zlib — usado para simular a IA desenvolvedora salvando a imagem pedida pelo Developer Assisted Mode. */
function createMinimalPng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const ihdr = pngChunk("IHDR", ihdrData);
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  const idat = pngChunk("IDAT", deflateSync(raw));
  const iend = pngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function extractAssistedImagePaths(stdout) {
  const matches = [...stdout.matchAll(/Caminho: (\S+)/g)];
  assert.ok(matches.length > 0, `stdout deveria listar ao menos um caminho de imagem esperado: ${stdout}`);
  return matches.map((match) => match[1]);
}

function extractAssistedVideoPaths(stdout) {
  const matches = [...stdout.matchAll(/Caminho: (\S+)/g)].filter((match) => match[1].includes("videos/"));
  assert.ok(matches.length > 0, `stdout deveria listar ao menos um caminho de vídeo esperado: ${stdout}`);
  return matches.map((match) => match[1]);
}

function extractAssistedNarrationPaths(stdout) {
  const matches = [...stdout.matchAll(/Caminho: (\S+)/g)].filter((match) => match[1].includes("audio/narration"));
  assert.ok(matches.length > 0, `stdout deveria listar o caminho da narração esperada: ${stdout}`);
  return matches.map((match) => match[1]);
}

function extractResolution(stdout) {
  const match = stdout.match(/Resolução: (\d+)x(\d+)/);
  assert.ok(match, `stdout deveria informar a resolução esperada: ${stdout}`);
  return [Number(match[1]), Number(match[2])];
}

async function fulfillAssistedImages(artifactsDir, executionId, relativePaths, width, height) {
  for (const relativePath of relativePaths) {
    const absolutePath = join(artifactsDir, executionId, relativePath);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, createMinimalPng(width, height));
  }
}

function createMinimalMp4(sizeBytes = 150 * 1024) {
  const buffer = Buffer.alloc(sizeBytes, 0);
  buffer.writeUInt32BE(sizeBytes, 0);
  buffer.write("ftyp", 4, "ascii");
  buffer.write("isom", 8, "ascii");
  return buffer;
}

async function fulfillAssistedVideos(artifactsDir, executionId, relativePaths) {
  for (const relativePath of relativePaths) {
    const absolutePath = join(artifactsDir, executionId, relativePath);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, createMinimalMp4());
  }
}

function createValidWav(durationSeconds = 6, sampleRate = 44100) {
  const samples = Math.floor(durationSeconds * sampleRate);
  const dataSize = samples * 2;
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
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 220) * 6000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}

async function fulfillAssistedNarrations(artifactsDir, executionId, relativePaths) {
  for (const relativePath of relativePaths) {
    const absolutePath = join(artifactsDir, executionId, relativePath);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, createValidWav());
  }
}

test("CLI: LOCAL_PRODUCTION é padrão, usa Developer Assisted Mode e Ana retorna local_ready sem publicar", async () => {
  await withTempCliEnv(async ({ env, artifactsDir }) => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "crie um post para o Rumo ao Altar no Instagram e Facebook e publique após aprovação"],
      { env },
    );

    assert.ok(stdout.includes("WAITING_ASSISTED_GENERATION"));
    assert.ok(stdout.includes("Modo usado: LOCAL_PRODUCTION"));
    assert.ok(stdout.includes("Aguardando geração assistida na etapa"));
    assert.ok(stdout.includes("Crie a imagem usando este prompt e salve neste caminho."));
    assert.ok(stdout.includes("--continue"));

    const executionId = extractExecutionId(stdout);
    const imagePaths = extractAssistedImagePaths(stdout);
    const [width, height] = extractResolution(stdout);

    const listResult = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--list"], { env });
    assert.ok(listResult.stdout.includes(executionId));

    await fulfillAssistedImages(artifactsDir, executionId, imagePaths, width, height);

    const continueResult = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--continue", executionId], { env });
    assert.ok(continueResult.stdout.includes("WAITING_HUMAN_APPROVAL"));
    assert.ok(continueResult.stdout.includes("Aguardando aprovação humana"));
    assert.ok(continueResult.stdout.includes("--approve"));

    const approveResult = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--approve", executionId], { env });
    assert.ok(approveResult.stdout.includes("COMPLETED"));
    assert.ok(approveResult.stdout.includes("Página(s) de entrega gerada(s)"));
    assert.ok(approveResult.stdout.includes("LOCAL_PRODUCTION: nada foi publicado"));

    const htmlPathMatch = approveResult.stdout.match(/^ {2}(.+index\.html)$/m);
    assert.ok(htmlPathMatch, `stdout deveria listar o caminho do index.html: ${approveResult.stdout}`);
    const html = await readFile(htmlPathMatch[1], "utf8");
    assert.ok(html.includes("Relatório das Skills utilizadas"));
    assert.ok(html.includes("Resumo técnico da execução"));
    assert.ok(html.includes("developer-assisted"));
    assert.ok(html.includes("Modo LOCAL_PRODUCTION"));

    const reportPathMatch = approveResult.stdout.match(/^ {2}relatório: (.+execution-report\.json)$/m);
    assert.ok(reportPathMatch, `stdout deveria listar execution-report.json: ${approveResult.stdout}`);
    const executionReport = JSON.parse(await readFile(reportPathMatch[1], "utf8"));
    const anaStep = executionReport.steps.find((step) => step.skillCapability === "social_publishing");
    assert.equal(anaStep.response.output.overallStatus, "local_ready");

    const listAfterApproval = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--list"], { env });
    assert.equal(listAfterApproval.stdout.includes(executionId), false);
  });
});

test("CLI: --mode local-production gera ZIP, caption, hashtags, metadata e relatório no carrossel", async () => {
  await withTempCliEnv(async ({ env, artifactsDir }) => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "--mode", "local-production", "crie um carrossel com 2 imagens para Instagram sobre taxa zero no Rumo ao Altar"],
      { env },
    );

    assert.ok(stdout.includes("Modo usado: LOCAL_PRODUCTION"));
    assert.ok(stdout.includes("WAITING_ASSISTED_GENERATION"));
    const executionId = extractExecutionId(stdout);
    const imagePaths = extractAssistedImagePaths(stdout);
    assert.equal(imagePaths.length, 2);
    const [width, height] = extractResolution(stdout);
    await fulfillAssistedImages(artifactsDir, executionId, imagePaths, width, height);

    await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--mode", "local-production", "--continue", executionId], { env });
    const approveResult = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--mode", "local-production", "--approve", executionId], { env });

    assert.ok(approveResult.stdout.includes("COMPLETED"));
    assert.ok(approveResult.stdout.includes("zip:"));
    assert.ok(approveResult.stdout.includes("legenda:"));
    assert.ok(approveResult.stdout.includes("hashtags:"));
    assert.ok(approveResult.stdout.includes("metadata:"));
    assert.ok(approveResult.stdout.includes("relatório:"));
  });
});

test("CLI: LOCAL_PRODUCTION executa pipeline de vídeo com Rafa em Developer Assisted Mode (ZUNO_VIDEO_RENDER_MODE=developer_assisted força o modo antigo)", async () => {
  await withTempCliEnv(async ({ env, artifactsDir }) => {
    const assistedEnv = { ...env, ZUNO_VIDEO_RENDER_MODE: "developer_assisted" };
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "--mode", "local-production", "crie um vídeo para Reels de 30 segundos sobre taxa zero no Rumo ao Altar"],
      { env: assistedEnv },
    );

    assert.ok(stdout.includes("WAITING_ASSISTED_GENERATION"));
    assert.ok(stdout.includes("Narração"));
    const executionId = extractExecutionId(stdout);
    const narrationPaths = extractAssistedNarrationPaths(stdout);
    await fulfillAssistedNarrations(artifactsDir, executionId, narrationPaths);

    const narrationContinueResult = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--mode", "local-production", "--continue", executionId], { env: assistedEnv });
    assert.ok(narrationContinueResult.stdout.includes("WAITING_ASSISTED_GENERATION"));
    assert.ok(narrationContinueResult.stdout.includes("Vídeo 1"));
    const videoPaths = extractAssistedVideoPaths(narrationContinueResult.stdout);
    await fulfillAssistedVideos(artifactsDir, executionId, videoPaths);

    const continueResult = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--mode", "local-production", "--continue", executionId], { env: assistedEnv });
    assert.ok(continueResult.stdout.includes("WAITING_HUMAN_APPROVAL"));

    const approveResult = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--mode", "local-production", "--approve", executionId], { env: assistedEnv });
    assert.ok(approveResult.stdout.includes("COMPLETED"));
    assert.ok(approveResult.stdout.includes("vídeo:"));

    const htmlPathMatch = approveResult.stdout.match(/^ {2}(.+index\.html)$/m);
    assert.ok(htmlPathMatch, `stdout deveria listar o caminho do index.html: ${approveResult.stdout}`);
    const html = await readFile(htmlPathMatch[1], "utf8");
    assert.ok(html.includes("<video class=\"media-preview\" controls"));
    assert.ok(html.includes("Baixar Vídeo"));
  });
});

test("CLI: LOCAL_PRODUCTION resolve assets visuais antes da renderização local automática", async () => {
  await withTempCliEnv(async ({ env, artifactsDir }) => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "--mode", "local-production", "crie um vídeo para Reels de 6 segundos sobre taxa zero no Rumo ao Altar"],
      { env, timeout: 60_000 },
    );

    // A primeira pausa obrigatória agora é da Nora: o vídeo só renderiza depois que a narração real
    // é salva localmente e validada.
    assert.ok(stdout.includes("WAITING_ASSISTED_GENERATION"), `esperava pausa de narração, recebeu: ${stdout}`);
    assert.ok(stdout.includes("Narração"), `stdout deveria indicar a etapa da Nora: ${stdout}`);
    const executionId = extractExecutionId(stdout);
    const narrationPaths = extractAssistedNarrationPaths(stdout);
    await fulfillAssistedNarrations(artifactsDir, executionId, narrationPaths);

    const continueResult = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "--mode", "local-production", "--continue", executionId],
      { env, timeout: 60_000 },
    );

    // Com a biblioteca local de assets do Rumo ao Altar disponível, após a Nora a renderização não
    // deve cair para placeholder nem pedir asset visual assistido: ela resolve imagens reais e segue até aprovação.
    assert.ok(continueResult.stdout.includes("WAITING_HUMAN_APPROVAL"), `esperava aprovação humana após narração e assets locais, recebeu: ${continueResult.stdout}`);

    const approveResult = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "--mode", "local-production", "--approve", executionId],
      { env, timeout: 60_000 },
    );
    assert.ok(approveResult.stdout.includes("COMPLETED"));
    assert.ok(approveResult.stdout.includes("Página(s) de entrega gerada(s)"));

    const htmlPathMatch = approveResult.stdout.match(/^ {2}(.+index\.html)$/m);
    assert.ok(htmlPathMatch, `stdout deveria listar o caminho do index.html: ${approveResult.stdout}`);
    const html = await readFile(htmlPathMatch[1], "utf8");
    assert.ok(html.includes("<video class=\"media-preview\" controls"));

    const videoPathMatch = approveResult.stdout.match(/^ {2}vídeo: (.+\.mp4)$/m);
    assert.ok(videoPathMatch, `stdout deveria listar o caminho do vídeo: ${approveResult.stdout}`);
    const videoBytes = await readFile(videoPathMatch[1]);
    assert.ok(videoBytes.length > 100 * 1024, "vídeo renderizado localmente deveria ter tamanho real, não um placeholder");
    assert.equal(videoBytes.toString("ascii", 4, 8), "ftyp", "arquivo renderizado deveria ter assinatura MP4 real");

    const reportPathMatch = approveResult.stdout.match(/^ {2}relatório: (.+execution-report\.json)$/m);
    const executionReport = JSON.parse(await readFile(reportPathMatch[1], "utf8"));
    const renderStep = executionReport.steps.find((step) => step.skillCapability === "video_rendering");
    assert.equal(renderStep.response.output.generationMode, "local_render");
    assert.equal(renderStep.response.output.video.fileName, "final-video.mp4");
  });
});

test("CLI: --continue antes do arquivo existir pausa de novo com a mesma instrução, sem avançar o workflow", async () => {
  await withTempCliEnv(async ({ env }) => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "crie um post para o Rumo ao Altar no Instagram e Facebook"],
      { env },
    );
    const executionId = extractExecutionId(stdout);

    const continueResult = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--continue", executionId], { env });
    assert.ok(continueResult.stdout.includes("WAITING_ASSISTED_GENERATION"));
    assert.ok(continueResult.stdout.includes("Aguardando geração assistida na etapa"));

    const listResult = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--list"], { env });
    assert.ok(listResult.stdout.includes(executionId));
  });
});

test("CLI: --reject reprova a etapa humana e encerra o workflow sem publicar", async () => {
  await withTempCliEnv(async ({ env, artifactsDir }) => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "crie um post para o Rumo ao Altar no Instagram e Facebook"],
      { env },
    );
    const executionId = extractExecutionId(stdout);
    const imagePaths = extractAssistedImagePaths(stdout);
    const [width, height] = extractResolution(stdout);
    await fulfillAssistedImages(artifactsDir, executionId, imagePaths, width, height);
    await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--continue", executionId], { env });

    const rejectResult = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--reject", executionId], { env });
    assert.ok(rejectResult.stdout.includes("FAILED"));
  });
});

test("CLI: comando que exige capability sem Skill implementada falha imediatamente com mensagem consolidada, sem chamar nenhuma Skill", async () => {
  await withTempCliEnv(async ({ env }) => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "crie uma campanha de trafego pago no Meta Ads para o lançamento educativo sobre presentes via pix"],
      { env },
    );

    assert.ok(stdout.includes("FAILED"));
    assert.ok(stdout.includes("campaign_management"));
    assert.equal(stdout.includes("WAITING_HUMAN_APPROVAL"), false);
    assert.equal(stdout.includes("WAITING_ASSISTED_GENERATION"), false);

    const listResult = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--list"], { env });
    assert.equal(listResult.stdout.includes("WAITING_HUMAN_APPROVAL"), false);
  });
});

test("CLI: sem argumentos imprime instruções de uso, incluindo --continue", async () => {
  const { stdout } = await execFileAsync(process.execPath, [CLI_ENTRYPOINT]);
  assert.ok(stdout.includes("Uso:"));
  assert.ok(stdout.includes("npm run zuno"));
  assert.ok(stdout.includes("--continue"));
});

test("CLI: --rate registra avaliações em processos separados sem colidir (regressão de id entre invocações)", async () => {
  await withTempCliEnv(async ({ env, dataDir, artifactsDir }) => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "--mode", "local-production", "crie um post para o Instagram do Rumo ao Altar para engajar os convidados"],
      { env },
    );
    const executionId = extractExecutionId(stdout);
    const imagePaths = extractAssistedImagePaths(stdout);
    const [width, height] = extractResolution(stdout);
    await fulfillAssistedImages(artifactsDir, executionId, imagePaths, width, height);
    await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--mode", "local-production", "--continue", executionId], { env });
    await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--mode", "local-production", "--approve", executionId], { env });

    // Duas avaliações em dois processos separados (cada `--rate` é uma invocação nova da CLI) —
    // antes da correção, cada processo reiniciava o gerador de id em 1 e a segunda sobrescrevia a
    // primeira no arquivo local.
    const first = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--rate", executionId, "--score", "8", "--needs-improvement", "cta"], { env });
    const second = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--rate", executionId, "--score", "5", "--needs-improvement", "cta"], { env });
    assert.ok(first.stdout.includes("Nota geral (1-10): 8"));
    assert.ok(second.stdout.includes("Nota geral (1-10): 5"));

    const stored = JSON.parse(await readFile(join(dataDir, "quality-feedback.json"), "utf8"));
    assert.equal(stored.length, 2);
    assert.notEqual(stored[0].id, stored[1].id);
    assert.deepEqual(stored.map((record) => record.overallScore).sort(), [5, 8]);

    const reportResult = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--quality-report", "--client-id", "client-rumo"], { env });
    assert.ok(reportResult.stdout.includes("Total de avaliações: 2"));
    assert.ok(reportResult.stdout.includes("cta: 2 ocorrência"));
  });
});

test("CLI: duas execuções de workflow completamente diferentes nunca colidem no mesmo executionId (regressão do BUG-04)", async () => {
  await withTempCliEnv(async ({ env }) => {
    // Comando A fica pendente de propósito (nunca chega a --continue/--approve): antes da
    // correção, o gerador de id sequencial de Caio reiniciava em 1 a cada processo novo da CLI,
    // então o Comando B (totalmente diferente) reaproveitava silenciosamente o mesmo
    // "workflow-execution-0001" e os artefatos ainda pendentes do Comando A.
    const first = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "--mode", "local-production", "crie uma imagem para Instagram sobre taxa zero na lista de presentes"],
      { env },
    );
    const firstExecutionId = extractExecutionId(first.stdout);
    assert.ok(first.stdout.includes("WAITING_ASSISTED_GENERATION"));

    const second = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "--mode", "local-production", "crie uma imagem para Instagram anunciando o plano PRO do Rumo ao Altar"],
      { env },
    );
    const secondExecutionId = extractExecutionId(second.stdout);

    assert.notEqual(firstExecutionId, secondExecutionId);
    // Comando B precisa pausar sozinho em WAITING_ASSISTED_GENERATION (Pedro rodando do zero para
    // o seu próprio conteúdo) — nunca pular direto para WAITING_HUMAN_APPROVAL reaproveitando o
    // estado/artefatos do Comando A.
    assert.ok(second.stdout.includes("WAITING_ASSISTED_GENERATION"));
    assert.equal(second.stdout.includes("WAITING_HUMAN_APPROVAL"), false);

    const listResult = await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--list"], { env });
    assert.ok(listResult.stdout.includes(firstExecutionId));
    assert.ok(listResult.stdout.includes(secondExecutionId));
  });
});

test("CLI: --comment aceita valores que começam com -- e a mensagem de erro cita a flag correta (regressão do BUG-05)", async () => {
  await withTempCliEnv(async ({ env, artifactsDir }) => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "--mode", "local-production", "crie uma imagem para Instagram sobre taxa zero na lista de presentes"],
      { env },
    );
    const executionId = extractExecutionId(stdout);
    const imagePaths = extractAssistedImagePaths(stdout);
    const [width, height] = extractResolution(stdout);
    await fulfillAssistedImages(artifactsDir, executionId, imagePaths, width, height);
    await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--mode", "local-production", "--continue", executionId], { env });
    await execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--mode", "local-production", "--approve", executionId], { env });

    const rateResult = await execFileAsync(
      process.execPath,
      [CLI_ENTRYPOINT, "--rate", executionId, "--score", "8", "--comment", "--ótimo trabalho, parabéns"],
      { env },
    );
    assert.ok(rateResult.stdout.includes("Nota geral (1-10): 8"));

    await assert.rejects(
      execFileAsync(process.execPath, [CLI_ENTRYPOINT, "--rate", executionId, "--score", "8", "--comment"], { env }),
      (error) => {
        assert.ok(error.stderr.includes("Informe o valor de --comment."));
        assert.ok(error.stderr.includes("Exemplo: --comment"));
        assert.equal(error.stderr.includes("Exemplo: --comment local-production"), false);
        return true;
      },
    );
  });
});
