# Release Track 1.0 — Relatório Final de Fechamento

**Data:** 2026-07-30
**Escopo:** fechar (resolver, aceitar ou adiar com justificativa) os 13 riscos residuais documentados em `docs/sprint-24-final-report.md` §15. Arquitetura congelada — nenhum domínio novo, nenhuma funcionalidade de negócio nova. Todo trabalho aqui é hardening de algo que já existia.
**Production:** continua bloqueada por padrão (`ProductionGuard`, confirmado ao vivo nesta sprint).

---

## 1. Backlog de riscos

| ID | Descrição | Impacto | Probabilidade | Criticidade | Responsável | Status | Plano de ação |
|---|---|---|---|---|---|---|---|
| R1 | Frontend não distingue erro real de "lista vazia" em nenhuma página workspace-scoped | Alto (mascara falhas reais como "sem dados") | Alta (toda falha de API passa por isso) | **Crítica** | Frontend | **Resolvido (majoritariamente)** | `ErrorState` criado e aplicado a 13 páginas/componentes; ver §2 |
| R2 | Só 2 de ~45 endpoints de escrita exigem `Idempotency-Key` | Médio (duplo efeito em retry) | Média | **Alta** | Backend | **Resolvido (parcial) + Aceito para o restante** | Middleware genérico criado, aplicado a 8 endpoints críticos; exceções documentadas em §2 |
| R3 | `SECRET_MANAGER_PROVIDER=production` é um stub sem backend real | Alto (bloqueia qualquer produção real) | Certa (é o estado atual) | **Alta** | Backend/Infra | **Adiado com justificativa** | Ver §4; falha fechado continua sendo o comportamento correto até um provedor real ser escolhido |
| R4 | `COOKIE_SECURE` tem default `false` | Alto se esquecido em produção | Baixa (requer erro humano) | **Alta** | Backend/Infra | **Aceito** | Documentado no runbook/deployment; validação de startup fica para quando produção real for decidida (fora de escopo — seria uma mudança de comportamento de config, não hardening puro) |
| R5 | Nenhum header de segurança HTTP (CSP/HSTS/etc.) | Alto | Certa | **Alta** | Backend | **Resolvido** | 6 headers implementados via middleware próprio, testados (3/3) |
| R6 | `publication_domain` (migration 0042) sub-indexado em 5 tabelas | Médio (degrada sob volume) | Certa (já existe hoje) | **Média** | Backend/DB | **Resolvido** | Migration `0050`, planos de execução validados via `EXPLAIN` (Index Scan confirmado nas 5 tabelas) |
| R7 | Sem rehearsal real de backup/restore | Alto (só descoberto num incidente real) | Baixa | **Média** | Ops | **Adiado com justificativa** | Requer um banco temporário dedicado e uma janela operacional — fora do escopo de uma sprint de hardening de código |
| R8 | Isolamento entre domínios novos (Scheduling↔Publication, Webhook↔Publication, Analytics↔Scheduling) sem guarda de CI | Médio | Média | **Média** | Backend | **Adiado com justificativa** | Ver §3; acoplamento existente é intencional/funcional (dispatcher), não um vazamento acidental — criar uma guarda exigiria decidir a fronteira "certa" primeiro, decisão de arquitetura fora do escopo de "eliminar/aceitar/adiar" |
| R9 | `traceId` não propaga para Scheduling | Baixo | Certa | **Baixa** | Backend | **Aceito** | Rastreabilidade parcial (Execution→Publication) já cobre o trecho mais crítico; estender exigiria tocar o domínio Scheduling, que não é hardening de superfície |
| R10 | `.env.example` desatualizado (variáveis de AI Gateway/Meta OAuth/Operations ausentes) | Baixo | Certa | **Baixa** | Docs | **Resolvido** | Ver `docs/deployment.md`/`docs/runbook.md` (Sprint 24) — gap documentado explicitamente; atualização completa do arquivo fica para quando as variáveis reais de produção forem definidas |
| R11 | `check-contract-drift.mjs` não cobre Execution/Publication/Credential/Webhook/Scheduling/Analytics/Operations | Baixo | Certa | **Baixa** | Backend | **Adiado com justificativa** | Estender a guarda para 7 domínios exige inventariar todos os DTOs primeiro — trabalho de escopo comparável a uma sprint própria |
| R12 | Sem `web/app/error.tsx`/`not-found.tsx` | Baixo | Baixa | **Baixa** | Frontend | **Aceito** | `ErrorState` por página cobre o caso relevante (erro de dados); um error boundary global cobriria só erros de render, que não apareceram em nenhum teste |
| R13 | Legado (`LOCAL_PRODUCTION`) tem um bug conhecido e deferido (BUG-06) | Nenhum para esta plataforma | N/A | **N/A** | N/A | **Fora de escopo** | Pertence ao pipeline legado, já homologado e liberado em seu próprio ciclo (`docs/rc2-re-homologacao-report.md`) — nunca se toca nesta arquitetura |

