# Clara, Knowledge Center do Zuno

Clara é o Centro de Conhecimento do Zuno. Ela não é uma Skill, não é uma Especialista, não utiliza IA, não cria conteúdo, não cria imagens, não cria campanhas, não cria estratégias e não publica. Sua responsabilidade é armazenar, organizar, versionar, auditar e disponibilizar contexto para que os Especialistas trabalhem com informações completas e controladas.

## Arquitetura

Clara vive na camada de aplicação porque representa uma regra operacional central do Zuno: todo conhecimento pertence a Clara e deve ser acessado por contrato. Especialistas, Arthur, Helena, Caio e Ícaro não acessam arquivos, banco de dados, storage local ou qualquer fonte de conhecimento diretamente. O único contrato público para consumo de conhecimento é `ClaraKnowledgePort`.

O núcleo da Clara é `ClaraKnowledgeCenter`. Ele depende de `ClaraKnowledgeRepositoryPort`, `ClaraLoggerPort`, `ZunoEventRecorderPort`, gerador de IDs e relógio injetáveis. Essa composição mantém a lógica de conhecimento testável e independente de infraestrutura.

## Módulos de conhecimento

O conhecimento foi separado em módulos para evitar que um Especialista receba dados desnecessários. Os módulos são `BrandContext`, `BusinessContext`, `AudienceContext`, `ProductContext`, `CampaignContext`, `ContentContext`, `IdentityContext`, `PublishingContext`, `AIContext`, `WorkflowContext`, `FutureContext`, `MarketingContext`, `LearningContext`, `CompetitionContext`, `PlaybookContext` e `EditorialLibraryContext`.

`BrandContext` concentra marca, posicionamento, promessa, tom de voz, hashtags preferidas, hashtags proibidas, CTAs preferidos, palavras obrigatórias, palavras proibidas e links importantes. `BusinessContext` concentra negócio, segmento, descrição, objetivos de marketing, redes conectadas e configurações específicas do cliente. `AudienceContext` concentra público-alvo e personas. `ProductContext` concentra produtos, serviços, benefícios, diferenciais e faixa de preço. `CampaignContext` concentra campanhas, status, canais e objetivos. `ContentContext` concentra calendário editorial e histórico de publicações. `IdentityContext` concentra cores, fontes, logo, estilo visual e diretrizes. `PublishingContext` concentra redes sociais conectadas e regras de publicação. `AIContext` concentra preferências de IA, modelos preferidos ou proibidos, idioma, custo e criatividade. `WorkflowContext` concentra contexto usado em execuções específicas. `FutureContext` concentra ideias, experimentos e oportunidades futuras.

### Fase "inteligência de marketing" — nove módulos temáticos

A partir da v1.1 (e completada na v1.2 com a Biblioteca Editorial), a Clara passou a organizar seu vocabulário em nove módulos temáticos, pensados para que todas as Skills produzam conteúdo cada vez melhor com o tempo. Quatro deles são **extensões de campos opcionais em módulos que já existiam** (e que a maioria das Skills já consulta hoje, sem precisar de nenhuma mudança de código); cinco são **módulos inteiramente novos**, prontos para uma Skill pedir explicitamente no futuro — dois desses cinco (`LearningContext` e `EditorialLibraryContext`) já são alimentados automaticamente desde já, mesmo sem nenhuma Skill os consultar ainda. Essa divisão não é cosmética: como `requestContext` só entrega os módulos que cada Skill pede explicitamente na sua própria lista `modules: [...]`, estender um módulo já pedido é a única forma de conhecimento novo chegar a uma Skill **sem editar nenhuma Skill** — exatamente o requisito desta fase.

