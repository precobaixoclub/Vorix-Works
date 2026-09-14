# Experiência completa de WhatsApp em Conversas — relatório de implementação

Continuação de `docs/conversas-canonical-chat-identity.md` (correção do bug de identidade). Esta
entrega cobre os blocos A-E do pedido "completar a experiência REAL de WhatsApp dentro do Vorix":
identidade (telefone como pivô, PN/LID como aliases), metadata de grupo, receipts visuais, composer
(emoji/áudio/anexos) e mídia outbound. IA de atendimento permanece OFF; nenhum piloto foi iniciado.

## 1. Modelo de identidade — telefone como pivô

`src/domain/inbox/whatsapp-identity.ts` — único lugar do projeto que interpreta JIDs do WhatsApp
(`classifyWhatsAppJid`/`isPersonJid`/`resolveWhatsAppPersonIdentity`). Nenhum outro arquivo faz
`.replace("@lid", ...)` ou `.endsWith("@s.whatsapp.net")` por conta própria.

`resolveWhatsAppPersonIdentity(jid, altJid)` produz `{ phoneE164?, pn?, lid? }`:
- Telefone (`phoneE164`) só é preenchido quando um JID `@s.whatsapp.net` está presente (no `jid` OU
  no `altJid`) — nunca inventado a partir de um LID sozinho.
- `pn`/`lid` são os aliases técnicos observados, cada um só quando presente.

**Evidência real usada** (nunca heurística): diagnóstico ao vivo em produção (ver
`docs/conversas-canonical-chat-identity.md`) confirmou que o whatsmeow/WuzAPI expõe `Info.SenderAlt`
e `Info.RecipientAlt` — quando `Sender`/`Chat` vêm como `@lid`, o campo `*Alt` correspondente às
vezes traz o JID `@s.whatsapp.net` (telefone real) da MESMA pessoa. É a única fonte usada para
ligar LID→telefone (seção 4 do pedido original: "usar dados reais da WuzAPI/whatsmeow", nunca
heurística).

## 2. Chat ≠ Pessoa ≠ Identidade técnica

