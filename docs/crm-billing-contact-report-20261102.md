# Faturamento de propostas e identificação de contatos — 02/11/2026

Implementação local. **Nenhum deploy, migration ou ajuste de dados foi executado em produção nesta entrega.**

Atualização posterior: após autorização do usuário, estas alterações foram publicadas na release `008fd47`, com a migration 0187 aplicada. Veja o [registro da publicação e conferência do legado](production-deploy-20261102.md). Este relatório mantém o registro da fase local anterior à publicação.

## Fluxo e estados finais

| Proposta | Oportunidade | Venda/estoque |
| --- | --- | --- |
| Enviada / visualizada | Em negociação | Aguardando resposta; sem ganho |
| Aceita | Aberta, em **Aguardando faturamento** | Sem venda e sem baixa |
| Faturada | **Ganha** | Fechamento com valor da proposta, data, usuário e baixa pelo mecanismo existente |
| Recusada | Mantém a negociação | Preserva a lógica anterior: perda exige decisão e motivo |
| Cancelada após perda | **Perdida** | Retira a venda da apuração por oportunidade; reverte estoque se estava ganha |
| Cancelada após reabertura | Aberta na fase escolhida | Mantém aceite/faturamento anterior na auditoria; permite renegociação explícita |

O aceite deixa de chamar ganho automático tanto no Sales Engine quanto no fallback do CRM. A preferência legada `proposalAcceptAutoWin` continua compatível na API, mas não autoriza ganho pelo aceite e saiu da configuração visual.

**Marcar como faturado** aparece no card do Kanban, no detalhe da oportunidade e nas apresentações de proposta aceita. Usa confirmação compartilhada e `POST /v1/deals/:id/invoice`, com `workspaceId` e `proposalId` opcional. O usuário vem da sessão; permissões de ganho e visibilidade própria/equipe são verificadas no servidor. Data e responsável também aparecem no detalhe.

O fechamento usa o compare-and-set já existente. A transação grava oportunidade, proposta, metadados e eventos; índices únicos impedem repetir o evento de faturamento. O banco também impede desviar uma proposta pendente para ganho ou outra fase sem faturamento, inclusive por um caminho antigo da aplicação. A baixa de variações permanece no trigger existente; estoque simples usa o controle idempotente existente por movimentos líquidos.

Não há emissão de NF-e/NFS-e, integração fiscal ou dependência externa de faturamento.

## Perda, reabertura e indicadores

A perda após ganho exige permissão de perda e de reabertura, usa os motivos existentes e guarda o fechamento anterior no evento de auditoria. Reabrir permite escolher a fase; preserva primeiro fechamento, contador de reaberturas, autoria e snapshot anterior. Propostas aceitas/faturadas são canceladas **operacionalmente**, mantendo hash/versão aceita, data e autor do faturamento. Uma nova versão pode ser criada explicitamente após reabrir; não são geradas propostas ou oportunidades automaticamente.

O Analytics continua considerando oportunidade atualmente ganha ou pedido pago. Aceite e fila de faturamento não geram venda. A deduplicação entre SalesIntents, oportunidade e pedido pago permanece. Reabertura/perda retiram a venda por oportunidade; pedido pago independente mantém sua regra. O marco `first_deal_won` passa a ser registrado no fechamento, com a deduplicação existente. Métricas históricas de aceite incluem propostas posteriormente faturadas e aceites comprovados.

Filtros de propostas incluem aguardando resposta, aceita/aguardando faturamento, faturada, recusada, cancelada, expirada e versões substituídas. Ganho não exclui a proposta da consulta. A busca no servidor considera número, título, oportunidade e nome/telefone atual do contato, inclusive telefone formatado.

## Contato canônico e origem dos dados

A regra está em [`src/shared/utils/contact-presentation.ts`](../src/shared/utils/contact-presentation.ts): `contactLabel`, `contactPhoneLabel`, `humanContactName`, `contactNameForInput` e `commercialTitle`. A entrada antiga do domínio CRM reexporta essa implementação. O frontend tem um espelho **gerado**, necessário para o contexto independente de build do Docker web; `node scripts/sync-contact-presentation.mjs --check` e testes impedem divergência.

- Nome humano + telefone válido: `João da Silva · (46) 99999-9999`.
- Somente telefone, nome técnico, Lead/IDs ou nome contendo apenas telefone: `(46) 99999-9999`.
- Sem identificação histórica válida: rótulo genérico; nunca ID, LID ou identificador interno.

Propostas, oportunidades, tarefas, conversas, Radar, pedidos, aprovações e notificações resolvem o contato atual no backend pelo vínculo existente, com tenant/workspace. O resultado não depende da primeira página do diretório. A proposta pública atualiza a projeção após registrar visualização/aceite e não expõe contato de outro escopo. Pedidos e aprovações mantêm snapshots originais; notificações antigas projetam a identidade atual sem reescrever o texto armazenado. Histórico, seletores, documentos, modais, busca, atendimento e telas mobile usam a apresentação comum. Grupos do WhatsApp mantêm sua identificação de grupo.

Novos cadastros não persistem o rótulo formatado como nome. Nome técnico vira telefone como identificação; o nome histórico existente permanece armazenado para auditoria. Contato definitivo continua exigindo telefone válido nos adaptadores CRM e formulário do Site. WhatsApp, API manual, ponte comercial, pedidos e conversões usam essa validação; SalesIntent anônima continua permitida sem criar contato definitivo. A associação de visitante ao contato válido mantém seus vínculos e escopo.

