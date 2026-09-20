# Jornada Comercial Integrada — Fase 4: Propostas

> Escopo implementado localmente em 20 de setembro de 2026. Esta entrega não foi publicada e não
> altera as classificações `PENDING_QA` da Fase 3. A Fase 5 não foi iniciada.

## Resultado de produto

Proposta passou a ser parte da jornada Conversa → Contato → Negócio. O mesmo formulário
`QuickCreateProposalModal` é usado dentro de Conversas, do Deal e do Contact 360. O Contact vem do
contexto; zero negócios abertos cria a proposta apenas no Contact, um negócio é preenchido
automaticamente e dois ou mais exigem escolha explícita. Nenhum Deal é criado silenciosamente.

A tela Propostas permanece como central: pesquisa por título, contato ou negócio, filtros por
status, detalhe com valores e datas, envio/ reenvio, métricas de abertura e gestão do link. A área
`Propostas → Modelos` concentra o CRUD dos modelos.

## Proposal Template v1

`proposal_templates` guarda nome, título padrão, itens padrão, condições, validade em dias e estado
ativo. O gerenciamento permite criar, editar, duplicar, ativar/desativar e excluir. Templates usam
a permissão existente de propostas e são sempre filtrados por tenant e workspace.

O template somente preenche o formulário. Ao criar, `Proposal.items` continua sendo o snapshot
existente; não há FK da Proposal para o template. Alterar ou excluir o modelo não modifica propostas
anteriores. O catálogo de produtos também é copiado para o snapshot.

## Link público

O token continua sendo gerado com 32 bytes aleatórios e somente seu SHA-256 é persistido. A Fase 4
adiciona `public_link_revoked_at` e operações explícitas de regeneração e revogação:

- regenerar substitui o hash e invalida imediatamente o token anterior;
- revogar mantém o hash para auditoria, mas o endpoint público recusa o acesso;
- o token bruto novo aparece somente na resposta da operação;
- o payload público remove `publicTokenHash` e inclui apenas nome do workspace e dados básicos do
  cliente necessários para apresentar a proposta.

## Envio pelo WhatsApp

O envio usa `deliverProposalThroughInbox`, uma camada de coordenação entre os bounded contexts. CRM
e Inbox permanecem sem importações cruzadas; o guard arquitetural confirma esse isolamento.

Fluxo efetivo:

1. valida Proposal, tenant, workspace, Contact e a conversa vinculada ao mesmo Contact;
2. reserva uma `proposal_delivery` por chave de idempotência;
3. gira o link público e compõe a mensagem editável substituindo `{{proposalUrl}}`;
4. chama o `sendInboxMessage` existente;
5. somente depois do retorno enfileirado registra a entrega e muda a Proposal para `sent`;
6. reenvio preserva o mesmo `proposal.id` e registra `proposal_resent`.

Não há cliente WuzAPI no CRM. `proposal_deliveries` é a relação explícita do fato de envio com a
conversa; não foi adicionado `conversationId` à Proposal. A reserva evita envio duplicado em
duplo clique/retry. A partir do início do despacho, qualquer falha mantém a reserva pendente: a Inbox
pode já ter persistido a mensagem para o reconciliador mesmo quando a publicação na fila lança erro.
Assim, uma repetição não cria uma segunda mensagem. Falhas anteriores ao despacho liberam a chave
para nova tentativa.

## Visualizações e resposta pública

Cada GET válido de uma proposta enviada/visualizada cria uma linha em `proposal_views`. A tabela só
contém `id`, `proposal_id` e `viewed_at`: não armazena IP, user-agent, localização ou fingerprint.
`viewedAt` permanece como primeira abertura; `lastViewedAt` e `viewCount` registram a última e a
quantidade. `proposal_viewed` na timeline continua sendo gravado apenas na primeira abertura para
não poluir o histórico.

“Visualização” significa acesso válido ao endpoint público. Refresh e previews automáticos do link
podem aumentar a contagem; não foi introduzido fingerprint para tentar distingui-los.