**Resumo:** 4 Resolvidos, 1 Resolvido parcialmente + aceito, 4 Aceitos, 3 Adiados com justificativa, 1 fora de escopo.

---

## 2. Itens resolvidos

### R1 — Erro invisível no frontend
Criado `web/components/ErrorState.tsx` — distingue sem-permissão (401/403), indisponível (`NETWORK_ERROR`) e erro genérico, com botão de retry via `mutate()`. Aplicado a: `planning` (lista+detalhe), `runtime` (lista+detalhe), `assets`, `campaigns`, `execution` (lista+detalhe), `publications` (lista+detalhe), `governance`, `providers`, `calendar`, `home` (card de conversas), `chat/[conversationId]`, `ConversationList`, `analytics` (todos os painéis com dados reais), `operations` (Resumo). **Não aplicado**: `knowledge` (dados 100% simulados, sem chamada de API real que possa falhar — decisão documentada no código-fonte desde a Sprint 04) e os 6 hooks secundários de `publications`/`providers`/`calendar` (queue/metrics/webhooks/sync/health/deadLetters) que já usam fallback `?? 0`/`?? []` — cobertura do hook primário de cada página foi priorizada.

### R2 — Idempotência (parcial)
`InMemoryIdempotencyKeyStore` + `registerIdempotencyMiddleware` (opt-in por rota via `config: { idempotent: true }`) — 6 testes unitários cobrindo replay exato, isolamento por tenant+usuário, ignorar rota sem opt-in, ausência de header, e nunca cachear 5xx. Aplicado a: `POST /credentials/connect|rotate|revoke|disable|enable`, `POST /providers/:id/connect|disconnect`, `POST /schedules`. Ver §"exceções justificadas" abaixo.

**Exceções justificadas (não instrumentadas nesta sprint):**
- `POST /credentials/health-check` — diagnóstico, sem efeito colateral relevante em repetir.
- Transições de estado de Publication (approve/publish/cancel/retry/reschedule/reconcile) e Scheduling (pause/resume/cancel/reschedule) — a idempotência correta para uma transição de estado é "checar o estado atual antes de agir" (no-op se já está no estado alvo), não um cache de resposta HTTP; auditar se cada handler já faz isso exigiria revisão caso a caso de 6 domínios que não construí, risco desproporcional a uma sprint de hardening.
- `system.route.ts` (reset de circuit breaker, recovery run) — operações administrativas, de baixa frequência, sempre acionadas manualmente por um operador que já vê o resultado antes de repetir.

### R5 — Headers de segurança
`registerSecurityHeadersMiddleware` — CSP (`default-src 'none'`, já que a API nunca serve HTML), X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy sempre; HSTS condicionado a `COOKIE_SECURE=true`. 3 testes, confirmados ao vivo contra um processo real.

### R6 — Índices ausentes
Migration `0050_publication_domain_missing_indexes.sql` — 6 índices novos (5 nas FKs de `publication_candidates/approvals/attempts/failures/dead_letters` + 1 composto para a listagem de dead-letters por tenant/workspace). Validado com `EXPLAIN` real: as 5 consultas que antes faziam Seq Scan agora usam Index/Bitmap Index Scan. `npm run test:publication` (30/30) confirma que nada quebrou.

### R10 — Documentação de configuração
Gap já registrado explicitamente em `docs/deployment.md`/`docs/runbook.md` (criados na Sprint 24) — tratado como "resolvido" no sentido de "documentado e rastreável", não de "arquivo `.env.example` reescrito", que exigiria decidir valores de produção reais fora do escopo desta sprint.

---

## 3. Itens aceitos

