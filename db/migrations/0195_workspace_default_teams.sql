-- One default commercial team per workspace. Bootstrap works regardless of whether the
-- first membership or the workspace is created first. New invitees never join it implicitly.
alter table teams add column is_default boolean not null default false;
create unique index teams_default_workspace_idx on teams(tenant_id, workspace_id) where is_default;

create function ensure_workspace_default_team(p_tenant text, p_workspace text) returns text
language plpgsql as $$
declare v_team text; v_member tenant_members%rowtype;
begin
  perform 1 from workspaces where id=p_workspace and tenant_id=p_tenant and status='active' for update;
  if not found then return null; end if;
  select id into v_team from teams where tenant_id=p_tenant and workspace_id=p_workspace and is_default;
  if v_team is not null then return v_team; end if;
  select tm.* into v_member from tenant_members tm join users u on u.id=tm.user_id
    where tm.tenant_id=p_tenant and tm.status='active' and u.status='active'
    -- Prefer the account owner, then any owner; otherwise the earliest active member.
    order by tm.is_account_owner desc, (tm.role='owner') desc, tm.created_at, u.created_at, tm.id limit 1;
  if not found then return null; end if;

  -- Reuse an operational team, preferring one already selected by a site or channel.
  -- Never change its members, principal, or distribution settings.
  select t.id into v_team from teams t where t.tenant_id=p_tenant and t.workspace_id=p_workspace
    and exists(select 1 from team_memberships m join tenant_members tm on tm.user_id=m.user_id
      and tm.tenant_id=p_tenant and tm.status='active' join users u on u.id=m.user_id and u.status='active'
      where m.team_id=t.id and m.attendance_level='N1')
    order by (exists(select 1 from site_commerce_settings s where s.tenant_id=p_tenant
      and s.workspace_id=p_workspace and s.settings->>'teamId'=t.id)
      or exists(select 1 from inbox_channel_routing_configs c where c.default_team_id=t.id)) desc,
      t.created_at, t.id limit 1;
  if v_team is null then
    v_team := 'team-default-' || md5(p_tenant || ':' || p_workspace);
    insert into teams(id,tenant_id,workspace_id,name,round_robin_enabled,is_default)
      values(v_team,p_tenant,p_workspace,'Equipe padrão',false,true);
    insert into team_memberships(id,team_id,user_id,role,attendance_level,is_principal_for_level,participates_in_round_robin)
      values('teammember-default-' || md5(v_team || ':' || v_member.user_id),v_team,v_member.user_id,
        v_member.role,'N1',true,true);
  else
    update teams set is_default=true,updated_at=now() where id=v_team;
  end if;
  return v_team;
end $$;

create function bootstrap_workspace_default_team() returns trigger language plpgsql as $$
declare w record;
begin
  if TG_TABLE_NAME='workspaces' then
    perform ensure_workspace_default_team(NEW.tenant_id,NEW.id);
  elsif TG_TABLE_NAME='tenant_members' then
    for w in select id,tenant_id from workspaces where tenant_id=NEW.tenant_id and status='active' order by id loop
      perform ensure_workspace_default_team(w.tenant_id,w.id);
    end loop;
  else
    for w in select w.id,w.tenant_id from workspaces w join tenant_members tm on tm.tenant_id=w.tenant_id
      where tm.user_id=NEW.id and tm.status='active' and w.status='active' order by w.id loop
      perform ensure_workspace_default_team(w.tenant_id,w.id);
    end loop;
  end if;
  return NEW;
end $$;
create trigger workspace_default_team_bootstrap after insert or update of status on workspaces
  for each row when(NEW.status='active') execute function bootstrap_workspace_default_team();
create trigger member_default_team_bootstrap after insert or update of status on tenant_members
  for each row when(NEW.status='active') execute function bootstrap_workspace_default_team();
create trigger user_default_team_bootstrap after update of status on users
  for each row when(NEW.status='active') execute function bootstrap_workspace_default_team();