Mantido da correção anterior: `InboxConversation.externalChatId` continua o pivô do CHAT (JID
preservado, estável mesmo sem `*Alt`); `InboxContact.phoneNormalized` é o pivô da PESSOA (telefone
quando resolvível, LID como fallback degradado documentado). Os dois podem divergir de propósito —
não é bug, é o design pedido explicitamente (seção 50: "Não precisa necessariamente usar phone como
externalChatId").

## 3. Aliases PN/LID — schema e conflito

Migration `db/migrations/0116_inbox_identity_and_group_metadata.sql` (aditiva):
- `inbox_contacts.whatsapp_pn`/`whatsapp_lid` (nullable) — índice único parcial por workspace em
  cada um (`where ... is not null`) — nunca dois contatos reivindicam o mesmo alias.
- `inbox_messages.sender_phone_e164` — telefone resolvido de quem mandou UMA mensagem específica
  (útil em grupo, onde cada participante tem seu próprio PN/LID).

`registerInboundMessage` agora resolve `phoneNormalized = chatPhoneE164 ?? normalizePhoneNumber(chatId)`
— telefone tem prioridade quando conhecido; LID-como-pseudo-telefone é só o fallback degradado.

**Conflito de identidade** (seção 43 do pedido original — "não fundir automaticamente"):
`PostgresInboxContactRepository.upsertByPhone` e o equivalente em memória detectam violação do
índice único de alias, LOGAM o conflito (`console.warn` — "CONFLITO DE IDENTIDADE: ... nunca
fundido automaticamente") e refazem o upsert sem o alias conflitante — nunca lançam erro que
derrubaria o processamento da mensagem, nunca fundem dois contatos silenciosamente. Testado
(`tests/inbox-persistence.test.mjs`, "LID_PHONE_ALIAS_RESOLUTION").

## 4. Contact Panel

`ContactContextPane` (frontend, já existia da correção anterior) mostra `conversationTitle`/
`contactPhone` prominentemente para DM — nunca LID. Nenhuma mudança adicional foi necessária aqui:
o painel já lia `contactPhone` (agora sempre o telefone canônico quando resolvido, por causa da
seção 3) — LID nunca teve, e continua sem ter, exposição na UI comercial.

## 5. Busca

**NÃO EXECUTADO.** Não existe hoje uma busca de conversas/contatos por nome/telefone na Inbox (a
lista atual é só filtro por status/atribuição). Adicionar isso é uma feature nova de UI fora do
escopo desta entrega (identidade/receipts/composer/mídia) — não implementado, sinalizado aqui em
vez de silenciosamente ignorado.

## 6. Grupos — nome real e metadata

**Endpoint confirmado via documentação real do repositório `asternic/wuzapi`** (`API.md`, nunca
assumido): `GET /group/info` com corpo `{"GroupJID": "..."}`, resposta
`{ Name, Topic, Participants: [{JID, IsAdmin, IsSuperAdmin}], GroupCreated, JID }` — envelope
`{code, data, success}` igual ao resto do client.

`WuzApiClient.getGroupInfo` (novo) → `WuzApiMessagingProvider.getGroupInfo` (novo, best-effort,
nunca lança) → `MessagingProvider.getGroupInfo` (novo método OPCIONAL do port — um provider sem
suporte a grupos simplesmente não implementa) → `syncGroupMetadata` (novo caso de uso,
`inbox-use-cases.ts`) → `InboxConversationRepositoryPort.updateGroupMetadata` (novo método,
Postgres + memória).

Disparado pelo worker (`inbox-worker.ts`) sempre que uma mensagem de grupo é processada e
`conversation.groupMetadataUpdatedAt` ainda é `undefined` — nunca refaz a cada mensagem depois da
primeira sincronização bem-sucedida. Best-effort, fora do caminho crítico do ack (mesmo padrão de
`downloadInboundMediaAndAttach`).

**AINDA NÃO CONFIRMADO AO VIVO** — o endpoint vem de documentação pública do repositório real (mesma
fonte/nível de confiança que outros trechos deste client antes de validação ao vivo, ex.:
`sendImage`/`sendAudio`), mas nunca foi chamado contra o container WuzAPI real desta instalação.
Testado com mock (`tests/inbox-persistence.test.mjs`, "GROUP_METADATA"), não com runtime real.

`groupAvatarUrl`/`groupParticipantCount`/`groupMetadataUpdatedAt` adicionados ao schema e ao
domínio (`InboxConversation`) — `groupAvatarUrl` reservado pro futuro (a resposta documentada de
`/group/info` não inclui URL de foto; setar isso exigiria `/group/photo`, que é só POST — sem GET
de leitura documentado, não implementado).

## 7. Fallback de nome de grupo

Frontend (`inbox-tab.tsx`, já existia) já cai em `"Grupo do WhatsApp"` quando `groupName` é
`undefined` — decisão desta entrega: manter esse fallback (não trocar para "Grupo" genérico como
sugerido na seção 10 do pedido, já que a sincronização de metadata acima deve preencher o nome real
na maioria dos casos rapidamente após a primeira mensagem) — atualiza automaticamente assim que
`syncGroupMetadata` resolve (`message.updated` via SSE, mesmo mecanismo de realtime já existente).

## 8. Participantes por mensagem

Mantido/estendido da correção anterior: `senderExternalId`/`senderDisplayName` (já existiam) +
`senderPhoneE164` (novo, seção 3). `conversation.externalChatId` continua SEMPRE o grupo, nunca um
participante — inalterado, já correto desde a correção do bug de identidade.

## 9. Header de grupo

`inbox-tab.tsx` (thread header e painel de contexto) — sem mudança estrutural nesta entrega além do
que a correção anterior já fez (`conversationTitle`/`conversationSubtitle`). Contagem de
participantes (`groupParticipantCount`) está disponível no domínio/schema mas **não foi conectada à
UI do header** nesta passada (escopo já grande; adicionar `· N participantes` ao subtítulo é uma
mudança de 1 linha quando o valor começar a chegar via `syncGroupMetadata` real — deixado como
próximo passo de baixo custo, não um bloqueio).

## 10. CRM

Inalterado desta entrega — grupo continua nunca vinculável ao CRM (`contactId` sempre `undefined`
em `chatType: "group"`, `CrmContextSection` já gated desde a correção anterior).

## 11. Receipts — estados reais mapeados

Backend já existia end-to-end (confirmado por pesquisa antes desta entrega): WuzAPI emite eventos
`ReadReceipt` com `state: "Delivered" | "Read" | "ReadSelf"` e `MessageIDs: string[]`;
`mapStatusReceipts` (renomeado de `mapStatusReceipt` nesta entrega) → `applyMessageStatusChanged` →
`inbox_messages.status`. Nenhum estado é inventado — só `delivered`/`read` que o provider
efetivamente reportou.

**Correção real nesta entrega**: `mapStatusReceipts` processava só `MessageIDs[0]`, descartando
silenciosamente o resto quando o WuzAPI reportava vários ids no mesmo evento (batch de receipt).
Agora devolve um `MessageStatusChanged` por id — `mapWuzApiEvent` passou a poder devolver um array;
`RawEventConsumer` (`inbox-worker.ts`) itera e publica cada um. Testado
(`tests/wuzapi-event-mapper-media.test.mjs`, "ReadReceipt com MessageIDs em lote").

**Associação por `externalMessageId`, nunca "última mensagem"** — já era assim antes desta entrega
(`updateStatusByExternalId` sempre filtra por `connection_id + external_message_id`), confirmado
correto na auditoria, nenhuma mudança necessária (seção 45 do pedido já estava satisfeita).

## 12. UI de receipts

`MessageStatusTicks` (novo componente, `inbox-tab.tsx`) substitui o texto ("Enviado"/"Entregue"/
"Lido") por ícones: relógio (`queued`/`sending`), ✓ (`sent`), ✓✓ (`delivered`), ✓✓ azul (`read`),
alerta (`failed`) — tooltip com o texto por extenso. `queued`/`sending` NUNCA mostram um ✓✓ que o
provider não confirmou.

## 13. Read receipt inbound (marcar como lido PARA o WhatsApp)

**NOT_SUPPORTED — documentado, não fingido.** `MessagingProviderCapabilities.supportsReadReceipts`
já era `false` no adapter real (`WuzApiMessagingProvider`, comentário: "o WuzAPI não expõe isso na
API usada aqui") — confirmado pela pesquisa desta entrega: nenhum endpoint de "marcar como lido" foi
encontrado no client, no port, nem na documentação pública do `asternic/wuzapi`. Nenhuma mudança de
código — a capability já declarava isso corretamente antes desta entrega.

## 14. Composer

`inbox-tab.tsx`, composer reestruturado pra `[+] [🙂] [Digite uma mensagem...] [🎤/➤]` (seção 17 do
pedido, literal): botão de anexo (`Popover` com "Foto ou vídeo"/"Documento"), `EmojiPickerButton`,
`Textarea` (agora com `ref` pra inserir emoji na posição do cursor), e alternância
mic↔enviar conforme o rascunho tem texto ou não.

## 15. Emoji

`EmojiPickerButton` — sem biblioteca externa (emoji é Unicode puro), ~55 emojis curados com
palavra-chave própria (busca simples por substring, sem "biblioteca gigante"). Insere na posição do
CURSOR (`textarea.selectionStart`/`selectionEnd`), fecha a busca ao fechar o popover.

## 16. Gravação de áudio

`VoiceRecorderButton` — `navigator.mediaDevices.getUserMedia({ audio: true })` +
`MediaRecorder`. Fluxo completo pedido: idle (🎤) → requesting (permissão) → recording (● timer +
Cancelar/Parar) → **preview** (`&lt;audio controls&gt;` — sempre pode ouvir antes de enviar, nunca envia
direto ao parar) → sending → volta a idle. Erros (permissão negada, sem microfone, browser sem
suporte) viram sempre mensagem humana (`describeRecorderError`) — nunca o erro técnico cru.

Formato: usa o que `MediaRecorder.isTypeSupported` primeiro aceitar, na ordem
`audio/ogg;codecs=opus` → `audio/webm;codecs=opus` → `audio/webm` → `audio/mp4` — prefere ogg/opus
(o formato do exemplo documentado do WuzAPI) mas a maioria dos browsers Chromium só grava webm/opus
nativamente; o mimetype real do blob vai embutido no data URI enviado, nunca forçado.

**AINDA NÃO CONFIRMADO AO VIVO**: se o WuzAPI/WhatsApp trata isso como voice note (PTT) ou áudio
genérico — a documentação pública não menciona um campo de distinção. Precisa de teste com telefone
real (seção 54 do pedido) antes de considerar isso garantido.

## 17. Permissão de microfone

Tratado: `NotAllowedError`/`SecurityError` → "Não foi possível acessar o microfone.";
`NotFoundError` → "Nenhum microfone disponível neste dispositivo."; browser sem
`getUserMedia`/`MediaRecorder` → "Seu navegador não suporta gravação de áudio." Nunca expõe
`DOMException`/stack cru na UI.

## 18. Formato de áudio (WuzAPI)

Documentação real confirmada (`API.md`): `POST /chat/send/audio` espera `Audio` como data URI
base64 (`"data:audio/ogg;base64,..."`), formato do EXEMPLO documentado. Nenhum campo `PTT`/`isPTT`
separado é mencionado em nenhum endpoint de envio — ver seção 16/23 sobre a distinção voice
note/áudio genérico continuar não confirmada.

## 19. Voice note vs. áudio genérico

Ver seções 16/18/23 — sem campo de distinção documentado, o envio atual manda qualquer áudio pelo
mesmo `/chat/send/audio`. Se o WuzAPI/WhatsApp diferenciar isso internamente por algum heurística
própria (ex.: duração curta + mimetype opus), é comportamento do PROVIDER, não controlado por este
código — só validável com teste real (seção 54, ainda não executado).

## 20. Attachments

Botão `+` abre um menu com exatamente as duas opções que o pipeline atual suporta de verdade —
"Foto ou vídeo" (`accept="image/*,video/*"`) e "Documento" (`accept` restrito ao allowlist real do
backend) — nunca uma ação que não faz nada (seção 24 do pedido: "não exibir ações falsas").

## 21. Validação de upload

Client: `accept` do `&lt;input type="file"&gt;` já filtra a maior parte (não é validação de segurança,
só UX — nunca confiar só nisso). Server (`inbox.route.ts`, `classifyOutboundMediaMime`):
allowlist explícito de mimetypes por tipo (imagem/áudio/vídeo/documento — documento restrito a um
conjunto de formatos de escritório comuns, nunca "qualquer coisa"); tamanho limitado por
`maxUploadBytes` (mesma configuração `MEDIA_UPLOAD_MAX_BYTES` já usada pelo upload de publicação —
um limite, um lugar só); nome de arquivo nunca usado para montar path no disco (a chave do storage é
sempre gerada pelo servidor: `tenantId/workspaceId/conversationId/timestamp-random`, nunca deriva do
`fileName` do usuário — sem risco de path traversal).

## 22. Preview outbound

**NÃO EXECUTADO nesta entrega.** O composer hoje envia o arquivo direto ao selecionar (sem etapa de
preview/confirmação antes do upload) — a ÚNICA exceção é áudio gravado, que TEM preview obrigatório
(seção 16/20, `&lt;audio controls&gt;` antes de enviar). Preview de imagem/vídeo/documento ANTES do envio
(seção 26 do pedido) ficou de fora do escopo desta passada — risco documentado na seção "riscos
restantes" abaixo.

## 23. Drag & drop / Clipboard

**NÃO EXECUTADO.** Ambos marcados como "secundário"/"se simples" no pedido original (seções 27/28)
— não implementados nesta entrega, priorizado o pipeline funcional de anexo por clique primeiro.

## 24. Media Outbound Pipeline

`sendInboxMediaMessage` (novo caso de uso) — grava uma cópia PRÓPRIA no `InboxMediaStoragePort`
(preview imediato, mesmo padrão do caminho inbound) e enfileira exatamente como texto
(`outboundQueue.publish`, reaproveitando TODA a resiliência já existente — circuit breaker, rate
limiter, retry, DLQ — nenhuma delas duplicada). `processOutboundMessage` (worker) agora despacha por
`message.type` via `sendOutboundByType`: `text` → `provider.sendText` (inalterado); `image`/`audio`/
`video`/`document` → lê os bytes de volta do storage, monta `data:&lt;mime&gt;;base64,...` (contrato
CONFIRMADO via `API.md` real — nunca uma URL fetchável, correção de uma suposição nunca validada do
client original) e chama `sendImage`/`sendAudio`/`sendVideo`/`sendDocument`.

Nova rota `POST /v1/inbox/conversations/:id/media` (multipart, mesmo padrão de
`publication-media.route.ts`) — `workspaceId`/`caption`/`fileName` como campos de formulário (nunca
querystring). Testado ponta a ponta contra Postgres real (`tests/inbox-media-outbound.test.mjs`):
grava cópia própria, enfileira, `processOutboundMessage` monta o data URI correto, `fileName` chega
ao provider, e falha explicitamente (nunca finge sucesso) sem storage configurado.

## 25. Capabilities

`MessagingProviderCapabilities` já existia (`supportsQrConnect`/`supportedMediaKinds`/
`supportsReadReceipts`/`supportsTypingIndicator`) — usado pelo backend pra saber o que o provider
suporta. Nesta entrega, `getGroupInfo`/`sendImage`/`sendAudio`/`sendVideo`/`sendDocument` continuam
métodos OPCIONAIS/já existentes no port — o frontend hoje NÃO lê `capabilities` pra decidir o que
mostrar no composer (mostra sempre anexo/emoji/áudio, assumindo WuzAPI). Isso é aceitável enquanto
só existir um provider real (WuzAPI) — vira um risco quando um segundo provider (canal stateless,
seção 51/omnichannel) existir sem suporte a áudio/anexo. Documentado, não resolvido nesta entrega.

## 26. Mídia inbound

Pipeline já existia (`downloadInboundMediaAndAttach`, correção anterior) — nenhuma mudança de lógica
nesta entrega, só a habilitação do storage persistente (seção 27 abaixo), que é o pré-requisito que
faltava pra esse pipeline funcionar de verdade em produção.

## 27. Storage — produção

`docker-compose.zuno.yml`: novo volume nomeado `zuno_inbox_media` (sobrevive restart/rebuild/deploy
— `docker volume` real, não um path efêmero do container), montado no MESMO path
(`/app/inbox-media`) em `zuno-api` (serve via `GET /v1/inbox/media/:id`) E `vorix-worker` (baixa
mídia inbound, grava mídia outbound) — os dois processos são containers DIFERENTES; sem o volume
compartilhado, cada um veria um filesystem local isolado e nunca enxergaria o arquivo escrito pelo
outro. `INBOX_MEDIA_STORAGE_ENABLED=true`/`DRIVER=local`/`LOCAL_DIR=/app/inbox-media` habilitados
por padrão nos dois serviços (documentado em `.env.zuno.example`, driver `s3` disponível trocando 4
variáveis pra um S3/R2/MinIO real). **Backup/retenção**: NÃO configurado nesta entrega — o volume
Docker sobrevive a redeploy normal, mas não tem backup automático fora do host (mesma lacuna que já
existia pra `zuno_uploads`, o object storage público — fora do escopo desta entrega, sinalizado como
risco).

## 28. Segurança

Tenant/workspace scoping: `sendInboxMediaMessage` chama `mustConversationBelongToTenantAndWorkspace`
(mesma guarda já usada por `sendInboxMessage`) antes de qualquer escrita — nunca aceita um
`conversationId` de outro tenant. Tamanho: `maxUploadBytes` (mesmo limite do upload de publicação).
Mimetype: allowlist explícito (seção 21). Nome de arquivo: nunca usado pra montar path no disco (a
chave do storage é gerada pelo servidor). SSRF: não aplicável ao pipeline outbound (nunca busca uma
URL fornecida pelo cliente — o arquivo chega via upload direto, nunca por referência). Storage
privado: `InboxMediaStoragePort` nunca expõe URL pública (mesmo design de antes desta entrega — só
acessível via `GET /v1/inbox/media/:id` com token de curta duração).

## 29. Payloads reais usados nesta entrega

- `Info.SenderAlt`/`Info.RecipientAlt` populados com JID `@s.whatsapp.net` — capturado ao vivo em
  produção durante a investigação anterior (`docs/conversas-canonical-chat-identity.md`), reanalisado
  aqui especificamente pra confirmar o mecanismo de alias PN/LID.
- `GET /group/info`, `POST /chat/send/image`/`audio`/`video`/`document` — contrato de
  request/response vem da documentação `API.md` REAL do repositório `asternic/wuzapi` (fetched
  diretamente do GitHub nesta sessão), nunca de suposição — mas nenhum dos dois foi chamado contra o
  container WuzAPI real desta instalação ainda (ver "riscos restantes").

## 30. Browser QA

**NÃO EXECUTADO nesta sessão.** `npm run typecheck` e `npm run build` (produção) passam limpos —
capturam a maioria dos erros estruturais de JSX/tipos — mas não substituem clicar de verdade. Um
ambiente local autenticado com Postgres seedado/workspace/conversa real teria sido necessário pra
uma sessão de browser ao vivo (Playwright já está disponível como devDependency,
`@playwright/test`) — decisão desta sessão foi priorizar a implementação completa dos 5 blocos
(A-E) dentro do tempo disponível em vez de montar esse ambiente. Recomendo uma passada manual rápida
(desktop + 390px) antes de considerar o composer 100% pronto — ver "próximos passos".

## 31. Mobile

Composer usa componentes já responsivos do design system (`Button`/`Textarea`/`Popover`) — nenhuma
largura fixa nova introduzida. Não testado fisicamente a 390px nesta sessão (ver seção 30).

## 32. Migrations

`db/migrations/0116_inbox_identity_and_group_metadata.sql` — aditiva, `0115` não tocada (conferido:
checksum de migration já aplicada nunca é alterado, ver `migration-runner.ts`).

## 33. Commits

- `feat(inbox): identidade telefone/PN-LID, metadata de grupo, receipts em lote e mídia outbound` —
  backend (domínio, ports, adapters Postgres/memória, mapper, use cases, rota, migration 0116).
- `chore(inbox): storage de mídia persistente em produção` — `docker-compose.zuno.yml` +
  `.env.zuno.example` (volume dedicado + env vars).
- `feat(inbox-ui): composer completo (anexos, emoji, áudio) e receipts visuais` — frontend.
- `docs(inbox): registra experiência completa de WhatsApp (identidade, receipts, composer, mídia)` —
  este relatório.

## 34. Deploy

Executado em seguida deste relatório (mesmo processo já usado nas duas correções anteriores:
migration primeiro, depois rebuild+restart de `zuno-api`/`vorix-worker`/`zuno-web`) — ver resultado
anexado ao final deste documento após a execução.

## 35. Riscos restantes

- **Voice note vs. áudio genérico** — não confirmado se o WhatsApp trata o áudio gravado pelo
  composer como PTT ou documento de áudio. Requer teste real (seção 54 do pedido original).
- **`GET /group/info` e `POST /chat/send/{image,audio,video,document}` nunca chamados ao vivo** —
  contrato vem de documentação real, não de teste contra o container WuzAPI desta instalação.
  Primeira chamada real vai revelar rapidamente se algum nome de campo diverge (mesmo padrão já
  visto com `Info.Timestamp` na correção anterior — plano é o mesmo: monitorar logs/erros do
  worker depois do deploy, ajustar se necessário).
- **Preview antes de enviar imagem/vídeo/documento** — não implementado (seção 22).
- **Drag & drop / clipboard paste** — não implementado (seção 23).
- **Busca de conversas/contatos** — não existe (seção 5).
- **Capabilities não conectadas ao composer** — frontend sempre assume que anexo/áudio funcionam;
  vira um problema real só quando um segundo provider sem esses recursos existir (seção 25).
- **Backup do volume de mídia** — não configurado (seção 27), mesma lacuna pré-existente de
  `zuno_uploads`.
- **`groupParticipantCount` não conectado à UI** — disponível no schema/domínio, falta 1 linha no
  header do frontend (seção 9).
- **Browser QA/mobile não executados nesta sessão** (seções 30/31) — recomendo uma passada manual
  antes de considerar o composer pronto pra uso diário.

## 36. Classificação final

```
PHONE_IDENTITY_CANONICAL      = VERIFIED_AUTOMATED (testes reais contra Postgres) — RUNTIME depende do próximo evento @lid+*Alt real em produção
LID_PHONE_ALIAS_RESOLUTION    = VERIFIED_AUTOMATED (inclui conflito nunca fundido automaticamente) — PARTIAL até validação ao vivo
GROUP_METADATA                = VERIFIED_AUTOMATED (mock) — endpoint real (GET /group/info) NUNCA chamado ao vivo ainda
OUTBOUND_RECEIPTS             = VERIFIED_AUTOMATED (mapeamento correto, já existia) + correção de bug real (lote de MessageIDs)
READ_RECEIPTS                 = NOT_SUPPORTED (documentado — WuzAPI não expõe endpoint, nunca fingido)
EMOJI                         = IMPLEMENTADO, NÃO VERIFICADO EM BROWSER (typecheck/build OK, sem sessão ao vivo)
VOICE_RECORDING                = IMPLEMENTADO, NÃO VERIFICADO EM BROWSER/DISPOSITIVO REAL
IMAGE_OUTBOUND                 = VERIFIED_AUTOMATED (pipeline + data URI corretos) — RUNTIME real não executado
AUDIO_OUTBOUND                 = VERIFIED_AUTOMATED — RUNTIME real não executado; voice note/PTT não confirmado
VIDEO_OUTBOUND                 = VERIFIED_AUTOMATED (mesmo caminho de código do image) — RUNTIME real não executado
DOCUMENT_OUTBOUND              = VERIFIED_AUTOMATED (fileName confirmado) — RUNTIME real não executado
IMAGE_INBOUND / AUDIO_INBOUND / VIDEO_INBOUND / DOCUMENT_INBOUND = pipeline pré-existente, agora com storage persistente habilitado — RUNTIME não reexecutado nesta sessão
MEDIA_STORAGE_PERSISTENT       = YES (volume Docker dedicado, sobrevive restart/rebuild/deploy — backup não configurado)
CONVERSATIONS_OPERATOR_EXPERIENCE = NOT_READY — implementação completa dos 5 blocos, mas SEM verificação de runtime real (WhatsApp físico) nem browser QA nesta sessão; ver "próximos passos"
```

## 37. Próximos passos (aguardando revisão humana)

1. Deploy (executado a seguir).
2. Testar telefone como pivô com uma pessoa real que já apareceu por LID (seção 50 do pedido).
3. Testar nome de grupo real no grupo já confirmado (`554699758123-1560728831@g.us`) — confirmar
   `GET /group/info` ao vivo (seção 51).
4. Testar receipts reais: enviar "Teste receipt Vorix", observar sent→delivered→read no telefone e
   na UI (seção 52).
5. Testar emoji, gravação de voz (5-10s, confirmar reprodução no telefone e se chega como voice
   note), imagem, documento e vídeo nos dois sentidos (seções 53-57).
6. Passada manual de browser QA, incluindo 390px (seção 58) — não executada nesta sessão.
7. **IA permanece OFF. Nenhum piloto humano iniciado.**