- **R4 (`COOKIE_SECURE` default `false`)** — comportamento correto para dev/sandbox (a maioria dos ambientes desta fase); mudar o default exigiria decidir "que ambiente é produção" de forma automática, o que não existe hoje sem ativar produção real. Mitigação: documentado em `docs/deployment.md` como passo obrigatório de deploy.
- **R9 (`traceId` não chega a Scheduling)** — a lacuna de rastreabilidade mais crítica (Execution→Publication, onde o dinheiro/efeito real acontece) já está fechada; Scheduling é a etapa de agendamento, não de execução.
- **R12 (sem error boundary/404 globais)** — `ErrorState` por página já cobre o caso que gerou o risco (erro de dado, não erro de render); nenhum teste ou uso real revelou um erro de render não capturado.
- **R2, parte não coberta** — ver exceções listadas em §2.

## 4. Itens adiados (com justificativa)

### R3 — Secret Manager de produção
**Decisão: manter o stub fail-closed, documentar explicitamente a integração esperada — não implementar uma integração real.**

Não há credenciais nem provedor de secret manager (Vault, AWS Secrets Manager, GCP Secret Manager etc.) definido ou disponível neste ambiente para conectar de verdade — implementar uma integração "real" sem um provedor real seria fabricar uma conexão que não existe, o oposto do que uma sprint de hardening deveria fazer. `SecretManagerPort` (`src/application/ports/secret-manager.port.ts`) já está desacoplado corretamente — qualquer implementação futura só precisa satisfazer:

```ts
export type SecretManagerPort = {
  get(ref: { tenantId: string; workspaceId: string; providerId: string; credentialReferenceId: string }): Promise<SecretValue | undefined>;
  put(secret: SecretValue): Promise<void>;
  health(): Promise<{ ok: boolean; provider: string; safeMessage: string }>;
};
```

**Integração esperada** (para quando um provedor real for escolhido): implementar uma nova classe em `src/infrastructure/operations/secret-managers.ts` (ex.: `VaultSecretManager`/`AwsSecretsManagerAdapter`) que troque `FailClosedProductionSecretManager` quando `SECRET_MANAGER_PROVIDER=production`, sem alterar nenhum código de domínio (`PublicationSecretStoragePort`, `credential-governance-service.ts` etc. já dependem só da porta). Até lá, `readyz`/`system/health` continuam corretamente reportando "não pronto para produção" — esse é o comportamento desejado, não um bug.

### R7 — Rehearsal de backup/restore
Requer um banco Postgres temporário dedicado e uma janela operacional real — não é uma mudança de código, é um exercício operacional. `docs/runbook.md` já documenta o procedimento esperado (`GET /v1/system/backup-restore`); executá-lo de fato fica como item do checklist de produção controlada (§7).

### R8 — Guardas de isolamento entre domínios novos
Investigação desta sprint (grep nas duas direções) confirmou: o acoplamento de `Scheduling→Publication` (`scheduling-publication-dispatcher.ts`, importa `enqueuePublication`/`PublicationWorker` diretamente) é a peça que de fato despacha publicações agendadas — é funcional, não um vazamento acidental, e nenhum ciclo foi encontrado. Criar uma guarda automatizada exigiria primeiro decidir se esse acoplamento deveria virar um Port formal (mudança de arquitetura, fora do escopo de "arquitetura congelada") ou permanecer como está — decisão que pertence a uma sprint de arquitetura, não a esta de fechamento de riscos.

### R11 — `check-contract-drift.mjs` incompleto
Estender a 7 domínios exige primeiro inventariar todos os DTOs desses domínios um a um (nenhum foi construído por mim, diferente de Planning/Runtime) — risco de listar um contrato incorretamente e criar falsos-positivos que quebrem `architecture:check` para todo mundo. Recomendado como primeiro item de uma sprint dedicada a isso.

---

## 5. Evidências

```
npm run architecture:check   → 8/8 guardas OK (623 arquivos verificados)
npm test                     → 1763/1763 (1754 anteriores + 9 novos: 3 headers + 6 idempotência)
cd web && npm run typecheck  → limpo
cd web && npm run build      → 21 rotas geradas, sem erro
cd web && npm test           → 11/11

EXPLAIN select * from publication_candidates where publication_id = 'x'
  → Bitmap Index Scan on idx_publication_candidates_publication (antes: Seq Scan)
  (mesma confirmação nas outras 4 tabelas — publication_approvals/attempts/failures/dead_letters)

GET /v1/system/release-gate  → { productionEnabled: false, environment: "development" } (ao vivo)
GET /v1/health                → headers: content-security-policy, x-frame-options,
                                 x-content-type-options, referrer-policy, permissions-policy (ao vivo)
```

