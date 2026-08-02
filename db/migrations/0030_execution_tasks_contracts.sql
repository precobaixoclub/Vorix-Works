-- ExecutionTask ganha contratos explícitos de entrada/saída — Sprint 10 (decisão obrigatória
-- 16/17). `not null default '...'::jsonb` cobre linhas já existentes de planos da Sprint 09 sem
-- quebrar nenhuma migração aplicada anteriormente; toda escrita NOVA (a partir desta sprint)
-- sempre populações os dois contratos de verdade (ver arthur-planner.ts).
alter table execution_tasks
  add column input_contract jsonb not null default '{"version": 1, "ports": []}'::jsonb,
  add column output_contract jsonb not null default '{"version": 1, "ports": []}'::jsonb;
