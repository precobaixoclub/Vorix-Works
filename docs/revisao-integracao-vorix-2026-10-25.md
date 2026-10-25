# Revisão de integração do Vorix — 25/10/2026

Revisão executada no código local, com correções e testes. Inclui frontend, API, casos de uso,
repositórios, migrações, regras de acesso, atendimento, oportunidades, propostas e relatórios.
A publicação no servidor e as migrações foram solicitadas explicitamente pelo usuário após a revisão.
Deploy concluído: [relatório de publicação](production-deploy-20261025.md). Nenhum envio de WhatsApp ou cobrança
real foi realizado durante os testes. As alterações que já existiam no workspace foram preservadas.

## Fluxos revisados

| Fluxo | Caminho e invariantes conferidos |
| --- | --- |
| Atendimento | Webhook → identidade do contato/canal → conversa permanente → atendimento aberto → distribuição → ciclo do responsável → primeira resposta humana → transferência → tipo/subtipo de encerramento → pesquisa → novo atendimento na mesma conversa. |
| Transferência | Encerra o ciclo anterior e inicia outro. FRT do novo responsável começa na atribuição; tempo de posse e resolução global têm medidas distintas. |
| Oportunidade | Cadastro → etapas personalizadas → produtos/valores → proposta opcional → ganho/perda → snapshot de fechamento → métricas/metas → arquivamento separado do resultado → reabertura e novo fechamento sem duplicar venda. |
| Proposta | Rascunho/modelo → aprovação quando aplicável → mensagem de WhatsApp → página pública responsiva → aceite/recusa → motivo e comentário no painel interno. Recusa mantém a oportunidade aberta; aceite respeita a configuração comercial. |
| Acesso | Sessão → vínculo ativo na empresa → perfil + concessões − remoções → equipes autorizadas → recorte de coleção, detalhe, relacionamentos, relatórios, mídias e eventos em tempo real. |
| Cadastro | Usuário, administrador principal, workspace, billing e funil na transação de provisionamento. Trial opcional usa savepoint para não invalidar a criação da conta. |
| Outros módulos | Suítes de Meetings/agenda/gravação, billing/capacidade, calendário, notificações, publicação/agendamento, analytics, arquivos, catálogo e Site. Navegador com API real local e dados fictícios para catálogo e Site. |

## Problemas encontrados e corrigidos

### Críticos

| Problema | Correção e áreas afetadas |
| --- | --- |
| Configuração comercial antiga `dealVisibility=all` ampliava o acesso além das permissões efetivas. | Escopo de oportunidades definido por permissões e equipes. Preferência antiga preservada por compatibilidade, sem conceder acesso. Padrão de novos registros passa a `own`. |
| Um colega participante de A e B expunha registros de B ao gerente de A. | Equipe explícita do registro restringe a leitura dos dados dos colegas; os registros da própria pessoa continuam acessíveis. Mesma regra aplicada no SQL e nas verificações de detalhe. Gerente recebe leitura de equipe nas equipes que gerencia; participação operacional continua permitindo os próprios atendimentos. |
| Consultas de vínculos por usuário misturavam equipes de empresas diferentes. | `listByUser` aceita tenant; resolvedores de acesso, política comercial, escopos, relatórios e dados de autenticação passam a informar a empresa. |
| Históricos e ações indiretas permitiam contornar o escopo de oportunidades/propostas/contatos/tarefas. | Guarda comum valida entidade, workspace, tenant, proprietário/equipe e IDs relacionados enviados por corpo/query. Coleções também recebem o recorte no banco. Timeline 360 aplica escopo a cada conjunto de dados. |
| Recursos podiam ser gravados com um workspace existente em outra empresa, dependendo apenas de uma FK simples. | Guarda comum de workspace nas rotas autenticadas de negócio, validando todos os IDs recebidos em params, query e corpo. Rotas públicas e administrativas da plataforma mantêm os seus próprios controles. |
| Stream da Inbox filtrava empresa/workspace, mas podia entregar eventos de conversas de outra equipe. Proxy de mídia podia ser acessado diretamente com sessão. | Stream revalida vínculo/permissões e escopo da conversa em cada evento. Mídias e avatares conferem o acesso à conversa; tokens curtos continuam limitados ao alvo. |
| Snapshots/históricos comerciais podiam expor custo/margem fora da visibilidade autorizada; configuração do vendedor podia sobrepor remoção individual. | Filtragem de campos sensíveis também nas respostas de detalhe/histórico. Remoção explícita de permissão prevalece sobre configurações comerciais. |