Aceite e recusa são idempotentes para a mesma decisão. Um retry do aceite já gravado volta a tentar
mover o Deal para a etapa Ganho, fechando o risco de estado parcial entre as duas operações sem um
refactor transacional entre repositórios. Mover um Deal que já está em Ganho é no-op. A recusa aceita
motivo (`price`, `deadline`, `scope`, `other`) e comentário, mantém o Deal aberto e oferece ações de
nova proposta e follow-up; no detalhe do Deal também oferece a decisão explícita de marcá-lo perdido.
Propostas vencidas continuam sem aceitar resposta, e a listagem agora materializa `expired` mesmo
antes de uma nova abertura pública.

## UX interna e pública

- Conversas mostra a proposta atual, valor, status, visualizações, abrir e reenviar.
- Deal Detail lista propostas, abre o detalhe e cria outra inline.
- Contact 360 agrupa Ativas, Aceitas, Recusadas e Expiradas, abre o detalhe e cria inline.
- O detalhe compartilhado mostra itens, valores, validade, envio, primeira/última abertura,
  quantidade, resposta e ações de link/envio conforme o status.
- A página pública usa cartões de itens em vez de tabela horizontal, mostra emissor e cliente e tem
  aceite/recusa com estados de erro. Foi exercitada em 390 px.

## Decisões de escopo

- Task “Enviar proposta” não é concluída automaticamente: não existe vínculo estrutural seguro entre
  Task e Proposal, e não foi feito matching por texto.
- Não há editor visual, assinatura digital, branding avançado, analytics invasivo ou Timeline 360.
- Não há status novo de Proposal.
- A migration `0130_commercial_proposals_phase4.sql` é a única extensão de banco.

## Verificação local

- Backend `tsc --noEmit`: passou.
- Backend build: passou.
- Guard `check-crm-isolation`: passou em 1.016 arquivos.
- `crm-execucao-comercial.test.mjs`: 9/9.
- `crm-propostas-fase4.test.mjs`: 8/8 (4 originais + 4 adicionados na auditoria de fechamento,
  ver §Addendum), cobrindo tracking, rotação/revogação, recusa idempotente, modelos, isolamento
  multi-tenant, deduplicação do envio (inclusive em falha de publicação), duplo aceite idempotente
  com Deal Won, tracking preservado após aceite, snapshot de template e recusa sem mover o Deal.
- Frontend `tsc --noEmit`: passou.
- Frontend `next build`: passou.
- Chrome real com fixtures HTTP explícitas: 6/6 em 1440 × 900 e 390 × 844. Cenários: criação
  contextual com modelo e múltiplos Deals, envio pelo contrato da Inbox, gerenciamento de modelos,
  página pública mobile e recusa com motivo.

Os testes de browser usam backend simulado e não comprovam fila/WuzAPI, banco ou autenticação de
produção. O teste de 390 px não simula teclado virtual físico.

## Classificação

| Critério | Classificação | Evidência |
|---|---|---|
| PROPOSAL_TEMPLATE_CRUD | PASS_LOCAL | CRUD no banco/casos de uso; criação no Chrome 1440/390 |
| TEMPLATE_SNAPSHOT | PASS_LOCAL | template sem vínculo persistente; itens copiados na criação |
| CONVERSATION_CREATE_PROPOSAL | PASS_LOCAL | Chrome, criação inline sem navegação |
| DEAL_CREATE_PROPOSAL | PASS_LOCAL | componente compartilhado integrado; typecheck/build |
| CONTACT_CREATE_PROPOSAL | PASS_LOCAL | componente compartilhado e agrupamento no Contact 360 |
| MULTIPLE_DEALS_PROPOSAL_CONTEXT | PASS_LOCAL | Chrome escolheu explicitamente o segundo Deal |
| PROPOSAL_LIST_AND_DETAIL | PASS_LOCAL | filtros/busca/detalhe compilados e buildados |
| LINK_ROTATE_REVOKE | PASS_LOCAL | teste PGlite invalida link anterior e revogado |
| PROPOSAL_VIEW_TRACKING | PASS_LOCAL | teste PGlite confirma primeira/última/quantidade |
| PROPOSAL_ACCEPT_IDEMPOTENCY | PASS_LOCAL | mesma decisão é no-op; Deal Won também é idempotente |
| PROPOSAL_REJECT_REASON | PASS_LOCAL | PGlite e Chrome público 1440/390 |
| SEND_VIA_INBOX_PIPELINE | PASS_LOCAL | orquestrador chama `sendInboxMessage`; teste impede duplicação em sucesso/falha; E2E valida contrato mockado |
| STATUS_SENT_AFTER_QUEUE | PASS_LOCAL | ordem garantida pelo orquestrador; falta fila real |
| PROPOSAL_RESEND | PASS_LOCAL | mesmo ID e evento `proposal_resent`; falta fila real |
| PUBLIC_PROPOSAL_MOBILE | PASS_LOCAL | Chrome 390 sem overflow horizontal |
| PHASE_4_PRODUCTION_RUNTIME | PENDING_QA | sem deploy e sem sessão/fila/banco de produção |
| PHASE_4_PRODUCTION_READY | NO | requer migration, deploy controlado e QA autenticado real |

