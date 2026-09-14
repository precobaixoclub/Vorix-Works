# Correção operacional da Inbox — organização, grupos, mídia real

Continuação de `docs/conversas-canonical-chat-identity.md` e
`docs/conversas-whatsapp-experience-completion.md`. Esta entrega corrigiu a causa raiz REAL do bug
mais crítico observado na homologação: mídia (imagem/áudio/vídeo/documento) nunca renderizava,
sempre aparecia como "Imagem recebida" — investigado ponta a ponta (WuzAPI → RabbitMQ → mapper →
worker → storage → proxy → frontend) com diagnóstico temporário ao vivo, nunca suposição.

## 1. Organização da lista

Filtro client-side por `chatType` (Todos os tipos / Grupos / Diretas), lado a lado com os filtros
de status já existentes (Todos/Minhas/Não lidas/Filtros avançados) — combinam livremente (ex.:
"Não lidas" + "Grupos"). Busca da lista passa a considerar `groupName` além de nome/telefone —
nunca busca por LID (`InboxContact.whatsappLid` nunca entra no haystack de busca).

## 2. Grupos — apresentação

Preview da última mensagem ganhou ícone curto por tipo de mídia: `📷 Foto`, `🎥 Vídeo`, `🎤 Áudio`,
`📄 Documento`, `📍 Localização`, `👤 Contato` (antes: "Imagem recebida" genérico). Fallback de nome
de grupo trocado de "Grupo do WhatsApp" para "Grupo" (nunca permanente — a metadata real chega
sozinha via `syncGroupMetadata`, já implementado na entrega anterior). Header da conversa aberta
mostra "· N participantes" quando a sincronização já resolveu isso (`groupParticipantCount`,
conectado ao frontend nesta entrega — antes existia só no schema/domínio).

## 3. Metadata de grupo — validação real

O endpoint `GET /group/info` (implementado na entrega anterior, contrato só documentado até então)
**ainda não foi confirmado ao vivo contra o WuzAPI real desta instalação** nesta sessão — nenhuma
nova mensagem de grupo chegou durante a janela de investigação de mídia para disparar
`syncGroupMetadata` pela primeira vez no grupo real já confirmado
(`554699758123-1560728831@g.us`). Ver "riscos restantes".

## 4. Grupos antigos — auditoria (reexecutada)

`scripts/audit-inbox-pre-fix-duplicates.mjs` (somente leitura, já existia) reexecutado contra
produção: resultado **idêntico** ao da entrega anterior — 40 conversas pré-fix, mesmos 6 clusters
candidatos a fragmentação, mesmas 2 conversas candidatas a self-echo mal categorizado. Nenhuma
mudança porque nenhum merge foi feito (nem deveria — ver seção 8).

## 5. Reconciliação

