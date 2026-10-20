alter table users add column if not exists avatar_url text;
alter table messaging_connections add column if not exists send_agent_name boolean not null default false;
