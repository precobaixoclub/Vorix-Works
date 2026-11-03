-- 0189 — Código automático de produto: sequência própria por workspace, sem reutilizar números.
-- Produtos cadastrados sem código recebem o próximo número (000001, 000002...). Códigos digitados
-- continuam aceitos; quando são numéricos, a sequência passa a contar a partir deles.

create table if not exists product_code_sequences (
  workspace_id text primary key references workspaces (id) on delete cascade,
  last_value   bigint not null default 0
);

-- Backfill: cada produto existente sem código ganha um número, na ordem de cadastro.
with base as (
  select workspace_id, coalesce(max(code::bigint) filter (where code ~ '^[0-9]{1,15}$'), 0) as start
  from products group by workspace_id
), pending as (
  select p.id, b.start + row_number() over (partition by p.workspace_id order by p.created_at, p.id) as n
  from products p join base b on b.workspace_id = p.workspace_id
  where p.code is null or btrim(p.code) = ''
)
update products p set code = case when length(pending.n::text) < 6 then lpad(pending.n::text, 6, '0') else pending.n::text end
from pending where pending.id = p.id;

insert into product_code_sequences (workspace_id, last_value)
select workspace_id, max(code::bigint) from products where code ~ '^[0-9]{1,15}$' group by workspace_id
on conflict (workspace_id) do update set last_value = greatest(product_code_sequences.last_value, excluded.last_value);
