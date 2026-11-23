create table platform_email_alert_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  from_email text,
  recipients text[] not null default '{}',
  event_types text[] not null default array['account_created','subscription_started','plan_changed',
    'cancellation_requested','subscription_cancelled','payment_failed','publication_failed','publication_action_required'],
  api_key_encrypted text,
  updated_at timestamptz not null default now()
);
insert into platform_email_alert_settings (id) values (true);

create table platform_email_deliveries (
  id bigint generated always as identity primary key,
  event_type text not null,
  event_key text not null,
  recipient text not null,
  from_email text not null,
  subject text not null,
  body text not null,
  link_path text,
  status text not null default 'pending' check (status in ('pending','sending','accepted','failed','cancelled')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token text,
  provider_id text,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (event_type, event_key, recipient)
);
create index platform_email_deliveries_ready_idx on platform_email_deliveries (available_at, id)
  where status in ('pending','sending');

-- Capture in the same transaction as each source event. The email provider runs independently.
create function enqueue_platform_email_alert(
  kind text, event_id text, email_subject text, email_body text, source_path text
) returns void language sql as $$
  insert into platform_email_deliveries (event_type, event_key, recipient, from_email, subject, body, link_path)
    select kind, event_id, recipient, s.from_email, left(email_subject, 180), left(email_body, 2500), source_path
    from platform_email_alert_settings s cross join lateral unnest(s.recipients) as recipient
    where s.id and s.api_key_encrypted is not null and s.from_email is not null
      and (kind = 'test' or (s.enabled and kind = any(s.event_types)))
    on conflict (event_type, event_key, recipient) do nothing;
$$;

create function platform_email_account_label(account_id text) returns text language sql stable as $$
  select coalesce(
    (select nullif(display_name, '') from tenant_administrative_controls where tenant_id = account_id),
    (select name from workspaces where tenant_id = account_id order by (status = 'active') desc, created_at, id limit 1),
    account_id
  );
$$;

create function platform_email_subscription_event() returns trigger language plpgsql as $$
declare
  previous_plan text;
  current_plan text;
  account_text text;
  path text := '/admin/tenants/' || new.tenant_id;
begin
  if new.billing_provider = 'sandbox' then return new; end if;

  if new.status = 'active' and new.provider_subscription_id is not null then
    if tg_op = 'INSERT' or old.status in ('trial','trial_expired') or old.provider_subscription_id is null then
      select name into current_plan from plan_versions where id = new.plan_version_id;
      perform enqueue_platform_email_alert('subscription_started', new.id, 'Nova assinatura confirmada',
        format(E'Conta: %s\nPlano: %s', platform_email_account_label(new.tenant_id), current_plan), path);
      return new;
    end if;
  end if;
  if tg_op = 'INSERT' then return new; end if;

  account_text := 'Conta: ' || platform_email_account_label(new.tenant_id);
  if old.plan_version_id <> new.plan_version_id and new.status in ('active','past_due') then
    select previous.name, current_version.name into previous_plan, current_plan
      from plan_versions previous cross join plan_versions current_version
      where previous.id = old.plan_version_id and current_version.id = new.plan_version_id
        and previous.plan_code <> current_version.plan_code;
    if found then
      perform enqueue_platform_email_alert('plan_changed', new.id || ':' || txid_current() || ':' || new.plan_version_id,
        'Alteração de plano aplicada', account_text || format(E'\nPlano anterior: %s\nNovo plano: %s', previous_plan, current_plan), path);
    end if;
  end if;
  if not old.cancel_at_period_end and new.cancel_at_period_end and new.status <> 'cancelled' then
    perform enqueue_platform_email_alert('cancellation_requested', new.id || ':' || txid_current(),
      'Cancelamento de assinatura solicitado', account_text || case when new.current_period_end is null then ''
        else E'\nFim do período atual: ' || to_char(new.current_period_end at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ' (Brasília)' end, path);
  end if;
  if old.status <> 'cancelled' and new.status = 'cancelled' then
    perform enqueue_platform_email_alert('subscription_cancelled', new.id || ':' || txid_current(), 'Assinatura cancelada', account_text, path);
  end if;
  return new;
end;
$$;
create trigger platform_email_subscription_event after insert or update of status, plan_version_id, cancel_at_period_end, provider_subscription_id
  on subscriptions for each row execute function platform_email_subscription_event();

create function platform_email_failed_payment() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from subscriptions where id = new.subscription_id and billing_provider <> 'sandbox') then return new; end if;
  perform enqueue_platform_email_alert('payment_failed', new.id, 'Falha no pagamento de assinatura',
    'Conta: ' || platform_email_account_label(new.tenant_id), '/admin/tenants/' || new.tenant_id);
  return new;
end;
$$;
create trigger platform_email_failed_payment after insert on billing_events for each row
  when (new.event_type = 'payment_failed') execute function platform_email_failed_payment();

create function platform_email_publication_failure() returns trigger language plpgsql as $$
declare
  pub publication_plans%rowtype;
  channel_name text;
  failure_text text;
begin
  select * into pub from publication_plans where id = new.publication_id and mode = 'real';
  if not found then return new; end if;
  select channel into channel_name from publication_targets where id = new.target_id and publication_id = pub.id;
  if tg_table_name = 'publication_dead_letters' then
    failure_text := coalesce(nullif(new.last_safe_message, ''), 'As tentativas de publicação terminaram sem confirmação de envio.');
  else
    failure_text := coalesce(new.payload->'failure'->>'message', 'A publicação agendada não chegou a ser enviada.');
  end if;
  perform enqueue_platform_email_alert('publication_failed', tg_table_name || ':' || new.id, 'Falha na publicação',
    format(E'Marca: %s\nRede: %s\nMotivo: %s', (select name from workspaces where id = pub.workspace_id),
      coalesce(channel_name, 'Consulte os destinos no Vorix'), failure_text),
    '/workspaces/' || pub.workspace_id || '/social/calendar?post=' || pub.id);
  return new;
end;
$$;
create trigger platform_email_publication_dead_letter after insert on publication_dead_letters for each row execute function platform_email_publication_failure();
create trigger platform_email_publication_schedule_failure after insert on publication_events for each row
  when (new.event_type = 'publication_failed' and new.payload ? 'scheduleId') execute function platform_email_publication_failure();

create function platform_email_social_action() returns trigger language plpgsql as $$
begin
  perform enqueue_platform_email_alert('publication_action_required',
    concat_ws(':', new.tenant_id, new.workspace_id, new.source_type, coalesce(new.source_id, new.id), date_trunc('minute', new.created_at)),
    new.title, format(E'Marca: %s\n%s', (select name from workspaces where id = new.workspace_id), new.body), new.source_url);
  return new;
end;
$$;
create trigger platform_email_social_action after insert on notifications for each row
  when (new.source_type in ('social_account_reauth','social_publication_late','social_provider_paused'))
  execute function platform_email_social_action();

create function platform_email_publication_reconcile() returns trigger language plpgsql as $$
begin
  if exists (select 1 from publication_plans where id = new.publication_id and mode = 'real') then
    perform enqueue_platform_email_alert('publication_action_required', 'reconciliation:' || new.id,
      'Publicação precisa de confirmação',
      format(E'Marca: %s\nA rede não confirmou o resultado. Confira antes de tentar publicar novamente.',
        (select name from workspaces where id = new.workspace_id)),
      '/workspaces/' || new.workspace_id || '/social/calendar?post=' || new.publication_id);
  end if;
  return new;
end;
$$;
create trigger platform_email_publication_reconcile after insert on publication_reconciliations for each row
  when (new.status = 'pending') execute function platform_email_publication_reconcile();
