# Dashboard principal — indicadores, fórmulas e regras de período

API: `GET /v1/dashboard?workspaceId&viewing&period&from&to&connectionId`. Fórmulas centralizadas em
`src/domain/dashboard/dashboard-metrics.ts` (puras e testadas); recorte/escopo em
`src/application/dashboard/dashboard-use-cases.ts`. A tela só exibe.

## Recorte ("Visualizando") e escopo

`me` · `team:<id>` · `my_teams` (consolidado das minhas equipes) · `user:<id>` · `company`. O backend devolve em
`options.viewings` só o que a pessoa pode ver e revalida a cada chamada (fora do escopo = 403). Cada bloco confere o
próprio domínio: atendimento (`inbox:*`), comercial (`sales_report:*`), metas (`goal:*` + `sales_report:*`).
Referência principal é a **equipe** (canal → equipe → pessoas/gerentes); não existe "gerente do canal" no Vorix e a
Dashboard não depende disso.

Período: `today`, `yesterday`, `last_7_days`, `last_30_days`, `this_month`, `last_month`, `custom` — sempre no fuso
do workspace (`workspace.settings.timezone`, padrão `America/Sao_Paulo`), como intervalo `[from, to)`.

## Atendimento

| Indicador | Fórmula | Entra no período por |
| --- | --- | --- |
| FRT médio | média de `assignment.first_response_at − assignment.started_at` (por ciclo de responsabilidade) | `started_at` do ciclo |
| FRT do atendimento | média de `attendance.first_response_at − opened_at` (referência) | `opened_at` |
| TMR | média de `closed_at − opened_at` | `closed_at` |
| Tempo de posse | média de `ended_at − started_at` por ciclo | `ended_at` |
| Abertos / Finalizados | contagem (cada atendimento uma vez) | `opened_at` / `closed_at` |
| Participou × Finalizou (por pessoa) | teve ciclo no atendimento × `closed_by` | — |
| Transferências | ciclos encerrados com `end_reason = transferred`; taxa = finalizados com ≥1 transferência ÷ finalizados; média = transferências dos finalizados ÷ finalizados | `ended_at` / `closed_at` |
| Reabertura | finalizados com `reopened_count > 0` ÷ finalizados | `closed_at` |
| Finalizações | contagem por tipo > subtipo (nome da época) | `closed_at` |
| Tempo por fase | média de `conversation_time_entries.duration_seconds` por fase | `ended_at` da permanência |
| Backlog | foto atual dos abertos: na fila (sem responsável) → sem 1ª resposta do responsável → aguardando cliente (fase PAUSED ou última mensagem enviada pela equipe) → aguardando atendente | agora |

O tempo antes de uma transferência nunca entra no FRT nem no tempo de posse de quem recebeu.

## SLA (prazo — não é CSAT)

Políticas em `inbox_sla_policies` (migration 0174): empresa, equipe ou canal; o mais específico vence, campo a
campo. Configuração em Configurações > Atendimento.

- **1ª resposta (individual)**: por ciclo — cumprido se `first_response_at − started_at ≤ prazo`. Ciclo que terminou
  sem responder depois do prazo conta como fora. Entra pela data da resposta.
- **Resolução (global)**: `closed_at − opened_at ≤ prazo`, pelos finalizados no período.
- **Perto de vencer / vencido agora**: ciclos sem 1ª resposta e atendimentos abertos, contra `agora`; "perto" = já
  consumiu 80% do prazo.

## CSAT

Pelos finalizados no período: média das notas (com a quantidade de avaliações), enviadas, respondidas, taxa de
resposta (respondidas ÷ enviadas), dispensadas, não enviadas por configuração do canal.

## Comercial

| Indicador | Fórmula | Entra por |
| --- | --- | --- |
| Em andamento / Pipeline | oportunidades abertas e soma de `value_cents`, por responsável/equipe atuais | foto atual |
| Pipeline por fase | o mesmo, agrupado pela etapa (Ganha/Perdida ficam de fora) | foto atual |
| Ganhas / valor ganho | contagem e soma do **valor final** (`final_value_cents`, senão `value_cents`), pelo responsável/equipe **creditados** | data de fechamento |
| Perdidas / valor / motivos | contagem, soma e distribuição de `loss_reason` | data de fechamento |
| Conversão | ganhas ÷ (ganhas + perdidas) — abertas nunca entram no denominador | data de fechamento |
| Ticket médio | valor ganho ÷ quantidade de ganhas | data de fechamento |
| Propostas | criadas, enviadas, aceitas, recusadas; aceite = aceitas ÷ enviadas; viraram venda = aceitas cuja oportunidade está ganha (proposta não é obrigatória para vender) | criação da proposta |

## Metas

Meta mensal de receita do recorte (mês do fim do período), reaproveitando o Sales Engine (`getPerformance`): meta,
realizado (vendas creditadas no mês), em andamento (pipeline atual), atingido = realizado ÷ meta, falta =
meta − realizado. Meta de equipe usa o que foi creditado à equipe — nunca soma metas individuais por cima (sem
duplicidade; uma venda tem uma equipe creditada).

## Desempenho

Uma consulta para atendimentos do período + backlog (com a última mensagem só dos abertos), uma para os ciclos
desses atendimentos e uma para fases; índices em 0172/0174. Cálculo em memória sobre o recorte. Se o volume crescer,
o próximo passo é materializar agregados diários por equipe/pessoa a partir dos mesmos timestamps (que continuam
sendo a fonte).