1. **Identidade da Marca** — extensão de `BrandContext` (já consultado por Eduardo, João, Sofia, Bruno, Vanessa, Diego, Lucas, Pedro e Rafa). Novos campos: `mission`, `vision`, `values`, `purpose`, `personality`, `archetypes`, `formalityLevel`, `preferredEmojis`, `forbiddenEmojis`, `communicationStyle`, `audienceAddressForm`. `toneOfVoice`, `mandatoryWords`, `forbiddenWords` e `positioning` já existiam.
2. **Produto** — extensão de `ProductContext` (já consultado por João). Novos campos: `features`, `objections`, `salesArguments`, `faq`, `limitations`, `comparisons`, `commonCustomerMistakes`, `competitiveAdvantages`. `benefits` e `differentiators` já existiam.
3. **Personas** — extensão de cada item de `AudienceContext.personas` (já consultado por João, Sofia, Bruno, Vanessa e Diego), permitindo múltiplas personas. Novos campos por persona: `age`, `lifeMoment`, `goals`, `fears`, `objections`, `emotionalTriggers`, `preferredLanguage`, `preferredChannels`, `funnelStage`. `name`, `description`, `pains` e `desires` (que cobre também "sonhos") já existiam.
4. **Marketing** — módulo novo, `MarketingContext`: `preferredCtas`, `hooks`, `storytellingFrameworks`, `mentalTriggers`, `openingStyles`, `closingStyles`, `captionStyles`, `preferredFormats`, `campaignObjectives`, `seasonalCalendar`, `usedThemes`, `forbiddenThemes`, `idealFrequency`.
5. **Direção Criativa** — extensão de `IdentityContext` (já consultado por João, Sofia, Bianca, Vanessa, Diego, Lucas, Pedro e Rafa). Novos campos: `visualReferences`, `composition`, `lighting`, `framing`, `photographyStyle`, `mockupGuidelines`, `iconography`, `backgroundStyles`, `layoutPatterns`, `approvedExamples`, `rejectedExamples`. `colors`, `fonts`, `logoUri`, `imageStyle` e `visualGuidelines` já existiam.
6. **Aprendizado** — módulo novo, `LearningContext`, alimentado **automaticamente** a partir do Quality Feedback (ver seção própria abaixo) — nenhuma Skill escreve aqui diretamente.
7. **Concorrência** — módulo novo, `CompetitionContext`: `competitors` (com pontos fortes/fracos), `opportunities`, `clientDifferentiators`.
8. **Playbook** — módulo novo, `PlaybookContext`: `brandRules`, `bestPractices`, `campaignExamples`, `approvedCampaigns`, `rejectedCampaigns`, `importantDecisions`. O requisito de "histórico de mudanças" **não precisa de campo próprio**: todo registro de qualquer módulo da Clara já tem `versions`/`history` genéricos (ver seções "Versionamento" e "Histórico" abaixo) — Playbook herda isso de graça.
9. **Biblioteca Editorial** — módulo novo, `EditorialLibraryContext`, adicionado na v1.2 (último da fase). Alimentado **automaticamente** a partir de Quality Feedback e Campaign Manager (ver seção própria abaixo) — nenhuma Skill escreve aqui diretamente.

Todos os campos novos são opcionais. Um registro criado antes desta evolução (ou um `payload` que só usa os campos antigos) continua válido sem nenhuma alteração — não há migração de dados nem checagem de schema em tempo de execução (ver "Armazenamento local").

### Integração automática com o Quality Feedback (Módulo 6 — Aprendizado)

Até esta fase, Quality Feedback e Clara eram sistemas totalmente independentes: o Quality Feedback nunca escrevia na Clara, e a Clara nunca lia o Quality Feedback. `src/application/knowledge/clara-learning-sync.ts` conecta os dois:

- `buildLearningContextPayload(clientId, report, now?)` é uma função pura que traduz um `QualityFeedbackReport` já calculado em um payload de `LearningContext` — nunca decide nada por conta própria, apenas espelha `bestRatedContent`, `worstRatedContent` (como `rejectedContent`, incluindo o comentário como motivo), `topRecurringComplaints` (como `recurringPatterns`) e `qualityOverTime` (como `qualityEvolution`), além de derivar `futureRecommendations` heurísticas a partir das reclamações mais recorrentes e do formato com pior média.
- `syncQualityFeedbackToClara({ clara, qualityFeedback, clientId, now? })` busca o relatório do cliente (`qualityFeedback.getReport({ clientId })`), monta o payload e grava um único `LearningContext` por cliente — cria na primeira sincronização, atualiza (gerando uma nova versão, com histórico) nas seguintes.
- O ponto de disparo é `recordQualityFeedback` na CLI (`src/interfaces/cli/run-command.ts`): toda vez que uma avaliação humana é registrada (`npm run zuno -- --rate ...`), a sincronização roda automaticamente logo em seguida. Uma falha na sincronização nunca impede o registro do feedback em si — é só um aviso no console.

Nenhuma Skill lê `LearningContext` hoje. Fica pronto para, no futuro, o Eduardo (ou outra Skill) pedir esse módulo explicitamente e usar o aprendizado acumulado para embasar recomendações — sem que isso mude nada no fluxo atual.

### Módulo 9 — Biblioteca Editorial

A partir da v1.2, a Clara ganhou um nono módulo, `EditorialLibraryContext`, o último da fase "inteligência de marketing" (ver `docs/clara-editorial-library-report.md` para o relatório completo, incluindo como Eduardo, João e Maria devem usá-lo). Assim como `LearningContext`, nenhuma Skill escreve aqui diretamente — o módulo é alimentado **automaticamente** sempre que uma execução recebe uma avaliação de Quality Feedback.

