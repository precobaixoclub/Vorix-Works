# Ciclo comercial das oportunidades

O Kanban usa as entidades existentes `pipelines`, `pipeline_stages`, `deals`,
`deal_items`, propostas, metas, permissões, automações e `timeline_events`.

## Fases e resultado

Cada funil possui exatamente uma fase com `is_won` e outra com `is_lost`.
Esses indicadores são a identidade comercial; o nome visual pode ser alterado.
As fases finais permanecem na ordem Ganha → Perdida, depois de todas as fases
ativas. Não podem ser excluídas ou convertidas em fases ativas. Deve restar ao
menos uma fase ativa para criar/reabrir oportunidades. Novos funis e suas fases
são criados na mesma transação.

As ações do Kanban, fechamento manual e movimentos por automação usam os mesmos
casos de uso comerciais. Fase, status, snapshot e eventos de encerramento/reabertura
são persistidos juntos. A verificação de status e data de atualização impede dois
fechamentos concorrentes de produzirem dois eventos de ganho. A execução de regras
mantém uma pilha por contexto assíncrono para evitar recursão.

## Ganho, perda e aceite

Ganho não exige proposta. O vendedor confirma valor final, data e observação.
O fechamento usa os produtos/quantidades/condições negociadas, preserva um snapshot
e credita o responsável/equipe existentes no momento do ganho. Um desconto adicional
no valor final passa pela política de aprovação existente.

O aceite de proposta usa a política `proposalAcceptAutoWin`. O padrão passa a ser
`true`; valores `false` já persistidos são preservados. O efeito continua no
`proposalAcceptanceHandler`, separado do aceite público, para permitir evoluir a
política de destino sem acoplar a proposta a uma coluna. O valor aceito é enviado
explicitamente ao fechamento, inclusive para oportunidades com valor calculado.

Perda exige motivo ativo no cadastro `sales_close_reasons`. `loss_reason_id`
identifica o motivo e `loss_reason` preserva o texto escolhido naquele momento.
Motivo e observação ficam separados. O administrador pode criar, renomear,
desativar, reordenar e excluir motivos sem uso. Referências comerciais e históricas
impedem apagar motivos usados.

## Arquivamento e consulta

`commercial_settings.closed_deal_archive_days` configura o prazo por workspace,
na estrutura comercial já existente: `null` = Nunca, `0` = imediatamente, ou um
número inteiro de dias. A interface oferece 1, 3, 7 e prazo personalizado.
O padrão permanece Nunca para preservar a visibilidade atual.

O arquivamento preenche `deals.archived_at`; não muda status, valor, crédito,
estoque, metas ou relatórios. Prazo e evento são aplicados de forma idempotente
na leitura operacional, no fechamento e por uma rotina independente a cada minuto.
O evento de arquivo e a atualização são persistidos na mesma instrução SQL.

`boardView` aceita `operational`, `open`, `won`, `lost`, `closed`, `archived`, `all`.
A ausência de filtro mantém a consulta geral existente. O Kanban usa `operational`
por padrão; consultas por resultado incluem arquivadas. Lista e resumo compartilham
os filtros e o escopo de visibilidade do vendedor.

A ação manual Mostrar no Kanban libera a visualização até o próximo fechamento
(`archive_manual_hold`), evitando que o agendador esconda imediatamente um registro
que o usuário acabou de devolver ao quadro.

## Reabertura e correções

Voltar para uma fase ativa reabre, remove o arquivo e limpa o snapshot corrente.
`first_closed_at` é preservado; `reopened_at`, `reopened_by_user_id` e `reopen_count`
registram as reaberturas. O histórico conserva o fechamento anterior, produtos,
valor, motivo e fases de origem/destino. Estoque segue a devolução existente.

Metas e relatórios continuam agregando a mesma linha da oportunidade, com status
ganho e valor final. Reabrir e ganhar novamente não insere outra venda. O resultado
corrente sai das metas enquanto aberto e retorna uma vez com o fechamento atual.

Gestores podem corrigir valor final ou motivo de perda sem reabrir, com eventos de
antes/depois. A correção preserva data, crédito e arquivamento e não dispara novo
ganho nem movimenta estoque.

## Permissões

As permissões seguem o RBAC atual. Editor, admin e owner recebem `deal:win`,
`deal:lose`, `deal:reopen`, `deal:archive` e `deal:unarchive`. Somente admin/owner
recebem `deal:edit_closed`, `deal:change_final_value` e `deal:change_loss_reason`.
Viewer permanece somente leitura. `deal:close` é mantida para compatibilidade.

## Atualização do banco

Aplicar `0173_deal_commercial_lifecycle.sql` pelo runner existente antes de subir
esta versão da aplicação. A migration preserva IDs/nomes, cria fases ausentes,
normaliza posições e converte indicadores finais duplicados em fases comuns.
Oportunidades já encerradas em colunas duplicadas são vinculadas à fase sistêmica
correta, preservando resultado/valor e registrando a alteração no histórico.
Motivos antigos recebem vínculo por rótulo quando o cadastro correspondente existe.

Os testes incluem banco vazio, atualização de dados antigos, fechamento concorrente,
retenção, permissões, automações, metas após reabertura e interface desktop/mobile.
