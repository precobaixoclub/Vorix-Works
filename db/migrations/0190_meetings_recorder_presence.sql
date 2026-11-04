-- 0190 — Presença dos workers do gravador de reuniões. Cada recorder grava um sinal de vida a cada
-- 15 s; a API só oferece "Conectar conta" e só abre o navegador de login quando há um worker vivo.
-- Antes, sem gravador instalado, a conta era criada e a tela esperava 30 s até desistir.

create table if not exists meeting_recorder_workers (
  worker_id    text primary key,
  provisioning boolean not null default false,
  last_seen_at timestamptz not null default now()
);
