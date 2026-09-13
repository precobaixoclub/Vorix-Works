# Identidade canônica de conversa — correção do bug estrutural (Conversas/WhatsApp)

Investigação e correção do bug P0/P1 relatado na homologação: mensagens de grupo fragmentando em
várias `InboxConversation` (uma por participante) e conversas diretas fragmentando em duas
(inbound separado de outbound, por self-echo do WuzAPI).

## 1. Causa raiz — DM (conversa privada)

`mapInboundMessage` (`src/infrastructure/messaging/wuzapi/wuzapi-event-mapper.ts`) usava
`Info.Sender` como identidade da conversa (`fromPhone`) e nunca checava `Info.IsFromMe`. O
WuzAPI/whatsmeow emite um evento `Message` também para mensagens que o **próprio número conectado**
mandou (via Vorix, ou direto do celular pareado) — nesse evento, `Sender` é o JID do **bot**, não
do contato do outro lado. Sem o check de `IsFromMe`, esse self-echo era processado exatamente como
uma mensagem inbound normal: virava um `InboxContact` novo (telefone = número do próprio bot) e uma
`InboxConversation` nova — uma segunda conversa "fantasma" pro mesmo par, mostrando a mensagem que
acabou de ser enviada como se fosse recebida.

## 2. Causa raiz — Grupo

O mesmo mapper nunca lia `Info.Chat`/`Info.IsGroup`. Em mensagem de grupo, `Info.Sender` é o
**participante** que mandou (`...@s.whatsapp.net`), e `Info.Chat` é o **grupo** (`...@g.us`) — a
identidade real da conversa. Usando `Sender` como chave, cada participante diferente que mandava
mensagem no mesmo grupo virava um `InboxContact`/`InboxConversation` próprio: um grupo com 30
pessoas ativas fragmentava em até 30 conversas.

Estrutural: `InboxConversation` era o par `(connection_id, contact_id)` — `unique (connection_id,
contact_id)` (migration `0082_inbox_conversations.sql`) — ou seja, a identidade da CONVERSA era
literalmente o REMETENTE de uma mensagem específica, nunca o CHAT em si.

## 3. Payload real (produção, sanitizado)

Diagnóstico temporário instrumentado em `inbox-worker.ts` (`logRawEventShapeForDiagnosis`, atrás de
`INBOX_DIAG_RAW_SHAPE=true`) capturou payloads reais durante a homologação ativa em produção
(commits `debug(inbox): ...`). Achados que **corrigiram suposições da documentação**:

- **`Info.Chat` nunca apareceu como `@s.whatsapp.net`/`@g.us` nos eventos reais capturados** — só
  como **`@lid`** (identidade "Linked ID" do whatsmeow, usada em vez do telefone tradicional para
  DM nesta versão do WuzAPI/conta) ou **`@newsletter`** (Canal do WhatsApp). `@g.us` (grupo
  tradicional) ainda **não foi visto num payload real** — a homologação até agora recebeu DMs e
  broadcasts de Canal, não uma mensagem de grupo `@g.us` de verdade.
- **Canal (`@newsletter`) chega com `Info.IsGroup: false`** — o flag booleano sozinho NÃO é
  suficiente para decidir "isto não é uma pessoa". Corrigido computando isso a partir do domínio do
  JID: qualquer `Chat` que não termine em `@s.whatsapp.net`/`@lid` é tratado pelo caminho seguro de
  "não-pessoa" (mesmo tratamento de grupo — JID preservado, nunca vira `InboxContact`), mesmo que
  `IsGroup` esteja `false`.
- **`Info.Timestamp` é uma STRING ISO-8601 com offset de fuso** (`"2026-09-13T20:03:49-03:00"`, 25
  caracteres) — nunca um número epoch como a suposição original (`typeof === "number"`) assumia.
  Isso significava que `occurredAt` **sempre** usava a hora de processamento do worker (fallback),
  nunca a hora real da mensagem no WhatsApp — um bug real e silencioso, só descoberto pelo
  diagnóstico.
