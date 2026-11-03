# Reativação de espaços arquivados — 02/11/2026

O arquivamento deixou de ser definitivo. A mesma ação de ativação permite restaurar um espaço arquivado, preservando seu identificador, configurações, membros, integrações e dados vinculados. A data `archived_at` é limpa ao restaurar, tanto no PostgreSQL quanto no adaptador em memória.

A lista oferece **Reativar** nos cartões arquivados, e o modal de edição permite escolher **Ativo**. Permissões de transição e isolamento por tenant continuam obrigatórios. Não é possível ativar novamente um espaço que já está ativo.

A reativação usa o bloqueio e a verificação de capacidade já compartilhados com o faturamento. Apenas espaços ativos ocupam vagas. Falta de capacidade mantém o espaço arquivado e apresenta a opção de ajustar o plano; não contrata adicionais nem altera a mensalidade automaticamente.

Validação: builds de produção do backend e frontend, 88 testes de servidor (casos de uso, API, PostgreSQL e capacidade, incluindo restaurações concorrentes disputando a última vaga) e 18 cenários de navegador em computador e celular.

O proprietário autorizou liberar **2 vagas de espaços ativos** para `tenant-vorix`, por concessão administrativa, sem mudar o plano ou a mensalidade. As demais configurações são preservadas. A liberação é registrada no histórico administrativo com motivo e controle de versão.

## Publicação e validação real

Commit `bdb4a75` publicado em produção. API pronta, site HTTP 200 e todos os containers Vorix saudáveis, com ambiente privado preservado e 189 migrações aplicadas, nenhuma pendente.

As 2 vagas foram efetivamente liberadas no controle administrativo (versão 3 → 4), com verificação de que plano, valor recorrente e demais configurações não mudaram.

A reativação de Bambilu Kids foi executada com sucesso dentro de uma transação de validação, verificando limpeza de `archived_at`, identidade e dados preservados. A transação foi desfeita e o registro original foi conferido integralmente, deixando a decisão de reativação definitiva ao proprietário. O botão do cartão e a escolha Ativo na edição foram conferidos no site real em 1440 px e 390 px, cancelando sem salvar; não houve erro de página nem transbordamento horizontal.

Log: `/var/log/vorix-deploy-bdb4a75-20261103000623.log`.

Release SHA-256: `fe57b8ca08958c6c335ea3aa3b49985f99cfd7520aa076d188b7b08e54bb3609`.

Evidência estruturada: `workspace-reactivation-20261102.validation.json`.
