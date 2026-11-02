# Publicação em produção — 02/11/2026

Release da aplicação: [`008fd47`](https://github.com/precobaixoclub/Vorix-Works/commit/008fd47d716ef7c216d4261874d53ac01cc068a5), enviada à branch `main` e publicada em `vorixworks.com` após autorização do usuário. Data local: 02/11/2026, fuso America/Sao_Paulo.

Inclui gestão de espaços ativos e contratação, acesso ao plano pela conta, correção do editor de modelos, faturamento manual de propostas e identificação canônica de contatos. API, workers, gateway e interface foram atualizados em conjunto.

## Resultado

- Processo oficial finalizado com `DEPLOY_DONE` e `DEPLOYED 008fd47`.
- `https://api.vorixworks.com/readyz`: `ready: true`; interface pública: HTTP 200.
- Cinco serviços saudáveis, todos usando as imagens atuais: API, worker de atendimento, worker de marketplaces, gateway social e interface.
- Zero erros fatais no recorte de logs verificado pelo deploy.
- Migration `0187_proposal_operational_billing` aplicada; 188 migrations aplicadas e nenhuma pendente.
- Seis arquivos de implementação/migração conferidos por SHA-256 contra o commit publicado. A rota `/conta/plano` também foi confirmada na imagem da interface em execução.
- Configuração `.env.zuno` preservada, com hash igual antes e depois da troca de código.

O host verificado foi `143.198.47.74`, com a chave SSH já registrada e checagem estrita. O endereço antigo `209.97.152.212`, presente em documentação anterior, não foi utilizado nesta publicação.

## Conferência dos dados

A auditoria antes da migração não encontrou propostas aceitas sem oportunidade, vínculos fora do escopo, múltiplos aceites em oportunidades abertas nem fases de faturamento duplicadas.

O tratamento de legado classificou duas propostas vencedoras antigas como faturadas históricas e cancelou operacionalmente um aceite antigo que não correspondia à proposta vencedora. A prova de aceite e o histórico permanecem armazenados. Essa classificação não reabriu vendas, não executou novo ganho e não repetiu baixa de estoque.

As contagens e os estados de espaços, oportunidades e contatos, assim como o estoque agregado dos produtos, permaneceram iguais antes e depois. Nenhuma mensalidade foi alterada e nenhuma mensagem foi enviada a clientes durante a publicação/verificação.

## Verificação no navegador

Chromium em 1440 e 390 px, usando a API real com autenticação:

- Botão Inativar abre a confirmação; cancelar preserva o espaço.
- Modal Editar mantém a seleção de situação e permite cancelar sem salvar.
- Plano e espaços abre `/conta/plano` e exibe o controle de quantidade de espaços.
- Personalizar Aura em um site existente abre os campos de edição, sem salvar ou publicar o rascunho.
- Zero erros JavaScript, sem overflow horizontal e sem gravações de negócio pela conferência do navegador.
- As APIs de espaços e capacidade continuam exigindo autenticação.

O fluxo de primeiro site, incluindo criar e salvar o rascunho com Nexus, Aura e Pulse, foi validado nos testes locais; a conferência em produção não criou sites de clientes.

## Backups e rastreabilidade

Backup do código: `/opt/zuno/deploy_backups/pre-008fd47-20261102204149.tgz`.

Backup do banco: `/opt/zuno/deploy_backups/db-pre-008fd47-20261102204149.sql.gz`.

Backup da configuração: `/root/.env.zuno.pre-008fd47-20261102204149`.

Pacote exato publicado: `/opt/zuno/deploy_backups/release-008fd47.tgz`, SHA-256 `94b14a072eef0dd5447921059e77871c1173d33162a63b7393a47af0ac49882e`.

Log do deploy: `/var/log/vorix-deploy-008fd47-20261102204149.log`.

Log das migrations: `/var/log/vorix-migrations-008fd47-20261102204149.log`.

As imagens anteriores foram preservadas com a etiqueta `rollback-20261102204149`. Não foi necessário rollback. A migração altera o fluxo operacional e classificações históricas; eventual recuperação do banco deve seguir o procedimento de restauração/ajuste explícito, sem presumir que voltar apenas as imagens desfaz a migração.

## Validações registradas

[Registro da publicação](production-deploy-20261102-validation.json).

[Validação de espaços, plano e editor](workspace-capacity-site-editor-20261102.md): builds e typechecks aprovados; 149 testes de API, 229 testes unitários web e 32 verificações no navegador aprovados. Antes do commit, um recorte adicional de 44 testes de propostas, migração, contatos e Analytics também passou.

[Validação anterior de propostas e contatos](crm-billing-contact-report-20261102.md), preservada como registro da fase local anterior à autorização de publicação.