- Campos de mídia de imagem confirmados ao vivo: `URL` (maiúsculo), `caption`, `directPath`,
  `fileLength`, `fileSHA256` (casing misto), `mimetype` — todos já cobertos pelo `pick()`
  defensivo existente em `extractMediaFields`.

## 4. PN/LID

`@lid` é tratado como identidade de pessoa (mesmo caminho que `@s.whatsapp.net`): normalizado para
`+<dígitos>` e usado para upsert de `InboxContact`/`external_chat_id`, exatamente como antes. **Não
foi possível confirmar se a MESMA pessoa pode aparecer ora como PN (`@s.whatsapp.net`) ora como LID
(`@lid`)** — o payload real desta homologação só mostrou `@lid`, nunca as duas formas para o mesmo
contato. Isto é um **risco documentado, não resolvido**: se isso acontecer, a mesma pessoa pode
gerar dois `InboxContact`/duas conversas diferentes (uma por PN, outra por LID) até haver evidência
real para uma canonicalização cruzada — ver seção "Riscos restantes".

## 5. Algoritmo canônico

`resolveCanonicalChatIdentity` (implementado dentro de `mapInboundMessage`, ver
`wuzapi-event-mapper.ts`):

```
isPersonJid(jid) = jid termina em "@s.whatsapp.net" ou "@lid"
isGroup = Info.IsGroup === true OU !isPersonJid(Info.Chat)
chatRaw = Info.Chat ?? Info.Sender   (fallback defensivo, nunca deveria faltar no envelope confirmado)
chatId  = isGroup ? chatRaw (JID preservado, ex. "120363...@g.us")
                  : normalizeWhatsmeowJid(chatRaw) (ex. "+5511999998888")
senderId = normalizeWhatsmeowJid(Info.Sender)   (sempre o remetente DESTA mensagem, nunca a identidade da conversa)
fromMe   = Info.IsFromMe === true
```

A chave real da `InboxConversation` é `(connectionId, chatType, externalChatId)` — nunca mais
`(connectionId, contactId)`.

## 6. Schema (migration 0115)

`db/migrations/0115_inbox_canonical_chat_identity.sql` — aditiva, sem apagar nada:

- `inbox_conversations`: `+chat_type` (`direct`/`group`), `+external_chat_id` (identidade canônica
  do chat), `+group_name`; `contact_id` passa a ser **opcional** (nunca setado em grupo — grupo
  nunca é fundido com um Contact do CRM).
- Índice único troca de `(connection_id, contact_id)` para `(connection_id, external_chat_id)`.
- `inbox_messages`: `+sender_external_id`, `+sender_display_name` — atribuição por mensagem de
  quem, dentro do chat, mandou aquela mensagem específica (essencial em grupo).
- Backfill: toda conversa pré-migration era necessariamente `direct` (grupo nunca foi suportado),
  `external_chat_id` preenchido a partir do `phone_normalized` do contato já associado.

## 7. Constraint/idempotência

`unique index inbox_conversations_connection_chat_key (connection_id, external_chat_id)` — dois
eventos concorrentes do mesmo chat (dois participantes de um grupo mandando ao mesmo tempo) nunca
criam duas conversas: `findOrCreate` faz `insert ... on conflict (...) do update`, serializado pelo
próprio Postgres a nível de linha (testado sob concorrência real, ver seção 9). Mensagens continuam
idempotentes por `unique (connection_id, external_message_id)` (migration 0083, inalterada).

## 8. Self-echo (DM e grupo)

`registerInboundMessage` (`src/application/inbox/inbox-use-cases.ts`), reescrito:

1. Se `fromMe === true`: primeiro checa `messageRepository.findByExternalId({connectionId,
   externalMessageId})` (novo método de port, sem inserir nada). Se já existe — é a confirmação do
   WuzAPI de uma mensagem que o próprio Vorix mandou via `sendInboxMessage`/`processOutboundMessage`
   — **no-op**, nunca cria uma segunda conversa/mensagem.
