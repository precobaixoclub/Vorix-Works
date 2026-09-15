-- Kanban de atendimento (réplica adaptada do CMDesk, pedido explícito do usuário) — quadro estilo
-- Trello POR EQUIPE, onde cada coluna é uma fase (`TeamKanbanPhase`) e cada card é uma conversa.
--
-- ADAPTAÇÃO AO VORIX (deliberada, documentada aqui pra quem ler depois): o CMDesk modela
-- `ConversationTeamState` como uma tabela própria (1 linha por conversa+equipe, permitindo uma
-- conversa "existir" em várias equipes ao mesmo tempo). No Vorix isso já não é possível — uma
-- conversa só tem UMA equipe responsável por vez (`inbox_conversations.current_team_id`, migration
-- 0123). Por isso a fase atual vira só mais um campo em `inbox_conversations`
-- (`current_phase_id`) em vez de uma tabela paralela — sempre coerente com `current_team_id`
-- (a fase só faz sentido enquanto a conversa pertence à equipe dona da fase).
--
-- Fora de escopo desta rodada (marcado como opcional no próprio guia do usuário): motor de
-- automação por fase (`TeamKanbanPhaseAutomationRule`/Log — SEND_MESSAGE/MOVE_PHASE automático) e
-- a varredura de "ciclo obsoleto" (depende do conceito de `AttendanceSession`, que o Vorix não tem
-- como entidade própria).

create table if not exists team_kanban_phases (
  id                            text primary key,
  tenant_id                     text not null,
  team_id                       text not null references teams (id) on delete cascade,
  name                          text not null,
  order_index                   integer not null,
  is_default_first              boolean not null default false,
  phase_type                    text not null default 'RUNNING' check (phase_type in ('RUNNING', 'PAUSED')),
  nao_contabiliza_operacional   boolean not null default false,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  -- Necessária pro algoritmo de reorder em duas passadas (ver `reorderKanbanPhases`) — sem isto,
  -- duas fases trocando de posição colidiriam no meio do caminho.
  unique (tenant_id, team_id, order_index)
);

create index if not exists team_kanban_phases_team_idx on team_kanban_phases (team_id);

-- HISTÓRICO: cada permanência de uma conversa em uma fase (uma linha nova a cada troca). No máximo
-- UMA linha aberta (`ended_at is null`) por (conversation_id, team_id) a qualquer momento —
-- garantido em código via lock, nunca por constraint (ver `moveConversationPhase`).
create table if not exists conversation_time_entries (
  id                text primary key,
  tenant_id         text not null,
  conversation_id   text not null references inbox_conversations (id) on delete cascade,
  team_id           text not null references teams (id) on delete cascade,
  -- FK pra fase É opcional de propósito (nunca `not null`): excluir uma fase com histórico não pode
  -- travar a exclusão nem apagar o histórico — `on delete set null` preserva a linha, só perde a
  -- referência (mesmo racional documentado no guia do usuário, seção 4.4).
  phase_id          text references team_kanban_phases (id) on delete set null,
  -- SNAPSHOT do phaseType da fase no momento em que a entrada foi aberta — nunca relido depois.
  -- Reconfigurar uma fase de RUNNING pra PAUSED não reescreve histórico antigo (auditoria correta).
  phase_type        text not null check (phase_type in ('RUNNING', 'PAUSED')),
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  duration_seconds  integer,
  created_at        timestamptz not null default now()
);

create index if not exists conversation_time_entries_conv_team_idx on conversation_time_entries (conversation_id, team_id);
-- Índice parcial — só as entradas ABERTAS importam pra consulta em tempo real (badge "rodando" dos
-- cards); a varredura de histórico fechado é rara (relatórios), não precisa de índice dedicado.
create index if not exists conversation_time_entries_open_idx on conversation_time_entries (conversation_id, team_id) where ended_at is null;

alter table inbox_conversations
  add column if not exists current_phase_id text references team_kanban_phases (id) on delete set null,
  add column if not exists is_pinned boolean not null default false,
  add column if not exists pinned_at timestamptz;

create index if not exists inbox_conversations_current_phase_idx on inbox_conversations (current_phase_id);

-- `inbox_conversation_events.type` tem um CHECK CONSTRAINT enumerando os tipos válidos (migration
-- 0086) — achado de revisão: o enum TypeScript (`InboxConversationEventType`) é só metade da
-- fonte de verdade, o banco tem a outra metade. Esquecer de estender ESTA constraint junto faz
-- todo `conversationEventRepository.record({type: "kanban_phase_changed", ...})` falhar em
-- runtime com uma violação de constraint — nunca um erro de compilação, só descoberto em teste/produção.
alter table inbox_conversation_events drop constraint if exists inbox_conversation_events_type_check;
alter table inbox_conversation_events add constraint inbox_conversation_events_type_check
  check (type in (
    'assigned', 'unassigned', 'took_over', 'transferred', 'status_changed', 'ai_paused', 'ai_resumed',
    'ai_response_sent', 'ai_response_failed', 'ai_response_cancelled', 'ai_response_skipped_insufficient_credits',
    'kanban_phase_changed'
  ));