A Biblioteca Editorial **nunca substitui o Quality Feedback**: ela não recalcula nota nem agrega médias por conta própria — isso já é responsabilidade de `QualityFeedbackReport`/`LearningContext`. Ela **interpreta** o histórico de conteúdos já produzidos (tema, formato, CTA, emojis, gancho, framework de storytelling) cruzado com a avaliação recebida, e produz conhecimento editorial derivado: o que já foi feito, o que funcionou, o que não funcionou, o que evitar repetir.

Campos do payload: `producedContent` (histórico cumulativo de conteúdos produzidos, um item por execução avaliada — tema, formato, objetivo, CTA, emojis, gancho, storytelling, nota, data), `usedThemes`, `usedFormats`, `campaigns`, `objectives`, `ctas`, `emojis`, `hooks`, `storytellingPatterns` (listas derivadas de `producedContent`, sem duplicatas), `evaluations` (espelho leve de cada avaliação, por execução), `workingPatterns`/`nonWorkingPatterns` (observações textuais derivadas dos conteúdos campeões/de baixa performance), `repeatedSubjects` (temas usados 3 ou mais vezes), `temporarilyForbiddenSubjects` (temas com 2 ou mais avaliações cuja média fica abaixo do limiar de baixa performance do Quality Feedback, com o motivo já redigido), `championContent` (nota >= 8), `lowPerformanceContent` (nota abaixo do limiar de baixa performance) e `futureRecommendations` (texto acionável combinando os pontos anteriores).

Mecanismo de integração (`src/application/knowledge/clara-editorial-library-sync.ts`):

- `extractEditorialSignals(report)` lê o `WorkflowExecutionReport` já concluído por acesso a campo por nome (o mesmo padrão de duck typing que Caio já usa em `caio.executor.ts` para não importar tipos de nenhuma Skill): tema e formato do passo de `editorial_planning` (Eduardo), CTA e emojis do passo de `copywriting` (Maria), gancho e estrutura narrativa do passo de `video_script` (Bruno), quando existir.
- Quando a avaliação informa um `campaignId` conhecido, o Campaign Manager é consultado (`campaignManager.getCampaign`) e, se houver um `CampaignContentItem` cujo `executionPlanId` bate com o plano executado, o tema/CTA/objetivo desse conteúdo (mais autoritativo, por vir do planejamento da campanha) sobrepõe o sinal extraído do report.
- `syncEditorialLibrary({ clara, clientId, report, feedbackRecord, campaign?, now? })` monta a nova entrada de `producedContent`, mescla com o histórico já existente (substituindo a entrada anterior da mesma `executionId`, se houver — resincronizar não duplica) e recalcula todos os campos derivados a partir do histórico completo. Grava um único `EditorialLibraryContext` por cliente — cria na primeira sincronização, atualiza (com nova versão, com histórico) nas seguintes.
- O ponto de disparo é o mesmo do Módulo 6: `recordQualityFeedback` na CLI, logo após `syncQualityFeedbackToClara`. Uma falha na sincronização nunca impede o registro do feedback em si nem a sincronização do Módulo 6 — é só um aviso no console, de forma independente.

Diferença deliberada em relação ao Módulo 6: `LearningContext` é **substituído** a cada sincronização (sempre um retrato agregado e atual do Quality Feedback); `EditorialLibraryContext` é **cumulativo** (cada sincronização acrescenta ao histórico), porque detectar repetição de tema exige memória de tudo que já foi produzido, não só da avaliação mais recente.

## Contratos

O contrato público é `ClaraKnowledgePort`. Ele permite criar, atualizar, remover, consultar, listar, pesquisar, obter versão específica e solicitar contexto por escopo. O contrato interno de persistência é `ClaraKnowledgeRepositoryPort`. Nenhum Especialista deve receber `ClaraKnowledgeRepositoryPort`; essa porta é exclusiva para Clara conversar com infraestrutura.

## Versionamento

Toda criação gera versão 1. Toda atualização gera uma nova versão incremental. Toda exclusão lógica também gera uma nova versão, preservando auditoria. Cada versão armazena número, data, autor, motivo, payload completo e resumo da alteração. Isso permite recuperar o estado anterior de uma marca, campanha, produto ou qualquer outro módulo.

## Histórico

Cada registro possui histórico independente com ação, data, autor, motivo, versão e resumo da alteração. O histórico responde às perguntas quem alterou, quando alterou, o que foi alterado e por qual motivo. Nesta fase o histórico é simples e local, mas já está modelado para auditoria futura.

## Busca e consultas

Clara permite busca por cliente, módulo, marca, campanha, publicação, produto, serviço, workflow, texto e palavras-chave. A busca textual normaliza caixa, acentos e pontuação para facilitar pesquisa local. `requestContext` permite entregar contexto filtrado para um Especialista, por exemplo apenas `IdentityContext` para um futuro Especialista visual ou apenas `CampaignContext` para um futuro Especialista de análise de campanhas.

## Armazenamento local

