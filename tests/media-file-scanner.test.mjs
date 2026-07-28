import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { scanMediaFiles } from "../dist/infrastructure/media-catalog/media-file-scanner.js";
import { classifyVideoFootage } from "../dist/infrastructure/media-catalog/footage-classifier.js";
import { computeFileHash } from "../dist/infrastructure/media-catalog/media-hash.js";

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), "zuno-media-scan-"));
}

function run(args) {
  const result = spawnSync(ffmpeg, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg falhou: ${result.stderr?.slice(-1500)}`);
}

async function buildPhoto(dir, fileName = "foto.png") {
  const path = join(dir, fileName);
  run(["-y", "-f", "lavfi", "-i", "color=c=0xC97F91:s=1080x1920", "-frames:v", "1", path]);
  return path;
}

async function buildProceduralVideo(dir, fileName = "gradiente.mp4") {
  const path = join(dir, fileName);
  run(["-y", "-f", "lavfi", "-i", "gradients=s=640x1136:c0=0xC97F91:c1=0x111111:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "2", path]);
  return path;
}

async function buildTexturedVideo(dir, fileName = "textura.mp4") {
  const path = join(dir, fileName);
  run(["-y", "-f", "lavfi", "-i", "testsrc=size=640x1136:duration=2:rate=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "2", path]);
  return path;
}

async function buildAudio(dir, fileName = "musica.wav") {
  const path = join(dir, fileName);
  run(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ar", "44100", "-ac", "1", path]);
  return path;
}

// ---------------------------------------------------------------------------------------------
// Indexação real: foto, vídeo, áudio
// ---------------------------------------------------------------------------------------------

test("scanMediaFiles indexa uma fotografia real e extrai dimensões/hash", async (t) => {
  const dir = await makeTempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await buildPhoto(dir);

  const { records, result } = await scanMediaFiles({ roots: [dir], existingRecords: [] });

  assert.equal(result.scanned, 1);
  assert.equal(result.added, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].type, "photo");
  assert.equal(records[0].width, 1080);
  assert.equal(records[0].height, 1920);
  assert.equal(records[0].aspectRatio, "9:16");
  assert.ok(records[0].hash.length === 64, "hash sha256 deve ter 64 caracteres hex");
});

test("scanMediaFiles indexa um vídeo real e extrai duração/dimensões/classificação de filmagem", async (t) => {
  const dir = await makeTempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await buildProceduralVideo(dir);

  const { records } = await scanMediaFiles({ roots: [dir], existingRecords: [] });

  assert.equal(records.length, 1);
  assert.equal(records[0].type, "video");
  assert.ok(records[0].durationSeconds >= 1.5 && records[0].durationSeconds <= 2.5);
  assert.equal(records[0].width, 640);
  assert.equal(records[0].height, 1136);
});

test("scanMediaFiles indexa um arquivo de áudio real e extrai duração/sample rate", async (t) => {
  const root = await makeTempDir();
  t.after(() => rm(root, { recursive: true, force: true }));
  await buildAudio(root);

  const { records } = await scanMediaFiles({ roots: [root], existingRecords: [] });

  assert.equal(records.length, 1);
  assert.equal(records[0].type, "music");
  assert.ok(records[0].durationSeconds >= 1.5 && records[0].durationSeconds <= 2.5);
  assert.equal(records[0].sampleRateHz, 44100);
});

// ---------------------------------------------------------------------------------------------
// Hash / deduplicação / near-duplicate
// ---------------------------------------------------------------------------------------------

test("scanMediaFiles detecta duplicata exata por hash quando dois arquivos físicos são byte-idênticos", async (t) => {
  const dir = await makeTempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const original = await buildPhoto(dir, "original.png");
  await copyFile(original, join(dir, "copia.png"));

  const { records, result } = await scanMediaFiles({ roots: [dir], existingRecords: [] });

  assert.equal(result.scanned, 2);
  assert.equal(result.duplicatesFound, 1);
  const duplicateRecord = records.find((record) => record.duplicate.duplicateOf);
  assert.ok(duplicateRecord, "um dos dois registros deve apontar duplicateOf para o outro");
  const original_ = records.find((record) => record.assetId === duplicateRecord.duplicate.duplicateOf);
  assert.ok(original_, "duplicateOf deve referenciar um assetId real do outro registro");
});

test("scanMediaFiles nunca duplica o registro do catálogo para o MESMO caminho físico em rescans sucessivos (atualiza em vez de duplicar)", async (t) => {
  const dir = await makeTempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await buildPhoto(dir);

  const first = await scanMediaFiles({ roots: [dir], existingRecords: [] });
  const second = await scanMediaFiles({ roots: [dir], existingRecords: first.records });

  assert.equal(second.result.added, 0);
  assert.equal(second.result.updated, 1);
  assert.equal(second.records.length, 1);
  assert.equal(second.records[0].assetId, first.records[0].assetId, "assetId deve ser preservado entre rescans, nunca recriado");
});

test("scanMediaFiles preserva tags e approvalStatus manuais entre rescans", async (t) => {
  const dir = await makeTempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await buildPhoto(dir);

  const first = await scanMediaFiles({ roots: [dir], existingRecords: [] });
  const manuallyTagged = first.records.map((record) => ({ ...record, tags: ["casal", "celular"], approvalStatus: "approved" }));

  const second = await scanMediaFiles({ roots: [dir], existingRecords: manuallyTagged });

  assert.deepEqual(second.records[0].tags, ["casal", "celular"]);
  assert.equal(second.records[0].approvalStatus, "approved");
});

test("scanMediaFiles marca como indisponível (available:false) um asset cujo arquivo físico sumiu, sem nunca apagar o registro", async (t) => {
  const dir = await makeTempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const photoPath = await buildPhoto(dir);

  const first = await scanMediaFiles({ roots: [dir], existingRecords: [] });
  await rm(photoPath);
  const second = await scanMediaFiles({ roots: [dir], existingRecords: first.records });

  assert.equal(second.result.unavailable, 1);
  assert.equal(second.records.length, 1, "o registro continua existindo no catálogo, nunca é apagado");
  assert.equal(second.records[0].available, false);
});

// ---------------------------------------------------------------------------------------------
// filmed_footage vs procedural_background
// ---------------------------------------------------------------------------------------------

test("classifyVideoFootage classifica um vídeo de gradiente suave como procedural_background", async (t) => {
  const dir = await makeTempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const videoPath = await buildProceduralVideo(dir);

  const { classification } = await classifyVideoFootage(videoPath);

  assert.equal(classification, "procedural_background");
});

test("classifyVideoFootage NUNCA classifica vídeo com textura/alta variação de pixel como filmed_footage automaticamente (design conservador)", async (t) => {
  const dir = await makeTempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const videoPath = await buildTexturedVideo(dir);

  const { classification } = await classifyVideoFootage(videoPath);

  // Design deliberado: alta energia de borda só prova "não é obviamente procedural" — nunca prova
  // filmagem real. Só fica `undefined` (não classificado), exigindo revisão humana/--media-tag.
  assert.notEqual(classification, "procedural_background");
  assert.equal(classification, undefined);
});

test("scanMediaFiles nunca marca um vídeo procedural recém-escaneado como filmed_footage/generated_video", async (t) => {
  const dir = await makeTempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await buildProceduralVideo(dir);

  const { records } = await scanMediaFiles({ roots: [dir], existingRecords: [] });

  assert.equal(records[0].footageClassification, "procedural_background");
  assert.notEqual(records[0].footageClassification, "filmed_footage");
  assert.notEqual(records[0].footageClassification, "generated_video");
});

test("computeFileHash produz o mesmo hash para o mesmo conteúdo e hashes diferentes para conteúdos diferentes", async (t) => {
  const dir = await makeTempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const photoA = await buildPhoto(dir, "a.png");
  await copyFile(photoA, join(dir, "a-copia.png"));
  const photoB = await buildTexturedVideo(dir, "b.mp4");

  const hashA1 = await computeFileHash(photoA);
  const hashA2 = await computeFileHash(join(dir, "a-copia.png"));
  const hashB = await computeFileHash(photoB);

  assert.equal(hashA1, hashA2);
  assert.notEqual(hashA1, hashB);
});