-- Shared by Inbox, Site leads, deals, and orders. The team row lock serializes the
-- round-robin pointer across processes and rolls back together with a failed insert.
create function next_team_member(p_team text, p_level text default 'N1')
returns table(user_id text,used_round_robin boolean) language plpgsql as $$
declare t teams%rowtype; v_principal text; v_eligible text[]; v_index integer;
begin
  select * into t from teams where id=p_team for update;
  if not found then return; end if;
  select m.user_id into v_principal from team_memberships m
    join tenant_members tm on tm.user_id=m.user_id and tm.tenant_id=t.tenant_id and tm.status='active'
    join users u on u.id=m.user_id and u.status='active'
    where m.team_id=p_team and m.attendance_level=p_level
    order by m.is_principal_for_level desc,m.created_at,m.id limit 1;
  if v_principal is null then return; end if;
  select array_agg(m.user_id order by m.created_at,m.id) into v_eligible from team_memberships m
    join tenant_members tm on tm.user_id=m.user_id and tm.tenant_id=t.tenant_id and tm.status='active'
    join users u on u.id=m.user_id and u.status='active'
    where m.team_id=p_team and m.attendance_level=p_level and m.participates_in_round_robin;
  if not t.round_robin_enabled or coalesce(cardinality(v_eligible),0)=0 then
    return query select v_principal,false; return;
  end if;
  v_index := greatest(coalesce((t.last_assigned_index_by_level->>p_level)::integer,0),0) % cardinality(v_eligible);
  update teams set last_assigned_index_by_level=jsonb_set(coalesce(last_assigned_index_by_level,'{}'),
    array[p_level],to_jsonb(v_index+1)),updated_at=now() where id=p_team;
  update team_memberships set last_assigned_at=now() where team_id=p_team and team_memberships.user_id=v_eligible[v_index+1];
  return query select v_eligible[v_index+1],true;
end $$;

create function set_workspace_default_team(p_team text) returns void language plpgsql as $$
declare t teams%rowtype;
begin
  select * into t from teams where id=p_team;
  if not found then raise exception 'TEAM_NOT_FOUND: equipe não encontrada.'; end if;
  perform 1 from workspaces where id=t.workspace_id and tenant_id=t.tenant_id for update;
  perform 1 from teams where id=p_team for update;
  if not exists(select 1 from team_memberships m join tenant_members tm on tm.user_id=m.user_id
    and tm.tenant_id=t.tenant_id and tm.status='active' join users u on u.id=m.user_id and u.status='active'
    where m.team_id=p_team and m.attendance_level='N1') then
    raise exception 'TEAM_DEFAULT_REQUIRES_MEMBER: adicione um usuário ativo no nível N1 antes de definir esta equipe como padrão.';
  end if;
  update teams set is_default=false,updated_at=now() where tenant_id=t.tenant_id and workspace_id=t.workspace_id and is_default and id<>p_team;
  update teams set is_default=true,updated_at=now() where id=p_team;
end $$;

create function protect_workspace_default_team() returns trigger language plpgsql as $$
begin
  if OLD.is_default and exists(select 1 from workspaces where id=OLD.workspace_id) then
    raise exception 'TEAM_DEFAULT_REQUIRED: defina outra equipe como padrão antes de excluir esta equipe.';
  end if;
  return OLD;
end $$;
create trigger protect_default_team before delete on teams for each row execute function protect_workspace_default_team();

create function protect_default_team_member() returns trigger language plpgsql as $$
begin
  if TG_OP='UPDATE' then
    if NEW.team_id=OLD.team_id and NEW.attendance_level=OLD.attendance_level then return NEW; end if;
  end if;
  perform 1 from teams where id=OLD.team_id for update;
  if OLD.attendance_level='N1' and exists(select 1 from teams where id=OLD.team_id and is_default)
    and not exists(select 1 from team_memberships m join teams t on t.id=m.team_id
      join tenant_members tm on tm.user_id=m.user_id and tm.tenant_id=t.tenant_id and tm.status='active'
      join users u on u.id=m.user_id and u.status='active'
      where m.team_id=OLD.team_id and m.user_id<>OLD.user_id and m.attendance_level='N1') then
    raise exception 'TEAM_DEFAULT_REQUIRES_MEMBER: mantenha um usuário ativo no nível N1 da equipe padrão ou escolha outra equipe padrão.';
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end $$;
create trigger protect_default_team_member before delete or update of team_id,attendance_level on team_memberships
  for each row execute function protect_default_team_member();

-- Disabling or removing someone from the account must not silently leave the default team
-- without an active N1 member (new orders/opportunities would arrive without an owner).
create function protect_default_team_tenant_member() returns trigger language plpgsql as $$
begin
  if TG_OP='UPDATE' and (OLD.status<>'active' or NEW.status='active') then return NEW; end if;
  if exists(select 1 from teams t join team_memberships m on m.team_id=t.id and m.user_id=OLD.user_id and m.attendance_level='N1'
      where t.tenant_id=OLD.tenant_id and t.is_default
      and not exists(select 1 from team_memberships o
        join tenant_members tm on tm.user_id=o.user_id and tm.tenant_id=t.tenant_id and tm.status='active'
        join users u on u.id=o.user_id and u.status='active'
        where o.team_id=t.id and o.user_id<>OLD.user_id and o.attendance_level='N1')) then
    raise exception 'TEAM_DEFAULT_REQUIRES_MEMBER: este usuário é o único responsável da equipe padrão. Adicione outro usuário no nível N1 da equipe padrão (ou escolha outra equipe padrão) antes de desativá-lo ou removê-lo.';
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end $$;
create trigger protect_default_team_tenant_member before delete or update of status on tenant_members
  for each row execute function protect_default_team_tenant_member();