2. Se não existe ainda — é uma mensagem que o número mandou por fora do Vorix (direto do celular
   pareado): registrada como `direction: "outbound"` na conversa resolvida pelo `chatId` (peer ou
   grupo), atribuída via `senderExternalId`/`senderDisplayName`, nunca gera resposta de IA (gate
   `message.direction === "inbound"` no worker antes de chamar `maybeGenerateAiResponse`).

## 9. Grupos e atribuição de participante

Grupo nunca ganha `contactId` (nunca é uma pessoa/Contact do CRM — testado explicitamente,
`tests/inbox-persistence.test.mjs`). Cada `InboxMessage` carrega `senderExternalId`/
`senderDisplayName` — a conversa representa o grupo inteiro, a mensagem representa o participante.
Nome do grupo (`groupName`) não vem no evento de mensagem do whatsmeow — fica `undefined` até uma
fonte real existir (ver "Riscos restantes"); frontend usa fallback seguro ("Grupo do WhatsApp"),
nunca inventa a partir do primeiro remetente.

## 10. CRM

`InboxContact`/CRM linking (`linkContactIdentity`) continua **manual**, inalterado — mas agora
gated no frontend: `CrmContextSection` (vínculo ao CRM) e o link "Abrir contato completo" só
aparecem para `chatType === "direct"` (`inbox-tab.tsx`). Backend reforça isso via `contactId`
opcional: uma tentativa de vincular grupo ao CRM não tem `contactId` pra vincular — a UI nunca
oferece a opção, e `CrmContextSection.handleLink` tem uma guarda defensiva adicional
(`!conversation.contactId` → no-op).

## 11. Merge/histórico (dados existentes)

**Não foi feito merge automático.** Antes da correção existiam **36 conversas pré-fix** no
workspace de homologação (`workspace-mscc9pi2-jkvwbo`) — todas classificadas `direct` pelo bug
antigo, já que grupo nunca existia como conceito. Como o mapper antigo **descartava** o
`Chat`/`IsGroup`/`IsFromMe` bruto, **não existe dado suficiente para reconciliar com certeza** quais
dessas 36 são: (a) pessoas realmente distintas, (b) fragmentos de um mesmo grupo/canal real, ou (c)
self-echo mal categorizado. Fazer merge com base só em nome+horário seria "merge cego" (juntar duas
pessoas por coincidência) — explicitamente proibido pelo pedido original (seção 19).

Criado `scripts/audit-inbox-pre-fix-duplicates.mjs` — **somente leitura**, nunca escreve/mescla
nada. Agrupa conversas pré-fix por proximidade temporal do primeiro evento (candidatos a "mesmo
grupo real fragmentado") e sinaliza conversas sem nome + muitas mensagens (candidatas a self-echo
mal categorizado), para revisão **humana**. Rodado contra produção (workspace de homologação):

- **40 conversas pré-fix** (workspace `workspace-mscc9pi2-jkvwbo`, corte = aplicação da migration
  0115).
- **6 clusters candidatos** a fragmentação de grupo/canal — ex.: 4 conversas com nomes reais
  distintos ("Eduardo Bragança", "Gabriel Moreira", "Gustavo Schmite", "VAGNER...") com primeiro
  evento em uma janela de 69 segundos — padrão consistente com múltiplos participantes reagindo a
  uma mesma postagem de grupo/canal em sequência, mas **não confirmável sem o `Chat` bruto**.
- **2 conversas sem nome de contato e com muitas mensagens** (134 e 18 mensagens, respectivamente,
  a primeira abrangendo toda a janela da homologação) — candidatas fortes a self-echo mal
  categorizado (mensagens do próprio operador, cujo evento nunca carrega `PushName`), mas também
  não confirmável com certeza pelos dados disponíveis.

