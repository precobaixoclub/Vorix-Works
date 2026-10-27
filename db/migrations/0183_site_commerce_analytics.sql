-- Analytics only. 0181 is reserved for Commerce Phase 2; 0182 for catalog bulk operations.
-- Recheck numbering at integration. Existing applied migrations are never edited.
alter table site_events add column if not exists event_key text,
 add column if not exists order_id text, add column if not exists opportunity_id text,
 add column if not exists conversation_id text, add column if not exists attendance_id text,
 add column if not exists referrer_host text, add column if not exists device_type text,
 add column if not exists amount_cents bigint, add column if not exists currency text;
alter table site_events drop constraint if exists site_events_type_check;
alter table site_events add constraint site_events_type_check check(type in
 ('SITE_VIEW','PRODUCT_VIEW','PRODUCT_WHATSAPP_CLICK','ADD_TO_CART','REMOVE_FROM_CART','CART_WHATSAPP_START','CONTACT_FORM_SUBMITTED','SALES_INTENT_CREATED','SALES_INTENT_CONVERTED','CHECKOUT_STARTED','SHIPPING_QUOTED','PAYMENT_STARTED','ORDER_CREATED','PAYMENT_APPROVED','ORDER_PAID','ORDER_CANCELLED','ORDER_COMPLETED'));
create unique index site_events_event_key_idx on site_events(site_id,event_key) where event_key is not null;
create index site_events_analytics_journey_idx on site_events(tenant_id,workspace_id,site_id,anonymous_session_id,created_at,id);

create table site_analytics_identities (
 tenant_id text not null, workspace_id text not null, site_id text not null, anonymous_session_id text not null,
 contact_id text, ambiguous boolean not null default false, linked_at timestamptz not null default now(),
 primary key(site_id,anonymous_session_id),
 foreign key(tenant_id,site_id) references tenant_sites(tenant_id,id) on delete cascade
);
-- Identity is accepted only from an actual, converted SalesIntent and an in-scope Contact.
create function vorix_site_analytics_link(p_site text,p_session text,p_contact text) returns void language plpgsql as $$
declare s record;
begin
 select i.tenant_id,i.workspace_id into s from sales_intents i join contacts c on c.id=i.contact_id and c.tenant_id=i.tenant_id and c.workspace_id=i.workspace_id
 where i.site_id=p_site and i.anonymous_session_id=p_session and i.contact_id=p_contact and i.status='CONVERTED' limit 1;
 if not found then return; end if;
 insert into site_analytics_identities(tenant_id,workspace_id,site_id,anonymous_session_id,contact_id)
 values(s.tenant_id,s.workspace_id,p_site,p_session,p_contact)
 on conflict(site_id,anonymous_session_id) do update set
 ambiguous=site_analytics_identities.ambiguous or site_analytics_identities.contact_id is distinct from excluded.contact_id,
 contact_id=case when site_analytics_identities.ambiguous or site_analytics_identities.contact_id is distinct from excluded.contact_id then null else excluded.contact_id end;
end $$;
create function vorix_site_analytics_intent_link() returns trigger language plpgsql as $$
begin
 if new.status='CONVERTED' and new.anonymous_session_id is not null and new.contact_id is not null then perform vorix_site_analytics_link(new.site_id,new.anonymous_session_id,new.contact_id);end if;
 return new;
end $$;
create trigger site_analytics_intent_link after insert or update of status,contact_id on sales_intents for each row execute function vorix_site_analytics_intent_link();
select vorix_site_analytics_link(site_id,anonymous_session_id,contact_id) from sales_intents where status='CONVERTED' and anonymous_session_id is not null and contact_id is not null;

