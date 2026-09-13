import { test } from "node:test";
import assert from "node:assert/strict";

import { mapWuzApiEvent } from "../dist/infrastructure/messaging/wuzapi/wuzapi-event-mapper.js";

/**
 * Redesign operacional (mídia real) — cobre `mapInboundMessage`/`extractMediaFields` para os 4
 * tipos de mídia (`imageMessage`/`videoMessage`/`audioMessage`/`documentMessage`), usando os nomes
 * de campo PÚBLICOS e documentados do proto do whatsmeow (`waE2E.*Message`, camelCase) — ver o
 * comentário PENDING no topo de `wuzapi-event-mapper.ts`. Estes payloads são SINTÉTICOS, nunca
 * capturados ao vivo (a homologação com QR real nunca foi executada, ver
 * `docs/conversas-fase2-spike.md`) — o objetivo aqui é travar o comportamento de extração dado o
 * formato ASSUMIDO, e servir de rede de segurança para quando o formato real for confirmado.
 */

function rawEvent(message, overrides = {}) {
  return {
    type: "Message",
    instanceName: "conn-1",
    event: {
      Info: { ID: "wamid-1", Sender: "5511999998888@s.whatsapp.net", PushName: "Cliente Teste", Timestamp: 1735000000, ...overrides.info },
      Message: message,
    },
  };
}

test("mapWuzApiEvent: imageMessage extrai url/mimetype/caption(->body)/fileLength/mediaKey/hashes/thumbnail", () => {
  const mapped = mapWuzApiEvent(rawEvent({
    imageMessage: {
      url: "https://mmg.whatsapp.net/xyz",
      mimetype: "image/jpeg",
      caption: "Segue a foto combinada",
      fileLength: 204800,
      fileSha256: "sha-abc",
      fileEncSha256: "encsha-abc",
      mediaKey: "key-abc",
      jpegThumbnail: "base64thumb==",
      width: 800,
      height: 600,
    },
  }));

  assert.ok(mapped && mapped.type === "message.inbound");
  assert.equal(mapped.messageType, "image");
  assert.equal(mapped.mediaUrl, "https://mmg.whatsapp.net/xyz");
  assert.equal(mapped.mimeType, "image/jpeg");
  assert.equal(mapped.body, "Segue a foto combinada", "caption vira body — mesma UX do WhatsApp");
  assert.equal(mapped.caption, "Segue a foto combinada");
  assert.equal(mapped.fileSizeBytes, 204800);
  assert.equal(mapped.mediaKey, "key-abc");
  assert.equal(mapped.fileSha256, "sha-abc");
  assert.equal(mapped.fileEncSha256, "encsha-abc");
  assert.equal(mapped.thumbnailBase64, "base64thumb==");
});

test("mapWuzApiEvent: videoMessage extrai duration (seconds) além dos campos de imagem", () => {
  const mapped = mapWuzApiEvent(rawEvent({
    videoMessage: { url: "https://mmg.whatsapp.net/vid", mimetype: "video/mp4", seconds: 42, fileLength: 1_500_000, mediaKey: "key-vid" },
  }));

  assert.equal(mapped.messageType, "video");
  assert.equal(mapped.durationSeconds, 42);
  assert.equal(mapped.mimeType, "video/mp4");
  assert.equal(mapped.body, undefined, "vídeo sem caption não deve inventar um body");
});

test("mapWuzApiEvent: audioMessage extrai duration, sem caption/fileName", () => {
  const mapped = mapWuzApiEvent(rawEvent({
    audioMessage: { url: "https://mmg.whatsapp.net/audio", mimetype: "audio/ogg; codecs=opus", seconds: 18, ptt: true, fileLength: 32_000, mediaKey: "key-audio" },
  }));

  assert.equal(mapped.messageType, "audio");
  assert.equal(mapped.durationSeconds, 18);
  assert.equal(mapped.mimeType, "audio/ogg; codecs=opus");
  assert.equal(mapped.fileName, undefined);
});

test("mapWuzApiEvent: documentMessage extrai fileName", () => {
  const mapped = mapWuzApiEvent(rawEvent({
    documentMessage: { url: "https://mmg.whatsapp.net/doc", mimetype: "application/pdf", fileName: "contrato.pdf", fileLength: 1_800_000, mediaKey: "key-doc" },
  }));

  assert.equal(mapped.messageType, "document");
  assert.equal(mapped.fileName, "contrato.pdf");
  assert.equal(mapped.mimeType, "application/pdf");
});

test("mapWuzApiEvent: mensagem de texto simples (conversation) nunca preenche campos de mídia", () => {
  const mapped = mapWuzApiEvent(rawEvent({ conversation: "Oi, tudo bem?" }));
  assert.equal(mapped.messageType, "text");
  assert.equal(mapped.body, "Oi, tudo bem?");
  assert.equal(mapped.mediaUrl, undefined);
  assert.equal(mapped.mediaKey, undefined);
});

test("mapWuzApiEvent: imageMessage sem url/mediaKey (payload incompleto) não lança — degrada com campos ausentes", () => {
  const mapped = mapWuzApiEvent(rawEvent({ imageMessage: { mimetype: "image/jpeg" } }));
  assert.equal(mapped.messageType, "image");
  assert.equal(mapped.mediaUrl, undefined);
  assert.equal(mapped.mimeType, "image/jpeg");
});

test("mapWuzApiEvent: mensagem sem Info.ID ou Sender é descartada (undefined), nunca lança", () => {
  assert.equal(mapWuzApiEvent({ type: "Message", instanceName: "conn-1", event: { Info: {}, Message: { conversation: "x" } } }), undefined);
});
