-- Registros técnicos aguardam o telefone sem perder identidade ou histórico.
alter table contacts add column if not exists phone_resolution_pending boolean not null default false;