**Decisão**: essas 40 conversas pré-fix permanecem como estão — não arquivadas, não mescladas, não
apagadas. Ficam como histórico "sujo" de antes da correção; recomendação é revisão manual pontual
pela equipe de atendimento (o script de auditoria pode ser reexecutado a qualquer momento, é
inofensivo). Toda conversa **criada depois da correção** já usa a identidade canônica correta desde
o primeiro evento.

## 12. Frontend

`web/features/inbox/types.ts`: `InboxConversation` ganha `chatType`/`groupName`, `contactId`/
`contactPhone` viram opcionais. `InboxMessage` ganha `senderExternalId`/`senderDisplayName`.
`InboxConversationLastMessagePreview` ganha `senderDisplayName` (preview "Maria: Fechou" em vez de
só "Fechou" — a última mensagem já trazia `direction`, faltava o nome de quem mandou).

`inbox-tab.tsx`: novos helpers `conversationTitle`/`conversationSubtitle` (grupo cai no fallback
"Grupo do WhatsApp" se `groupName` for `undefined`, nunca inventa nome a partir do primeiro
remetente) usados na lista, no header da thread e no painel de contexto. `MessageBubble` ganha prop
`isGroup` — mensagem inbound de grupo mostra `senderDisplayName` acima da bolha (ex.: "João"),
mensagem de DM continua sem repetir o nome (já está no header). `lastMessagePreviewLabel` prefixa
com o nome do remetente só em grupo. `CrmContextSection` (vínculo ao CRM) só renderiza para
`chatType === "direct"`.

## 13. Testes

`tests/wuzapi-event-mapper-media.test.mjs` (+9 testes novos): DM via `Chat`, grupo (`chatId` do
grupo, `senderId` do participante), dois participantes diferentes produzindo o mesmo `chatId`,
self-echo (`chatId` continua o peer), `@lid` tratado como pessoa, `@newsletter` tratado como
não-pessoa, `Timestamp` string ISO-8601 e numérico (fallback), fallback sem `Chat`.

`tests/inbox-persistence.test.mjs` (+4 testes novos, todos contra Postgres real via pglite):

- `DIRECT_CONVERSATION_IDENTITY`: inbound → outbound (self-echo idempotente) → inbound de novo,
  tudo na MESMA conversa (1 conversation, 3 mensagens reais).
- `GROUP_CONVERSATION_IDENTITY` + `GROUP_PARTICIPANT_ATTRIBUTION`: 3 participantes diferentes +
  resposta do Vorix + repetição de um participante — 1 `InboxConversation`, 5 mensagens, cada
  inbound com `senderExternalId` correto, `contactId` sempre `undefined`.
- `CONCURRENT_GROUP_MESSAGES`: dois participantes mandando via `Promise.all` (concorrência real) no
  mesmo grupo — 1 única conversa (nunca duas, mesmo sob corrida).
- Conversa de grupo nunca ganha `contactId` / nunca aparece com `crmContactId` na listagem.

Todos os call sites pré-existentes que criavam conversa/mensagem foram migrados pra nova assinatura
(`chatType`/`externalChatId` em vez de só `contactId`) em 13 arquivos de teste.

**Resultado**: 142 testes do módulo Conversas/CRM-Conversas, 142 passando. Suíte completa do
projeto (2886 testes): 2883-2886 passando conforme a corrida (2 falhas remanescentes,
`analytics.test.mjs`/`cli.smoke.test.mjs`, são flakiness de concorrência ao rodar TODOS os arquivos
num único processo — passam isoladamente, não têm relação com este módulo). `npm run
architecture:check` (incluindo `check-inbox-conversation-isolation` e `check-crm-isolation`): OK.

## 14. Runtime — DM real

