-- Link privado da seleção; a referência curta continua servindo para o atendimento.
alter table sales_intents add column selection_token text not null default
 (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''));
create unique index sales_intents_selection_token_idx on sales_intents(selection_token);
alter table sales_intents add column selection_revision integer not null default 1;
alter table sales_intents add column selection_submitted_at timestamptz;
alter table sales_intents add column selection_customer jsonb;
alter table sales_intents add column selection_history jsonb not null default '[]'::jsonb;
alter table sales_intents add column selection_locked_until timestamptz;
alter table sales_intents add column selection_sync_error text;
alter table sales_intents add column selection_deal_item_ids text[] not null default '{}';
