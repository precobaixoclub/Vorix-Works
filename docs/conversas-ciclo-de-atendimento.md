# Conversas — ciclo de atendimento

Migration `0172_inbox_attendance_cycles.sql`. Domínio em `src/domain/inbox/attendance.model.ts`, regras em
`src/application/inbox/attendance-tracking.ts` e `inbox-use-cases.ts`.

## Conceitos

| Conceito | Entidade | Vida |
| --- | --- | --- |
| Contato | `inbox_contacts` | A pessoa. |
| Conversa | `inbox_conversations` | Histórico **permanente** com o contato naquele canal. Nunca recriada a cada atendimento. |
| Atendimento | `inbox_attendances` | Ciclo que abre e fecha dentro da conversa. `number` é o "#125" (sequencial por workspace). |
| Ciclo de responsabilidade | `inbox_attendance_assignments` | Cada pessoa que recebeu o atendimento, com o próprio relógio de primeira resposta. |
| Oportunidade | `deals` (CRM) | Outro bounded context. |

Invariantes garantidas pelo banco (índices parciais únicos): no máximo **um atendimento aberto por conversa** e
no máximo **um ciclo de responsabilidade ativo por atendimento**.

## Quando cada coisa acontece

- **Cliente escreve numa conversa sem atendimento aberto** → abre atendimento (`open_reason = inbound_message`),
  com a regra que distribuiu (`distribution_rule`).
- **Cliente volta a falar depois de finalizado** → atendimento **novo** na mesma conversa (o anterior fica fechado).
  A regra vem do canal (`messaging_connections.new_attendance_assignment`):
  - `last_assignee` (padrão): fica com quem atendeu da última vez.
  - `redistribute`: passa de novo pela triagem (se for rodar) ou pelo roteamento do canal + rodízio da equipe; sem
    roteamento, vai para a fila (`queue`).
- **A nota da pesquisa (1–5)** nunca abre atendimento: é gravada no atendimento que enviou a pesquisa.
- **Atribuir / assumir / transferir / triagem / roteamento** → encerra o ciclo de quem saiu (`end_reason`,
  `transferred_to_user_id`, `holding_seconds`) e abre o de quem entrou, com `started_at = agora`.
- **Primeira resposta**: a primeira mensagem humana enviada pelo **responsável atual** marca o ciclo dele
  (`first_response_at`, `first_response_seconds`). A primeira mensagem humana de qualquer pessoa marca o atendimento
  (`inbox_attendances.first_response_at/by`). IA e mensagens automáticas nunca contam.
- **Finalizar** exige tipo **e** subtipo ativos (`inbox_closure_types` / `inbox_closure_subtypes`, por workspace,
  exclusão lógica). Os nomes ficam como snapshot no atendimento. `inbox_conversations.closing_reason` recebe
  "Tipo > Subtipo" para os relatórios de motivos já existentes.
- **Pesquisa de satisfação** é por canal (`messaging_connections.csat_on_close`). Situação registrada em
  `inbox_attendances.csat_status`: `sent`, `disabled_by_channel`, `waived` (com `csat_waived_by`),
  `not_applicable` (grupo/Instagram) ou `failed`. Dispensar exige a permissão `inbox:manage_service`
  (gerente = `admin`, administrador = `owner`); para o atendente (`editor`) a API recusa (`INBOX_CSAT_WAIVE_FORBIDDEN`).
- **Reabrir manualmente** reabre o **mesmo** atendimento (`reopened_count`), com um ciclo novo para o responsável.

## Eventos (marcos da timeline)

`inbox_conversation_events` é a fonte; o texto exibido é gerado no frontend
(`web/features/inbox/attendance-labels.ts`). Colunas estruturadas: `attendance_id` (preenchido automaticamente com o
atendimento aberto quando omitido), `contact_id`, `from_user_id`/`to_user_id`, `from_phase_id`/`to_phase_id`,
`closure_type_id`/`closure_subtype_id`, `reason`, `metadata`.

Tipos novos: `attendance_opened`, `attendance_closed`, `attendance_reopened`, `csat_sent`, `csat_not_sent`.
`kanban_phase_changed` passou a gravar `from_phase_id`/`to_phase_id` e o nome das duas fases (snapshot).
Nenhum evento é enviado ao cliente.

## Métricas — de onde tirar

Timestamps são a fonte primária; `*_seconds` é só cache e pode ser recalculado.

```sql
-- Tempo médio de primeira resposta por atendente (relógio de cada responsável).
select user_id, avg(extract(epoch from first_response_at - started_at)) as avg_frt_seconds, count(*) as cycles
from inbox_attendance_assignments
where workspace_id = $1 and first_response_at is not null and started_at >= $2
group by user_id;

-- Tempo médio de resolução por canal.
select connection_id, avg(extract(epoch from closed_at - opened_at)) as avg_resolution_seconds
from inbox_attendances where workspace_id = $1 and status = 'closed' group by connection_id;

-- Transferências por atendimento.
select attendance_id, count(*) filter (where end_reason = 'transferred') as transfers
from inbox_attendance_assignments where workspace_id = $1 group by attendance_id;

-- Finalizações por tipo/subtipo (nome da época).
select closure_type_name, closure_subtype_name, count(*) from inbox_attendances
where workspace_id = $1 and status = 'closed' group by 1, 2 order by 3 desc;

-- Reincidência: atendimentos por conversa.
select conversation_id, count(*) as attendances from inbox_attendances where workspace_id = $1 group by 1 having count(*) > 1;

-- CSAT e taxa de envio.
select count(*) filter (where csat_status = 'sent') * 1.0 / nullif(count(*), 0) as send_rate,
       avg(csat_score) filter (where csat_score is not null) as csat_avg,
       count(csat_score) * 1.0 / nullif(count(*) filter (where csat_status = 'sent'), 0) as response_rate
from inbox_attendances where workspace_id = $1 and status = 'closed';
```

Tempo em cada fase do kanban continua em `conversation_time_entries` (por conversa + equipe); para recortar por
atendimento, cruzar pelo intervalo `opened_at`–`closed_at`.

## Migração de dados

A 0172 cria um atendimento aberto (`open_reason = migration`) para cada conversa `open`/`pending`, com o ciclo do
responsável atual começando no momento da migração (não há como reconstruir o passado com precisão). A pesquisa por
canal herda a regra antiga do workspace (`inbox_service_settings.csat_enabled`).
