-- Pricing/Capacity Etapa C (Mercado Pago) — generaliza `subscription_pending_changes` para também
-- representar cancelamento agendado (`change_type='cancellation'`), reaproveitando a MESMA fila +
-- scheduler já usados para redução de capacidade (`change_type='capacity_decrease'`), em vez de um
-- mecanismo paralelo. Mercado Pago não tem `cancel_at_period_end` nativo (seção 16 do pedido) — o
-- cancelamento real só acontece no provider quando o scheduler perceber que o período terminou.
--
-- Aditiva: coluna nova com default, colunas específicas de redução de capacidade relaxadas pra
-- nullable (uma linha de cancelamento não tem addon/quantidade). Nenhuma linha existente muda de
-- significado — toda linha pré-existente já é `capacity_decrease` com os campos preenchidos.

alter table subscription_pending_changes
  add column if not exists change_type text not null default 'capacity_decrease'
    check (change_type in ('capacity_decrease', 'cancellation'));

alter table subscription_pending_changes
  alter column addon_code drop not null,
  alter column from_quantity drop not null,
  alter column target_quantity drop not null;

-- Constraint condicional: linhas de redução de capacidade continuam exigindo addon/quantidades;
-- linhas de cancelamento nunca as preenchem (evita um estado ambíguo "cancelamento com addon").
alter table subscription_pending_changes
  add constraint subscription_pending_changes_type_fields_chk check (
    (change_type = 'capacity_decrease' and addon_code is not null and from_quantity is not null and target_quantity is not null)
    or
    (change_type = 'cancellation' and addon_code is null and from_quantity is null and target_quantity is null)
  );

-- No máximo um cancelamento agendado pendente por assinatura — mesma garantia que já existia por
-- addon (seção 12 do pedido: "nunca duas pendências divergentes da mesma coisa").
create unique index if not exists subscription_pending_changes_one_cancellation_idx
  on subscription_pending_changes (subscription_id)
  where change_type = 'cancellation' and applied_at is null and cancelled_at is null;
