-- 0056 — Acrescenta "quality_review" (novo TaskType, ver src/domain/planning/planning.model.ts) às
-- CHECK constraints de `type` que ainda fechavam essas colunas na lista de 7 valores definida em
-- 0055. A capability usada por essa task é "human_review" (já presente desde 0025/0055 — o
-- mapeamento capability->skill "human_review"->"quality_review" já existe no código,
-- capability-mapping.ts, só nunca foi exercitado), por isso nenhuma constraint de `capability`
-- precisa mudar aqui. Task usada pelo template `content_request-visual-only-v2`
-- (arthur-planner.ts): roda o skill Lucas (quality gate) entre `visual_generation` e `approval`.

alter table execution_tasks drop constraint execution_tasks_type_check;
alter table execution_tasks add constraint execution_tasks_type_check
  check (type in ('research', 'campaign_structure', 'copy_generation', 'visual_generation', 'approval', 'publication', 'content_brief', 'quality_review'));

alter table runtime_tasks drop constraint runtime_tasks_type_check;
alter table runtime_tasks add constraint runtime_tasks_type_check
  check (type in ('research', 'campaign_structure', 'copy_generation', 'visual_generation', 'approval', 'publication', 'content_brief', 'quality_review'));

alter table execution_task_runs drop constraint execution_task_runs_type_check;
alter table execution_task_runs add constraint execution_task_runs_type_check
  check (type in ('research', 'campaign_structure', 'copy_generation', 'visual_generation', 'approval', 'publication', 'content_brief', 'quality_review'));
