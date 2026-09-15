import { test } from "node:test";
import assert from "node:assert/strict";

import { downloadInboundMediaAndAttach } from "../dist/application/inbox/inbox-use-cases.js";

/**
 * Bloco "Mídia inbound" (ver docs/conversas-inbox-organization-media-runtime.md) — achado real em
 * produção: mídia de Canal/Newsletter do WhatsApp (`@newsletter`) nunca traz `mediaKey` (não é
 * criptografada por destinatário, ao contrário de DM/grupo normal — confirmado contra o .proto real
 * do whatsmeow, `waE2E.ImageMessage.mediaKey`). Chamar o endpoint de download do WuzAPI sem isso
 * sempre falha ("no url present", mesmo com a URL presente) — não é um erro transitório, não
 * adianta reprocessar. `downloadInboundMediaAndAttach` agora detecta isso ANTES de tentar a chamada
 * HTTP que sabemos que vai falhar.
 */

function makeFakeMediaStorage() {
  const objects = new Map();
  return {
    async health() { return { ok: true }; },
    async put(input) { objects.set(input.key, { body: input.body, contentType: input.contentType }); },
    async get(key) { return objects.get(key); },
    async delete(key) { objects.delete(key); },
    objects,
  };
}

test("downloadInboundMediaAndAttach: sem mediaKey nunca tenta a chamada ao provider — reason=no_media_key_unsupported_source", async () => {
  let downloadCalled = false;
  const provider = {
    downloadMedia: async () => {
      downloadCalled = true;
      return { body: Buffer.from("nunca deveria chegar aqui"), mimeType: "image/jpeg" };
    },
  };
  const deps = {
    inboxMediaStorage: makeFakeMediaStorage(),
    provider,
    connectionRepository: { getById: async () => ({ id: "conn-1", externalSessionId: "sess-1" }) },
    messageRepository: {
      attachMedia: async () => { throw new Error("não deveria ser chamado"); },
      attachMediaSourceRef: async () => { throw new Error("não deveria ser chamado — falhou antes de chegar no ref bruto"); },
    },
  };

  const result = await downloadInboundMediaAndAttach(deps, {
    tenantId: "t1", workspaceId: "w1", connectionId: "conn-1", messageId: "msg-1",
    type: "image", mediaUrl: "https://mmg.whatsapp.net/fake-250-char-url",
    // mediaKey ausente de propósito — mesmo payload real de uma mensagem de Canal.
  });

  assert.equal(result.attached, false);
  assert.equal(result.reason, "no_media_key_unsupported_source");
  assert.equal(downloadCalled, false, "nunca deve tentar a chamada HTTP ao provider sabendo que vai falhar");
});

test("downloadInboundMediaAndAttach: com mediaKey MAS SEM directPath, nunca tenta a chamada ao provider — reason=no_direct_path", async () => {
  // Causa raiz real (lendo o código-fonte de whatsmeow/wuzapi): `Client.Download()` exige
  // `DirectPath` não-vazio e nunca olha `mediaUrl` pra essa checagem — sem isso, a chamada HTTP
  // sempre falharia com "no url present" mesmo com mediaKey presente. Era exatamente isso que
  // fazia 100% dos downloads falharem em produção antes desta correção.
  let downloadCalled = false;
  const provider = {
    downloadMedia: async () => {
      downloadCalled = true;
      return { body: Buffer.from("nunca deveria chegar aqui"), mimeType: "image/jpeg" };
    },
  };
  const deps = {
    inboxMediaStorage: makeFakeMediaStorage(),
    provider,
    connectionRepository: { getById: async () => ({ id: "conn-1", externalSessionId: "sess-1" }) },
    messageRepository: {
      attachMedia: async () => { throw new Error("não deveria ser chamado"); },
      attachMediaSourceRef: async () => { throw new Error("não deveria ser chamado — falhou antes de chegar no ref bruto"); },
    },
  };

  const result = await downloadInboundMediaAndAttach(deps, {
    tenantId: "t1", workspaceId: "w1", connectionId: "conn-1", messageId: "msg-2",
    type: "image", mediaUrl: "https://mmg.whatsapp.net/fake-url", mediaKey: "chave-real-de-teste",
    // mediaDirectPath ausente de propósito.
  });

  assert.equal(result.attached, false);
  assert.equal(result.reason, "no_direct_path");
  assert.equal(downloadCalled, false, "nunca deve tentar a chamada HTTP sabendo que vai falhar com 'no url present'");
});

