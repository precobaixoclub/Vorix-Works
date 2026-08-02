-- Memória de conversa — pares chave/valor extraídos por regra simples (Fase 1/2). Uma linha por
-- conversa (upsert); é o lugar certo para memória semântica de verdade entrar quando o AI Gateway
-- (Fase 7) for ligado — a estrutura já existe, vazia de inteligência.
create table conversation_memory (
  conversation_id   text primary key references conversations (id) on delete cascade,
  facts             jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null
);