alter table commerce_orders add column owner_user_id text, add column team_id text references teams(id) on delete set null;
create index commerce_orders_owner_idx on commerce_orders(tenant_id,workspace_id,owner_user_id);
create index commerce_orders_team_idx on commerce_orders(tenant_id,workspace_id,team_id);

create function assign_commercial_default_team() returns trigger language plpgsql as $$
declare v_default text;
begin
  if TG_TABLE_NAME='commerce_orders' then
    -- An order originating in a deal follows its existing assignment without advancing the wheel.
    if NEW.owner_user_id is null and NEW.team_id is null and NEW.crm_deal_id is not null then
      select d.owner_user_id,d.team_id into NEW.owner_user_id,NEW.team_id from deals d
        where d.id=NEW.crm_deal_id and d.tenant_id=NEW.tenant_id and d.workspace_id=NEW.workspace_id;
    end if;
    if NEW.team_id is null and NEW.owner_user_id is null and NEW.site_id is not null then
      select t.id into NEW.team_id from site_commerce_settings s join teams t on t.id=s.settings->>'teamId'
        and t.tenant_id=NEW.tenant_id and t.workspace_id=NEW.workspace_id
        where s.site_id=NEW.site_id and s.tenant_id=NEW.tenant_id and s.workspace_id=NEW.workspace_id;
    end if;
  end if;
  if NEW.team_id is null then
    v_default := ensure_workspace_default_team(NEW.tenant_id,NEW.workspace_id);
    -- An explicitly chosen owner is preserved, including assignments outside the default team.
    if NEW.owner_user_id is null or exists(select 1 from team_memberships where team_id=v_default and user_id=NEW.owner_user_id) then
      NEW.team_id := v_default;
    end if;
  end if;
  if NEW.team_id is not null then
    if not exists(select 1 from teams where id=NEW.team_id and tenant_id=NEW.tenant_id and workspace_id=NEW.workspace_id) then
      raise exception 'TEAM_NOT_FOUND: equipe fora do workspace.';
    end if;
    if NEW.owner_user_id is null then
      select n.user_id into NEW.owner_user_id from next_team_member(NEW.team_id,'N1') n;
    end if;
  end if;
  return NEW;
end $$;
create trigger assign_deal_default_team before insert on deals for each row execute function assign_commercial_default_team();
create trigger assign_order_default_team before insert on commerce_orders for each row execute function assign_commercial_default_team();

-- Existing workspaces get a default without changing configured routing or memberships.
do $$ declare w record; begin
  for w in select id,tenant_id from workspaces where status='active' order by id loop
    perform ensure_workspace_default_team(w.tenant_id,w.id);
  end loop;
end $$;

-- Repair only unassigned OPEN deals in accounts with exactly one active user.
-- Closed deals and historical credit/financial snapshots are deliberately untouched.
with sole as (
  select tm.tenant_id,min(tm.user_id) user_id from tenant_members tm join users u on u.id=tm.user_id and u.status='active'
    where tm.status='active' group by tm.tenant_id having count(*)=1
)
update deals d set owner_user_id=coalesce(d.owner_user_id,s.user_id),team_id=coalesce(d.team_id,t.id),updated_at=now()
  from sole s,teams t where d.tenant_id=s.tenant_id and t.tenant_id=d.tenant_id and t.workspace_id=d.workspace_id and t.is_default
    and d.status='open' and d.won_at is null and d.lost_at is null
    and (d.owner_user_id is null or d.owner_user_id=s.user_id) and (d.owner_user_id is null or d.team_id is null)
    and (d.team_id is null or exists(select 1 from team_memberships m where m.team_id=d.team_id and m.user_id=s.user_id));

with sole as (
  select tm.tenant_id,min(tm.user_id) user_id from tenant_members tm join users u on u.id=tm.user_id and u.status='active'
    where tm.status='active' group by tm.tenant_id having count(*)=1
)
update commerce_orders o set owner_user_id=s.user_id,team_id=t.id
  from sole s,teams t where o.tenant_id=s.tenant_id and t.tenant_id=o.tenant_id and t.workspace_id=o.workspace_id and t.is_default
    and o.owner_user_id is null and o.team_id is null;