**PARCIALMENTE VERIFICADO** contra produção, com tráfego real (não simulado): depois do deploy da
correção, novas conversas diretas (`@lid`) continuaram sendo criadas com `external_chat_id`
determinístico e **sem nenhuma duplicata** (`select ... group by connection_id, external_chat_id
having count(*) > 1` → 0 linhas). Não foi possível observar ao vivo, dentro desta sessão, o ciclo
completo "Pessoa X envia → Vorix responde pelo Vorix → Pessoa X envia de novo" com um humano
operando o WhatsApp em tempo real — a homologação ativa forneceu tráfego inbound real, mas nenhuma
resposta foi enviada pela UI do Vorix durante a janela observada.

## 15. Runtime — grupo real

**NÃO VERIFICADO.** Nenhum evento com `Info.Chat` terminando em `@g.us` chegou durante a janela de
observação — a homologação recebeu DMs (`@lid`) e um evento de Canal (`@newsletter`), não um grupo
tradicional. A lógica está coberta por testes automatizados determinísticos (contra Postgres real,
seção 13) usando os nomes de campo confirmados via código-fonte do `asternic/wuzapi`
(`Info.Chat`/`Info.IsGroup`/`Info.Sender` — mesma fonte já citada no cabeçalho original do mapper),
mas isso **não substitui** uma verificação com um grupo real de homologação.

## 16. Mídia em grupo

**NÃO VERIFICADO** (depende da seção 15 — precisa de um grupo real primeiro). O caminho de código é
o mesmo de DM (`downloadInboundMediaAndAttach`, inalterado por esta correção) — mídia recebida num
grupo entra na mesma `InboxConversation` do grupo, com `senderExternalId` da mensagem preservado.

## 17. Commits

- `debug(inbox): diagnóstico temporário de forma do payload bruto WuzAPI`
- `debug(inbox): expõe Timestamp/Type/AddressingMode bruto no diagnóstico temporário`
- `fix(inbox): corrige classificação de canal/@lid e parsing de Timestamp com payload real`
- (este commit) `fix(inbox): canonicaliza identidade de chats privados e grupos` — schema, mapper,
  use cases, repositórios Postgres/memória, ports, gate do diagnóstico atrás de env var.
- `fix(inbox-ui): apresenta grupos e remetentes corretamente` — frontend.
- `docs(inbox): registra investigação e correção da identidade canônica de chat` — este relatório +
  script de auditoria.

## 18. Migrations

`db/migrations/0115_inbox_canonical_chat_identity.sql` — aplicada em produção
(`workspace-mscc9pi2-jkvwbo`, servidor `vorixworks.com`) antes do redeploy do código novo, seguindo
a ordem segura (migration primeiro, código depois) — ver seção 19.

## 19. Deploy

Ordem seguida (produção real, `209.97.152.212`):

1. Deploy do diagnóstico temporário (só `vorix-worker`) → captura de payload real.
2. Ajustes no mapper com base no payload real (`@lid`/`@newsletter`/`Timestamp`).
3. Rebuild + restart de `zuno-api` + `vorix-worker` com o código da correção.
4. **Migration 0115 aplicada imediatamente depois do restart** (mesmo container, `node
   scripts/migrate.mjs`) — a imagem nova precisa existir antes da migration existir em disco
   (migrations são copiadas pra dentro da imagem no build, não montadas via volume). Há uma janela
   curta (segundos) entre o container novo subir e a migration aplicar; qualquer evento que chegasse
   nesse intervalo falharia e seria reprocessado pela escada de retry do RabbitMQ (nunca perdido) —
   não houve nenhum erro observado nos logs durante o deploy real.
5. Verificado: `GET /v1/health` OK, containers saudáveis, 0 conversas duplicadas
   (`connection_id, external_chat_id`) depois do deploy.
6. Segundo commit (classificação `@lid`/`@newsletter` + `Timestamp`) deployado só no worker.
7. Backup completo do código anterior preservado em `/opt/zuno/deploy_backups/` a cada passo.

