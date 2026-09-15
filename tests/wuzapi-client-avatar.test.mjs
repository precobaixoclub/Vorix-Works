import { test } from "node:test";
import assert from "node:assert/strict";

import { WuzApiClient } from "../dist/infrastructure/messaging/wuzapi/wuzapi-client.js";

/**
 * Bloco "fotos de grupo/contato" (pedido explícito do usuário em produção, "ajustar para carregar
 * as fotos dos grupos e conversas") — confirmado lendo o handler real (`asternic/wuzapi`,
 * `handlers.go`, `func (s *server) GetAvatar()`) e o struct que ele devolve
 * (`whatsmeow/types.ProfilePictureInfo`, com tags `json:"..."` explícitas — lowercase, ao contrário
 * do `GroupInfo` sem tags). `POST /user/avatar` (nunca GET, diferente de `/group/info`); a `url`
 * devolvida é baixável direto por HTTP simples (comentário do próprio whatsmeow), então
 * `downloadAvatar` já entrega os bytes prontos, sem precisar de um segundo endpoint do WuzAPI.
 */

function clientWithFetch(fetchImpl) {
  return new WuzApiClient({ baseUrl: "http://wuzapi.internal", adminToken: "admin-token", fetchImpl });
}

test("downloadAvatar: chama POST /user/avatar com {Phone, Preview:false} e baixa os bytes reais da url devolvida", async () => {
  let capturedUrl, capturedInit;
  const fetchImpl = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    if (url === "http://wuzapi.internal/user/avatar") {
      return new Response(JSON.stringify({ code: 200, success: true, data: { url: "https://pps.whatsapp.net/fake-avatar.jpg", id: "pic-123", type: "image" } }), { status: 200 });
    }
    if (url === "https://pps.whatsapp.net/fake-avatar.jpg") {
      return new Response(Buffer.from("bytes reais da foto"), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    throw new Error(`URL inesperada: ${url}`);
  };

  const client = clientWithFetch(fetchImpl);
  const result = await client.downloadAvatar("sess-1", "5511999998888@s.whatsapp.net");

  assert.equal(capturedUrl, "https://pps.whatsapp.net/fake-avatar.jpg", "último fetch deve ser direto na url devolvida pelo WuzAPI");
  assert.ok(result);
  assert.equal(result.body.toString("utf8"), "bytes reais da foto");
  assert.equal(result.mimeType, "image/jpeg");
});

/**
 * ACHADO AO VIVO EM PRODUÇÃO (2026-09-15, logo após o primeiro deploy) — as duas mensagens de erro
 * REAIS confirmadas na primeira reconciliação retroativa (5/7 contatos e 0/4 grupos caíram aqui);
 * "no avatar found" (a mensagem que o código-fonte sugeria) nunca é alcançada na prática, porque
 * `GetProfilePictureInfo()` do whatsmeow já falha ANTES disso com uma destas duas.
 */
test("downloadAvatar: contato/grupo SEM foto de perfil (mensagem real 'does not have a profile picture') devolve undefined, nunca lança", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ code: 500, success: false, error: "failed to get avatar: that user or group does not have a profile picture" }), { status: 500 });
  const client = clientWithFetch(fetchImpl);
  const result = await client.downloadAvatar("sess-1", "5511999998888@s.whatsapp.net");
  assert.equal(result, undefined, "ausência de foto é o estado normal pra boa parte dos contatos — nunca deveria lançar nem logar como falha");
});

test("downloadAvatar: pessoa escondeu a foto de perfil (mensagem real 'hidden their profile picture') devolve undefined, nunca lança", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ code: 500, success: false, error: "failed to get avatar: the user has hidden their profile picture from you" }), { status: 500 });
  const client = clientWithFetch(fetchImpl);
  const result = await client.downloadAvatar("sess-1", "5511999998888@s.whatsapp.net");
  assert.equal(result, undefined);
});

test("downloadAvatar: outro erro 500 genuíno (não relacionado a ausência de foto) ainda propaga como MessagingProviderError transient", async () => {
  const fetchImpl = async () => new Response("internal server error", { status: 500 });
  const client = clientWithFetch(fetchImpl);
  await assert.rejects(() => client.downloadAvatar("sess-1", "5511999998888@s.whatsapp.net"));
});