## Quantidade de pontos revisados

O inventário anterior à implementação registrou **97 linhas candidatas em 35 arquivos**, não 97 bugs confirmados. A primeira passagem substituiu **34 ocorrências de leitura/apresentação direta de nome**, além de dois rótulos literais. Outros dois rótulos de evento Meta foram traduzidos na apresentação: **4 pontos literais com “Lead” corrigidos** no total. O protocolo Meta mantém internamente o enum `Lead`.

Além dessas ocorrências, foram corrigidas as fontes/projeções de **10 superfícies**: contatos, oportunidades, propostas internas, propostas públicas, tarefas, conversas, Radar, pedidos, aprovações e notificações. Os números de código não representam quantidade de registros afetados em produção; não foi realizada auditoria de dados produtivos nesta etapa.

Inventário verificável: [`crm-contact-presentation-audit-20261102.json`](crm-contact-presentation-audit-20261102.json). Mapeamento anterior às alterações: [`crm-billing-contact-audit-20261102.md`](crm-billing-contact-audit-20261102.md).

## Migration e tratamento do legado

Migration: [`0187_proposal_operational_billing.sql`](../db/migrations/0187_proposal_operational_billing.sql).

Ela adiciona `is_awaiting_billing`, vínculo `billing_proposal_id`, estado `invoiced`, data/usuário/origem do faturamento e dados de cancelamento operacional. Cria proteção de unicidade, sincronização transacional e eventos de auditoria. Reaproveita uma fase existente chamada Aguardando faturamento ou cria a fase antes dos resultados terminais.

Vendas antigas não são reabertas nem geram novo ganho/estoque. Uma proposta aceita explicitamente referenciada como vencedora é classificada como faturada histórica, com data de fechamento e usuário original quando conhecidos. Não se inventam data ou responsável: campos antigos ausentes permanecem ausentes e a interface informa a origem histórica. Aceites vinculados a oportunidades abertas entram na fila; havendo múltiplos aceites, usa-se o mais recente. Aceites adicionais/ambíguos em negócios encerrados são cancelados operacionalmente, com motivo de migração e prova original preservada.

**Revisão antes da aplicação:** o script somente de leitura [`scripts/audit-proposal-billing.sql`](../scripts/audit-proposal-billing.sql), com parâmetros `tenant_id` e `workspace_id`, identifica propostas sem negócio, vínculos fora do escopo, aceites ambíguos e fases duplicadas. Propostas legadas sem oportunidade continuam consultáveis; faturamento exige vínculo correto. Não são criadas oportunidades para adivinhar esse vínculo. Conferir esses casos antes de aprovar a migração em produção.

## Validação

Os resultados finais e comandos estão registrados em [`crm-billing-contact-validation-20261102.json`](crm-billing-contact-validation-20261102.json).

| Verificação | Resultado |
| --- | --- |
| Regressão backend ampliada | 244 testes aprovados |
| Recortes finais de leitura, busca e migração | Aprovados; resultados detalhados no JSON |
| Testes unitários web | 229 aprovados, 31 arquivos |
| Navegador desktop 1366 / mobile 390 | 14 aprovados; mais 6 verificações finais de metadados/busca |
| Build API e build de produção web | Aprovados |
| Typecheck API e web | Aprovados |
| Isolamento CRM/Inbox e Inbox/Conversation | Aprovado |
| Contratos backend/frontend | 49 contratos verificados |
| Espelho da apresentação de contato | Consistente |

Testes novos: `proposal-billing-contact.test.mjs` cobre as 12 etapas do ciclo, concorrência/idempotência, ganho/perda/reabertura, estoque, auditoria, autenticação/autorização/escopo e contatos atuais/legados; `proposal-billing-migration.test.mjs` cobre migração incremental com dados antigos e reaproveitamento de fase; `contact-presentation-guard.test.mjs` impede os fallbacks diretos antigos; `web/tests/contact-presentation.test.ts` cobre nomes, telefones, IDs, LIDs e nomes de formulário; `web/e2e/proposal-billing-contact.spec.ts` cobre confirmação, fila, contato fora da primeira página, busca, faturamento e reabertura no desktop/celular. O teste do Analytics executa aceite → faturamento → reabertura → perda e preserva pedido pago independente.

Evidências visuais com dados locais de teste: [mobile](evidence/crm-proposal-invoiced-mobile-20261102.png) e [desktop](evidence/crm-proposal-invoiced-desktop-20261102.png).

## Arquivos e limites da entrega

Lista completa: [`crm-billing-contact-files-20261102.md`](crm-billing-contact-files-20261102.md).

As principais mudanças estão nos casos de uso CRM/Sales, adaptadores PostgreSQL, rotas comerciais/públicas, apresentação compartilhada, telas de propostas/oportunidades/contatos/atendimento/pedidos, componentes de faturamento/reabertura, testes e migration 0187.

Pendência operacional: revisar o preflight e executar eventual deploy/migration somente após apresentação e aprovação desta entrega. Publicação não foi iniciada. API e web devem ser atualizadas em conjunto. Estoque simples mantém a política anterior de fechamento com movimentação `best-effort`; esta entrega preserva seu controle contra duplicação, sem redesenhar essa política. Mensagens livres e snapshots brutos de auditoria permanecem armazenados; a regra comum controla a identificação estruturada de pessoas.
