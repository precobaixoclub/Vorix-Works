-- Réplica adaptada da arquitetura de Times/Canais/Roteamento do CMDesk (relatório fornecido pelo
-- usuário) — só a parte de roteamento por equipe (round-robin), NUNCA horário comercial, Kanban +
-- automação, grupos de tipo de atendimento/ação rápida, ou árvore de menu hierárquica (fora de
-- escopo desta rodada, subsistemas grandes o suficiente pra merecer rodada própria). Reaproveita o
-- `Team`/`team_memberships` já existentes (CRM/Comercial, migration 0089) em vez de criar uma
-- segunda entidade de equipe paralela.

alter table teams
  add column if not exists round_robin_enabled boolean not null default true,
  -- Ponteiro circular POR NÍVEL de atendimento (`{"N1": 3, "N2": 1}`) — mesmo desenho do CMDesk
  -- (`lastAssignedIndexByLevel`), cada nível gira de forma independente dentro da mesma equipe.
  add column if not exists last_assigned_index_by_level jsonb not null default '{}'::jsonb,
  add column if not exists timezone text not null default 'America/Sao_Paulo';

alter table team_memberships
  -- Nível de atendimento (N1/N2/...) — string livre normalizada na camada de aplicação, nunca um
  -- enum fechado no banco (mesmo racional do CMDesk: qualquer rótulo é aceito).
  add column if not exists attendance_level text not null default 'N1',
  -- Exatamente um membro por (team_id, attendance_level) deve ter isto true — fallback fixo quando
  -- o rodízio está desligado ou ninguém do nível participa dele. Reforçado na camada de aplicação
  -- (nunca uma constraint de banco, para não travar em estados transitórios durante um update em lote).
  add column if not exists is_principal_for_level boolean not null default false,
  add column if not exists participates_in_round_robin boolean not null default true,
  add column if not exists last_assigned_at timestamptz;

create index if not exists team_memberships_level_idx on team_memberships (team_id, attendance_level);

-- Canal (MessagingConnection) <-> Equipe — N:N. Uma equipe pode atender vários canais; um canal
-- pode ter várias equipes vinculadas (necessário pro round-robin ENTRE equipes de um mesmo canal).
create table if not exists messaging_connection_teams (
  id text primary key,
  connection_id text not null references messaging_connections (id) on delete cascade,
  team_id text not null references teams (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (connection_id, team_id)
);

create index if not exists messaging_connection_teams_connection_idx on messaging_connection_teams (connection_id);
create index if not exists messaging_connection_teams_team_idx on messaging_connection_teams (team_id);

-- Config de roteamento do canal (1:1) — versão simplificada do `ChannelRoutingConfig` do CMDesk:
-- só `defaultTeamId` + distribuição "default" (sempre a mesma equipe) vs "round_robin" (rodízio
-- entre as equipes vinculadas). Sem menu hierárquico, sem sticky/pinned por contato+canal — fora de
-- escopo desta rodada.
create table if not exists inbox_channel_routing_configs (
  id text primary key,
  connection_id text not null unique references messaging_connections (id) on delete cascade,
  default_team_id text not null references teams (id),
  distribution_mode text not null default 'default' check (distribution_mode in ('default', 'round_robin')),
  last_team_round_robin_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Equipe atualmente responsável pela conversa — nível ACIMA de `assigned_user_id` (que continua
-- sendo o agente humano específico). `department_id` (migration anterior) fica intocado, nunca foi
-- lido por nenhuma lógica real — nova coluna própria em vez de reaproveitar um campo morto.
alter table inbox_conversations
  add column if not exists current_team_id text references teams (id);

create index if not exists inbox_conversations_current_team_idx on inbox_conversations (current_team_id);