### Altos

| Problema | Correção e áreas afetadas |
| --- | --- |
| Cadastro tentava reconectar um cliente PostgreSQL já reservado ao criar o funil. | Pool da transação usa a mesma conexão e savepoints nas transações internas dos repositórios. Rollback de provisionamento permanece integral. |
| Cadastro público ainda criava `admin`, que passou a significar Gerente. | Nova conta nasce `owner` e `is_account_owner=true`. Migração repara empresas legadas sem administrador ativo/principal, sem promover os demais membros. |
| Falha SQL no trial opcional podia deixar a transação inteira abortada, apesar do erro ser capturado. | Savepoint específico do trial: falha opcional é desfeita e usuário/workspace/funil continuam sendo confirmados. |
| Métricas antigas usavam conversa, `updated_at` e primeira resposta automática. | Relatório passa a usar atendimentos e ciclos: recebimento por `opened_at`, finalização/TMR por `closed_at`, FRT humano por atribuição. Mensagens automáticas continuam apenas no volume de mensagens. |
| Relatório comercial antigo usava valor inicial, datas antigas e totais de propostas sem o mesmo recorte. | Usa status comercial, valor final, fechamento, crédito histórico e escopo também nas propostas. Reabertura deixa de contar ganho; novo fechamento mantém uma única venda. |
| Dashboard e metas discordavam nos limites do mês perto da meia-noite. | Utilitário de calendário no fuso da empresa compartilhado. Metas, realizado, período corrente, impacto da oportunidade e previsão usam esse fuso. Previsão com data sem horário é comparada como data local. |
| Pesquisa nova após reabertura preservava nota/data da pesquisa anterior. Respostas simultâneas podiam duplicar marco e agradecimento. | Nova pesquisa limpa a resposta anterior do ciclo reaberto; resposta válida é gravada uma vez. Compare-and-set da pesquisa pendente impede dupla confirmação/evento/agradecimento. |
| Distribuição selecionava membros desativados/removidos; último responsável podia ser retido após sair da equipe. | Seleção exige vínculo ativo na empresa. Novo atendimento verifica se o último responsável continua ativo e na equipe; caso contrário passa novamente pela distribuição. |
| Caminho de movimentação sem Sales Engine alterava `won_at`/`lost_at` sem sincronizar o novo status comercial. | Fechamento/reabertura desse caminho também usa `setClosure`, com compare-and-set, snapshot financeiro disponível e eventos estruturados. |

### Médios

| Problema | Correção e áreas afetadas |
| --- | --- |
| Backlog pessoal incluía atendimentos atualmente atribuídos a outra pessoa, pela participação histórica. | Backlog pessoal usa a responsabilidade ativa; métricas históricas preservam os ciclos de quem participou. |
| Conversão silenciosa de datas impossíveis e amostras inválidas de CSAT. | Datas de calendário inválidas são rejeitadas. Notas válidas são inteiras de 1 a 5; ausência de amostra continua sem média inventada. |
| Numeração de atendimentos dependia de cinco tentativas de `max+1`. | Abertura numera sob lock do workspace em transação, mantendo os índices únicos de atendimento aberto e responsabilidade ativa. |
| Respostas atrasadas podiam preencher FRT antes da atribuição ou em atendimento já fechado. | Persistência exige atendimento aberto e resposta posterior à abertura/atribuição. |
| Telas ainda decidiam ações pelo nome do perfil, contrariando permissões individuais. | Oportunidades, detalhes, canais, atendimento e configuração do Kanban consultam permissões efetivas. Ações de ganho/perda, correção, arquivamento e reabertura têm controles próprios. |
| Contatos automáticos do WhatsApp sem proprietário desapareciam com o novo recorte comercial. | Contato pode ser acessado através de conversa autorizada; isso não amplia acesso aos negócios/propostas de outras equipes associados ao contato. |
| Respostas incompletas podiam derrubar Dashboard/cockpit/detalhe ou apresentar simulação financeira inválida. | Tratamento de blocos ausentes e validação de respostas essenciais. Confirmação financeira depende de uma simulação válida. |

### Melhorias de validação

- O executor padrão omitia 22 arquivos de teste. Agora descobre automaticamente todas as suítes
  `tests/*.test.mjs`, mantendo a lista existente e evitando duplicações.
