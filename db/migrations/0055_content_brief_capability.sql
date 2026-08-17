-- 0055 — Acrescenta "content_brief" (novo TaskType/ExecutionCapability, ver
-- src/domain/planning/planning.model.ts) às CHECK constraints que ainda fechavam essas colunas
-- na lista antiga de 6 valores. Usado pelo pipeline reduzido `content_request-visual-only-v1`
-- (content_brief -> visual_generation -> approval, sem publicação) — sem esta migration, gravar
-- qualquer uma dessas tarefas falha com "violates check constraint ..._capability_check"/
-- "..._type_check".

alter table execution_tasks drop constraint execution_tasks_type_check;
alter table execution_tasks add constraint execution_tasks_type_check
  check (type in ('research', 'campaign_structure', 'copy_generation', 'visual_generation', 'approval', 'publication', 'content_brief'));

alter table execution_tasks drop constraint execution_tasks_capability_check;
alter table execution_tasks add constraint execution_tasks_capability_check
  check (capability in ('editorial_research', 'strategic_planning', 'copywriting', 'visual_design', 'human_review', 'distribution', 'content_brief'));

alter table runtime_tasks drop constraint runtime_tasks_type_check;
alter table runtime_tasks add constraint runtime_tasks_type_check
  check (type in ('research', 'campaign_structure', 'copy_generation', 'visual_generation', 'approval', 'publication', 'content_brief'));

alter table runtime_tasks drop constraint runtime_tasks_capability_check;
alter table runtime_tasks add constraint runtime_tasks_capability_check
  check (capability in ('editorial_research', 'strategic_planning', 'copywriting', 'visual_design', 'human_review', 'distribution', 'content_brief'));

alter table execution_task_runs drop constraint execution_task_runs_type_check;
alter table execution_task_runs add constraint execution_task_runs_type_check
  check (type in ('research', 'campaign_structure', 'copy_generation', 'visual_generation', 'approval', 'publication', 'content_brief'));

alter table execution_task_runs drop constraint execution_task_runs_capability_check;
alter table execution_task_runs add constraint execution_task_runs_capability_check
  check (capability in ('editorial_research', 'strategic_planning', 'copywriting', 'visual_design', 'human_review', 'distribution', 'content_brief'));

alter table execution_handler_resolution_events drop constraint execution_handler_resolution_capability_check;
alter table execution_handler_resolution_events add constraint execution_handler_resolution_capability_check
  check (capability in ('editorial_research', 'strategic_planning', 'copywriting', 'visual_design', 'human_review', 'distribution', 'content_brief'));

alter table execution_traces drop constraint execution_traces_capability_check;
alter table execution_traces add constraint execution_traces_capability_check
  check (capability in ('editorial_research', 'strategic_planning', 'copywriting', 'visual_design', 'human_review', 'distribution', 'content_brief'));