Deploy do frontend (`zuno-web`) concluído em seguida (`docker compose up -d --build`, todos os 4
containers): `vorixworks.com`/`api.vorixworks.com` respondendo 200/OK, 115 migrations aplicadas, 0
conversas duplicadas, 2 conversas `chat_type='group'` (Canal/`@newsletter`, corretamente sem
`contact_id`) confirmadas no banco pós-deploy, sem erros nos logs de `zuno-api`/`vorix-worker` nos
minutos seguintes.

## 20. Riscos restantes

- **PN/LID cruzado**: se a mesma pessoa aparecer ora como `@s.whatsapp.net` ora como `@lid` em
  eventos diferentes, ela vira dois `InboxContact`/duas conversas. Sem payload real mostrando esse
  caso, não há como resolver com segurança agora — monitorar e tratar quando/se acontecer.
- **Grupo real (`@g.us`) nunca visto ao vivo** — a lógica está testada automaticamente com os nomes
  de campo confirmados via código-fonte, mas não com um payload real. Recomendo testar com um grupo
  de homologação real antes de considerar "Grupo" 100% pronto pra piloto (reativar
  `INBOX_DIAG_RAW_SHAPE=true` no `vorix-worker` pra capturar o primeiro evento real, se útil).
- **Nome do grupo (`groupName`) nunca preenchido** — o evento de mensagem do whatsmeow não carrega
  o assunto/nome do grupo; buscar isso exigiria uma chamada separada (ex. metadata de grupo da
  WuzAPI), não implementada nesta correção. Frontend usa fallback seguro.
- **Canal (`@newsletter`)** é tratado pelo mesmo caminho seguro de "grupo" (JID preservado, sem
  contato/CRM), mas a UX ainda mostra rótulo genérico de grupo — Canal e Grupo são conceitos
  diferentes no WhatsApp; a distinção visual entre os dois não foi implementada nesta correção
  (fora do escopo original, que era sobre GRUPOS).
- **Reconciliação histórica**: as 40 conversas pré-fix continuam fragmentadas/possivelmente
  incorretas — decisão deliberada de não mesclar às cegas (seção 11). Revisão manual recomendada.

## 21. Classificação final

```
DIRECT_CONVERSATION_IDENTITY        = VERIFIED_AUTOMATED (testes) + PARTIAL_RUNTIME (produção: sem duplicatas em tráfego real; ciclo completo com reply humano não observado nesta sessão)
GROUP_CONVERSATION_IDENTITY         = VERIFIED_AUTOMATED (testes) / RUNTIME NÃO VERIFICADO (nenhum @g.us real recebido)
GROUP_PARTICIPANT_ATTRIBUTION       = VERIFIED_AUTOMATED (testes) / RUNTIME NÃO VERIFICADO
OUTBOUND_DIRECT_SAME_CONVERSATION   = VERIFIED_AUTOMATED (testes) / RUNTIME NÃO VERIFICADO (nenhuma resposta enviada pela UI durante a janela observada)
OUTBOUND_GROUP_SAME_CONVERSATION    = VERIFIED_AUTOMATED (testes) / RUNTIME NÃO VERIFICADO
CONCURRENT_GROUP_MESSAGES           = VERIFIED_AUTOMATED (Promise.all real contra Postgres real)
EXISTING_DUPLICATES_RECONCILED      = NO (deliberado — dado insuficiente pra merge seguro; auditoria somente-leitura criada e executada, ver seção 11)
```

## 22. Próximos passos (aguardando revisão humana)

1. Deploy do frontend + verificação visual manual de uma conversa direta real.
2. Teste com um grupo de homologação real do WhatsApp — confirmar `@g.us` ao vivo e completar a
   verificação de runtime das seções 15/16/21.
3. Testar o ciclo completo de resposta humana (outbound via UI) com um contato direto real.
4. Revisão manual das 40 conversas pré-fix (script de auditoria já disponível).
5. **Não ativar IA nem iniciar piloto até a revisão acima.**
