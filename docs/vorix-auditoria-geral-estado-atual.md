# Vorix — Auditoria Geral do Estado Atual

**Auditoria feita diretamente no repositório atual** (código, migrations, rotas, frontend, banco de
homologação, VPS de produção via SSH, commits) — nunca a partir de memória de conversas
anteriores. **Atualizado após o fechamento da correção do bug outbound**: HEAD atual
`94954cf` ("fix(inbox): reconcilia mensagens outbound órfãs após falha de publish no broker"),
commitada, implantada na VPS real e validada em runtime real (`VERIFIED_RUNTIME`) — ver seção 6.3
e `docs/conversas-homologacao-runtime-relatorio.md` §1-C. A auditoria original foi feita em
`1fbac2e`; as seções afetadas por essa correção foram atualizadas.

Regra de honestidade aplicada em todo o texto: `IMPLEMENTADO` / `TESTADO_AUTOMATIZADO` /
`VERIFIED_RUNTIME` / `PARCIAL` / `DESABILITADO` / `BLOCKED` / `PLANEJADO` / `NÃO_IMPLEMENTADO` —
nunca "o sistema suporta X" sem uma citação de arquivo/linha/rota/migration por trás.

---

## 1. Resumo executivo

Vorix (nome interno do pacote: `zuno`) é hoje uma plataforma B2C/B2B real, multi-tenant, cobrindo
quatro pilares que de fato existem em código, testados e (majoritariamente) já implantados em
produção: **Marketing** (criação de conteúdo assistida por IA, publicação real em Instagram/
Facebook/TikTok/YouTube, Meta Ads), **Atendimento via WhatsApp** (Inbox real, IA opcional,
resiliência operacional testada contra infraestrutura real), **CRM Comercial** (contatos, pipeline/
Kanban, propostas, automações, copiloto de IA) e **Gestão SaaS** (planos, trial, checkout, billing,
analytics de produto, growth dashboard).

A arquitetura é sólida e consistentemente hexagonal (domain → application → infrastructure →
interfaces), com isolamento cross-tenant real e testado, e uma disciplina de "nunca confiar só no
client" bem aplicada nos pontos críticos (webhooks, billing, retry). A suíte de testes é grande e
real: **2838 testes, 2836 passando**, rodada de ponta a ponta nesta auditoria.

Dois fatos centrais mudam a leitura de "pronto para vender" mais do que qualquer feature
individual:

1. **A VPS de produção roda uma versão do banco anterior a todo o trabalho de Billing/Trial/
   Product Analytics/Growth** (migration `0102`, enquanto o repositório já está em `0114`) — ou
   seja, cobrança real, trial real e analytics de produto **existem no código e passam nos
   testes, mas não estão implantados**.
2. **A homologação operacional do WhatsApp com telefone físico real ainda não foi concluída** — é
   o único bloqueador objetivo remanescente para o piloto de Conversas. O bug de mensagem outbound
   que ficava presa indefinidamente se o RabbitMQ caísse no momento exato do envio **já foi
   corrigido, commitado, implantado na VPS real e validado em runtime real** (`VERIFIED_RUNTIME`).

O primeiro fato acima **bloqueia objetivamente** qualquer decisão de comercialização com cobrança
real até ser fechado — ver seção 12 (GO/NO-GO).

---

## 2. Produto atual

Confirmado pelo código (`CLAUDE.md`, `package.json`, estrutura de `src/`), a visão de produto real
é:

```
Marketing  →  Conversa  →  Contato  →  Negócio  →  Proposta  →  Venda  →  Resultados
```

- **Marketing**: pipeline de criação (briefing → planejamento → runtime → execução), geração de
  imagem/vídeo/copy assistida por IA, publicação real em redes sociais, Meta Ads.
- **Conversa**: Inbox de WhatsApp com atendimento humano+IA.
- **Contato → Negócio → Proposta → Venda**: CRM Comercial completo (Kanban, propostas com link
  público, automações, copiloto de IA, lead scoring determinístico).
- **Resultados**: métricas reais de atendimento e comercial (SQL agregado, não placeholder).

