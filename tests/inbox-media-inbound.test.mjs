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
    messageRepository: { attachMedia: async () => { throw new Error("não deveria ser chamado"); } },
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

test("downloadInboundMediaAndAttach: com mediaKey presente, segue o caminho normal (chama o provider)", async () => {
  const mediaStorage = makeFakeMediaStorage();
  let attachedMediaCall;
  const provider = {
    downloadMedia: async (input) => {
      assert.equal(input.ref.mediaKey, "chave-real-de-teste");
      return { body: Buffer.from("bytes reais da imagem"), mimeType: "image/jpeg" };
    },
  };
  const deps = {
    inboxMediaStorage: mediaStorage,
    provider,
    connectionRepository: { getById: async () => ({ id: "conn-1", externalSessionId: "sess-1" }) },
    messageRepository: { attachMedia: async (id, input) => { attachedMediaCall = { id, input }; } },
  };

  const result = await downloadInboundMediaAndAttach(deps, {
    tenantId: "t1", workspaceId: "w1", connectionId: "conn-1", messageId: "msg-2",
    type: "image", mediaUrl: "https://mmg.whatsapp.net/fake-url", mediaKey: "chave-real-de-teste",
  });

  assert.equal(result.attached, true);
  assert.equal(result.reason, undefined);
  assert.equal(attachedMediaCall.id, "msg-2");
  assert.ok(attachedMediaCall.input.mediaStorageRef?.objectKey);
});