A infraestrutura possui `InMemoryClaraKnowledgeRepository` para testes e execução rápida, além de `LocalJsonClaraKnowledgeRepository` para persistência local em arquivo JSON. Isso cumpre a fase sem banco de dados e mantém o storage atrás de uma porta. Quando o Zuno evoluir para SaaS, o adapter JSON poderá ser substituído por banco relacional, documento, cache distribuído ou armazenamento multi-tenant sem alterar os Especialistas.

## Logs

Clara registra logs para cadastro, atualização, exclusão, pesquisa, consulta, entrega de contexto e criação de versão. A implementação em memória `InMemoryClaraLogger` permite auditoria local e testes.

## Eventos

Clara emite `KnowledgeCreated`, `KnowledgeUpdated`, `KnowledgeDeleted`, `KnowledgeRequested`, `KnowledgeDelivered` e `KnowledgeVersionCreated`. Esses eventos já preparam a arquitetura para futuro Event Bus, auditoria centralizada, notificações, sincronização com painel web ou trilhas de compliance.

## Integração com Arthur

Arthur não armazena conhecimento e não precisa conhecer armazenamento. Em um fluxo futuro, uma camada de aplicação poderá consultar Clara antes de chamar Arthur, entregando contexto resumido para planejamento. Se Arthur vier a consultar Clara diretamente, deverá fazer isso apenas por `ClaraKnowledgePort`, sem persistir ou modificar conhecimento por conta própria.

Arthur obtém o cliente por Valentina, não por Clara. Clara usa o `clientId` resolvido por Valentina para entregar conhecimento daquele cliente.

## Integração com Caio

Caio não armazena conhecimento. Em fluxos futuros, Caio poderá receber um `ExecutionPlan` com etapas que exigem contexto e solicitar esse contexto por uma porta de aplicação antes de chamar Helena. A responsabilidade de manter versões e histórico permanece na Clara.

## Integração com Helena

Helena não armazena conhecimento e não consulta arquivos. Ela continua responsável por localizar e executar Skills. Quando uma Skill precisar de contexto do cliente, a própria Skill Especialista deverá usar `ClaraKnowledgePort`, ou Caio deverá preparar o contexto antes da execução, dependendo do desenho do caso de uso.

## Integração com Ícaro

Ícaro não armazena conhecimento e não consulta Clara nesta versão. Ele continua responsável apenas por comunicação com IA. Preferências de IA por cliente vivem em `AIContext`, dentro da Clara, e poderão ser usadas por Especialistas ou por uma camada de aplicação para montar solicitações ao Ícaro.

## Integração com Especialistas

Especialistas não devem guardar conhecimento próprio de clientes, marcas, produtos, campanhas ou histórico. Quando precisarem de contexto, devem solicitar à Clara por `ClaraKnowledgePort`, informando cliente, módulos e escopo necessário. Clara devolve apenas o contexto solicitado, reduzindo acoplamento e vazamento de dados desnecessários. `tests/clara-knowledge-center.test.mjs` cobre isso com dois testes: um confirma que nenhuma das 12 Skills (nem Arthur/Caio/Helena/Ícaro) importa o repositório da Clara ou `node:fs`/`fs/promises` diretamente; outro confirma que toda Skill que depende da Clara o faz exclusivamente via `ClaraKnowledgePort` (nunca importando `ClaraKnowledgeCenter`, a implementação concreta).

## Próxima evolução

Antes da próxima Especialista, é recomendável criar um caso de uso de composição de contexto, que receba uma etapa de workflow, consulte Clara, monte o briefing estruturado e só então entregue a entrada à Skill. Isso deixará Maria e futuras Especialistas ainda mais limpas, porque elas receberão contexto já filtrado e auditado.

Os cinco módulos novos (`MarketingContext`, `LearningContext`, `CompetitionContext`, `PlaybookContext`, `EditorialLibraryContext`) existem na Clara mas nenhuma Skill os pede ainda — isso é intencional nesta fase (ver `docs/clara-knowledge-modules-report.md` e `docs/clara-editorial-library-report.md` para o racional completo). `LearningContext` e `EditorialLibraryContext` já são alimentados automaticamente a cada avaliação de Quality Feedback, mesmo sem nenhuma Skill os consultar ainda — o conhecimento se acumula desde já, pronto para o dia em que Eduardo, João ou Maria passarem a pedi-los. Quando isso acontecer, basta adicionar o nome do módulo à lista `modules: [...]` da própria Skill — nenhuma mudança na Clara é necessária para isso.

Com a Biblioteca Editorial, o Centro de Conhecimento da Clara é considerado **concluído** nesta fase: nove módulos temáticos, cobrindo identidade, produto, público, marketing, direção criativa, aprendizado, concorrência, playbook e histórico editorial — arquitetura, isolamento e compatibilidade retroativa preservados em todas as evoluções.
