# Reativação de espaços arquivados — 02/11/2026

O arquivamento deixou de ser definitivo. A mesma ação de ativação permite restaurar um espaço arquivado, preservando seu identificador, configurações, membros, integrações e dados vinculados. A data `archived_at` é limpa ao restaurar, tanto no PostgreSQL quanto no adaptador em memória.

A lista oferece **Reativar** nos cartões arquivados, e o modal de edição permite escolher **Ativo**. Permissões de transição e isolamento por tenant continuam obrigatórios. Não é possível ativar novamente um espaço que já está ativo.

A reativação usa o bloqueio e a verificação de capacidade já compartilhados com o faturamento. Apenas espaços ativos ocupam vagas. Falta de capacidade mantém o espaço arquivado e apresenta a opção de ajustar o plano; não contrata adicionais nem altera a mensalidade automaticamente.

Validação: builds de produção do backend e frontend, 88 testes de servidor (casos de uso, API, PostgreSQL e capacidade, incluindo restaurações concorrentes disputando a última vaga) e 18 cenários de navegador em computador e celular.

O proprietário autorizou liberar **2 vagas de espaços ativos** para `tenant-vorix`, por concessão administrativa, sem mudar o plano ou a mensalidade. As demais configurações são preservadas. A liberação é registrada no histórico administrativo com motivo e controle de versão.
