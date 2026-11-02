# Espaços ativos, contratação e editor do site — 02/11/2026

Implementação local, sem publicação em produção e sem cobranças reais. Mantida a orientação de apresentar as validações antes de publicar. As alterações de faturamento de propostas e apresentação de contatos que já estavam na árvore de trabalho foram preservadas.

Atualização posterior: a release `008fd47` foi publicada em produção após autorização do usuário. Veja o [registro da publicação e verificações](production-deploy-20261102.md). Os resultados abaixo documentam a validação local anterior à publicação.

## Comportamento entregue

- A lista de espaços oferece **Ativar** e **Inativar**, com confirmação e respeito às permissões. A opção continua disponível no modal de edição.
- Somente espaços com status `active` ocupam vagas. Inativos e arquivados continuam armazenados, com seus dados preservados.
- Criação e reativação usam a versão real da assinatura, os adicionais contratados e as reduções já agendadas. Compartilham o lock de contratação por conta para impedir duas ocupações da última vaga ou uma reativação durante a redução do plano.
- Inativar libera uma vaga; não altera sozinho a quantidade contratada nem o preço. Para reduzir a mensalidade, o cliente ajusta a contratação explicitamente.
- **Plano e espaços**, na lista de espaços, abre `/conta/plano#quantidades-plano`. A cobrança pode ser gerenciada mesmo sem nenhum espaço ativo ou criado. As mensagens de limite oferecem acesso ao ajuste, preservando o formulário original em outra aba.
- A tela de cobrança existente foi extraída para um componente compartilhado. A rota de configurações do espaço continua funcionando para espaços ativos. Quantidades, prévia, preços, permissões e checkout usam as mesmas APIs de faturamento.
- Aumentos liberam capacidade ao salvar. Reduções são agendadas para o fim do ciclo pago e não podem ficar abaixo do uso ativo. O gateway recebe automaticamente o valor da próxima renovação quando o cliente salva as quantidades. Não foi introduzida cobrança proporcional imediata.
- Espaços inativos mostram uma tela de situação com acesso à gestão. A guarda de requisições autenticadas que informa `workspaceId` rejeita alterações operacionais em espaços inativos/arquivados e mantém consultas e as rotas de gestão do espaço. A alteração não exclui dados, não desconecta provedores e não despublica sites existentes.
- No primeiro **Personalizar**, o endereço é sugerido a partir do nome do espaço, o rascunho é criado com o modelo escolhido e a navegação abre os campos de edição. O endereço sugerido continua editável; conflitos de endereço são apresentados pela API, sem sobrescrever outro site.
- **Personalizar** em um site existente abre o editor do modelo escolhido. Salvar continua sendo uma operação de rascunho; publicar permanece uma ação separada.

## Validação

| Verificação | Resultado |
| --- | --- |
| Build da API | Passou |
| Build de produção do frontend, incluindo TypeScript | Passou |
| Typecheck separado da API e do frontend | Passou |
| Testes da API, assinatura, preços, status, site e migração | 149 passaram |
| Testes unitários do frontend | 229 passaram |
| Chromium, desktop 1366 e celular 390 | 32 passaram |

Os testes cobrem liberação de vaga sem apagar o espaço, reativação sem capacidade, assinatura em atraso, isolamento entre contas, duas criações concorrentes e redução concorrente com reativação. Também cobrem prévia sem cobrança, confirmação do novo valor, redução e cancelamento da redução, persistência após recarregar, acesso ao plano sem espaços e edição/salvamento de Nexus, Aura e Pulse sem publicação.

A regressão do teste de migração 0163 foi corrigida na preparação da fixture: dados antigos agora são inseridos com o schema antigo, antes de executar as migrações, em vez de usar adapters atuais que já dependem da migração 0187 da tarefa anterior. A preservação de produto, variante e oportunidade continua sendo verificada.

As chamadas de faturamento foram exercitadas com provedor sandbox. Nenhuma conta de cliente, assinatura real, mensagem ou configuração de produção foi alterada. Esta tarefa não adiciona migração; a migração 0187 já pendente pertence ao ajuste anterior de propostas.

## Evidências

- [Editor Aura — computador](evidence/workspace-capacity-site-20261102/editor-aura-desktop.png)
- [Editor Aura — celular](evidence/workspace-capacity-site-20261102/editor-aura-mobile.png)
- [Plano e espaços — computador](evidence/workspace-capacity-site-20261102/plano-desktop.png)
- [Plano e espaços — celular](evidence/workspace-capacity-site-20261102/plano-mobile.png)
- [Situação do espaço — computador](evidence/workspace-capacity-site-20261102/status-desktop.png)
- [Situação do espaço — celular](evidence/workspace-capacity-site-20261102/status-mobile.png)
- [Registro de validação](workspace-capacity-site-validation-20261102.json)

Os valores e nomes das capturas pertencem às fixtures de teste; não representam preços ou assinaturas de produção.