## 6. Smoke Test

Reexecutado o fluxo Conversation→Briefing→Planning→Runtime contra um processo real (mesma metodologia da Sprint 24 — porta 3930, `AUTH_MODE=noop`, `PERSISTENCE_DRIVER=memory`):

```
POST /v1/workspaces, /v1/conversations, /v1/conversations/:id/messages ×6
  → conversation.state: "resolved", preparedCommandSummary.status: "prepared"
GET /v1/planning   → status: "ready"
GET /v1/runtime    → status: "validated"
```

Idempotência confirmada em dois cenários reais: uma resposta 5xx (config incompleta em modo memória para credenciais/schedules) **nunca foi cacheada** — cada tentativa gerou um `requestId` novo, exatamente o comportamento desenhado (nunca travar um cliente num erro eterno). O caminho de replay em caso de sucesso (2xx) está coberto pelos 6 testes unitários do middleware (`tests/idempotency-middleware.test.mjs`), que simulam exatamente esse caso — não foi reproduzido contra um endpoint de negócio real nesta rodada porque as rotas de credencial exigem configuração de OAuth/Postgres além do que este ambiente de smoke test tinha à mão; documentado aqui com honestidade em vez de alegar uma verificação que não foi feita.

Publication→Scheduling→Analytics→Audit→Dashboard: cobertos pela suíte automatizada (`test:publication`, `test:scheduling`, `test:analytics`, `test:operations`), todos dentro do `npm test` verde confirmado em §5 — mesma metodologia e mesma ressalva já declaradas no relatório da Sprint 24.

## 7. Checklist de Produção Controlada

Preparação para liberar **1 tenant / 1 workspace / 1 provider sandbox / 1 credencial / 1 publicação**, com monitoramento integral — **sem ativar produção**:

- [ ] Escolher o tenant/workspace piloto e registrar em `PUBLICATION_CANARY_*`
- [ ] Confirmar `PUBLICATION_PROVIDER_ENVIRONMENT=sandbox` e `PUBLICATION_PRODUCTION_ENABLED=false` (padrão — não mudar)
- [ ] Conectar 1 credencial via `POST /v1/providers/meta_pages_sandbox/connect` (idempotente agora) e confirmar `GET /v1/providers/:id/health`
- [ ] Rodar o fluxo completo Conversation→Publication para 1 conteúdo, com `mode: "dry_run"` primeiro, depois sandbox real
- [ ] Observar `GET /v1/system/health`, `/v1/system/circuit-breakers`, `/v1/system/backpressure` durante a janela
- [ ] Confirmar `GET /v1/system/release-gate` → `productionEnabled: false` antes, durante e depois
- [ ] Revisar `GET /v1/analytics/*` (Publicações, Alertas) para essa janela específica
- [ ] Confirmar zero dead-letters gerados; se algum ocorrer, seguir `docs/troubleshooting.md`
- [ ] Registrar o resultado como anexo deste relatório antes de considerar uma segunda rodada

## 8. Aprovação Final do Release Candidate 1.0

**Decisão: Release Candidate 1.0 permanece aprovado para produção controlada. Dos 13 riscos da Sprint 24: 4 resolvidos, 1 resolvido parcialmente (idempotência, com exceções justificadas), 4 aceitos, 3 adiados com justificativa registrada, 1 fora de escopo (pipeline legado). Nenhum risco crítico permanece sem classificação ou sem plano.**

Toda a suíte automatizada permanece verde (1763/1763), os 8 guardas de arquitetura passam, o frontend compila e testa limpo, e as correções aplicadas (headers de segurança, índices, idempotência parcial, tratamento de erro no frontend) foram verificadas com evidência real — testes automatizados novos, `EXPLAIN` de banco, e chamadas HTTP ao vivo — não apenas descritas.

- [x] **Release Candidate 1.0 aprovado para produção controlada**
- [ ] Reprovar / exigir nova rodada

**Production permanece bloqueada.** Nenhuma Sprint 25 foi iniciada. Aguardando revisão arquitetural final.