test("downloadInboundMediaAndAttach: com mediaKey e directPath presentes, segue o caminho normal (chama o provider com DirectPath)", async () => {
  const mediaStorage = makeFakeMediaStorage();
  let attachedMediaCall;
  let sourceRefCall;
  const provider = {
    downloadMedia: async (input) => {
      assert.equal(input.ref.mediaKey, "chave-real-de-teste");
      assert.equal(input.ref.directPath, "/v/t62.7118-24/fake-direct-path");
      // Bloco "retry de mídia" — o ref bruto precisa ter sido gravado ANTES desta chamada (nunca
      // depois), senão uma falha aqui perderia a chance de retry.
      assert.ok(sourceRefCall, "attachMediaSourceRef precisa ter sido chamado ANTES de downloadMedia");
      return { body: Buffer.from("bytes reais da imagem"), mimeType: "image/jpeg" };
    },
  };
  const deps = {
    inboxMediaStorage: mediaStorage,
    provider,
    connectionRepository: { getById: async () => ({ id: "conn-1", externalSessionId: "sess-1" }) },
    messageRepository: {
      attachMedia: async (id, input) => { attachedMediaCall = { id, input }; },
      attachMediaSourceRef: async (id, ref) => { sourceRefCall = { id, ref }; },
    },
  };

  const result = await downloadInboundMediaAndAttach(deps, {
    tenantId: "t1", workspaceId: "w1", connectionId: "conn-1", messageId: "msg-3",
    type: "image", mediaUrl: "https://mmg.whatsapp.net/fake-url", mediaKey: "chave-real-de-teste",
    mediaDirectPath: "/v/t62.7118-24/fake-direct-path",
  });

  assert.equal(result.attached, true);
  assert.equal(result.reason, undefined);
  assert.equal(attachedMediaCall.id, "msg-3");
  assert.ok(attachedMediaCall.input.mediaStorageRef?.objectKey);
  assert.equal(sourceRefCall.id, "msg-3");
  assert.equal(sourceRefCall.ref.directPath, "/v/t62.7118-24/fake-direct-path");
});

test("downloadInboundMediaAndAttach: retry de mídia (bloco novo) — o ref bruto é gravado MESMO quando o download falha (nunca perde a chance de tentar de novo depois)", async () => {
  let sourceRefCall;
  const provider = { downloadMedia: async () => undefined }; // simula falha (ex.: WuzAPI reiniciando no meio).
  const deps = {
    inboxMediaStorage: makeFakeMediaStorage(),
    provider,
    connectionRepository: { getById: async () => ({ id: "conn-1", externalSessionId: "sess-1" }) },
    messageRepository: {
      attachMedia: async () => { throw new Error("nunca deveria ser chamado — download falhou"); },
      attachMediaSourceRef: async (id, ref) => { sourceRefCall = { id, ref }; },
    },
  };

  const result = await downloadInboundMediaAndAttach(deps, {
    tenantId: "t1", workspaceId: "w1", connectionId: "conn-1", messageId: "msg-4",
    type: "image", mediaUrl: "https://mmg.whatsapp.net/fake-url", mediaKey: "chave-real-de-teste",
    mediaDirectPath: "/v/t62.7118-24/fake-direct-path",
  });

  assert.equal(result.attached, false);
  assert.ok(sourceRefCall, "o ref bruto precisa ter sido persistido MESMO com o download falhando — é dele que o reconciliador de retry depende depois");
  assert.equal(sourceRefCall.id, "msg-4");
});