## QA ainda necessário antes de produção

Executar migration e deploy controlados; depois, em workspace de teste autenticado, criar por
Conversa/Deal/Contact com 0, 1 e vários Deals, enviar e reenviar por uma conversa WhatsApp real,
confirmar a mesma Proposal após reload, abrir o link em outro dispositivo, conferir contagem,
rotacionar/revogar, aceitar e recusar, confirmar Deal Ganho apenas no aceite e repetir os fluxos em
mobile com teclado real. Até isso acontecer, nenhum item recebe `VERIFIED_RUNTIME`.

---

## Addendum — auditoria de fechamento (revisão pedida pelo usuário, mesma data)

O usuário pediu uma revisão do que foi implementado contra a especificação completa da Fase 4 (61
itens). Uma auditoria de código (não confiando só neste documento) encontrou o volume de trabalho
como sólido e bem arquitetado — snapshot, isolamento do pipeline de mensagens, hash do token,
tracking sem dado invasivo, multi-tenant e "recusa não move o Deal" todos corretos e verificados
lendo o código — mas com gaps reais, agora fechados nesta mesma revisão:

**Bugs corrigidos:**
- Mojibake (encoding corrompido) em 2 lugares: a lista de propostas do negócio
  (`DealDetailModal.tsx`) e a aba Propostas do Contact 360 mostravam "neg?cio"/"visualiza??o"/"?es"
  em vez de "negócio"/"visualização"/"ões" — texto real que apareceria quebrado para o usuário.
- `scripts/check-crm-isolation.mjs` não cobria `src/application/commercial/` (a nova ponte de envio
  de Proposal por WhatsApp desta fase) nem `application/commercial-bridge/` (a ponte da Fase 1) —
  não porque violassem isolamento (não violam), mas porque o guard simplesmente não as inspecionava
  (ficavam fora dos dois grupos de padrão). Adicionado um terceiro grupo "ponte neutra" que verifica
  especificamente que essas pontes nunca importam `/infrastructure/messaging/` direto (só através
  dos casos de uso já expostos por `/application/inbox/`) — fecha um ponto cego real da rede de
  segurança arquitetural sem alterar nenhum comportamento.

**Funcionalidade completada:**
- `ProposalDetailModal.tsx` (componente compartilhado usado em Conversa/Deal/Contact 360) não
  mostrava Subtotal, Desconto nem "Respondida em" — só Total. Adicionados os 3 campos.
- A tela central `/proposals` não oferecia "Criar nova proposta"/"Criar follow-up"/"Marcar negócio
  como perdido" depois de uma recusa (só os pontos de entrada contextuais tinham isso) — agora tem,
  reaproveitando os mesmos componentes já existentes (`QuickCreateTaskModal`, `LossReasonModal`),
  nenhuma lógica nova duplicada.
- Consistência do aceite (item 33): `acceptPublicProposal` e `applyProposalAcceptanceToDeal`
  continuam sendo duas chamadas separadas (nenhum refactor transacional, como o pedido permitia
  evitar sem necessidade real) — mas agora, se a segunda falhar depois que a primeira já persistiu
  `status=accepted`, o erro é logado com o `proposalId`/`dealId` para reconciliação manual, e a
  resposta ao cliente **não vira mais um 500 genérico** para uma proposta que na verdade já foi
  aceita (a aceitação em si é idempotente; reconciliar o Deal continua exigindo um retry, agora pelo
  menos visível em log).
