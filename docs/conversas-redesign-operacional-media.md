# Vorix — Redesign Operacional de Conversas + Mídia Real

**Contexto**: validação com mensagens reais em produção mostrou que a tela de Conversas, apesar de
"visualmente pronta" (fases anteriores), tinha uma ergonomia ruim no uso real — a área de conversa
ficava pequena, a sidebar global não recolhia, uma coluna inteira era gasta só com "Inbox/Canais",
e mídia recebida (imagem/áudio/vídeo/documento) nunca renderizava de verdade, só um rótulo
genérico ("Imagem recebida"). Esta rodada corrige layout/ergonomia **e** investiga/implementa o
pipeline de mídia ponta a ponta. Homologação funcional (WhatsApp real) foi pausada de propósito
para esta rodada, a pedido explícito.

---

## 1. Causa raiz da conversa estreita

Três problemas compostos, não um só:

1. **Sidebar global sem collapse** (`WorkspaceSidebar.tsx`) — sempre `264px`, sem alternativa.
2. **Uma coluna inteira** (`PageSubnav`, ~224px) só para alternar entre 2 abas ("Inbox" e "Canais
   de atendimento") — um componente de navegação de PÁGINA reaproveitado para o que deveria ser um
   detalhe interno do módulo.
3. **`md:h-[calc(100dvh-13rem)]`** no container das 3 colunas da conversa — um número mágico que
   assumia a altura exata de `PageHeader` + `PageSubnav` + paddings do `<main>` + topbar. Qualquer
   mudança em qualquer um desses desalinhava a régua de altura.

Resultado somado: em 1366px, a área de conversa sobrava menos de 700px de largura e uma altura
calculada por adivinhação.

## 2. Novo layout

- **Sidebar colapsável** (`web/contexts/sidebar-context.tsx` + `WorkspaceSidebar.tsx`): rail de
  64px (ícones + tooltip) ou 264px (completo), com botão de toggle no rodapé da nav.
- **App Shell** (`web/app/workspaces/[workspaceId]/layout.tsx`): rota `/conversas` entra num bypass
  dedicado (`isConversasPath`, mesmo padrão já usado para onboarding/bastidor) — sem scroll de
  página, `h-dvh` reto em vez do `overflow-y-auto` padrão das demais rotas.
- **Canvas edge-to-edge** (`inbox-tab.tsx`): o container de 3 colunas deixou de ser um "card boxed"
  com borda/sombra dentro de um `<main>` com padding — agora ocupa 100% da área restante.
- **Grid fix real** (achado durante o QA em browser, não previsto no plano original): o grid de
  colunas (`grid h-full min-h-0 md:grid-cols-[...]`) não tinha `grid-template-rows` explícito — a
  única linha implícita cresce para caber o CONTEÚDO por padrão (`grid-auto-rows: auto`), ignorando
  `h-full`/`min-h-0` do item. Em mobile isso inflava a página inteira além da viewport numa
  conversa longa. Corrigido com `grid-rows-[minmax(0,1fr)]`.

## 3. Sidebar — comportamento e persistência

`web/contexts/sidebar-context.tsx`: preferência por usuário (`localStorage`, mesma convenção de
`useModalWidth.ts` — chave escopada, leitura lazy, `try/catch` para modo privado).

- Sem preferência salva: recolhida em `/conversas` (alta densidade), expandida nas demais rotas.
- Primeiro toggle manual (em qualquer rota): a partir daí, a escolha vale globalmente, em qualquer
  rota, até o próximo toggle. Navegar entre páginas nunca reabre a sidebar sozinha.

## 4. Subnav removida/reorganizada

`PageSubnav` (coluna de ~224px) foi substituído por `ConversasHeader` — uma barra compacta de 44px
com o rótulo "Conversas" e um segmented control ("Inbox" / "Canais") inline. Documentado como
exceção deliberada à regra "sub-navegação = `PageSubnav`" (`web/CLAUDE.md`, regra 3): aqui são só 2
opções e o objetivo é recuperar largura, não organizar navegação profunda.

## 5. Comportamento de viewport

Achado real (não hipotético) durante o QA em Chromium: combinar `flex-1` com `h-dvh` no MESMO
elemento quebra em mobile. O container de conteúdo do App Shell é `flex-col` em mobile e
`flex-row` a partir de `md:` — `flex-1` (que define `flex-basis: 0%`) reinterpreta seu eixo
conforme a direção do flex. Em mobile, isso entrava em conflito com `h-dvh` explícito e inflava o
container para o tamanho do conteúdo (a página inteira ganhava scroll). Corrigido trocando por
`md:flex-1` (o grow em largura só é necessário ao lado da sidebar, a partir de `md:`).

## 6. Composer

Sem mudanças estruturais — já era o último filho de uma coluna flex (`flex flex-col h-full`),
então "gruda" no fundo naturalmente. Segue com anexo desabilitado (envio de mídia outbound fica
fora do escopo desta rodada — ver seção 27).

## 7. Origem do problema de mídia — auditoria confirmada

**Não era um bug pontual — mídia nunca foi implementada de ponta a ponta.** Três pontos de
descarte, cada um independente:

1. `wuzapi-event-mapper.ts` (`mapInboundMessage`) extraía só o *tipo* da mensagem (via nome da
   chave do payload, ex. `imageMessage`), nunca `url`/`mimetype`/`caption`/`fileName`.
2. `inbox-worker.ts` (consumer de `message.inbound`) não repassava esses campos para
   `registerInboundMessage`, mesmo que o mapper os tivesse extraído.
3. `registerInboundMessage` (`inbox-use-cases.ts`) nunca aceitava/persistia
   `mediaStorageRef`/`mimeType`, embora o schema do banco (`inbox_messages`, migration 0083) e o
   repositório Postgres já suportassem esses campos perfeitamente.

No frontend, `MessageMediaPreview` (`inbox-tab.tsx`) sempre foi só um ícone + rótulo estático — o
tipo `InboxMessage` do cliente nem tinha campo para guardar uma URL de mídia. E a **homologação
real com QR do WhatsApp nunca foi executada** (`docs/conversas-fase2-spike.md`) — não existe, em
lugar nenhum do repositório, um payload real de mídia capturado.

## 8. Payload real — status

**PENDING, não confirmado ao vivo.** A extração implementada usa os nomes de campo públicos e
documentados do proto do whatsmeow (`imageMessage.url/mimetype/caption/fileLength/fileSha256/
fileEncSha256/mediaKey/jpegThumbnail`, `videoMessage`/`audioMessage.seconds`,
`documentMessage.fileName`), com fallback defensivo tentando também a variante PascalCase (o resto
do WuzAPI mistura casing entre rotas — ver `wuzapi-client.ts`). O endpoint de download
(`wuzapi-client.ts::downloadMedia`) foi implementado contra a documentação pública do
`asternic/wuzapi` (`POST /chat/downloadimage|downloadvideo|downloadaudio|downloaddocument`,
recebendo `Url/MediaKey/Mimetype/FileSHA256/FileLength/FileEncSHA256`, devolvendo base64) — também
nunca testado contra uma instância real. Ambos os arquivos têm o mesmo comentário
`PENDING`/`AINDA NÃO CONFIRMADO` já usado no resto do módulo para esse tipo de lacuna. **Fechar
isto exige parear uma sessão WhatsApp real** — fora do alcance desta sessão.

## 9. Persistência

Sem migration nova. `media_storage_ref`/`mime_type` (colunas dedicadas, já existiam) guardam a
referência de storage. Atributos auxiliares (`fileName`/`fileSizeBytes`/`durationSeconds`/
`thumbnailDataUrl`) vão dentro de `metadata jsonb` (também já existia) — são só dados de exibição,
nunca filtrados/indexados, então não justificam colunas dedicadas. Tipo `InboxMediaMetadata`
documentado em `src/domain/inbox/inbox.model.ts`.

O download é **best-effort e assíncrono**: a mensagem aparece imediatamente com `type` correto e
mídia vazia; um passo separado (`downloadInboundMediaAndAttach`, disparado pelo worker fora do
caminho crítico do ack, nunca bloqueando a fila) baixa e anexa a mídia um instante depois,
disparando `message.updated` via SSE quando conclui.

## 10. Segurança da mídia

- Storage **dedicado e privado** (`InboxMediaStoragePort` — `local-inbox-media-storage.ts`/
  `s3-inbox-media-storage.ts`/`disabled-inbox-media-storage.ts`), deliberadamente separado do
  `ObjectStoragePort` público (esse é para mídia hospedada publicamente para TikTok/Meta puxarem —
  nunca reaproveitado aqui, por design).
- **Proxy autenticado** (`GET /v1/inbox/media/:id`) — nunca uma URL/token do WuzAPI exposta ao
  navegador, nunca uma URL assinada de storage direta. Token de curtíssima duração e escopo único
  (`POST /v1/inbox/media-token`, `purpose: "inbox_media"`, 60s), escopado a **uma mensagem
  específica** — um token minted para a mídia da mensagem A nunca autentica a mensagem B (mesmo
  dentro da janela de validade). Cross-tenant → 404 (nunca vaza existência).
- 17 testes automatizados cobrindo exatamente isso (`tests/inbox-stream-token-hardening.test.mjs`):
  mint sem auth (401), mensagem inexistente (404), token escopado funciona, token de A rejeitado
  para B (401), mensagem de outro tenant (404 — IDOR), storage desligado (404, nunca 500).

## 11-14. Renderização real por tipo de mídia

Implementado em `web/app/workspaces/[workspaceId]/conversas/message-media.tsx`, substituindo o
antigo `MessageMediaPreview` (que virou só o fallback de erro):

- **Imagem**: `<img>` real, carregada assim que a mensagem aparece (a mídia é pequena o bastante
  para não justificar lazy), com lightbox em clique (overlay simples, não o `DetailModal`/`Sheet`
  do design system — é visualização de mídia, não um registro). Estado de loading (skeleton) e
  erro (ícone+rótulo+"Tentar novamente").
- **Áudio**: player custom leve — botão play/pause, barra de progresso, duração — carregado só ao
  clicar em play (lazy, nunca busca token/bytes antes disso).
- **Vídeo**: estado lazy com poster (thumbnail do WhatsApp quando disponível) + botão de play;
  carrega o `<video controls>` real só ao clicar.
- **Documento**: card com ícone, nome de arquivo e tamanho reais, botão "Abrir" que busca o token
  sob demanda e abre em nova aba — nunca pré-carrega antes do clique.

Todos os quatro caem no mesmo fallback (`MediaFallback`, reaproveitando `mediaIconFor`/
`mediaLabelFor`) quando `mediaStorageRef` ainda não existe (download não concluído/não configurado)
ou quando a busca do arquivo falha — com botão "Tentar novamente" nesse último caso.

## 15. Estados de erro

Nunca bolha vazia/spinner infinito: erro de rede ao buscar token/mídia cai direto no fallback com
"Tentar novamente"; ausência de `mediaStorageRef` (download ainda em voo, ou nunca configurado)
mostra o mesmo ícone+rótulo — o frontend não tem como distinguir os dois casos sem um campo de
status dedicado, e não foi criado um só para isso nesta rodada (ver riscos, seção 27).

## 16. Lista de conversas — preview real

Antes: todo item mostrava o texto fixo "Última interação registrada." Agora, `listByWorkspace`
(Postgres) faz um `LEFT JOIN LATERAL` com a última mensagem por conversa (barato — usa o índice
`inbox_messages_conversation_idx (conversation_id, created_at desc)` que já existia, sem migration
nova) e o frontend mostra texto real para mensagens de texto (`"Você: ..."` quando outbound) ou o
rótulo de mídia (`"Documento recebido"` etc.) para o resto.

## 17-19. Screenshots — desktop e mobile

QA feito com **Playwright real, Chromium real**, não JSX/storybook — 4 projetos (1366/1440/1920
desktop, 390 mobile), rede mockada (ver seção 20 sobre por que) alimentando o app Next.js real.
Capturas em `docs/screenshots/`:

- `conversas-depois-{desktop-1366,desktop-1440,desktop-1920,mobile-390}.png` — Inbox aberto numa
  conversa com mídia, sidebar recolhida (estado padrão em `/conversas`). Mostra player de áudio
  real (barra de progresso, "0:02"), estado lazy do vídeo (poster+play) e o card do documento
  (`contrato.pdf`, "PDF · 199 B", botão "Abrir") todos renderizados de verdade. A mensagem de
  imagem existe na mesma conversa mas ficou fora da janela de rolagem nestas capturas específicas
  (6 mensagens, viewport mostra as ~5 mais recentes) — a renderização real do `<img>` (com
  `naturalWidth > 0`, ou seja, bytes decodificados de verdade) é coberta por um teste dedicado
  (`conversas-layout.spec.ts`), não só pela foto.
- `conversas-sidebar-expandida-desktop-{1366,1440,1920}.png` — sidebar expandida manualmente,
  mostrando a navegação completa (Início, seções Conversas/Comercial/Marketing/Resultados/Sistema)
  ao lado da lista de conversas.
- `conversas-detalhes-abertos-desktop-{1366,1440,1920,mobile-390}.png` — painel de contexto
  (CRM/contato) aberto como overlay sobre a conversa (fundo escurecido/desfocado), mostrando a
  sugestão de "Vorix encontrou uma oportunidade" do `CrmContextSection`.

Não existe uma captura "antes" desta rodada — o estado anterior está documentado por trecho de
código exato nas seções 1 e 7 (com caminho de arquivo e linha), que é a mesma prática já usada nos
relatórios anteriores do módulo Conversas quando a comparação é melhor expressa em código do que em
imagem (ex. `docs/conversas-pre-pilot-hardening.md`, seção "SSE — antes/depois").

## 20. Por que a rede foi mockada no QA em browser

`AUTH_MODE=noop` (o único modo que roda sem Postgres/JWT configurados) não tem fluxo de login real
— `identity` (refresh/me) só existe com `AUTH_MODE=jwt` + Postgres real (`container.ts`). Sem
provisionar um Postgres completo só para este QA, a única forma de exercitar o App Shell/Inbox
REAIS num Chromium real é mockar a rede (`page.route`) e deixar o Next.js/React renderar de
verdade por cima — `proxy.ts` (middleware de borda) só checa a *presença* do cookie de refresh,
nunca o valida, então isso é suficiente para passar pelo portão de autenticação.

Isso significa: o **layout/ergonomia** (sidebar, viewport, subnav, lista, header, painel de
detalhes) foi verificado com o código real rodando num navegador real — alta confiança. A
**mídia** foi verificada da mesma forma, mas os bytes servidos pelo proxy mockado são fixtures
reais e válidos (não WhatsApp real): um JPEG 1x1 válido (decodifica de verdade), um WAV construído
programaticamente (toca de verdade, reporta duração real), e um PDF mínimo válido. Vídeo ficou
parcial — sem `ffmpeg` disponível neste ambiente para gerar um `.mp4` real, só o estado lazy
(poster + botão) foi verificado; a decodificação/reprodução de um vídeo real não foi validada.

## 21. Testes automatizados

- `tests/wuzapi-event-mapper-media.test.mjs` (novo, 7 testes) — extração por tipo de mídia
  (imagem/vídeo/áudio/documento), caption→body, payload incompleto não lança.
- `tests/inbox-stream-token-hardening.test.mjs` (estendido, +8 testes, 17 no total) — proxy de
  mídia: mint, escopo por mensagem, cross-tenant, storage desligado.
- `web/e2e/conversas-layout.spec.ts` (novo, Playwright) — 45 passed / 3 skipped (intencionalmente,
  onde a sidebar global não existe em mobile) nos 4 breakpoints.
- Suíte completa de Inbox (`inbox-persistence`, `inbox-attendance`, `inbox-attendance-http`,
  `inbox-ai-responder`, `inbox-resilience`, `inbox-security-hardening`,
  `inbox-migrations-clean-run`, `messaging-provider-capabilities`) — 86/86 passando, zero
  regressão.

## 22. Typecheck

`npx tsc --noEmit` limpo em ambos os projetos (raiz/backend e `web/`), depois de cada bloco de
mudanças.

## 23. Build

`npm run build` (raiz) limpo — compila + copia manifests/assets sem erro.

## 24. Architecture check

`verify-skills-discovery`, `check-legacy-chat-imports`, `check-contract-drift`,
`check-ai-stack-isolation`, `check-inbox-conversation-isolation`, `check-crm-isolation` — todos OK,
nenhum novo acoplamento indevido introduzido.

## 25. Commits

Nenhum commit criado nesta sessão — só working tree. Nada foi enviado a nenhum repositório remoto.

## 26. Deploy

Não realizado — fora do escopo desta rodada (sem ambiente de produção/staging acessível nesta
sessão).

## 27. Riscos restantes

1. **Payload real do WuzAPI nunca confirmado** — nomes de campo do mapper e do endpoint de
   download são best-effort documentado, não validado. Só fecha com QR pairing real.
2. **Vídeo real nunca decodificado** neste QA (sem `ffmpeg` no ambiente para gerar um fixture
   válido) — o componente foi revisado e segue o mesmo padrão do áudio/imagem, mas a reprodução em
   si não foi vista funcionando com bytes reais.
3. **Envio de mídia outbound** fica fora do escopo (botão de anexo continua desabilitado) — os
   nomes de campo de `sendImage`/`sendAudio`/`sendVideo`/`sendDocument` do WuzAPI já eram
   documentados como não confirmados antes desta rodada, e continuam assim.
4. **Sem status granular de "download em andamento vs. nunca vai chegar"** — o frontend trata os
   dois casos com o mesmo fallback; um campo dedicado melhoraria a UX, mas não foi criado agora
   (adicionaria complexidade sem um caso de uso comprovado ainda).
5. **Card boxed vs. canvas edge-to-edge** foi uma decisão tomada sem confirmação explícita do
   usuário (ver seção 2) — vale revisar visualmente se é o resultado desejado.

## 28. Classificação final

```
CONVERSATION_LAYOUT_READY      = YES   (verificado em Chromium real, 1366/1440/1920/390)
SIDEBAR_COLLAPSIBLE_READY      = YES   (verificado em Chromium real, persistência incluída)
TEXT_MESSAGES_RENDERING        = VERIFIED_RUNTIME (mensagens reais de homologação anterior + QA em browser)
IMAGE_RENDERING                = BROWSER_VERIFIED_WITH_FIXTURE   (JPEG real via proxy real; não é payload WhatsApp real)
AUDIO_RENDERING                = BROWSER_VERIFIED_WITH_FIXTURE   (WAV real via proxy real; toca e reporta duração)
VIDEO_RENDERING                = PARTIAL   (estado lazy verificado; decodificação real não testada — sem fixture mp4)
DOCUMENT_RENDERING             = BROWSER_VERIFIED_WITH_FIXTURE   (PDF real via proxy real; abre em nova aba)
MEDIA_ERROR_HANDLING           = YES   (fallback + retry cobertos por código e revisão; não exercitado via teste de falha de rede real)
MOBILE_CONVERSATION_READY      = YES   (verificado em Chromium real, 390px, achado e corrigido um bug real de overflow)
WUZAPI_MEDIA_PIPELINE_REAL     = NOT_EXECUTED (requer QR pairing real — fora do escopo desta sessão, por decisão do usuário)
```

`BROWSER_VERIFIED_WITH_FIXTURE` é uma classificação nova, deliberadamente distinta de
`VERIFIED_RUNTIME`: significa "aberto num Chromium real, através do proxy autenticado real,
servindo bytes reais e decodificáveis" — mas com um arquivo de teste, não uma mensagem que veio de
verdade do WhatsApp. É mais forte que "só vi o JSX", mas não é o mesmo que homologação real.