-- A minute projection preserves local calendar boundaries in every modern IANA offset.
-- Repeated views aggregate; exact distinct visitor IDs remain available across days/products.
create table site_analytics_buckets (
 tenant_id text not null, workspace_id text not null, site_id text not null, bucket timestamptz not null,
 actor text not null, type text not null, product_key text not null default '', variant_key text not null default '',
 dimensions jsonb not null default '{}', dimension_key text not null, count bigint not null default 0,
 primary key(site_id,bucket,actor,type,product_key,variant_key,dimension_key),
 foreign key(tenant_id,site_id) references tenant_sites(tenant_id,id) on delete cascade
);
create index site_analytics_buckets_scope_idx on site_analytics_buckets(tenant_id,workspace_id,bucket,site_id);
create index site_analytics_buckets_product_idx on site_analytics_buckets(tenant_id,workspace_id,product_key,bucket);
create index site_analytics_buckets_entry_idx on site_analytics_buckets(site_id,actor,bucket desc) where type='SITE_VIEW';
create table site_analytics_event_receipts (
 site_id text not null references tenant_sites(id) on delete cascade, event_key text not null,
 primary key(site_id,event_key)
);
-- Consumer projection of future trusted events; no dependency on Order/Payment tables.
create table site_analytics_order_facts (
 tenant_id text not null,workspace_id text not null,site_id text not null,order_id text not null,
 actor text,product_id text,opportunity_id text,utm jsonb not null default '{}',
 created_at timestamptz,paid_at timestamptz,cancelled_at timestamptz,completed_at timestamptz,
 amount_cents bigint,currency text,
 primary key(site_id,order_id),foreign key(tenant_id,site_id) references tenant_sites(tenant_id,id) on delete cascade
);
create index site_analytics_orders_scope_idx on site_analytics_order_facts(tenant_id,workspace_id,paid_at);
create function vorix_site_analytics_project(e site_events) returns void language plpgsql as $$
declare k text; a text; dims jsonb; accepted integer;
begin
 if not exists(select 1 from tenant_sites s where s.id=e.site_id and s.tenant_id=e.tenant_id and s.workspace_id=e.workspace_id) then return;end if;
 k:=coalesce(case when e.type in ('SALES_INTENT_CREATED','SALES_INTENT_CONVERTED','CONTACT_FORM_SUBMITTED') and e.sales_intent_id is not null then e.type||':'||e.sales_intent_id
 when e.type in ('ORDER_CREATED','ORDER_PAID','ORDER_CANCELLED','ORDER_COMPLETED','PAYMENT_APPROVED') and e.order_id is not null then e.type||':'||e.order_id end,e.event_key,e.id);
 insert into site_analytics_event_receipts(site_id,event_key) values(e.site_id,k) on conflict do nothing;
 get diagnostics accepted=row_count;if accepted=0 then return;end if;
 a:=case when nullif(e.anonymous_session_id,'') is not null then 'a:'||e.anonymous_session_id else '' end;
 dims:=jsonb_strip_nulls(jsonb_build_object('source',nullif(e.utm->>'source',''),'medium',nullif(e.utm->>'medium',''),'campaign',nullif(e.utm->>'campaign',''),'content',nullif(e.utm->>'content',''),'term',nullif(e.utm->>'term',''),'referrer',e.referrer_host,'device',e.device_type));
 insert into site_analytics_buckets(tenant_id,workspace_id,site_id,bucket,actor,type,product_key,variant_key,dimensions,dimension_key,count)
 values(e.tenant_id,e.workspace_id,e.site_id,date_trunc('minute',e.created_at),a,e.type,coalesce(e.product_id,''),coalesce(e.variant_id,''),
 dims,md5(dims::text),1)
 on conflict(site_id,bucket,actor,type,product_key,variant_key,dimension_key) do update set count=site_analytics_buckets.count+1;
 if e.order_id is not null and e.type in ('ORDER_CREATED','ORDER_PAID','ORDER_CANCELLED','ORDER_COMPLETED','PAYMENT_APPROVED') then
  insert into site_analytics_order_facts(tenant_id,workspace_id,site_id,order_id,actor,product_id,opportunity_id,utm,created_at,paid_at,cancelled_at,completed_at,amount_cents,currency)
  values(e.tenant_id,e.workspace_id,e.site_id,e.order_id,a,e.product_id,e.opportunity_id,e.utm,
   case when e.type='ORDER_CREATED' then e.created_at end,case when e.type='ORDER_PAID' then e.created_at end,
   case when e.type='ORDER_CANCELLED' then e.created_at end,case when e.type='ORDER_COMPLETED' then e.created_at end,
   case when e.type='ORDER_PAID' then e.amount_cents end,case when e.type='ORDER_PAID' then e.currency end)
  on conflict(site_id,order_id) do update set
   actor=coalesce(nullif(site_analytics_order_facts.actor,''),excluded.actor),product_id=coalesce(site_analytics_order_facts.product_id,excluded.product_id),
   opportunity_id=coalesce(site_analytics_order_facts.opportunity_id,excluded.opportunity_id),
   utm=case when site_analytics_order_facts.utm='{}'::jsonb then excluded.utm else site_analytics_order_facts.utm end,
   created_at=coalesce(site_analytics_order_facts.created_at,excluded.created_at),paid_at=coalesce(site_analytics_order_facts.paid_at,excluded.paid_at),
   cancelled_at=coalesce(site_analytics_order_facts.cancelled_at,excluded.cancelled_at),completed_at=coalesce(site_analytics_order_facts.completed_at,excluded.completed_at),
   amount_cents=coalesce(excluded.amount_cents,site_analytics_order_facts.amount_cents),currency=coalesce(excluded.currency,site_analytics_order_facts.currency);
 end if;
end $$;
create function vorix_site_analytics_event_trigger() returns trigger language plpgsql as $$
begin perform vorix_site_analytics_project(new);return new;end $$;
create trigger site_analytics_event_projection after insert on site_events for each row execute function vorix_site_analytics_event_trigger();
-- One-time, idempotent historical projection, outside dashboard requests.
select vorix_site_analytics_project(e) from site_events e order by e.created_at,e.id;
create index sales_intents_analytics_conversion_idx on sales_intents(tenant_id,workspace_id,converted_at,site_id);
create index sales_intents_analytics_deal_idx on sales_intents(deal_id,tenant_id,workspace_id) where deal_id is not null;
