# Troubleshooting — Plataforma Zuno (RC 1.0)

## `/readyz` retorna 503

Ler o array `checks` da resposta — cada item tem `status: "pass"|"fail"` e `safeMessage`. Causas mais comuns:

- `database` falhando: `DATABASE_URL` incorreta ou Postgres fora do ar. Com `PERSISTENCE_DRIVER=memory` este check sempre passa trivialmente.
- `secret_manager` falhando: `SECRET_MANAGER_PROVIDER=production` sem um backend real conectado — **esperado nesta fase** (RC 1.0 nunca liga produção real, ver `docs/sprint-24-final-report.md` Seção 11). Em dev/sandbox, usar `SECRET_MANAGER_PROVIDER=local` (padrão).
- `production_guard` falhando: normalmente não falha (produção bloqueada é o estado "pass" esperado) — se aparecer como falha, checar se alguém setou `PUBLICATION_PRODUCTION_ENABLED=true` sem os demais requisitos (canário, provider permitido, secret manager pronto).

## 429 inesperado numa rota de negócio

Checar `GET /v1/system/rate-limits` para o bucket relevante. Se for tráfego legítimo, ajustar `OPERATIONAL_RATE_LIMIT_DEFAULT`/`OPERATIONAL_RATE_LIMIT_WINDOW_MS` (não documentados em `.env.example` — ver `api-config.ts`). `/health`/`/livez`/`/readyz` nunca são afetados.

## Circuit breaker aberto travando um provider

`GET /v1/system/circuit-breakers` mostra `state: "open"` e `target`. Esperar o `cooldownMs` (padrão 60s) para `half_open`, ou investigar a causa raiz antes de `POST /v1/system/circuit-breakers/:id/reset` — resetar sem corrigir a causa reabre no próximo erro.

## Publicação presa em `waiting_for_approval` / não avança

Confirmar `POST /v1/publications/:id/approve` foi chamado com um principal que tem `publication:approve`. Depois, `POST /v1/publications/:id/publish` (ou aguardar o worker automático via `POST /v1/publications/operate/run-due` se agendada).

## Publicação em `unknown_outcome`

O provider não confirmou nem negou de forma conclusiva (timeout, resposta ambígua). Rodar `POST /v1/publications/:id/reconcile` — a reconciliação cruza com webhooks recebidos do provider (`publication_sync_completed`) para resolver o estado real. Nunca assumir sucesso/falha sem essa etapa.

## Webhook rejeitado (400) do provider

Causas possíveis, nesta ordem de verificação:
1. Segredo de assinatura errado/ausente (`*_WEBHOOK_SECRET` — checar qual provider e a variável correspondente).
2. `replay_detected` — nonce já visto; normal se o provider está reenviando o mesmo evento (idempotência funcionando como esperado, não é um bug).
3. `payload_invalid`/`provider_unknown` — provider não reconhecido pelo normalizador (`provider-event-normalizer.ts`) ou payload fora do formato esperado.

## Idempotência — reenviar a mesma requisição criou um registro duplicado

Nem todo endpoint de escrita exige `idempotencyKey` (achado documentado no relatório final — só `POST /execution-runs` e `POST /publications` exigem). Para os demais (approve/publish/cancel/retry/reschedule/reconcile, todo `scheduling.route.ts`, todo `system.route.ts`), o cliente é responsável por não reenviar sem necessidade; retries automáticos devem checar o estado atual (`GET`) antes de reenviar um POST de transição de estado.

## Discrepância entre o que o frontend mostra e o que a API retorna

Como nenhuma página do frontend (`web/app/workspaces/[workspaceId]/**`) lê o campo `error` das chamadas SWR (achado documentado no relatório final, Seção 6), um erro real da API (500, 403, timeout) aparece no frontend como "lista vazia" — indistinguível de "não há dados". Ao investigar um "onde sumiram os dados" relatado por um usuário, sempre checar a aba de rede do browser / logs da API antes de assumir que os dados realmente não existem.

## Analytics com números que não batem

Lembrar que Analytics é sempre **derivado** — nunca a fonte de verdade. Comparar contra o domínio de origem (Publication/Execution/Scheduling) antes de assumir bug em Analytics; um evento de compensação (`analytics_compensation`) pode já estar em trânsito.
