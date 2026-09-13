/**
 * Bytes REAIS e válidos (decodáveis pelo Chromium) para os testes de renderização de mídia —
 * nunca capturados de uma mensagem real do WhatsApp (a homologação com QR nunca foi executada,
 * ver docs/conversas-fase2-spike.md), mas nem por isso fixtures "falsas": um `<img>` com este JPEG
 * renderiza de verdade, um `<audio>` com este WAV toca e reporta `duration` de verdade. Isso
 * exercita o pipeline real do frontend (proxy autenticado → renderer) num Chromium real, só sem
 * uma sessão WhatsApp real por trás.
 */

/** JPEG 1x1 vermelho — o menor JPEG válido comumente usado em testes de decodificação. */
export const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";

/** Constrói um WAV PCM 8kHz/mono/8-bit válido de `durationSeconds` (silêncio) — sem depender de
 * ffmpeg (indisponível neste ambiente). Cabeçalho RIFF/WAVE/fmt/data por extenso, byte a byte. */
export function buildTinyWav(durationSeconds = 2): Buffer {
  const sampleRate = 8000;
  const numSamples = Math.round(sampleRate * durationSeconds);
  const dataSize = numSamples; // 8-bit mono = 1 byte/sample
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // subchunk1Size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28); // byteRate (1 byte/sample * 1 channel)
  buffer.writeUInt16LE(1, 32); // blockAlign
  buffer.writeUInt16LE(8, 34); // bitsPerSample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  buffer.fill(128, 44); // silêncio (8-bit unsigned, ponto médio)
  return buffer;
}

/** PDF mínimo válido (1 página em branco, 200x100pt) — suficiente para o navegador reconhecer
 * `application/pdf` e abrir no viewer nativo em vez de tratar como download corrompido. */
export const TINY_PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF",
  "utf8",
);