- A Timeline 360 passou a ler eventos comerciais em lote, com tenant/workspace e limite por
  entidade, substituindo as consultas separadas por oportunidade, tarefa e proposta.
- Fixtures de HTTP foram ajustadas para criar workspaces reais antes das requisições. Tentativas
  contra workspace alheio agora esperam `404`, em vez de uma coleção vazia com `200`.
- Fixtures de navegador acompanham permissões efetivas, a nova Dashboard e os DTOs atuais.
  Seletores antigos de mídia/formulários e expectativas da antiga limpeza manual de contatos foram atualizados.
- O binário local de FFmpeg ausente foi restaurado com `npm rebuild ffmpeg-static`; testes de mídia
  passaram a executar efetivamente. Isso é uma correção do ambiente, sem mudança de dependência.
- O primeiro build no servidor encontrou uma importação do domínio do backend nas fixtures E2E.
  O contexto Docker do frontend contém somente `web/`; as permissões fictícias passaram a ter
  snapshot explícito dentro das próprias fixtures, preservando os cenários de acesso e o build isolado.
  O rollback dessa tentativa preservou a aplicação anterior e ocorreu antes das migrações.

## Migrações e compatibilidade

Arquivos das entregas integradas, revalidados em banco de teste:

- `0172_inbox_attendance_cycles.sql`: atendimentos, atribuições, catálogo de finalização e
  backfill dos atendimentos em aberto.
- `0173_access_profiles_and_scope.sql`: exceções de permissão, status de membro, proteção de
  administrador principal e auditoria. Mantém concessões explícitas dos gestores legados.
- `0173_deal_commercial_lifecycle.sql`: fechamento/reabertura/arquivamento de oportunidades.
- `0174_inbox_sla_policies.sql`: metas de prazo para empresa/equipe/canal.
- **Nova nesta revisão:** `0175_integration_review.sql`: reparo dos administradores legados,
  default comercial `own`, índice de primeira resposta por período e preservação do último
  encerramento/CSAT conhecido de conversas antigas sem atendimento estruturado.

O runner identifica migrações pelo nome completo; os dois arquivos com prefixo `0173` têm IDs
distintos. Arquivos já existentes não foram renomeados. A nova migração foi testada em instalação
limpa, atualização e reaplicação idempotente.

Em produção, as cinco migrações foram aplicadas; total final de 176, nenhuma pendente ou com
checksum divergente. Nenhuma migração previamente aplicada foi alterada. Foram encontrados dois
atendimentos abertos preservados pelo backfill e nenhum encerramento legado elegível. O schema
inclui atendimentos, ciclos de responsabilidade, catálogos de encerramento, auditoria de acesso,
exceções individuais, SLA e novos campos de fechamento/arquivamento. Índices incluem unicidade
do atendimento aberto e do responsável ativo, numeração por workspace, períodos de abertura,
fechamento e primeira resposta, responsável por período, administrador principal, etapas de
resultado e oportunidades fechadas aguardando arquivamento.

Limite histórico: uma conversa antiga não permite reconstruir todos os atendimentos e transferências
anteriores. A migração preserva o último fechamento e a pesquisa conhecidos. TMR/SLA de resolução
de registros marcados como migração não recebem uma duração operacional inventada. Novos ciclos
usam os timestamps estruturados. Não há backfill artificial de FRT individual.

## Definições usadas nos indicadores

| Indicador | Fonte / período |
| --- | --- |
| Atendimentos iniciados | `opened_at` no período. |
| Finalizados e TMR | `closed_at` no período; TMR = fechamento − abertura conhecida. |
| FRT individual | Primeira resposta humana − início do ciclo; ciclos iniciados no período. |
| Posse individual | Fim − início do ciclo; ciclos encerrados no período. |
| SLA de resposta | Prazo do ciclo; respostas/saídas sem resposta no período e estado dos ciclos ativos. |
| Backlog | Fotografia atual; no recorte pessoal, somente responsabilidade ativa. |
| CSAT | Pesquisas enviadas e respondidas válidas dos atendimentos fechados no período; não é SLA. |
| Ganhos, perdas, realizado | Status e fechamento atual, crédito histórico e valor final; arquivar não altera o resultado. |
| Conversão comercial | Ganhas / (ganhas + perdidas); sem denominador, sem taxa. |
| Ticket médio | Valor final ganho / quantidade ganha. |
| Metas | Mesmas vendas por fechamento no fuso da empresa, sem somar meta de equipe e metas individuais como se fossem vendas diferentes. |

