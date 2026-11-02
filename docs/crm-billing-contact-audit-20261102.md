# Mapeamento anterior à implementação — faturamento e contato canônico

Pedido: arquivo `Texto colado.txt`, recebido em 02/11/2026. Não implantar em produção antes de apresentar resultados e validações.

## Fluxo encontrado

1. O link público chama `respondToPublicProposal`/`acceptPublicProposal` em `application/crm/proposal-use-cases.ts`, registra decisão, hash da versão aceita, eventos e automações.
2. `public-proposals.route.ts` chama `applyProposalAcceptanceToDeal`. Há dois caminhos: `proposalAcceptanceHandler` do Sales Engine chama `winDeal` quando `proposalAcceptAutoWin` está habilitado (padrão atual); o fallback legado move diretamente para a etapa ganha e registra `first_deal_won`.
3. `winDeal`, `loseDeal` e `reopenDeal` já compartilham snapshots de fechamento, compare-and-set, trilha imutável e configurações de motivos. `PostgresDealRepository.setClosure` confirma oportunidade e eventos juntos. O trigger de estoque de variações acompanha a mudança de status; estoque simples é idempotente por movimentos líquidos da oportunidade.
4. `loseDeal` exige oportunidade aberta; será necessário permitir a transição de ganha para perdida com as permissões de correção/reabertura, preservando o ganho anterior e devolvendo o estoque pelo mecanismo existente.
5. Propostas não possuem estado faturado nem data/autor do faturamento. Etapas possuem apenas indicadores sistêmicos de ganha/perdida. A interface de criação exige oportunidade, embora a API legada aceite propostas sem vínculo.
6. O Analytics do Site calcula venda a partir do status atual `won`, deduplica por oportunidade e exclui a oportunidade quando já existe pedido pago correspondente. Reabertura/perda deixam de satisfazer a consulta de venda. Checkout e pagamento não precisam mudar.

## Identificação de contatos

Inventário inicial: **97 linhas candidatas em 35 arquivos da interface**, contendo `contactName`, `customerName` ou leituras diretas de `contact.name` (inventário em `tmp/contact-presentation-audit-before.json`). São candidatos à revisão, não 97 bugs confirmados.

Propostas e seletores montam nomes diretamente. Algumas telas procuram o contato somente na primeira página de `useContacts`, perdendo resolução canônica quando o contato não está nessa página. Conversas/Radar também usam seus próprios campos de nome/telefone. Snapshots e vínculos antigos podem conservar nomes técnicos; mudar somente um texto não corrige a origem.

A centralização deve distinguir nome humano de telefone/identificador, resolver o contato atual pelo vínculo existente e usar nome + telefone, ou somente telefone. Dados brutos e snapshots permanecem para auditoria; IDs não serão utilizados como identificação visual. Tipos internos como `LeadScore` e o evento de integração Meta `Lead` não são identidades de pessoas e não podem ser renomeados no protocolo.

## Desenho da alteração

- Aceite mantém a proposta aceita e leva a oportunidade aberta a uma etapa sistêmica de aguardando faturamento, sem ganho/receita/baixa.
- Faturamento manual reutiliza o fechamento existente e confirma proposta faturada, data/autor, oportunidade ganha e eventos na mesma operação persistente, protegida contra concorrência.
- Perda/reabertura anulam a situação operacional da proposta faturada/aceita sem remover seus dados de aceite/faturamento nem eventos. Não criam novas entidades automaticamente.
- Ganhos históricos e pedidos pagos serão preservados; qualquer compatibilização histórica será identificada, sem inventar autor e sem gerar novos eventos de venda.
- Contato canônico será resolvido no backend e apresentado por uma regra compartilhada na interface; a validação obrigatória de telefone continua nos pontos de entrada existentes.

Este documento foi criado após a análise e antes de alterar a implementação.