- Eventos `proposal_resent`/`proposal_link_regenerated` apareciam em inglês na Timeline (fallback de
  `humanizeEventCode`, sem entrada no mapa de rótulos) — adicionados "Proposta reenviada"/"Link da
  proposta regenerado".
- Mensagens de erro na página pública (`web/app/p/[token]/page.tsx`) vazavam o código técnico cru
  (ex.: "PROPOSAL_LINK_REVOKED: este link foi revogado.") para o cliente final que abriu o link pelo
  WhatsApp — agora só a frase em português aparece, o prefixo é removido antes de exibir. De
  quebra, corrigidas 3 palavras sem acento nessa mesma tela ("Preco"/"Comentario"/"Voce").

**Testes de backend adicionados** (`tests/crm-propostas-fase4.test.mjs`, de 4 para 8 testes) —
cenários pedidos pela especificação que existiam só como comportamento no código, sem prova
automatizada:
- Duplo aceite idempotente: aceitar a mesma proposta duas vezes, e aplicar
  `applyProposalAcceptanceToDeal` duas vezes, nunca duplica o evento `deal_stage_changed` nem troca
  `wonAt` na segunda chamada.
- Tracking preservado após aceite: `viewCount`/`viewedAt`/`lastViewedAt` continuam exatamente iguais
  depois de aceitar (aceitar não reseta nem mexe no histórico de visualizações).
- Template → Proposal com snapshot real: cria uma Proposal copiando os campos de um template (a
  mesma cópia que o frontend faz), depois muda e apaga o template, e confirma que a Proposal já
  criada não reflete nem a mudança nem a exclusão.
- Recusa com Deal de fato vinculado: cria um Deal numa etapa aberta de verdade (não só uma Proposal
  sem `dealId`, que era o único caso coberto antes), recusa a proposta, e confirma que o Deal
  continua na mesma etapa aberta — não foi movido pra Perdido nem para nenhuma outra.

**Verificação depois dos fixes**: `tsc --noEmit` (backend e frontend) limpo, `npm run build`
(backend e frontend) limpo, `npm run architecture:check` completo OK (incluindo a nova cobertura do
guard sobre as pontes), 39/39 testes de CRM/fundação relevantes + 8/8 de `crm-propostas-fase4`
(47 no total, sem regressão), 52/52 testes de frontend (vitest).

**Gaps que ficam documentados, não corrigidos nesta rodada** (polimento/escopo maior, não bugs
bloqueantes):
- Existem dois componentes chamados `ProposalDetailModal` (o compartilhado novo e um local dentro de
  `proposals/page.tsx`, pré-existente e estendido nesta fase) com paridade de feature que já não
  diverge mais nos pontos auditados, mas continuam sendo implementações separadas — consolidar num
  só é um refactor maior, deixado para uma fase de polimento futura em vez de arriscar aqui.
- Nenhum dos modais de Proposal foi convertido para o padrão `Sheet` em mobile (item 47 é opcional
  — "Modal pode virar Sheet" —, e o `Modal` atual já é razoavelmente responsivo).
- Regeneração de link não tem trava de idempotência no backend contra duplo clique (só
  `disabled={busy}` no frontend) — risco baixo (o clique duplo só gera um link a mais que invalida o
  anterior, nunca inconsistência de dado), documentado, não corrigido.
- E2E (`web/e2e/phase4-proposals.spec.ts`) continua sem um cenário de aceite terminando em "Deal
  Ganho" — coberto por teste de backend real (novo, ver acima), mas não por Chrome/Playwright.

## Classificação atualizada (pós-fechamento)

```
PROPOSAL_ACCEPT_IDEMPOTENCY = PASS_LOCAL → agora com teste automatizado direto (antes só descrito)
PROPOSAL_DETAIL_SUBTOTAL_DISCOUNT = PASS_LOCAL (novo — Subtotal/Desconto/Respondida no modal compartilhado)
POST_REJECTION_ACTIONS_CENTRAL_SCREEN = PASS_LOCAL (novo — tela central agora tem as 3 ações, não só os pontos contextuais)
BRIDGE_ISOLATION_GUARD_COVERAGE = PASS_LOCAL (novo — guard cobre commercial-bridge/commercial agora)
PHASE_4_PRODUCTION_READY = NO (inalterado — ainda sem migration/deploy/QA autenticado real)
```