Veja também `dashboard-indicadores.md`, `conversas-ciclo-de-atendimento.md`,
`perfis-permissoes-escopo.md` e `deal-commercial-lifecycle.md`.

## Validações

- Arquitetura: build do backend, 49 contratos e verificações de isolamento aprovados;
  1.216 arquivos examinados. Registro local: `.qa/review-architecture-last.log`.
- Frontend: typecheck, 167 testes em 23 arquivos e build Next.js de produção aprovados.
  Registros: `.qa/review-web-{typecheck,tests,build}-release.log`.
- Navegador: 136 cenários de interface aprovados após correção e reexecução das falhas;
  55 cenários de catálogo/Site com API e banco de teste aprovados. Total: 191 cenários únicos
  aprovados, 13 pulos intencionais. Desktop de 1.440 px e celular de 390 px.
  Registros: `.qa/review-browser-round3.log`, `.qa/review-ui-regressions.log`,
  `.qa/review-ui-final-cases.log` e `.qa/review-sites-browser.log`.
- Os testes de navegador produziram capturas preservadas em `.qa/evidence/`. Imagens de
  documentação e miniaturas regravadas incidentalmente pelos testes foram restauradas;
  alterações reais de código anteriores à revisão foram preservadas.
- Backend integral: 4.077 testes descobertos, 4.075 aprovados, 2 pulados e nenhuma falha
  (378,8 segundos). Comando: `node scripts/test-backend.mjs`, após o build validado pela
  arquitetura. Registro: `.qa/review-backend-release.log`.
- Resumo versionado: `qa/integration-review-20261025/validation.json`.
- Produção: builds Linux das três imagens aprovados; API e worker saudáveis; web HTTP 200;
  `ready=true`; 26 verificações públicas em desktop/celular aprovadas, sem erros JavaScript.
  Inclui imagem Open Graph da proposta e bloqueio de acesso anônimo às novas rotas.
  Conferência por hash de 12 arquivos canônicos do commit e verificações de integridade do banco
  aprovadas. Evidências versionadas em `qa/integration-review-20261025/production-*.json`.

## Decisão de negócio pendente

**Atendimentos já abertos de uma pessoa desativada ou removida da equipe:** manter a atribuição
para transferência pela gestão ou devolver automaticamente à fila? A revisão bloqueia o acesso
e novas distribuições ao usuário e preserva o histórico existente. Recomenda-se devolver os
atendimentos operacionais à fila com um evento estruturado, mas essa política altera a operação
e não foi escolhida arbitrariamente.

## Limites e riscos técnicos restantes

- WhatsApp, Google/Meetings e pagamentos foram exercitados com adaptadores de teste/sandbox;
  credenciais, webhooks e serviços externos reais precisam de homologação no ambiente de destino.
- O cenário de navegador de renovação de capacidade exige PostgreSQL descartável nativo.
  O script disponível depende de Docker/WSL, indisponível nesta máquina. As suítes de backend de
  capacidade, provedor e scheduler foram executadas separadamente.
- Parte do rastreamento operacional de atendimento ainda tem tratamento best-effort. Falhas de
  infraestrutura entre operações independentes precisam de monitoramento; esta revisão não
  converteu todo o módulo em uma única transação/outbox distribuída.
- O carregamento da Dashboard possui teto de 50.000 atendimentos relevantes. Não foi realizado
  ensaio de carga com volume de produção, replicação ou múltiplas instâncias.
- O modo híbrido `AUTH_MODE=jwt` com persistência operacional em memória serve a testes de módulos
  isolados. O fluxo completo de cadastro/CRM deve usar `PERSISTENCE_DRIVER=postgres`, como nos
  testes integrados e na fixture de navegador com API real.
- O servidor terminou com aproximadamente 6,3 GB livres. Backups foram mantidos; crescimento de
  imagens, cache de build e backups exige acompanhamento operacional.
- `/readyz` já apresentava `status=degraded` antes do deploy pelo aviso de `production_guard`.
  Permanece assim, com `ready=true` e banco, secrets, estado operacional e fila aprovados;
  nenhuma configuração de publicação foi alterada neste deploy.

As verificações em produção foram de saúde, integridade e navegação anônima. Os fluxos autenticados
de negócio foram testados em ambiente controlado; não foram operadas contas de clientes no smoke.