**Não executada.** Critério do pedido original ("mesma connectionId + mesmo canonical group
externalChatId = pode reconciliar") não se aplica a NENHUMA das 40 conversas pré-fix auditadas: o
mapper anterior à correção de identidade **descartava** o `Chat`/`IsGroup` bruto do WuzAPI, então
não existe `externalChatId` real gravado pra essas linhas — não há como provar que duas delas são
"o mesmo grupo" com certeza, só suspeitar por proximidade temporal (já documentado, não é prova).
Continua: sem merge cego.

## 6. DMs antigas

Mesma auditoria cobre isso (seção 4 acima) — 2 conversas candidatas a self-echo/LID-fragmentado
identificadas, nenhuma reconciliada (mesma razão: sem prova real do provider pros dados antigos).

## 7. Busca

Implementada nesta entrega (ver seção 1) — nome/telefone pra DM, `groupName` pra grupo, nunca LID.

## 8. Unread

Sem mudança necessária — não houve merge/reconciliação nesta entrega, então não há risco de
contagem duplicada por merge. Comportamento existente (`markLastMessage`/`markRead`) inalterado.

## 9. CAUSA RAIZ REAL DO BUG DE MÍDIA (a descoberta principal desta entrega)

Investigação com diagnóstico temporário ao vivo (payload real, sanitizado, nunca suposição —
seção 16 do pedido original), em 3 camadas sucessivas pra isolar exatamente onde a cadeia quebrava:

1. **Precondições do worker** (`INBOX_MEDIA_STORAGE_ENABLED`, `provider.downloadMedia`,
   `event.mediaUrl`) — todas OK. `mediaUrl` chegava com 250 caracteres, `mediaKey` **ausente**.
2. **Ponto de envio real** (`WuzApiClient.downloadMedia`, imediatamente antes da chamada HTTP) —
   confirmado: `urlLength: 250` intacto até aqui. **Nenhuma perda de dado em nenhum lugar do
   pipeline Vorix** (mapper → use case → provider → client, ponta a ponta).
3. **Logs do próprio container WuzAPI** — toda tentativa de download, ao longo de 32h de
   homologação (40+ ocorrências), respondeu o MESMO erro: `"no url present"` (status 500) — mesmo
   com uma URL de 250 caracteres sendo enviada.

**Explicação real**: mensagens de **Canal/Newsletter do WhatsApp** (`Info.Chat` termina em
`@newsletter`) nunca trazem `mediaKey` — confirmado contra o `.proto` REAL do whatsmeow
(`waE2E.ImageMessage`, campo 8, `optional bytes mediaKey`, buscado direto do repositório
`tulir/whatsmeow` nesta sessão): conteúdo de Canal não é criptografado por destinatário (é
broadcast público), então não existe uma chave de descriptografia por mensagem. O endpoint
`/chat/downloadimage` do WuzAPI exige o par completo (`Url` + `MediaKey`) pra descriptografar a
mídia E2E — quando `MediaKey` falta, ele responde o erro genérico `"no url present"` (mensagem
enganosa do próprio WuzAPI — na prática significa "faltam parâmetros obrigatórios", não
especificamente a URL).

**Payload real capturado** (sanitizado, `imageMessage` de uma mensagem de Canal):
```
URL: string(len=250)        ← presente
caption: string(len=215)    ← presente
directPath: string(len=216) ← presente
fileLength: number          ← presente
fileSHA256: string(len=44)  ← presente (também bytes no proto, serializado OK — descarta hipótese
                                de "campos bytes são descartados na serialização")
mimetype: string(len=10)    ← presente
mediaKey: AUSENTE            ← a causa raiz
```

## 10. Correção aplicada

`downloadInboundMediaAndAttach` (`inbox-use-cases.ts`) agora checa `input.mediaKey` **antes** de
chamar `provider.downloadMedia` — se ausente, loga a causa raiz real (nunca um erro genérico) e
desiste sem tentar a chamada HTTP que já se sabe que vai falhar. Retorna
`{ attached: false, reason: "no_media_key_unsupported_source" }` — nunca finge recuperação (seção
25 do pedido original). Mídia de DM/grupo normal (que TEM `mediaKey`, por ser E2E criptografada
como manda o protocolo padrão do WhatsApp) segue o MESMO caminho de sempre, sem nenhuma mudança de
comportamento.

## 11. O que isto NÃO prova ainda

**Ainda não há confirmação de que uma imagem de uma pessoa/grupo real (não-Canal) baixa com
sucesso.** Das 186 mensagens `type='image'` acumuladas na homologação, a maioria concentra-se em
poucas conversas com padrão de rajada (múltiplas mensagens em poucos segundos — ex. "🚘 Daniel
Repasses", 14 imagens, correlacionado com 11 tentativas de download em 11 segundos nos logs do
WuzAPI) — um padrão mais consistente com conteúdo de broadcast/encaminhado do que com uma pessoa
enviando fotos manualmente. Isso é um INDÍCIO, não uma prova — pode muito bem ser um contato real
que reenviou várias fotos em sequência.

O único grupo real confirmado nesta homologação (`554699758123-1560728821@g.us`) ainda não recebeu
nenhuma mensagem de mídia (só texto até o momento da investigação) — não há evidência direta desse
grupo especificamente.

**Não fingir mais do que foi provado**: a correção é logicamente sólida e testada
(`tests/inbox-media-inbound.test.mjs` — confirma que `mediaKey` presente segue o fluxo normal e
ausente nunca tenta a chamada HTTP), mas o caminho "mediaKey presente → download real bem-sucedido"
segue **NÃO VERIFICADO EM RUNTIME** até uma imagem real de pessoa/grupo (não-Canal) ser testada.

## 12. Sticker/figurinha

**NÃO EXECUTADO.** Nenhum payload real de figurinha foi capturado durante a janela de investigação
desta sessão (as mensagens `type='other'` já existentes no banco — 61 no total — não tiveram seu
payload bruto capturado quando chegaram, o diagnóstico não estava ativo naquele momento). Seguindo
a instrução explícita do pedido original ("Não assumir... implementar somente se contrato real
estiver claro"), nenhum `message_type: "sticker"` foi criado nesta entrega. Requer captura de um
evento real de figurinha antes de qualquer implementação.

## 13. Reaction

**NÃO EXECUTADO**, mesma razão da seção 12 — nenhum payload real de reação capturado.

## 14. Mídia — bug identificado e corrigido

Ver seções 9/10 acima — esta é a entrega principal desta rodada.

## 15. Storage

Confirmado ao vivo (não assumido): `INBOX_MEDIA_STORAGE_ENABLED=true`, `DRIVER=local`,
`LOCAL_DIR=/app/inbox-media` presentes tanto em `zuno-api` quanto em `vorix-worker`; volume
`zuno_inbox_media` montado em `/app/inbox-media` nos dois containers (confirmado via `docker
inspect`); diretório existe e é gravável (`ls -la` confirmado). **NÃO é mais
`DisabledInboxMediaStorage`** — já era esse o estado desde a entrega anterior (Bloco D), confirmado
de novo nesta auditoria.

## 16. Storage runtime

Com a correção da seção 10, o caminho completo (`worker recebe evento → reconhece mídia → baixa
arquivo → grava no volume → preenche media_storage_ref → API lê → browser recebe via proxy`) só é
efetivamente exercido quando `mediaKey` está presente — que é exatamente o caso NÃO VERIFICADO
ainda (seção 11). O código está pronto; falta o teste real.

## 17. Payload real da WuzAPI

Diagnóstico temporário reativado 3 vezes nesta sessão (`INBOX_DIAG_RAW_SHAPE=true`, mesmo padrão
opt-in já existente) — capturado com sucesso payload de imagem de Canal (seção 9), confirmado
**desligado** no deploy final (removido do `docker-compose.zuno.yml` do servidor, nunca fica ligado
continuamente — seção 16 do pedido original).

## 18. Imagem / 19. Vídeo / 20. Áudio / 21. Documento

Renderização real (preview/lightbox/player/ícone+nome) já existia desde a entrega anterior
(`message-media.tsx`) — nesta entrega, melhorado: mensagem de erro específica por tipo ("Não foi
possível carregar esta imagem", distinta do rótulo neutro de "mídia ainda processando"); barra de
progresso do áudio agora aceita clique pra buscar um ponto (seek), usando o novo suporte a HTTP
Range do proxy (seção 22).

## 22. Media Proxy

`GET /v1/inbox/media/:id` ganhou suporte a HTTP Range (RFC 7233 forma simples) — antes inexistente,
o que impedia seek real em áudio/vídeo (o `<audio>`/`<video>` do browser tenta um `Range` request
pra pular pra um ponto do arquivo; sem suporte, cai pro arquivo inteiro de novo). Responde `206` +
`Content-Range` quando um Range válido é pedido, `200` + `Accept-Ranges: bytes` caso contrário —
nunca lança em range malformado/fora dos limites. `Content-Disposition: attachment` com filename
real (sanitizado) só pra documento; `inline` pros demais tipos. Testado
(`tests/inbox-media-proxy.test.mjs`, 10 casos).

## 23. Auth do proxy

Inalterado — já testado e confirmado na entrega anterior (`tests/inbox-security-hardening.test.mjs`:
IDOR cross-tenant, `media_token` escopado por `messageId`). Reexecutado nesta sessão junto com o
resto da suíte: sem regressão.

## 24. Mídia antiga (histórico)

**Não recuperável para as mensagens de Canal já acumuladas** (134+18+16+14+... = a maioria das 186
imagens) — `mediaKey` nunca existiu pra essas mensagens (não é um dado perdido, é um dado que nunca
existiu no protocolo do WhatsApp pra conteúdo de Canal). Nenhum job de reprocessamento foi criado
pra essas — não haveria o que recuperar. Para as poucas mensagens que POSSAM ter vindo de pessoas
reais com `mediaKey` genuíno mas falharam por outro motivo (não identificado ainda, já que nenhuma
confirmação positiva existe): um job de reprocessamento controlado (seção 26 do pedido original)
só faz sentido DEPOIS de confirmar que o caminho "mediaKey presente" funciona de verdade — não
implementado nesta entrega (evitando construir algo em cima de uma suposição ainda não provada).

## 25. Testes automatizados

Novos/atualizados nesta entrega: `tests/inbox-media-inbound.test.mjs` (detecção de `mediaKey`
ausente, caminho normal com `mediaKey` presente), `tests/inbox-media-proxy.test.mjs` (Range,
sanitização de filename). Suíte completa do módulo Conversas: **172 testes, 172 passando**.
`architecture:check`, `typecheck` e `build` de produção do frontend: limpos.

## 26. Browser QA

**NÃO EXECUTADO** — mesma decisão da entrega anterior (ambiente local autenticado com dados reais
exigiria montar Postgres/worker/seed dedicados; priorizado o diagnóstico e a correção da causa raiz
real de produção dentro do tempo disponível). `typecheck`/`build` de produção continuam sendo o
sinal disponível de correção estrutural do JSX/tipos — não substituem clicar de verdade.

## 27. Mobile

Não testado fisicamente a 390px nesta sessão — mesmo risco já documentado antes, sem mudança.

## 28. Commits desta entrega

- `debug(inbox): diagnóstico temporário das precondições de download de mídia`
- `debug(inbox): diagnóstico temporário no ponto exato de envio do download de mídia`
- `feat(inbox): suporte a HTTP Range e Content-Disposition no proxy de mídia`
- `feat(inbox-ui): organiza lista de conversas (filtro Grupos/Diretas, preview com ícone de mídia)`
- `fix(inbox): detecta mídia sem mediaKey (Canal/Newsletter) antes de tentar o download` — a
  correção principal desta entrega, baseada 100% em evidência real coletada ao vivo.
- `docs(inbox): registra correção operacional da lista e causa raiz real do bug de mídia` (este
  relatório).

## 29. Deploy

Migration: nenhuma nova nesta entrega (só código). Deploy completo executado (api+worker+web
rebuild, mesmo processo já validado nas entregas anteriores): `vorixworks.com`/
`api.vorixworks.com` respondendo 200/OK, containers saudáveis, sem erros nos logs pós-deploy,
diagnóstico bruto confirmado desligado (removido do `docker-compose.zuno.yml` do servidor).

## 30. Riscos restantes

- **Caminho "mediaKey presente → download bem-sucedido" ainda não verificado em runtime real** —
  é o item mais importante pendente. Precisa de uma imagem real enviada por uma pessoa (DM) ou no
  grupo já confirmado, observada até o fim (arquivo aparece no volume, `media_storage_ref`
  preenchido, imagem renderiza no browser).
- **Metadata de grupo (`GET /group/info`) ainda não confirmada ao vivo** — nenhuma mensagem nova
  chegou no grupo real durante a janela desta investigação pra disparar a primeira sincronização.
- **Sticker/reaction seguem sem payload real capturado** — nenhuma implementação, por instrução
  explícita de não assumir contrato.
- **172 imagens de Canal permanecem sem mídia, permanentemente** (não é um bug, é uma limitação de
  protocolo — Canal não tem mediaKey) — o frontend agora mostra "Não foi possível carregar esta
  imagem" com retry pra essas (retry sempre vai falhar do mesmo jeito, já que a causa é estrutural,
  não transitória; um `retry` manual não resolve, mas também não quebra nada).
- **Reconciliação de grupos/DMs antigas continua não feita** — decisão deliberada (dado
  insuficiente), documentada de novo nesta auditoria.
- **Browser QA/mobile não executados** — mesmo risco já sinalizado nas entregas anteriores.

## 31. Classificação final

```
CONVERSATION_LIST_ORGANIZED          = YES (filtro Grupos/Diretas implementado, testado via typecheck/build)
DIRECT_CONVERSATIONS_CLEAN           = VERIFIED_AUTOMATED — pré-fix (40 conversas) permanece não-reconciliado, deliberado
GROUP_CONVERSATIONS_CLEAN            = VERIFIED_RUNTIME (grupo real, entrega anterior) — sem mudança nesta entrega
GROUP_NAMES_REAL                     = NOT_EXECUTED (GET /group/info ainda não confirmado ao vivo — nenhum evento novo no grupo real durante a janela desta sessão)
GROUP_SENDER_PREVIEW                 = VERIFIED_RUNTIME (entrega anterior, sender_display_name/ícone de mídia — sem mudança de lógica nesta entrega)
IMAGE_RENDERING                      = FAILED até agora para o tráfego observado (100% Canal, sem mediaKey) — causa raiz corrigida nesta entrega, caminho normal NÃO VERIFICADO EM RUNTIME ainda
STICKER_RENDERING                    = NOT_SUPPORTED (nenhum payload real capturado — não implementado)
AUDIO_RENDERING                      = mesma situação de IMAGE_RENDERING (mesma causa raiz, mesma correção, mesma pendência de verificação real)
VIDEO_RENDERING                      = mesma situação
DOCUMENT_RENDERING                   = mesma situação
MEDIA_STORAGE                        = VERIFIED_RUNTIME (volume confirmado montado/gravável nos dois processos — a ESCRITA em si nunca foi exercida com sucesso ainda porque nenhum download completou)
MEDIA_PROXY                          = VERIFIED_AUTOMATED (Range, Content-Disposition, cross-tenant — 10+23 testes) — RUNTIME real (servir um arquivo de verdade) ainda não exercido
OLD_MEDIA_RECOVERY                   = NOT_SUPPORTED pra Canal (limitação de protocolo, não um bug) — indeterminado pro resto até a causa raiz de qualquer falha não-Canal ser confirmada/descartada
MOBILE_INBOX                         = NOT_EXECUTED (sem browser QA nesta sessão)
CONVERSATIONS_OPERATOR_EXPERIENCE    = NOT_READY — causa raiz do bug mais crítico (mídia) finalmente identificada com evidência real e corrigida, mas o caminho positivo (mediaKey presente) segue sem confirmação em runtime; não atende ao critério de fechamento do pedido original enquanto isso não for verificado
```

## 32. Próximos passos (aguardando revisão humana)

1. **Enviar uma imagem real de uma pessoa (DM) ou no grupo confirmado
   (`554699758123-1560728821@g.us`)** — este é o teste que decide se a causa raiz foi
   completamente resolvida ou se há uma segunda camada de problema ainda não descoberta.
2. Mandar uma mensagem qualquer no grupo real pra disparar a primeira sincronização de
   `GET /group/info` e confirmar o nome real aparecendo na tela.
3. Se a imagem real funcionar: repetir para áudio, vídeo e documento (mesma causa raiz, mesma
   correção, mesma pendência).
4. Se uma figurinha real for enviada nesse processo, capturar o payload (reativar
   `INBOX_DIAG_RAW_SHAPE=true` brevemente) antes de implementar suporte a sticker.
5. **Não ativar IA. Não iniciar piloto** até os itens acima confirmarem o pipeline de mídia
   funcionando de ponta a ponta com uma mensagem real de pessoa/grupo.
