import { test } from "node:test";
import assert from "node:assert/strict";

import { WuzApiClient } from "../dist/infrastructure/messaging/wuzapi/wuzapi-client.js";

/**
 * Causa raiz real de "toda mídia falha ao baixar em produção" (272 mensagens, 0% de sucesso) —
 * encontrada lendo o código-fonte real de `asternic/wuzapi` (`handlers.go`) e `tulir/whatsmeow`
 * (`download.go`), não suposição. Dois bugs confirmados e corrigidos aqui:
 *
 * 1. `DirectPath` nunca era enviado no corpo da requisição — `whatsmeow.Client.Download()` checa
 *    `len(msg.GetDirectPath()) == 0` (NUNCA olha `URL` pra essa checagem) e retorna
 *    `"no url present"` se vazio. Isso explica o erro genérico batendo 100% das vezes mesmo com
 *    `mediaKey`/`url` presentes.
 * 2. A resposta de sucesso (`{"Mimetype": ..., "Data": ...}`) tem `Data` como uma DATA URL
 *    completa (`data:<mime>;base64,<...>`, pacote Go `vincent-petithory/dataurl`), não base64
 *    puro — decodificar sem remover o prefixo corromperia o arquivo.
 */

function clientWithFetch(fetchImpl) {
  return new WuzApiClient({ baseUrl: "http://wuzapi.internal", adminToken: "admin-token", fetchImpl });
}

test("downloadMedia: envia DirectPath no corpo da requisição (campo antes ausente, causa raiz real do bug)", async () => {
  let capturedBody;
  const fetchImpl = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ code: 200, success: true, data: { Mimetype: "image/jpeg", Data: "data:image/jpeg;base64,aGVsbG8=" } }), { status: 200 });
  };

  const client = clientWithFetch(fetchImpl);
  await client.downloadMedia("sess-1", "image", {
    url: "https://mmg.whatsapp.net/fake",
    directPath: "/v/t62.7118-24/fake-direct-path",
    mediaKey: "chave-base64",
    mimeType: "image/jpeg",
    fileSha256: "sha-abc",
    fileSizeBytes: 12345,
    fileEncSha256: "encsha-abc",
  });

  assert.equal(capturedBody.Url, "https://mmg.whatsapp.net/fake");
  assert.equal(capturedBody.DirectPath, "/v/t62.7118-24/fake-direct-path", "DirectPath precisa ir no corpo — whatsmeow.Client.Download() exige isso, nunca usa Url pra essa checagem");
  assert.equal(capturedBody.MediaKey, "chave-base64");
});

test("downloadMedia: decodifica corretamente uma resposta Data URL completa (data:<mime>;base64,<...>), não base64 puro", async () => {
  const realBytes = Buffer.from("conteudo real do arquivo de imagem");
  const fetchImpl = async () =>
    new Response(JSON.stringify({ code: 200, success: true, data: { Mimetype: "image/jpeg", Data: `data:image/jpeg;base64,${realBytes.toString("base64")}` } }), { status: 200 });

  const client = clientWithFetch(fetchImpl);
  const result = await client.downloadMedia("sess-1", "image", { url: "https://mmg.whatsapp.net/fake", directPath: "/v/fake", mediaKey: "k" });

  assert.ok(result);
  assert.equal(result.body.toString("utf8"), "conteudo real do arquivo de imagem", "o prefixo 'data:image/jpeg;base64,' precisa ser removido antes de decodificar, senão o arquivo fica corrompido");
});

test("downloadMedia: ainda aceita base64 puro (sem prefixo data:) por segurança/compatibilidade", async () => {
  const realBytes = Buffer.from("outro conteudo real");
  const fetchImpl = async () => new Response(JSON.stringify({ code: 200, success: true, data: { Mimetype: "audio/ogg", Data: realBytes.toString("base64") } }), { status: 200 });

  const client = clientWithFetch(fetchImpl);
  const result = await client.downloadMedia("sess-1", "audio", { url: "https://mmg.whatsapp.net/fake", directPath: "/v/fake", mediaKey: "k" });

  assert.ok(result);
  assert.equal(result.body.toString("utf8"), "outro conteudo real");
});
