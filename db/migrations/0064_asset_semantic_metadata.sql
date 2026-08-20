-- 0064 — Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT": metadados
-- semânticos por material (Asset Library), aditivos e opcionais. `material_type` é
-- DELIBERADAMENTE separado de `kind` (que continua existindo e sendo usado por
-- `findLogoAssetUrl`/validação de upload) — granularidade mais fina para o motor GPT entender o
-- papel real de cada material (logo principal vs. secundária, screenshot do site vs. do app,
-- etc.), sem forçar migração de nenhum asset já cadastrado nem do CHECK constraint de `kind`.

alter table assets
  add column material_type text,
  add column ai_instructions text,
  add column usage_rule text,
  add column usage_priority text;

alter table assets
  add constraint assets_material_type_check check (material_type is null or material_type in (
    'logo_principal', 'logo_secundaria', 'screenshot_site', 'screenshot_app', 'produto',
    'foto_institucional', 'referencia_visual', 'selo', 'icone', 'fundo', 'campanha', 'outro'
  ));

alter table assets
  add constraint assets_usage_priority_check check (usage_priority is null or usage_priority in (
    'required', 'preferred', 'automatic', 'on_request'
  ));
