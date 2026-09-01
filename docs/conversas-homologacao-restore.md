# Módulo Conversas — Roteiro para Fechar RUNTIME_VALIDATION_PENDING_POSTGRES_RESTORE

Execução real com os binários `pg_dump`/`pg_restore`/`psql`, quando houver acesso a Docker/VPS.
O drill atual (`scripts/restore-drill.mjs`) já valida a integridade dos dados via protocolo de fio
real (pglite), mas nunca passou pelo executável `pg_dump`/`pg_restore` de verdade — este roteiro
fecha essa lacuna específica.

## Pré-condição

Um Postgres real acessível (o próprio `zuno-postgres` de um ambiente de staging, nunca produção
como origem de teste de restore) e os binários `pg_dump`/`pg_restore`/`psql` disponíveis no host
ou num container com acesso de rede a ele.

## Roteiro

1. **Dump real** — `scripts/backup-postgres.sh` contra o banco de staging; confirmar que o
   arquivo de dump é gerado, documentar tamanho e tempo gasto.
2. **Banco descartável** — criar um banco novo, vazio, **nunca o de produção como destino**
   (ex.: `createdb conversas_restore_drill`).
3. **Restore** — `pg_restore`/`psql` o dump do passo 1 nesse banco descartável; documentar tempo
   gasto.
4. **Validação de schema** — confirmar que todas as migrations aparecem em `schema_migrations`
   (mesma contagem do banco de origem) e que constraints/índices existem (ex.: o índice único
   parcial de `ai_generation_ledger.idempotency_key`, os índices de `0088`).
5. **Validação de dados** — comparar contagens de linhas de `inbox_conversations`,
   `inbox_messages`, `messaging_connections`, `inbox_conversation_events` entre origem e destino;
   conferir uma amostra de mensagens/conversas linha a linha (mesmo conteúdo, mesmos timestamps).
6. **Auditoria** — confirmar que nenhuma credencial/secret do banco de origem vazou para os logs
   do processo de dump/restore.
7. **Descartar o banco de teste** — `dropdb conversas_restore_drill` ao final; nunca deixar um
   banco de teste com dados de produção esquecido rodando.

Documentar tempo total (dump + restore + validação) e tamanho do dump — esses dois números são o
que baliza o RTO real de um restore de incidente, cobrado por `docs/conversas-runbook.md` (seção
9). Só depois desta execução real, atualizar `RUNTIME_VALIDATION_PENDING_POSTGRES_RESTORE` para
`VERIFIED_RUNTIME` no relatório da Fase 7.