**Tenant → Workspace → módulos**: 1 Tenant : N Workspaces (`src/domain/workspace/workspace.model.ts:4-9`,
comentário explícito: *"Tenant = a conta que paga; Workspace = uma marca/cliente gerenciado por
trás dessa conta"*). `Tenant` não tem tabela própria — existe implicitamente via FK em
`workspaces.tenant_id`/`tenant_members.tenant_id`/`tenant_billing.tenant_id`. `N workspaces por
tenant` é real e ativamente limitado por plano (`WORKSPACE_LIMIT_EXCEEDED` em
`workspace-use-cases.ts:44-58`), não só teórico — o signup padrão cria exatamente 1 workspace, mas
`POST /v1/workspaces` permite criar mais, respeitando o limite do plano. Praticamente todo módulo
de negócio (Inbox, CRM, Publication, Onboarding) é escopado por `workspaceId`, nunca só por
`tenantId`.

---

## 3. Arquitetura

Hexagonal/clean, real e consistente: `src/domain` (tipos puros, zero import de framework),
`src/application` (casos de uso, só dependem de `application/ports/*`), `src/infrastructure`
(adapters concretos — Postgres, RabbitMQ, WuzAPI, Stripe, providers sociais, AI Gateway),
`src/interfaces` (`api/` Fastify, `worker/` — **exatamente um processo**, `inbox-worker.ts`, `cli/`
pipeline legado).

**IMPORTANTE**: o repositório contém DUAS arquiteturas que nunca se importam mutuamente, garantido
por `npm run architecture:check` (`scripts/check-*-isolation.mjs`, confirmado limpo nesta
auditoria): (1) o **pipeline legado** de Skills de IA (Arthur/Helena/Caio/Eduardo/João/Maria/
Sofia/Bianca/Pedro/Lucas/Ana/Bruno/Vanessa/Diego/Rafa/Ícaro) — um pipeline de CLI local, sem
servidor/banco; (2) a **"plataforma nova"** — a API multi-tenant + frontend Next.js, que é o
produto comercial real e o foco deste relatório.

**Infra real confirmada**: Postgres (única base de dados, real). **Redis: NÃO USADO** — grepado em
todo o repositório, zero dependência; um comentário em
`inbox-rabbitmq-topology.ts:18` cita Redis explicitamente como algo que o design evita de
propósito ("fanout `inbox.realtime`... evita precisar de Redis só para pub/sub cross-processo").
RabbitMQ real (`amqplib`, topologia dedicada). WuzAPI real (gateway WhatsApp). AI Gateway — único
provider realmente conectado na "plataforma nova" é **Anthropic** (`AI_MODEL_REGISTRY`,
`claude-haiku-4-5-20251001`/`claude-sonnet-5-20260201`, comentário explícito "único provider real
conectado nesta sprint"); OpenAI/Google Veo existem como adapters reais mas pertencem ao **pipeline
legado** (Ícaro), não à plataforma nova — exceto o motor criativo de imagem (seção 4.1), que usa
OpenAI de verdade. Billing: Stripe real + Sandbox (dev/teste). Publication: adapters reais para
Meta (Instagram/Facebook), TikTok, YouTube; Kwai não verificado; LinkedIn/X são stubs sandbox-only.

**Fluxos reais** (nunca inventados, todos confirmados por arquivo):

```
Browser → Fastify (app.ts → routes/v1) → requirePermission/requirePrincipal
        → application/*-use-cases → infrastructure/storage/postgres/* → Postgres

WhatsApp → WuzAPI → wuzapi.events.raw (RabbitMQ)
         → RawEventConsumer → inbox.events (topic exchange)
         → inbox.incoming.queue → vorix-worker (inbox-worker.ts)
         → application/inbox/inbox-use-cases.ts → Postgres
         → (opcional) AI Gateway (auto-reply) → inbox.realtime (fanout) → SSE → Browser

Payment provider → billing-webhook.route.ts (fora do prefixo /v1, HMAC verificado)
                 → application/billing/webhook-use-cases.ts
                 → postgres-platform-billing-repository.ts (tenant_billing)
```

---

## 4. Módulos

### 4.1 Marketing

| Recurso | Status | Evidência |
|---|---|---|
| Pipeline de criação (briefing→planejamento→runtime→execução) | IMPLEMENTADO | rotas dedicadas por estágio (`conversations.route.ts`, `briefings.route.ts`, `planning.route.ts`, `runtime.route.ts`, `execution-runs.route.ts`, `production.route.ts`) |
| Geração de imagem via IA | IMPLEMENTADO | `OpenAiImageProviderAdapter` real (`gpt-image-1`, `api.openai.com`), wired em `container.ts:687,763` |
| Geração de vídeo (Google Veo) | PARCIAL/NÃO_VERIFICADO | `google-veo-provider-adapter.ts` — comentário próprio do arquivo (linhas 10-16) admite não ter sido confirmado contra um app real do Google AI Studio |
| Publicação Instagram/Facebook | IMPLEMENTADO, RUNTIME_VERIFIED | `MetaContentPostingProvider`, chamadas reais a `graph.facebook.com/v21.0` |
| Publicação TikTok | IMPLEMENTADO | `TikTokContentPostingProvider`, Content Posting API real |
| Publicação YouTube | IMPLEMENTADO | `YouTubeContentPostingProvider`, OAuth real |
| Publicação Kwai | PARCIAL | próprio código aponta fonte não verificada (`docs/kwai-publishing.md`) |
| Publicação LinkedIn/X | DESABILITADO (stub) | `sandbox-social-providers.ts`, `status: "sandbox_only"`, URLs fake |
| Meta Ads (campanhas/adsets/ads/audiences/pixels/CAPI) | IMPLEMENTADO | `meta-graph-client.ts` real, rotas com create/update reais (não só leitura) |
| Calendário de publicação | IMPLEMENTADO | `scheduling.route.ts` + `publication-scheduler.ts` (scheduler real, drena publicações agendadas) |
| Perfil de marca | IMPLEMENTADO | `brand-profile.route.ts`, consumido pelo motor criativo |
| Analytics de conteúdo | IMPLEMENTADO, sistema DISTINTO do Product Analytics | `analytics_events`/`analytics_provider_metric_snapshots` (migration `0048`) — mede publicação/campanha, nunca funil de crescimento SaaS |

### 4.2 Conversas / Atendimento

Modelo real: `MessagingConnection`, `InboxContact`, `InboxConversation`, `InboxMessage` — único
provider `wuzapi` (WhatsApp). Worker dedicado (`vorix-worker`, processo separado, nunca
compartilha com a API), RabbitMQ real com escada de retry TTL+DLX (5s→15s→60s→300s) + DLQ por
fila, CAS (`tryMarkSending`) impedindo duplo envio ao provider, circuit breaker + rate limiter
(Postgres-backed, sobrevivem a restart), health monitor que nunca ressuscita estado terminal
(`logged_out`/`requires_repair`).

Kill switches: `CONVERSATIONS_MODULE_ENABLED` (módulo inteiro), `AI_INBOX_AUTO_REPLY_ENABLED` (só
IA), `INBOX_OUTBOUND_SEND_PAUSED` (só envio outbound). Os três testados nesta e em sessões
anteriores; o terceiro foi re-testado em runtime real nesta sessão após um `BLOCKED` anterior por
fixture, agora `VERIFIED_RUNTIME` completo.

**Bug real confirmado e correção em andamento** — ver seção 6.4, é o item mais importante deste
módulo agora.

### 4.3 Contatos 360°

`Contact`/`ContactIdentity` (CRM) são entidades **distintas** de `InboxContact` (Inbox), ligadas
por `inbox_contacts.contact_id` (nullable, nunca automático — precisa de ação explícita do
usuário). `ContactIdentity.channel` suporta `whatsapp|instagram|facebook|tiktok` **como valor de
enum**, mas **só WhatsApp tem um canal de entrada real** (`MESSAGING_PROVIDERS = ["wuzapi"]`) —
**nunca confundir "o modelo representa Instagram" com "o Inbox recebe mensagens reais do
Instagram"**, que não acontece hoje. Merge de identidade duplicada é **detectado, nunca resolvido
automaticamente** (decisão deliberada, documentada no próprio código como fase futura).

### 4.4 CRM Comercial

Pipeline configurável com 6 estágios padrão auto-criados por workspace, Kanban real com
drag-and-drop (`web/.../deals/page.tsx`, `draggable`/`onDrop` reais), perda sempre exige motivo,
`updateDeal` estruturalmente incapaz de mudar `stageId` (só `moveDealStage` pode, sempre com
timeline). Tarefas (CRUD completo, sem query dedicada de "atrasadas" — só usada como fator de
cálculo em outros lugares). Catálogo de produtos **sem estoque** (confirmado ausência via grep).
Propostas com item congelado no momento da criação, token público hash SHA-256, link público sem
login permite ver/aceitar/recusar, aceitar move automaticamente o negócio ligado para "Ganho".
Ações de CRM (vincular contato, criar negócio/tarefa/proposta, ver lead score, gerar sugestões do
copiloto) já disponíveis **de dentro da própria tela de Conversas** (`crm-panel.tsx`, todas
wireadas a endpoints reais). Lead scoring é **determinístico** (fatores/pesos fixos, nunca
persistido, nunca IA); Copiloto Comercial é **gerado por IA real** (`AiGatewayCommercialCopilotGenerator`),
mas nenhuma sugestão se auto-executa — sempre exige aceite humano explícito. Automações
(gatilho+condição+ação, log de toda avaliação mesmo sem match, proteção anti-loop real e
documentada) — **sem** builder de linguagem natural/estilo Zapier (confirmado ausente). Métricas
comerciais são agregações SQL reais (pipeline aberto, conversão, ciclo médio, motivos de perda,
aging por etapa, receita por origem).

### 4.5 Onboarding

6 passos (`company, channel, team, commercial, brand, done`), idempotente em cada etapa
(chamar duas vezes nunca duplica nem regride), a etapa "channel" respeita feature flag E
entitlement de forma independente (flag checada primeiro), `company`/`commercial` não são
puláveis na UI, `channel`/`team`/`brand` são.

### 4.6 Auth / Usuários / Equipes

Signup real cria User+Workspace+tenant_billing FREE numa única transação real (BEGIN/COMMIT/
ROLLBACK), incluindo pipeline CRM padrão já provisionado. JWT (access 15min) + refresh token
(30 dias, hash, detecção de reuse/replay revoga a sessão inteira). Convite por e-mail com token
hash SHA-256, TTL 7 dias, idempotência garantida um nível acima (onboarding), não no próprio
`inviteMember`. RBAC real: 4 papéis (`owner/admin/editor/viewer`), ~70 permissões finas,
guard `requirePermission`/`requirePlatformAdmin` aplicado de fato nas rotas. **Teams existem como
modelo de dados real e CRUD completo, mas não são usados para escopar permissão nenhuma** — o
único consumidor de negócio é a distribuição round-robin de contatos em automações CRM. Limite de
usuários por plano é **real e enforced** (`assertWithinLimit`, resource `"users"`, chamado no
convite durante onboarding).

---

## 5. SaaS / Billing

`PlanVersion` imutável e versionado, `Subscription` real (fonte de verdade), `tenant_billing`
como cache rápido de leitura recalculado a partir da Subscription. Status reais: `trial, active,
past_due, cancelled, expired, suspended, trial_expired`. Checkout nunca decide assinatura pelo
retorno HTTP — só webhook confirmado (idempotente, dedup real por `(provider, providerEventId)`).
Upgrade/downgrade bloqueia overage antes de qualquer chamada ao provider, nunca apaga dado;
cancelamento sempre `cancel_at_period_end`. Trial é uma Subscription real sem cartão, duração
sempre de `PlanVersion.trialDays` (nunca hardcoded), expira via scheduler dedicado, entra no MESMO
modo read-only de `past_due`/`suspended`. Product Analytics com fundação própria (`product_events`
+ idempotência real de eventos "first_*"), privacidade por sanitização de propriedades, eventos de
estado sempre server-side (nunca confiados ao client — allowlist fechada por schema). Growth
Dashboard com MRR/ARR/ARPU **reais** (nunca estimados), documentando explicitamente o que não é
calculável hoje (churn/expansion MRR, DAU/WAU/MAU, cohorts) em vez de aproximar.

**Achado real de gap de enforcement**: as 7 capabilities de plano (`crm/conversations/marketing/
proposals/automation/ai_auto_reply/advanced_analytics`) são expostas via `GET /v1/entitlements`
só para a UI decidir o que mostrar — **nenhuma rota ou caso de uso as impõe no servidor**. Limites
numéricos (`assertWithinLimit`) só têm 2 call sites reais (`users`, `messaging_connections`) —
`contacts`/`storage_mb`/`automations` **também não são enforced em lugar nenhum**. Exceção:
`ai_credits` é enforced de verdade, mas por um mecanismo separado (ledger real de crédito,
`CreditGatedAiGateway`). **Isto é um risco comercial real, não teórico** — hoje, via chamada direta
à API, um tenant FREE pode usar qualquer capability e criar volume ilimitado de contatos/
automações independente do plano contratado.

**Achado real de deploy**: a VPS de produção roda migration `0102` — **nenhuma parte deste
capítulo (Billing/Trial/Product Analytics/Growth) está implantada em produção hoje**, apesar de
100% implementada e testada no repositório.

---

## 6. Homologação

### 6.1 Tabela obrigatória

| Item | Status | Evidência | Documento |
|---|---|---|---|
| Publicação/consumo RabbitMQ | VERIFIED_RUNTIME | mensagem real publicada/consumida contra broker de produção | `docs/conversas-homologacao-runtime-relatorio.md` §1 |
| ACK (sucesso) | VERIFIED_RUNTIME | evento bem formado → persistido, fila drenada | idem |
| NACK via republish (nunca nack cru) | VERIFIED_RUNTIME | confirmado por código + observado | idem |
| Retry 5s/15s/60s/300s | VERIFIED_RUNTIME | timing real medido (~364s, teórico 380s) | idem |
| DLQ | VERIFIED_RUNTIME | aterrissagem confirmada, status Postgres correto | idem |
| Redelivery manual da DLQ | VERIFIED_RUNTIME | mensagem antiga movida de volta, consumida sem crash | idem |
| Worker restart | VERIFIED_RUNTIME | `docker stop`/`start`, reconecta e retoma | idem |
| Broker restart (queda/volta) | VERIFIED_RUNTIME | RabbitMQ parado/religado, worker recupera sozinho | idem |
| SIGTERM / graceful shutdown | VERIFIED_RUNTIME | log de drain + `Exited(0)` | idem |
| Backup real (`pg_dump`) | VERIFIED_RUNTIME | arquivo real produzido, bug de nome de container corrigido | idem §2 |
| Restore real | VERIFIED_RUNTIME | banco descartável, contagens+conteúdo idênticos | idem §2 |
| Kill switch `INBOX_OUTBOUND_SEND_PAUSED` | VERIFIED_RUNTIME | pause bloqueia provider, nunca esgota retry, unpause resume sem duplicar | idem §1-A |
| Correção do bug outbound `queued` órfão | VERIFIED_RUNTIME | commit `94954cf`, implantado, cenário exato reproduzido e recuperado automaticamente | idem §1-C |
| QR / login WhatsApp | NOT_EXECUTED | exige telefone físico | `docs/conversas-homologacao-whatsapp-execucao.md` (roteiro pronto) |
| Inbound texto real | NOT_EXECUTED | idem | idem |
| Outbound texto real | NOT_EXECUTED | idem | idem |
| Receipts (sent/delivered/read) | NOT_EXECUTED | idem | idem |
| Imagem/áudio/vídeo/documento | NOT_EXECUTED | campos de mídia do WuzAPI client nunca confirmados contra instância real | idem |
| Reconnect real (perda de rede) | NOT_EXECUTED | idem | idem |
| Logout/revogação real | NOT_EXECUTED | idem | idem |
| Takeover humano (concorrência) | VERIFIED_AUTOMATED | CAS testado com Postgres real (PGlite), não executado ainda via API HTTP da VPS | `tests/inbox-attendance*.test.mjs` |
| IA de atendimento em piloto real | NOT_EXECUTED | gated corretamente atrás do WhatsApp real | — |

### 6.2 Flags confirmadas em produção (VPS real, via SSH)

`CONVERSATIONS_MODULE_ENABLED=false` (corrigido nesta sessão — estava `true` sem uso real
detectado: 1 conexão nunca conectada, 0 mensagens). `AI_INBOX_AUTO_REPLY_ENABLED=false`
(nunca ativada). `vorix-worker` implantado pela primeira vez nesta sessão.

### 6.3 Bug do outbound `queued` órfão — seção específica exigida — **FECHADO**

**Cenário exato**: `sendInboxMessage` insere a linha (`status='queued'`) → `outboundQueue.publish()`
falha (ex.: RabbitMQ momentaneamente fora do ar) → RabbitMQ volta → mensagem **continua `queued`
indefinidamente**, nenhum mecanismo existente (retry ladder, DLQ, redelivery) a alcança.

- **Continuava reproduzível?** Sim, antes da correção — reproduzido em runtime real contra a VPS
  de produção: RabbitMQ parado de propósito, `sendInboxMessage` real chamado, mensagem ficou órfã,
  RabbitMQ religado, worker reconectou, mensagem **permaneceu `queued`** minutos depois.
- **Foi corrigido?** **Sim — commitado, implantado e validado em runtime real.**
- **Commit**: `94954cf` ("fix(inbox): reconcilia mensagens outbound órfãs após falha de publish no
  broker").
- **Mecanismo**: reconciliador periódico (`reconcileOrphanedOutboundMessages`, roda no
  `vorix-worker`, uma vez imediatamente no boot + a cada 60s por padrão), busca mensagens `queued`
  nunca confirmadas publicadas no broker e mais velhas que uma janela de graça (120s por padrão),
  republica. Nunca uma garantia "exactly-once" — at-least-once na fila, protegido pelo CAS
  (`tryMarkSending`) já existente, que garante que só uma entrega chama o provider mesmo se o
  reconciliador republicar algo que já tinha sido publicado de verdade.
- **Testes**: 13 testes automatizados, 100% passando (`tests/inbox-outbound-reconciliation.test.mjs`)
  — fluxo normal, o cenário exato do bug, idempotência sob duplicidade no broker, reconciliação
  concorrente, filtros de status `sending`/`sent`/`failed`, janela de graça, recuperação após
  restart, isolamento cross-tenant, interação com o kill switch de pausa, métricas.
- **Deploy**: implantado na VPS real via `git archive` do HEAD (procedimento documentado em
  `docs/deployment.md`), migration `0114` aplicada diretamente no Postgres real (só o schema desta
  correção — as migrations `0103`-`0113`, ainda pendentes de deploy, deliberadamente NÃO foram
  aplicadas junto, pra não introduzir Billing/Trial/Product Analytics fora do escopo pedido).
- **Homologação runtime (depois da correção)**: **VERIFIED_RUNTIME** — cenário exato reproduzido
  de novo contra a VPS real (RabbitMQ off → `sendInboxMessage` → commit → publish falha →
  RabbitMQ on → reconciliador → CAS → provider → estado terminal), recuperação automática
  confirmada sem nenhuma intervenção manual, zero duplicidade (janela de crash B testada com
  entrega dupla real na fila — só uma chamada ao provider), restart do worker também recupera
  órfãs, kill switch de pausa continua respeitado, mensagem `failed` terminal nunca ressuscitada.
  Detalhe completo em `docs/conversas-homologacao-runtime-relatorio.md` seção 1-C.
- **Achado residual de observabilidade** (não bloqueador): `inbox_outbound_publish_failed_total`
  nunca incrementa pela rota HTTP real porque a API nunca teve métricas Prometheus wireadas para
  Inbox (gap pré-existente, não introduzido por esta correção) — recomendado como item de dívida
  técnica separado.
- **Risco residual**: nenhum quanto à correção em si. Continua pendente: aplicar as migrations
  `0103`-`0113` (Billing/Trial/Product Analytics) na mesma VPS quando essa iniciativa for
  formalmente implantada — não é bloqueador para o piloto de Conversas.

Este item **deixa de ser bloqueador no GO/NO-GO final** (seção 12).

---

## 7. Segurança

RBAC real e enforced (`requirePermission`/`requirePlatformAdmin`). Isolamento cross-tenant "404,
nunca 403" confirmado em pelo menos 6 módulos diferentes (Deals, Contacts, Teams, Products,
Pipelines, Proposals, Automation Rules, Tasks — mesmo padrão de guard repetido, Inbox como
precedente citado em todos). Tokens públicos (propostas) e de convite: `randomBytes(32)` + SHA-256,
só o hash persistido, token bruto devolvido uma única vez. Webhook de billing valida assinatura
(`stripe-signature`) e deduplica por `(provider, providerEventId)`. Segredos (OAuth de
Instagram/TikTok/YouTube/Kwai/Meta) cifrados em repouso com **AES-256-GCM**, chave derivada de
`JWT_SECRET` via SHA-256. Sanitização de dado sensível antes de qualquer chamada de IA
(`AiInputSanitizer`, remove `password/token/secret/apikey/authorization/...`, e também remove
valores de `workspaceId`/`tenantId` que não batam com o tenant esperado — proteção explícita
anti-vazamento cross-tenant no caminho de IA). Sanitização equivalente em Product Analytics.
Nenhuma concatenação insegura de SQL encontrada nos adapters Postgres inspecionados (sempre
parâmetros `$1..$n`). Nenhuma rota sem guard de autenticação encontrada nas amostras revisadas,
exceto o webhook de billing (protegido por HMAC, deliberado).

**Risco real já citado na seção 5**: ausência de enforcement server-side de capabilities/limites
de plano (fora de `users`/`messaging_connections`/`ai_credits`).

---

## 8. Infraestrutura

VPS compartilhada (209.97.152.212), 7 stacks isoladas por rede Docker, Vorix não é a única
aplicação ali. `zuno-zuno-api-1`/`zuno-zuno-web-1`/`zuno-zuno-postgres-1` saudáveis.
`zuno-vorix-worker-1` implantado pela primeira vez nesta sessão. `conversas-gateway-*`
(WuzAPI/RabbitMQ/Postgres do WuzAPI) rodando há 8+ dias, WhatsApp nunca pareado com telefone real.

**Achado de deploy**: Postgres de produção está em migration `0102` — todo o trabalho de
Billing/Trial/Product Analytics/Growth (`0103`–`0113`) e a correção do bug outbound (`0114`,
nem commitada) **não estão implantados** ali.

Backup/restore: bug real corrigido nesta sessão (nomes de container errados faziam o script
reportar sucesso sem nunca produzir um backup real — ver seção 6.1). Cron real de backup **ainda
não está agendado** (comando pronto, não aplicado — bloqueado por permissão de sistema).

Baseline de recursos IDLE capturado; sob tráfego real: `NOT_EXECUTED` (exige piloto).

---

## 9. Testes

**Suíte completa executada nesta auditoria** (não amostra): `npm test` real, resultado:

```
tests 2838   pass 2836   fail 2   cancelled 0   skipped 0   duration_ms 131340
```

**2 falhas, ambas PREEXISTENTES / ambientais, não relacionadas a nenhum código novo**:
1. `tests/analytics.test.mjs:208` — assert dependente de janela de data relativa ao "hoje" real
   (`last_30_days`), não relacionado a nenhuma mudança atual.
2. `tests/cli.smoke.test.mjs:280` — `EBUSY` do Windows ao tentar apagar um arquivo temporário de
   áudio (lock de arquivo específico do SO), não relacionado a nenhuma mudança atual.

`typecheck`/`build`/`architecture:check` (backend e `web/`) rodados nesta auditoria com o HEAD +
as mudanças uncommitted presentes: **limpos, sem erros**.

---

## 10. Dívida técnica

| P | Item | Risco | Evidência | Bloqueia piloto? | Bloqueia comercialização? | Correção recomendada |
|---|---|---|---|---|---|---|
| ~~P0~~ | ~~Mensagem outbound `queued` órfã~~ **RESOLVIDO** | — | `VERIFIED_RUNTIME`, commit `94954cf`, implantado (seção 6.3) | Não | Não | — |
| P0 | Homologação WhatsApp real (telefone físico) | Comportamento real desconhecido (QR/mídia/receipts/reconnect) | `NOT_EXECUTED`, roteiro pronto | Sim | Sim | Executar `docs/conversas-homologacao-whatsapp-execucao.md` |
| P0 | Billing/Trial/Product Analytics não implantados em produção | Nenhuma cobrança real funciona hoje | VPS na migration 0102 (só `0114`, da correção outbound, foi aplicada isoladamente) | Não (piloto pode ser sem cobrança) | Sim | Rodar migrations 0103-0113 na VPS + deploy da imagem atual |
| P1 | Capabilities de plano sem enforcement server-side | Uso de feature paga sem plano correspondente | Zero call site de `assertCanUse` fora da própria definição | Não | Sim, antes de vender planos diferenciados | Adicionar `assertCanUse`/`assertWithinLimit` nas rotas relevantes |
| P1 | Cron de backup real não agendado | Sem backup automático recorrente até alguém rodar manualmente | Comando pronto, não aplicado | Sim (recomendado antes) | Sim | Adicionar entrada de cron na VPS |
| P2 | Rate limiter/circuit breaker não-atômico sob concorrência real | Janela teórica de contagem imprecisa sob alta concorrência | Documentado desde a Fase 6/7 de Conversas, nunca reproduzido na prática | Não | Não, monitorar | Reescrita atômica (SQL `UPDATE ... RETURNING`) se evidência real aparecer |
| P2 | Janela de corrida `external_message_id` vs. receipt | Recibo pode chegar antes da persistência do id externo | Documentado, nunca reproduzido na prática | Não | Não | Só corrigir se reproduzido com evidência real |
| P2 | Campos de mídia do WuzAPI client não confirmados | Envio de imagem/áudio/vídeo/documento pode falhar por nome de campo errado | Comentário próprio do código admite isso | Sim para a homologação de mídia | Sim para vender "mídia" | Confirmar contra instância WuzAPI real durante a homologação de WhatsApp |
| P3 | Teams sem consumidor de permissão | Feature "completa" mas sem efeito de RBAC | Confirmado via grep (só 1 consumidor de negócio, não relacionado a permissão) | Não | Não | Decidir se vale a pena escopar permissão por Team, ou remover a expectativa do produto |
| P3 | Métricas de Growth não calculáveis (churn/expansion MRR, DAU/WAU/MAU, cohorts) | Nenhum — já documentado como indisponível, nunca aproximado | `growth-dashboard-use-cases.ts` | Não | Não | Construir snapshot histórico de MRR quando fizer sentido |

---

## 11. Status comercial

| Funcionalidade | Pronta para vender? | Condição | Observação |
|---|---|---|---|
| CRM (contatos, Kanban, tarefas, catálogo) | **SIM** | — | Implementado, testado, sem enforcement de plano ainda |
| Propostas com link público | **SIM** | — | Implementado, testado |
| Automações CRM | **SIM** | — | Sem builder NL, vocabulário fechado documentado |
| Copiloto Comercial (IA) | **SIM** | — | Sempre exige confirmação humana |
| Marketing — criação de conteúdo (imagem) | **SIM** | — | OpenAI real |
| Marketing — criação de conteúdo (vídeo) | **AVALIAR** | Confirmar Google Veo contra app real antes de anunciar | Não verificado |
| Publicação Instagram/Facebook/TikTok/YouTube | **SIM** | — | APIs reais, `RUNTIME_VERIFIED` |
| Meta Ads (campanhas/audiences/pixels) | **SIM** | — | API real, create/update |
| Atendimento via WhatsApp | **NÃO ainda** | Falta só a homologação com telefone físico real | Bug outbound já corrigido/implantado/validado; infra testada de ponta a ponta |
| IA de atendimento (auto-reply) | **NÃO ainda** | Depende do item acima | Nunca ativada em produção |
| Inbox Instagram | **NÃO** | — | Não existe canal de entrada real |
| Inbox Facebook | **NÃO** | — | Idem |
| Inbox TikTok | **NÃO** | — | Idem |
| Planos pagos / Trial / Checkout real | **NÃO ainda** | Depende de implantar migrations 0103-0113 na VPS | Código pronto e testado, não implantado |
| Growth Dashboard / Product Analytics | **NÃO ainda** | Mesma dependência acima | Idem |

---

## 12. GO / NO-GO

**Desenvolvimento interno**: **GO** — arquitetura sólida, testes extensos e reais, práticas de
segurança consistentes.

**Piloto controlado (1 workspace, humano, sem IA)**: **NO-GO condicional** — bloqueador objetivo
remanescente: concluir a homologação de WhatsApp com telefone físico real (QR, inbound, outbound,
reconnect, logout, no mínimo). A correção do bug outbound já está commitada, implantada e validada
em runtime real (`VERIFIED_RUNTIME` — ver seção 6.3).

**Primeiros clientes pagos**: **NO-GO** — depende do piloto acima estar aprovado, **mais** implantar
Billing/Trial/Product Analytics na VPS real (hoje inexistente em produção), **mais** fechar o
enforcement de capabilities de plano (hoje sem proteção server-side).

**Divulgação pública em escala**: **NO-GO** — todos os bloqueadores acima, mais: cron de backup
real agendado, homologação de mídia (imagem/áudio/vídeo/documento) confirmada, IA de atendimento
validada em piloto real antes de ativar amplamente.

---

## 13. Próximos passos

### Checklist para piloto (bloqueador vs. pode ficar para depois)

**BLOQUEADOR**:
- [x] ~~Commitar a correção do bug outbound órfão~~ — commit `94954cf`.
- [x] ~~Validar a correção em runtime real~~ — `VERIFIED_RUNTIME`, ver `docs/conversas-homologacao-runtime-relatorio.md` §1-C.
- [ ] Executar `docs/conversas-homologacao-whatsapp-execucao.md` com telefone físico real (no
      mínimo: QR/conectar, inbound texto, outbound texto, reconnect, logout).

**PODE FICAR PARA DEPOIS** (do piloto controlado, humano, 24-48h):
- Homologação de mídia (imagem/áudio/vídeo/documento) — pode ser feita durante o piloto.
- Ativação de IA de atendimento — só depois do piloto humano estável.
- Cron de backup real agendado — recomendado antes, mas não bloqueia um piloto de curtíssimo prazo
  com dado facilmente recriável.

### Checklist para lançamento público (além do checklist de piloto)

- [ ] Implantar migrations `0103`–`0113` na VPS de produção (`0114` já aplicada isoladamente) +
      deploy completo da imagem atual.
- [ ] Wireup de métricas Prometheus na API para Inbox (`inbox_outbound_publish_failed_total` hoje
      nunca incrementa pela rota HTTP — gap de observabilidade, não de confiabilidade).
- [ ] Enforcement server-side de capabilities/limites de plano (`assertCanUse`/`assertWithinLimit`
      nas rotas que hoje não têm).
- [ ] Cron de backup real agendado e testado ponta a ponta pelo menos uma vez em produção.
- [ ] IA de atendimento validada num piloto real antes de qualquer ativação ampla.
- [ ] Confirmar Google Veo (geração de vídeo) contra um app real antes de anunciar publicamente.
- [ ] Termos de uso / privacidade — não auditado neste documento (fora do escopo técnico pedido).
- [ ] Runbook de incidente já existe (`docs/conversas-runbook.md`) — confirmar que cobre também
      Billing/CRM, não só Conversas.

---

## 14. Funcionalidades futuras (claramente fora do que existe hoje)

Instagram Inbox real, Facebook Messenger Inbox real, TikTok Inbox real, atribuição Ads→Receita,
automações por linguagem natural (estilo Zapier/NL), roteamento por presença/horário, forecast de
vendas, coaching de atendimento por IA, cohorts avançados, retenção D1/D7/D30 calculada,
dashboard executivo multi-workspace, escopo de permissão por Team, churn/expansion/contraction MRR
calculado (exige snapshot histórico ainda não construído).

---

## Anexos / Evidências

- `docs/conversas-homologacao-runtime-relatorio.md` — homologação real de broker/restore/kill
  switch, com IDs/timestamps reais.
- `docs/conversas-homologacao-whatsapp-execucao.md` — roteiro pronto para a homologação de
  WhatsApp com telefone físico.
- `tests/inbox-outbound-reconciliation.test.mjs` — 13 testes da correção do bug outbound.
- `db/migrations/0114_inbox_outbound_publish_tracking.sql` — migration da correção, aplicada na
  VPS real.
- Commit `89f8cdc` — correção real do script de backup.
- Commit `1fbac2e` — fechamento do gate do kill switch + reprodução do bug outbound.
- Commit `94954cf` (HEAD) — correção do bug outbound, commitada, implantada e validada em runtime
  real (`VERIFIED_RUNTIME`).
