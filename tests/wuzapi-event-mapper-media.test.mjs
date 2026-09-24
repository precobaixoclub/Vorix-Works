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

test("mapWuzApiEvent: imageMessage extrai url/directPath/mimetype/caption(->body)/fileLength/mediaKey/hashes/thumbnail", () => {
  const mapped = mapWuzApiEvent(rawEvent({
    imageMessage: {
      url: "https://mmg.whatsapp.net/xyz",
      directPath: "/v/t62.7118-24/fake-direct-path",
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
  assert.equal(mapped.mediaDirectPath, "/v/t62.7118-24/fake-direct-path", "directPath é o campo CRÍTICO pro download real funcionar — whatsmeow.Client.Download() exige isso, nunca usa a url");
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

test("mapWuzApiEvent: contactMessage extrai displayName/vcard, telefone resolvido via waid (bug real corrigido: contato chegava sem nenhum campo)", () => {
  const mapped = mapWuzApiEvent(rawEvent({
    contactMessage: {
      displayName: "Fornecedor Principal",
      vcard: "BEGIN:VCARD\nVERSION:3.0\nN:;Fornecedor Principal;;;\nFN:Fornecedor Principal\nTEL;type=CELL;waid=5511988887777:+55 11 98888-7777\nEND:VCARD",
    },
  }));

  assert.equal(mapped.messageType, "contact");
  assert.equal(mapped.contactName, "Fornecedor Principal");
  assert.equal(mapped.contactPhoneE164, "+5511988887777", "resolvido a partir de waid=, nunca do texto formatado após os dois-pontos");
  assert.ok(mapped.contactVcard.includes("BEGIN:VCARD"));
  assert.equal(mapped.body, "Fornecedor Principal", "nome vira fallback de body — nunca bolha vazia em quem só lê body");
});

test("mapWuzApiEvent: contactMessage sem waid (contato salvo só com telefone fixo) cai pro valor cru após os dois-pontos", () => {
  const mapped = mapWuzApiEvent(rawEvent({
    contactMessage: { displayName: "Escritório", vcard: "BEGIN:VCARD\nVERSION:3.0\nFN:Escritório\nTEL;type=WORK:+55 11 3333-4444\nEND:VCARD" },
  }));

  assert.equal(mapped.contactPhoneE164, "+551133334444");
});

test("mapWuzApiEvent: contactMessage sem vcard nenhum não lança — degrada com telefone ausente", () => {
  const mapped = mapWuzApiEvent(rawEvent({ contactMessage: { displayName: "Sem vCard" } }));

  assert.equal(mapped.messageType, "contact");
  assert.equal(mapped.contactName, "Sem vCard");
  assert.equal(mapped.contactPhoneE164, undefined);
});

test("mapWuzApiEvent: mensagem de texto simples (conversation) nunca preenche campos de mídia", () => {
  const mapped = mapWuzApiEvent(rawEvent({ conversation: "Oi, tudo bem?" }));
  assert.equal(mapped.messageType, "text");
  assert.equal(mapped.body, "Oi, tudo bem?");
  assert.equal(mapped.mediaUrl, undefined);
  assert.equal(mapped.mediaKey, undefined);
});

/**
 * CORREÇÃO DE BUG REAL (achado ao vivo em produção, 2026-09-15, relatado pelo usuário: "mensagens
 * enviadas diretamente pelo whatsapp" não carregavam) — payload real capturado nos logs do WuzAPI:
 * um self-echo (mensagem enviada do próprio celular, `IsFromMe:true`) com `Message.extendedTextMessage.text`
 * preenchido (nunca `Message.conversation`, usado só pro texto MAIS simples possível, sem nenhum
 * contexto adicional). `messageType` já classificava corretamente como "text", mas `body` ficava
 * `undefined` — confirmado em produção: 33/45 mensagens recebidas e 13/20 enviadas com corpo vazio
 * num único workspace, a MAIORIA das mensagens de texto reais.
 */
test("mapWuzApiEvent: extendedTextMessage (resposta citada/preview de link/self-echo de outro dispositivo) preenche body — bug real de produção corrigido", () => {
  const mapped = mapWuzApiEvent(rawEvent(
    { extendedTextMessage: { text: "Não não", contextInfo: { disappearingMode: { initiator: 0 } } } },
    { info: { IsFromMe: true } },
  ));
  assert.equal(mapped.messageType, "text");
  assert.equal(mapped.body, "Não não", "extendedTextMessage.text nunca deveria ficar undefined — é a forma MAIS COMUM de mensagem de texto real (qualquer contexto adicional usa este formato, não `conversation`)");
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

/**
 * Correção do bug estrutural de identidade de conversa (ver docs/conversas-canonical-chat-identity.md).
 * Fixtures SANITIZADAS (sem telefone/nome real) representando os 3 cenários que motivaram a
 * correção — nomes de campo (`Chat`/`IsGroup`/`IsFromMe`) vêm do comentário já existente no topo de
 * `wuzapi-event-mapper.ts` ("CONFIRMADO via código-fonte real de asternic/wuzapi"), AINDA sem
 * confirmação ao vivo específica pra grupo/self-echo (ver diagnóstico temporário em
 * `inbox-worker.ts` — `logRawEventShapeForDiagnosis`); tratar como alta-confiança, reavaliar quando
 * o diagnóstico capturar um evento real.
 */

test("mapWuzApiEvent: DIRECT — chatId vem de Info.Chat (== peer), isGroup false, fromMe false", () => {
  const mapped = mapWuzApiEvent(rawEvent(
    { conversation: "Oi" },
    { info: { Chat: "5511999998888@s.whatsapp.net", IsGroup: false, IsFromMe: false } },
  ));

  assert.equal(mapped.chatId, "+5511999998888");
  assert.equal(mapped.isGroup, false);
  assert.equal(mapped.fromMe, false);
  assert.equal(mapped.senderId, "+5511999998888");
  assert.equal(mapped.senderName, "Cliente Teste");
});

test("mapWuzApiEvent: GRUPO — chatId vem de Info.Chat (o GRUPO, @g.us), senderId é o PARTICIPANTE (Info.Sender), nunca o contrário", () => {
  const mapped = mapWuzApiEvent(rawEvent(
    { conversation: "Bora jogar às 20h?" },
    { info: { Sender: "5511911110001@s.whatsapp.net", Chat: "120363912345678901@g.us", PushName: "João", IsGroup: true, IsFromMe: false } },
  ));

  assert.equal(mapped.isGroup, true);
  assert.equal(mapped.chatId, "120363912345678901@g.us", "identidade do CHAT é o grupo — nunca reduzido a formato de telefone (não é um telefone)");
  assert.equal(mapped.senderId, "+5511911110001", "quem mandou a mensagem é o PARTICIPANTE, atribuído por mensagem — nunca a identidade da conversa");
  assert.equal(mapped.senderName, "João");
  assert.equal(mapped.fromMe, false);
});

test("mapWuzApiEvent: dois participantes DIFERENTES no MESMO grupo produzem o MESMO chatId (a causa raiz do bug de fragmentação)", () => {
  const fromJoao = mapWuzApiEvent(rawEvent(
    { conversation: "Bora jogar?" },
    { info: { ID: "wamid-joao", Sender: "5511911110001@s.whatsapp.net", Chat: "120363912345678901@g.us", PushName: "João", IsGroup: true } },
  ));
  const fromMaria = mapWuzApiEvent(rawEvent(
    { conversation: "Fechou" },
    { info: { ID: "wamid-maria", Sender: "5511911110002@s.whatsapp.net", Chat: "120363912345678901@g.us", PushName: "Maria", IsGroup: true } },
  ));

  assert.equal(fromJoao.chatId, fromMaria.chatId, "mesmo grupo, remetentes diferentes — a IDENTIDADE DA CONVERSA (chatId) deve ser igual");
  assert.notEqual(fromJoao.senderId, fromMaria.senderId, "mas o REMETENTE de cada mensagem continua distinto");
});

test("mapWuzApiEvent: SELF-ECHO (IsFromMe=true) — chatId continua o PEER (não o próprio número), fromMe=true", () => {
  const mapped = mapWuzApiEvent(rawEvent(
    { conversation: "Oi, aqui é a empresa" },
    { info: { Sender: "5511900000000@s.whatsapp.net", Chat: "5511999998888@s.whatsapp.net", PushName: "Minha Empresa", IsFromMe: true, IsGroup: false } },
  ));

  assert.equal(mapped.fromMe, true);
  assert.equal(mapped.chatId, "+5511999998888", "self-echo: a conversa continua sendo a do PEER — nunca uma conversa nova pro próprio número do bot");
  assert.notEqual(mapped.chatId, mapped.senderId, "self-echo: chatId (peer) e senderId (o próprio bot) são DIFERENTES de propósito");
});

/**
 * CORREÇÃO DE BUG REAL (achado ao vivo em produção, 2026-09-14, logo após o deploy da réplica de
 * identidade) — payload real capturado nos logs do WuzAPI: DM inbound com o peer endereçado por
 * LID, `SenderAlt` preenchido com o telefone real, `RecipientAlt` vazio. `chatPhoneE164` nunca
 * resolvia (contato ficava preso no pivô degradado/LID puro para sempre, mesmo com evidência forte
 * disponível no mesmo evento) porque o código só olhava `RecipientAlt` pra identidade do Chat,
 * incondicionalmente — nunca `SenderAlt`, que é onde o alt do peer realmente vem quando é ELE quem
 * mandou a mensagem (`IsFromMe:false`).
 */
test("mapWuzApiEvent: DM inbound com peer via LID + SenderAlt real (RecipientAlt vazio) — chatPhoneE164 resolve (bug real de produção corrigido)", () => {
  const mapped = mapWuzApiEvent(rawEvent(
    { conversation: "Cara não sei" },
    {
      info: {
        Chat: "159154828243108@lid", Sender: "159154828243108@lid",
        SenderAlt: "554691086107@s.whatsapp.net", RecipientAlt: "",
        IsGroup: false, IsFromMe: false,
      },
    },
  ));

  assert.equal(mapped.chatPhoneE164, "+554691086107", "inbound: o alt do PEER vem em SenderAlt (ele é quem mandou) — RecipientAlt vazio nunca deveria bloquear a resolução");
  assert.equal(mapped.chatLid, "+159154828243108");
  assert.equal(mapped.senderPn, "+554691086107");
});

test("mapWuzApiEvent: self-echo (IsFromMe=true) com SenderAlt sendo o NOSSO próprio alt — chatPhoneE164 usa RecipientAlt (do peer), nunca SenderAlt (nosso)", () => {
  const mapped = mapWuzApiEvent(rawEvent(
    { conversation: "Aqui é a empresa" },
    {
      info: {
        Chat: "554691086107@s.whatsapp.net", Sender: "999888777666555@lid",
        SenderAlt: "5511900000000@s.whatsapp.net", RecipientAlt: "159154828243108@lid",
        IsGroup: false, IsFromMe: true,
      },
    },
  ));

  assert.equal(mapped.chatPhoneE164, "+554691086107", "self-echo: Chat já vem como PN direto, resolve normalmente");
  assert.equal(mapped.chatLid, "+159154828243108", "o LID do PEER vem de RecipientAlt (nós somos o Sender aqui) — nunca de SenderAlt, que seria o nosso próprio alias");
});

test("mapWuzApiEvent: ReadReceipt com MessageIDs em lote produz UM MessageStatusChanged POR id, nunca só o primeiro", () => {
  const events = mapWuzApiEvent({
    type: "ReadReceipt",
    instanceName: "conn-1",
    state: "Read",
    event: { MessageIDs: ["wamid-a", "wamid-b", "wamid-c"] },
  });

  assert.ok(Array.isArray(events), "receipt em lote deve devolver um array");
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((e) => e.externalMessageId), ["wamid-a", "wamid-b", "wamid-c"]);
  assert.ok(events.every((e) => e.type === "message.status" && e.status === "read"));
});

test("mapWuzApiEvent: ReadReceipt Delivered/ReadSelf mapeiam pros status corretos", () => {
  const delivered = mapWuzApiEvent({ type: "ReadReceipt", instanceName: "conn-1", state: "Delivered", event: { MessageIDs: ["wamid-x"] } });
  assert.equal(delivered[0].status, "delivered");

  const readSelf = mapWuzApiEvent({ type: "ReadReceipt", instanceName: "conn-1", state: "ReadSelf", event: { MessageIDs: ["wamid-y"] } });
  assert.equal(readSelf[0].status, "read");
});

test("mapWuzApiEvent: sem Info.Chat (defensivo) cai pra Info.Sender como chatId", () => {
  const mapped = mapWuzApiEvent(rawEvent({ conversation: "Oi" }, { info: {} }));
  assert.equal(mapped.chatId, "+5511999998888", "fallback defensivo — nunca deveria acontecer no envelope real, mas nunca deve descartar o evento inteiro");
});

/**
 * Achados AO VIVO via diagnóstico temporário em produção (ver commits "debug(inbox)") — payloads
 * reais mostraram formas que a documentação/código-fonte pesquisado não previa:
 * - `Info.Chat` pode terminar em `@lid` (identidade "Linked ID" do whatsmeow — usada em vez de
 *   `@s.whatsapp.net` para DM nesta versão do WuzAPI) ou `@newsletter` (Canal do WhatsApp).
 * - `Info.IsGroup` é `false` para Canal/Newsletter — não basta pra decidir "isto é uma pessoa".
 * - `Info.Timestamp` é uma STRING ISO-8601 com offset (`"2026-09-13T20:03:49-03:00"`), nunca um
 *   número epoch como a suposição original assumia.
 */

test("mapWuzApiEvent: @lid é tratado como DM normal (é uma pessoa) — mesmo caminho de @s.whatsapp.net", () => {
  const mapped = mapWuzApiEvent(rawEvent(
    { conversation: "Oi" },
    { info: { Sender: "123456789012345@lid", Chat: "123456789012345@lid", IsGroup: false, IsFromMe: false } },
  ));

  assert.equal(mapped.isGroup, false, "@lid é uma pessoa (DM), não deve virar grupo/canal");
  assert.equal(mapped.chatId, "+123456789012345");
});

/**
 * ACHADO AO VIVO (pedido explícito do usuário em produção, 2026-09-15: "quero somente conversas do
 * whatsapp e grupos") — Canal/Newsletter (`@newsletter`) nunca é uma conversa de atendimento: é um
 * feed de transmissão, nunca respondido/gerenciado pelo atendimento, e a mídia nem pode ser baixada
 * (WhatsApp não criptografa por destinatário nesse caso). Antes disto, o Canal virava uma
 * "conversa" (mesmo caminho seguro de grupo, pra nunca virar um InboxContact/telefone fake) — agora
 * é descartado por completo, mesmo caminho de `status@broadcast` abaixo.
 */
test("mapWuzApiEvent: @newsletter (Canal do WhatsApp) é descartado inteiro — nunca vira conversa/mensagem", () => {
  const mapped = mapWuzApiEvent(rawEvent(
    { conversation: "Notícia do dia" },
    { info: { Sender: "120363111222333444@newsletter", Chat: "120363111222333444@newsletter", IsGroup: false, IsFromMe: false } },
  ));

  assert.equal(mapped, undefined, "Canal/Newsletter nunca deveria virar um evento reconhecido — descartado inteiro");
});

/**
 * ACHADO AO VIVO (relatado pelo usuário em produção, 2026-09-15): "status@broadcast" é o feed de
 * Status/Stories do WhatsApp — atualizações postadas por QUALQUER contato, nunca uma conversa real
 * com uma pessoa/grupo específico. Sem descartar este evento, cada Status virava uma mensagem
 * acumulada numa única conversa fantasma sem nome, aparecendo como um "grupo" cheio de fotos
 * aleatórias de stories.
 */
test("mapWuzApiEvent: status@broadcast (feed de Status/Stories do WhatsApp) é descartado inteiro — nunca vira conversa/mensagem", () => {
  const mapped = mapWuzApiEvent(rawEvent(
    { imageMessage: { url: "https://mmg.whatsapp.net/status-photo", mimetype: "image/jpeg" } },
    { info: { Sender: "5511988887777@s.whatsapp.net", Chat: "status@broadcast", IsGroup: false, IsFromMe: false } },
  ));

  assert.equal(mapped, undefined, "status@broadcast nunca deveria virar um evento reconhecido — descartado inteiro, como um evento corrompido");
});

/**
 * ACHADO AO VIVO EM PRODUÇÃO (2026-09-15, relatado pelo usuário: "mensagens sem texto... que não
 * carregou") — payload real capturado nos logs do WuzAPI: um evento de grupo com `Message`
 * contendo SOMENTE `senderKeyDistributionMessage` (+ `messageContextInfo`, metadado nunca
 * conteúdo). Isto é uma mensagem de PROTOCOLO (distribuição de chave de criptografia do grupo,
 * enviada automaticamente pelo whatsmeow), nunca algo que uma pessoa escreveu.
 */
test("mapWuzApiEvent: senderKeyDistributionMessage sozinho (mensagem de protocolo, nunca conteúdo real) é descartado inteiro", () => {
  const mapped = mapWuzApiEvent(rawEvent(
    {
      senderKeyDistributionMessage: { groupID: "554699758123-1560728831@g.us", axolotlSenderKeyDistributionMessage: "base64==" },
      messageContextInfo: { deviceListMetadata: { senderTimestamp: 1789388401 }, deviceListMetadataVersion: 2 },
    },
    { info: { Chat: "554699758123-1560728831@g.us", IsGroup: true, IsFromMe: false } },
  ));

  assert.equal(mapped, undefined, "mensagem de protocolo pura (só distribuição de chave) nunca deveria virar uma mensagem visível na Inbox");
});

test("mapWuzApiEvent: senderKeyDistributionMessage JUNTO com conteúdo real (ex.: extendedTextMessage) NUNCA é descartado", () => {
  const mapped = mapWuzApiEvent(rawEvent(
    {
      senderKeyDistributionMessage: { groupID: "554699758123-1560728831@g.us", axolotlSenderKeyDistributionMessage: "base64==" },
      extendedTextMessage: { text: "Mensagem real que veio junto" },
    },
    { info: { Chat: "554699758123-1560728831@g.us", IsGroup: true, IsFromMe: false } },
  ));

  assert.ok(mapped, "presença de conteúdo real (mesmo ao lado de metadado de protocolo) nunca deve ser descartada");
  assert.equal(mapped.body, "Mensagem real que veio junto");
});

test("mapWuzApiEvent: Info.Timestamp como STRING ISO-8601 com offset (formato real confirmado) é convertido corretamente para occurredAt", () => {
  const mapped = mapWuzApiEvent(rawEvent({ conversation: "Oi" }, { info: { Timestamp: "2026-09-13T20:03:49-03:00" } }));
  assert.equal(mapped.occurredAt, new Date("2026-09-13T20:03:49-03:00").toISOString());
});

test("mapWuzApiEvent: Info.Timestamp numérico (epoch, fallback defensivo) ainda funciona", () => {
  const mapped = mapWuzApiEvent(rawEvent({ conversation: "Oi" }, { info: { Timestamp: 1735000000 } }));
  assert.equal(mapped.occurredAt, new Date(1735000000 * 1000).toISOString());
});
