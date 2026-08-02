# Runbook — Plataforma Zuno (RC 1.0)

Cobre a plataforma nova (Conversation → Operations). Para o pipeline legado (CLI `LOCAL_PRODUCTION`), ver `docs/organic-cycle-e2e.md` e os relatórios de homologação em `docs/rc*-*.md`.

## Verificação rápida de saúde

```
GET /health          # liveness trivial, sem checks
GET /livez            # processo vivo (uptime)
GET /readyz           # database + secret manager + estado operacional + production guard + fila
GET /v1/system/health  # tudo acima + circuit breakers + SLO
GET /v1/system/release-gate   # confirma production bloqueada (environment/productionEnabled/canário)
```

`readyz` retorna 503 se qualquer check falhar — é o alvo correto para um load balancer/orquestrador de containers.

## Circuit breakers

- Consultar estado: `GET /v1/system/circuit-breakers` (permissão `system:operate`).
- Resetar manualmente: `POST /v1/system/circuit-breakers/:id/reset` — **ação auditada**, usar só depois de confirmar que a causa raiz da abertura foi resolvida (ex.: provider externo voltou a responder). Resetar sem corrigir a causa reabre o circuito na próxima falha.
- Fluxo esperado: `closed → (N falhas) → open → (cooldown) → half_open → (sucesso) → closed`.

## Rate limiting

- Consultar: `GET /v1/system/rate-limits`.
- Buckets por `route_group:tenant:principal:ip`; `/health`,`/livez`,`/readyz` nunca são limitados.
- 429 vem com `X-RateLimit-*`/`Retry-After` — nunca derruba health.

## Backpressure

- Consultar: `GET /v1/system/backpressure`.
- Sinais: fila local alta, outbox de Publication pendente, dead-letters, atraso de Scheduling, dead-letters de Analytics.
- Quando ativo, Publication recusa novas operações de `publish`/reprocessamento (leituras continuam liberadas) — não é necessário nenhuma ação manual, o sistema se autorregula; investigar a causa (worker parado? provider lento?) se persistir.

## Dead letters e reprocessamento

| Fila | Consultar | Reprocessar |
|---|---|---|
| Publication | `GET /v1/publications/dead-letters` | `POST /v1/publications/dead-letters/:id/reprocess` |
| Scheduling | `GET /v1/scheduling/dead-letters` | `POST /v1/scheduling/dead-letters/:id/reprocess` |
| Analytics | ver `AnalyticsAlertService`/repositório — sem endpoint HTTP dedicado nesta sprint (achado, ver relatório final) |

## Recovery / recuperação após queda

- `POST /v1/system/recovery/run` (permissão `system:operate`) — reprocessa outbox pendente de Publication e ocorrências atrasadas de Scheduling; idempotente, seguro de rodar mais de uma vez.
- `GET /v1/publications/queue`, `/reconciliation` para inspecionar o que ficou pendente antes de acionar recovery.

## Backup / restore

- `GET /v1/system/backup-restore` retorna o plano (`BackupRestorePlanner`): fontes de verdade vs. dados derivados, ordem de restore, checks de consistência.
- `analytics_events`/`analytics` são sempre **derivados** — nunca restaurar Analytics antes das fontes primárias (Publication/Execution/Scheduling).
- Não existe rehearsal de restore automatizado nesta sprint (risco residual, ver relatório final) — validar manualmente contra um banco temporário antes de confiar no plano em um incidente real.

## Rodando localmente

```
npm run build && npm run zuno:api          # API, memória ou Postgres conforme PERSISTENCE_DRIVER
cd web && npm run dev                       # frontend
npm run db:migrate                          # aplica migrations pendentes contra DATABASE_URL
npm run db:migrate:status                   # lista o que já foi aplicado
```

Variáveis mínimas: ver `.env.example` — mas note o gap documentado no relatório final (Seção 9): várias variáveis usadas por `api-config.ts` (AI Gateway, Meta OAuth, Operations) não estão listadas em `.env.example` hoje.
