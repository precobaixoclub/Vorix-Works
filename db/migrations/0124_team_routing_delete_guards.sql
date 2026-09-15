-- Bloco "roteamento por equipe" — achado de revisão (nenhuma das duas FKs novas de 0123 tinha uma
-- ação de ON DELETE explícita, então as duas caíam no padrão do Postgres, RESTRICT):
--
-- 1. `inbox_conversations.current_team_id` — RESTRICT aqui bloquearia excluir uma equipe PARA
--    SEMPRE se ela já tivesse roteado QUALQUER conversa, mesmo uma finalizada há meses (o "dono"
--    de verdade da conversa é `assigned_user_id`; `current_team_id` é metadado histórico de
--    roteamento). Corrigido pra SET NULL — excluir a equipe nunca é bloqueado por isso, só limpa
--    a referência em conversas antigas.
-- 2. `inbox_channel_routing_configs.default_team_id` — RESTRICT aqui é o comportamento CERTO
--    (config ATIVA de um canal, precisa de resolução explícita antes de excluir a equipe), mas sem
--    tratamento a violação de FK vira um erro cru de Postgres na API em vez de uma mensagem clara —
--    corrigido no código (`PostgresTeamRepository.delete`), nunca na constraint.

alter table inbox_conversations drop constraint if exists inbox_conversations_current_team_id_fkey;
alter table inbox_conversations
  add constraint inbox_conversations_current_team_id_fkey foreign key (current_team_id) references teams (id) on delete set null;

-- Backfill (achado de revisão) — `is_principal_for_level` nasceu com default `false` na migration
-- 0123, então TODA equipe criada ANTES desta funcionalidade (o CRM já tinha `Team`/`team_memberships`
-- há tempos) ficou sem NENHUM principal marcado em nenhum nível — o código nunca quebra por causa
-- disso (`selectNextMemberForLevel` cai pro fallback `members[0]`), mas o invariante "no máximo um
-- principal por nível" documentado em todo o resto do código fica falso pros dados existentes até
-- alguém editar manualmente. Marca o membro mais antigo (por `created_at`) de cada
-- (team_id, attendance_level) como principal — mesmo critério de fallback já usado no código
-- (`members[0]`, ordenado por `created_at asc`), só que persistido em vez de recalculado toda hora.
update team_memberships
set is_principal_for_level = true
where id in (
  select distinct on (team_id, attendance_level) id
  from team_memberships
  order by team_id, attendance_level, created_at asc
);
