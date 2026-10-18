-- Nenhum plano recebe Site/Commerce gratuitamente; preço e inclusão são configurados no billing.
update plan_versions set capabilities='{"site":false,"commerce":false}'::jsonb || capabilities;
alter table addon_definitions drop constraint if exists addon_definitions_resource_check;
alter table addon_definitions add constraint addon_definitions_resource_check check(resource in ('users','workspaces','messaging_connections','contacts','ai_credits','storage_mb','automations','meetings_concurrent_recordings','site','commerce'));
