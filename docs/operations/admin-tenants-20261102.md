# Administração de contas e contratos — 2 de novembro de 2026

## Alteração

O painel separa gestão, produtos e configurações da plataforma. A página da conta reúne contrato e cobrança, acessos e limites e histórico administrativo, seguidos de consumo de IA, créditos, pessoas e espaços. As estimativas de receita e margem de IA em USD são identificadas como estimativas; não são somadas às mensalidades dos contratos.

O contrato é lido da assinatura e da versão de plano reais, incluindo adicionais e preços capturados, situação, renovação, cancelamento e próxima cobrança. Sem assinatura de pagamento, a tela identifica explicitamente a concessão administrativa e não promete cobrança automática. Trocar o plano de uma assinatura existente usa o ciclo normal do provedor, não apenas o resumo legado `tenant_billing`. Alterar quantidades usa as mesmas regras de prévia, aumento imediato e redução na renovação do fluxo de cobrança existente.

Liberações administrativas são independentes do preço contratado. Permitem seguir a assinatura, liberar ou bloquear a conta; definir acesso a CRM, propostas, automações, respostas automáticas de IA e relatórios; e definir limites de usuários, espaços ativos, conexões de mensagens, contatos, créditos de IA e automações. Ausência de override segue o contrato; `false`, zero e ilimitado (`null`) mantêm significados distintos. Reduzir limites não exclui dados existentes.

Cada alteração desses controles exige motivo e registra ator, antes/depois e horário. O controle de versão rejeita sobrescritas concorrentes. A gravação compartilha o bloqueio de capacidade por tenant com alocações e alterações comerciais. Produtos Conversas, Marketing, Meetings e Site mantêm seus controles próprios e a auditoria existente; religar Meetings preserva os limites negociados. Os limites de gravações, minutos, retenção e armazenamento do Meetings podem ser editados.

Renovações e alterações comerciais do Meetings preservam concessões e bloqueios de origem manual ou interna. A sincronização automática altera somente o acesso derivado da assinatura; não desfaz uma decisão administrativa.

Os controles são aplicados na resolução de entitlements, nos guardas da API, nas inclusões de contatos/automações/conexões por repositório, no uso de créditos de IA, nas respostas automáticas do worker e na resolução de publicação social. Bloqueios globais e RBAC continuam prioritários. Admin, autenticação e cobrança continuam acessíveis para recuperação. Os caches administrativos e de produtos expiram em até um segundo; operações já em execução podem concluir.

O saldo de créditos exibido no resumo da conta, na barra do workspace e na recarga também considera a concessão administrativa. A cota contratada permanece intacta no banco; remover a concessão restaura essa cota. O modo ilimitado aparece como ilimitado nas telas, sem expor a sentinela numérica usada pelos consumidores legados.

O limite genérico de armazenamento do catálogo continua visível no contrato retornado pela API, mas não é oferecido como controle manual: o contador legado não mede todos os caminhos de upload. Armazenamento do Meetings usa seus limites reais. Não há promessa de bloqueio de armazenamento global sem medição correspondente.

A migração 0188 preserva os recursos comerciais já usados pela conta interna `tenant-vorix` como concessões explícitas, com histórico. Nenhum plano pago ou cobrança foi criado para isso.

## Limpeza autorizada de testes

Foi usado o manifesto explícito `tenant-cleanup-20261102.manifest.json`, conferido contra todos os identificadores presentes no banco. Apenas `tenant-vorix` permanece como conta de cliente. `__global__` é um identificador técnico de configurações globais, preservado.

- 35 identificadores de teste removidos, incluindo 8 contas listadas no painel e resíduos antigos de homologação.
- 2.177 linhas removidas explicitamente, além de filhos removidos pelas cascatas existentes.
- 258 snapshots de dados protegidos (tabelas com tenant, descendentes sem coluna tenant e o administrador proprietário) conferidos antes/depois dentro da mesma transação, sem diferença.
- Os espaços reais Preço Baixo Club (ativo) e Bambilu Kids (arquivado), o administrador proprietário e os registros globais foram preservados.
- Não havia assinaturas de teste vinculadas a provedor de pagamento. O script recusa excluir uma conta com assinatura externa vinculada.
- Identidades globais de usuários e arquivos físicos compartilháveis não são apagados indiscriminadamente. Os vínculos e dados dos tenants de teste são removidos.

Backup integral do banco, gzip validado, modo 0600:

`/opt/zuno/deploy_backups/pre-test-tenant-cleanup-20261102T224915Z.sql.gz`

SHA-256: `9998d01acf0b8c1757dbc64827e6409ab4dc69930558258c9a731c55b2bf73b4`.

Auditoria completa no servidor: `/opt/zuno/deploy_backups/test-tenant-cleanup-20261102.audit.json`.

O script `scripts/operations/delete-test-tenants.mjs` usa simulação com rollback por padrão. A execução exige manifesto, proprietário administrador verificado e referência de backup. Identificador inesperado, assinatura vinculada, bloqueio de FK ou alteração nos snapshots protegidos provoca rollback. As FKs permanecem ativas.

## Validação

- Build e tipos do backend; build de produção e tipos do frontend.
- 135 testes de regressão do backend: controles, proteção da limpeza, contratos, billing, capacidade, soluções, créditos e workspaces.
- Revisão do saldo exibido: 45 testes de créditos, contratos e concessões administrativas.
- Preservação das decisões administrativas nas renovações: 38 testes de controles, Meetings, soluções e ciclo da assinatura.
- 234 testes do frontend.
- 6 cenários de navegador (desktop e celular): concessões com motivo e persistência, histórico, preservação dos limites do Meetings, prévia/confirmar cobrança no tenant selecionado e manutenção do rascunho em conflito.
- 2 cenários adicionais de navegador para a apresentação de créditos ilimitados na cobrança (desktop e celular).

As mudanças financeiras foram validadas por testes e simulações, sem efetuar cobranças reais. O tenant preservado não tem assinatura de pagamento vinculada.

## Publicação e conferência em produção

Publicação concluída em 02/11/2026: interface no commit `fbb0b27`, API e workers no commit `765a4e0`. A conferência final ocorreu às 20h37 (Brasília), com resultado PASS, sem gravações de negócio ou cobranças durante a navegação de validação.

- API pronta, site HTTP 200 e todos os containers Vorix saudáveis; nenhum erro fatal no procedimento de deploy.
- 189 migrações aplicadas, nenhuma pendente e nenhum checksum divergente; ambiente privado preservado.
- Conta e ranking mostram somente Vorix. Os dois espaços reais e o proprietário permanecem presentes.
- Contrato, controles, histórico e saldos de IA conferidos por chamadas reais à API. Saldo do workspace, recarga e resumo administrativo coincidem.
- Navegação real conferida em 1440 px e 390 px, sem erro de página, transbordamento horizontal ou mutações de negócio.
- Os 3.833 arquivos da release final foram verificados contra os objetos do commit Git, mantendo os bytes canônicos das migrações.

Log final: `/var/log/vorix-deploy-765a4e0-20261102232453.log`.

SHA-256 da release final: `543909b450483a1f4d07679ed812821502d842677cb6b6a30e218be23c0e7f55`.

Evidência estruturada: `admin-tenants-20261102.validation.json`.
