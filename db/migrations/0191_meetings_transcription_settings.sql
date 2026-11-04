-- 0191 — Motor de transcrição do Vorix Meetings, escolhido no painel administrativo.
-- Padrão: LOCAL_FASTER_WHISPER (gratuito, no próprio servidor). OPENAI_OPTIONAL só por escolha
-- explícita do admin (gera custo externo); nada usa a API da OpenAI automaticamente.

create table if not exists meeting_transcription_settings (
  id          text primary key default 'singleton' check (id = 'singleton'),
  engine      text not null default 'LOCAL_FASTER_WHISPER'
              check (engine in ('LOCAL_FASTER_WHISPER', 'LOCAL_WHISPER_CPP', 'OPENAI_OPTIONAL')),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

insert into meeting_transcription_settings (id) values ('singleton') on conflict (id) do nothing;
