# Valentina, Gerente de Clientes do Zuno

Valentina é a Gerente de Clientes do Zuno. Ela não é uma Skill, não é uma Especialista, não utiliza IA, não cria conteúdo, não cria imagens, não cria campanhas e não publica. Sua responsabilidade é representar e administrar cada cliente dentro da plataforma, garantindo que todo workflow comece sabendo exatamente qual cliente está sendo atendido.

## Arquitetura

Valentina vive na camada de aplicação porque representa uma regra central de negócio: todo cliente do Zuno deve existir como tenant administrado por contrato. O contrato público é `ValentinaTenantPort`. A persistência fica atrás de `ValentinaTenantRepositoryPort`, permitindo trocar memória, JSON local, SQLite, PostgreSQL, MySQL ou MongoDB no futuro sem alterar Arthur, Caio, Helena, Clara, Ícaro ou Especialistas.

## Representação de cliente

Um cliente é representado por `TenantRecord`. Esse registro contém `tenantId`, `clientId`, nome de exibição, status, plano contratado, status da assinatura, datas de criação, ativação, vencimento, suspensão e exclusão lógica, timezone, idioma, país, ambiente, nicho, objetivos principais, redes sociais conectadas, integrações preparadas, créditos, consumo, especialistas habilitados, recursos liberados, permissões, preferências, configurações gerais, histórico e versões.

Valentina não armazena conhecimento de marca, produto, público ou campanha. Essas informações pertencem à Clara. Valentina informa qual cliente está sendo usado, qual plano está ativo, quais limites existem e quais permissões estão liberadas.

## Planos

O catálogo de planos fica em `VALENTINA_PLAN_CATALOG`. Foram preparados os planos `FREE`, `START`, `PRO`, `BUSINESS` e `ENTERPRISE`. Cada plano define limite mensal de IA, limite diário de IA, especialistas liberados, recursos liberados, integrações liberadas, limite mensal de publicações, limite mensal de campanhas, limite mensal de imagens e limite mensal de vídeos.

`FREE` libera operação mínima de estratégia, copy e revisão, sem publicações, campanhas ou imagens. `START` libera operação inicial de conteúdo. `PRO` libera imagem, carrossel, publicação, métricas e otimização. `BUSINESS` libera todos os especialistas, recursos e integrações com limites altos. `ENTERPRISE` usa limites ilimitados.

## Consumo

Valentina registra tokens consumidos, custo estimado, custo real, publicações, campanhas, imagens e vídeos. O consumo é organizado por mês, com detalhe diário de tokens de IA. A estrutura também contempla créditos extras: tokens adicionados, tokens extras consumidos e saldo disponível. Quando o consumo ultrapassa o limite mensal do plano, Valentina permite usar créditos extras. Quando ultrapassa limite diário ou limite de recurso, Valentina bloqueia a operação.

## Integrações

Valentina prepara integrações futuras com Meta, Facebook, Instagram, LinkedIn, TikTok, Threads, YouTube e Google Business. Nesta fase ela não chama nenhuma API externa. Ela armazena apenas estado da integração, rede, referência de token, escopos, expiração e metadados. O campo `tokenReference` foi usado para apontar para um cofre futuro, evitando que adapters precisem receber tokens crus diretamente do domínio.

## Histórico e versionamento

Toda alteração em um cliente gera nova versão e entrada de histórico. O histórico registra quem alterou, quando alterou, motivo, ação, versão, valores antigos e valores novos. A criação gera versão 1. Atualização, ativação, suspensão, troca de plano, adição de créditos, consumo, conexão de integração, desconexão de integração e exclusão lógica geram versões incrementais.

## Eventos

Valentina emite `TenantCreated`, `TenantUpdated`, `TenantActivated`, `TenantSuspended`, `PlanChanged`, `CreditsConsumed`, `CreditsAdded`, `IntegrationConnected`, `IntegrationDisconnected` e `TenantDeleted`. Esses eventos preparam o Zuno para auditoria, notificações, cobrança, painel administrativo e sincronização futura.

## Logs

Valentina registra logs para criação, atualização, ativação, suspensão, exclusão, troca de plano, consumo, adição de créditos, alteração de integração, consulta de cliente, entrega de cliente e verificação de limites.

## Integração com Arthur

Arthur agora exige `clientId` ou `tenantId` antes de planejar. Quando recebe uma instância de Valentina, Arthur consulta Valentina para resolver o contexto do cliente e grava esse contexto em `ExecutionPlan.tenant`. As etapas do plano também recebem `clientId` e `tenantId` em seus inputs. Arthur continua não armazenando cliente e não acessa repositório.

## Integração com Caio

Caio valida que todo `ExecutionPlan` possua cliente. Quando recebe Valentina, Caio carrega `TenantClientContext` antes de iniciar o workflow, grava `clientId` e `tenantId` no relatório de execução e repassa esse contexto para Helena executar Skills. Caio não modifica o cliente e não acessa armazenamento.

## Integração com Helena

Helena poderá consultar Valentina para verificar quais Especialistas estão habilitados para determinado cliente. A implementação atual já expõe `canUseSpecialist` e `checkLimits`, permitindo que uma futura etapa de execução bloqueie Skills fora do plano.

## Integração com Clara

Clara continua sendo dona do conhecimento. Valentina apenas fornece `clientId` e contexto administrativo. Quando um Especialista precisar de conhecimento, ele usa `clientId` resolvido pela Valentina para consultar Clara.

## Integração com Ícaro

Ícaro poderá consultar Valentina para descobrir plano, limites, orçamento e prioridade de IA. A implementação atual expõe `TenantClientContext`, `checkLimits` e preferências de IA, permitindo que Ícaro ajuste custo, qualidade ou velocidade sem alterar informações do cliente.

## Integração com Especialistas

Especialistas não armazenam clientes. Eles recebem `clientId` e `tenantId` no contexto de execução e podem consultar Valentina por `ValentinaTenantPort` quando precisarem validar plano, recurso ou permissão. Para conhecimento de marca e campanha, eles consultam Clara; para IA, consultam Ícaro.

## Armazenamento local

Foram criados `InMemoryValentinaTenantRepository` e `LocalJsonValentinaTenantRepository`. O armazenamento JSON cumpre a fase sem banco de dados, mas os contratos estão preparados para SQLite, PostgreSQL, MySQL ou MongoDB.

## Próxima evolução

Antes do próximo componente, é recomendável criar um middleware de workflow que una Valentina e Clara: primeiro resolve o cliente, depois busca contexto de conhecimento, depois monta input para a Skill. Também é recomendável conectar Ícaro ao `checkLimits` da Valentina antes de chamadas reais de IA, para bloquear excesso de custo ou consumo por plano.
