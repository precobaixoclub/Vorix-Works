# Bianca, Especialista em Layout e Composição Visual

Bianca é a Skill real do Zuno responsável por ocupar a capability `social_media_design`, inserida no `ExecutionPlan` do Arthur entre a etapa "Direção de arte" (Sofia) e a etapa "Geração de imagem" (Pedro). Ela nasceu de uma separação de responsabilidades: Sofia acumulava tanto a direção de arte quanto decisões de layout, o que gerava peças visualmente fracas. Bianca existe exclusivamente para transformar a direção de arte da Sofia em um layout extremamente profissional e detalhado, que o Pedro executa sem precisar tomar nenhuma decisão de design por conta própria — ela é a **referência definitiva de layout e composição visual do Zuno**: toda decisão estrutural da peça (grid, hierarquia, posicionamento, alinhamento, composição, espaçamento, tipografia, consistência visual e organização dos elementos) é centralizada aqui, nunca no Pedro.

Bianca não cria estratégia de marketing, não escreve copy, não gera imagens e não define conceito criativo, identidade visual, paleta de cores, tipografia, moodboard, estilo visual ou a emoção que o material deve transmitir — tudo isso continua sendo responsabilidade exclusiva da Sofia, apenas repassado por Bianca para dar contexto ao Pedro. Bianca também não publica, não cria campanhas, não consulta métricas, não acessa storage diretamente e não conversa diretamente com OpenAI, Gemini, Claude ou qualquer provider de IA. Bianca também não executa nem chama outra Skill diretamente — isso continua sendo papel exclusivo de Arthur, Helena e Caio.

Bianca conhece apenas três abstrações: `ValentinaTenantPort` para identificar o cliente, `ClaraKnowledgePort` para obter identidade visual (logo) e regras de publicação e, de forma opcional, `IcaroBrainPort` para pedir apoio de IA na hora de aprimorar grid, hierarquia visual, aplicação de cor, estilo de componentes, de ilustração e de mockup.

## Responsabilidade

Bianca recebe a direção de arte completa da Sofia e devolve uma especificação de design extremamente detalhada: grid, hierarquia visual, escala tipográfica (tamanho de títulos, subtítulos, texto e CTA), aplicação de cor, sistema de espaçamento, estilo de cards, ícones, botões, boxes, separadores, sombras e bordas, estilo de ilustrações e de mockups, posicionamento de logo, posição e nível de destaque do CTA (geral e por slide), composição dedicada para capa de Reels quando o formato pedir, regras dedicadas de contraste visual, diretrizes de acessibilidade visual, regras de padronização visual sempre presentes, layout de cada slide (ponto focal, peso visual, alinhamento, margens, área de respiro, elementos de apoio, o que deve chamar mais atenção e o que deve ficar em segundo plano), e a sequência visual/consistência do carrossel quando aplicável — pronta para o Pedro transformar em imagens finais.

## Contrato de entrada

A entrada de Bianca é `BiancaDesignRequestInput`:

- `clientId` ou `tenantId` (pelo menos um dos dois é obrigatório);
- `originalRequest`: o pedido original do usuário, em texto livre;
- `joaoStrategy`: um resumo da estratégia do João (`BiancaJoaoStrategySummary`) com `angle`, `centralPromise`, `keyMessages` e `recommendedCta` — usado para planejar quantos slides o carrossel precisa e onde cada mensagem/CTA deve aparecer;
- `sofiaDirection`: a direção de arte completa produzida pela Sofia (`BiancaSofiaDirectionSummary`);
- `sofiaBriefing`: o briefing que a própria Sofia já monta pensando em Bianca (`BiancaSofiaBriefing`);
- `channel`: canal desejado para esta peça (mesmo vocabulário de canais já usado pelas demais Skills);
- `format`: formato desejado, em texto livre (por exemplo "carrossel", "post único");
- `workflowContext`: contexto opcional adicional vindo do workflow.

Diferente de Sofia (que recebe `joaoStrategy` inteiro) e de Pedro (que não recebe `joaoStrategy` nenhum), Bianca recebe apenas o subconjunto de campos de João que ela realmente precisa para planejar a sequência de slides — reforçando que ela não deve reinterpretar a estratégia de marketing, apenas usá-la como insumo mecânico para o layout.

## Contrato de saída

Bianca devolve `BiancaDesignOutput`, contendo:

- `designConcept`: como a especificação de design traduz o conceito visual da Sofia em um layout escaneável;
- `visualConcept`, `recommendedStyle`, `suggestedPalette`, `recommendedFormat`, `recommendedAspectRatio`: repassados da Sofia sem reinterpretação, para que o documento entregue ao Pedro seja autocontido;
- `gridSystem`, `visualHierarchyStrategy`, `typographyScale` (`headline`, `subheadline`, `body`, `caption`, `cta`), `colorApplication`, `spacingSystem`;
- `componentStyle`: lista descrevendo cards, ícones, botões, boxes, separadores, sombras e bordas;
- `illustrationStyle`, `mockupStyle`, `logoPlacement`;
- `ctaPlacement`: posição e nível de destaque do CTA na peça como um todo (política geral — cada slide pode ter seu próprio `ctaPlacement`);
- `reelsCoverComposition`: composição específica para capa de Reels — presente apenas quando o formato pede uma capa de Reels, ausente nos demais casos;
- `contrastRules`: regras dedicadas de contraste (texto/fundo, CTA/fundo), distintas de `colorApplication` (que descreve a aplicação da paleta, não o contraste em si);
- `accessibilityGuidelines`: diretrizes dedicadas de acessibilidade visual (leitura por daltonismo, tamanho mínimo de fonte, uso de texto alternativo);
- `visualStandardizationRules`: regras de padronização visual sempre presentes — para carrossel, cobre consistência entre slides; para peça única, cobre consistência com as demais peças da marca;
- `slides`: lista de `BiancaSlideDesign`, um por slide, cada um com `role`, `focalPoint`, `visualWeightOrder`, `headlineSize`, `subheadlineSize`, `bodyTextSize`, `alignment`, `margins`, `breathingRoom`, `supportingElements`, `emphasis`, `secondaryElements`, `logoPlacement` e `ctaPlacement` (opcional — presente apenas em slides que têm CTA);
- `carouselFlow`: presente apenas quando o formato é um carrossel, com `totalSlides`, `readingFlow`, `sequenceNotes` e `consistencyRules`;
- `designConstraints`, `designRisks`, `observations`, `nextSteps`;
- `pedroBriefing`: briefing estruturado e detalhado pronto para o Pedro (`BiancaPedroBriefing`);
- `aiSupportUsed`: indica se o Ícaro conseguiu aprimorar a especificação nesta execução.

Quando a solicitação é inválida ou a Valentina não encontra o cliente, Bianca devolve `status: "failed"`. Quando a Clara não tem `IdentityContext` registrado, Bianca devolve `status: "needs_more_context"` — diferente de Sofia e Pedro (que toleram a ausência de um dos dois módulos, `IdentityContext` ou `BrandContext`), Bianca depende só de `IdentityContext` (para saber se existe logo real) e por isso exige esse único módulo diretamente.

## Fluxo interno

1. Valida a solicitação recebida (cliente, pedido original, canal, formato, e presença mínima de `joaoStrategy`, `sofiaDirection` e `sofiaBriefing`).
2. Consulta a Valentina para resolver o cliente, usando `getClientContext` quando recebe `tenantId` ou `getTenant` seguido de `getClientContext` quando recebe apenas `clientId`.
3. Consulta a Clara por `requestContext`, pedindo apenas os módulos `IdentityContext` e `PublishingContext` — o subconjunto mais estreito entre todos os Especialistas de conteúdo visual, porque Bianca não precisa de marca, público ou conteúdo para decidir layout, apenas do logo real (quando existir) e do fluxo de aprovação.
4. Avalia se `IdentityContext` está presente. Se não estiver, Bianca interrompe com `needs_more_context`.
5. Monta uma especificação de design base de forma determinística: grid e sistema de espaçamento adequados ao formato, estratégia de hierarquia visual derivada do ângulo estratégico do João, escala tipográfica qualitativa (não pixels exatos, já que nenhuma ferramenta de design real está por trás desta heurística), aplicação de cor derivada da paleta da Sofia, estilo de componentes (cards, ícones, botões, boxes, separadores, sombras, bordas), estilo de ilustração e de mockup, posicionamento de logo (reservando a área mesmo sem um logo real cadastrado), e o layout de cada slide — gancho, mensagens de apoio (uma por mensagem-chave do João) e fechamento com CTA, para carrosséis; um único slide para peças que não são carrossel.
6. Se o Ícaro estiver configurado, monta um prompt e pede uma tarefa `analysis` para aprimorar apenas grid, estratégia de hierarquia visual, aplicação de cor, estilo de componentes, estilo de ilustração, estilo de mockup, regras de contraste, diretrizes de acessibilidade visual e composição de capa de Reels — nunca conceito, paleta, tipografia ou emoção, que continuam sendo decisão da Sofia. Se o Ícaro não estiver configurado ou falhar, Bianca segue com a especificação heurística e registra o ocorrido nos logs, sem falhar a execução.
7. Monta o `pedroBriefing`, reunindo toda a especificação de design finalizada em um documento autocontido já pensado para o Pedro.
8. Devolve a especificação de design completa como saída estruturada e um artefato do tipo `plan`.

## Como Bianca planeja slides e carrossel

Quando o `format` indica um carrossel, Bianca usa a quantidade de `keyMessages` do João para calcular o número de slides (entre 3 e 10: um slide de gancho, um slide por mensagem principal, e um slide de fechamento com CTA), reaproveitando a mesma heurística de contagem que a Sofia usava antes desta separação de responsabilidades — só que agora aplicada ao layout, não à direção de arte. Cada slide recebe um papel (`role`) explícito, um ponto focal, uma ordem de peso visual, tamanhos qualitativos de título/subtítulo/texto, alinhamento, margens, área de respiro, elementos de apoio, o que deve ganhar destaque e o que deve ficar em segundo plano — e `ctaPlacement` nos slides que efetivamente têm CTA (o slide único e o slide de fechamento do carrossel; os slides de gancho e de mensagem de apoio não têm CTA, por isso o campo fica ausente neles). O `carouselFlow` resultante documenta o fluxo de leitura e as regras de consistência específicas de sequenciamento (mesma paleta, tipografia, posição de logo, margem e grid em todos os slides); `visualStandardizationRules`, sempre presente independente do formato, documenta a padronização visual de forma mais ampla (incluindo o estilo do CTA quando há mais de um slide). Para peças que não são carrossel, Bianca monta um único slide cobrindo a peça inteira.

## Composição por formato

Além do grid e da hierarquia geral, Bianca detecta quando o `format` pede uma capa de Reels (menções a "reels cover"/"capa de reels"/"reels") e preenche `reelsCoverComposition` com orientação específica: manter os elementos essenciais na metade superior do quadro, fora da área inferior que o próprio Instagram sobrepõe com ícones de interação e legenda. Para os demais formatos (feed, stories, carrossel), a composição já é coberta pelas decisões gerais de grid, proporção (`recommendedAspectRatio`, herdada da Sofia) e pelo layout por slide — não há um campo dedicado separado para cada um desses três formatos porque a `BiancaDesignCore` inteira (grid, hierarquia, slides) já varia de acordo com eles.

## Uso opcional do Ícaro

Assim como João e Sofia, e ao contrário da Maria e do Pedro (para quem o Ícaro é obrigatório), o Ícaro é uma dependência opcional para Bianca — o manifesto declara `IcaroBrainPort` com `optional: true`. A especificação de design de Bianca é construída de forma determinística a partir da direção da Sofia e do conhecimento devolvido pela Clara; o Ícaro apenas aprimora alguns campos de layout quando disponível e bem-sucedido. Falha do Ícaro nunca falha a execução de Bianca: fica registrada em log (`AISupportFailed`) e o campo `aiSupportUsed` permanece `false`.

## Integração com Valentina

Bianca usa exclusivamente `ValentinaTenantPort.getClientContext` e `ValentinaTenantPort.getTenant`, com a mesma lógica de resolução de cliente usada pelas demais Skills.

## Integração com Clara

Bianca usa exclusivamente `ClaraKnowledgePort.requestContext`, informando o `clientId` resolvido pela Valentina, os módulos `IdentityContext` e `PublishingContext`, e um `requester` do tipo `specialist` identificado pelo id do manifesto de Bianca. Bianca nunca cria, atualiza ou remove conhecimento na Clara.

## Integração com Ícaro

Quando configurado, Bianca usa exclusivamente `IcaroBrainPort.request` com `taskType: "analysis"` — pelo mesmo motivo que Sofia usa `"analysis"`: Bianca nunca deve pedir a geração de uma imagem de verdade, apenas o aprimoramento textual de decisões de layout. O prompt reforça nas `constraints` que o Ícaro não deve alterar conceito criativo, paleta, tipografia ou emoção. Bianca nunca importa um Provider de IA concreto nem qualquer SDK externo.

## Integração com Arthur, Caio e Helena

Arthur passou a reservar, entre as etapas "Direção de arte" e "Geração de imagem", uma nova etapa "Design de redes sociais" com `skillCapability: "social_media_design"`, incluída no plano sempre que `art_direction` também é necessária. O manifesto de Bianca declara `capabilities: ["social_media_design"]`, então ela ocupa exatamente essa etapa. O catálogo de planos da Valentina (`valentina-plan-catalog.ts`) libera `social_media_design` no plano PRO e superiores, no mesmo grupo de `art_direction` e `image_generation`. Helena descobre o manifesto de Bianca, valida, carrega a Skill e a executa somente quando solicitada por Arthur (via Caio), seguindo exatamente o mesmo padrão de pasta (`src/skills/bianca-social-media-design/`, `skill.manifest.json`, `index.ts` exportando `createSkill`) já usado por todas as Skills anteriores — nenhuma mudança foi necessária em `FileSystemSkillDiscovery`, `FileSystemSkillModuleLoader` ou `scripts/copy-skill-manifests.mjs` para que Bianca fosse descoberta.

## Como o output de Bianca prepara o trabalho do Pedro

O campo `pedroBriefing` de Bianca reúne toda a especificação de design finalizada — grid, hierarquia, tipografia, cor, componentes, ilustração, mockup, logo e o layout completo de cada slide — em um único objeto autocontido, incorporando também o conceito, paleta, estilo e formato definidos pela Sofia, para que o Pedro dependa de um único documento completo em vez de dois. Por respeito ao isolamento entre Skills (ADR 0002), Bianca não importa nenhum tipo do Pedro — ela define seu próprio tipo `BiancaPedroBriefing`, e o Pedro define seu próprio tipo `PedroBiancaBriefing`, espelhando por convenção o mesmo formato, campo a campo. Esse espelhamento é verificado automaticamente pelo teste `organic-cycle.e2e.test.mjs` (`assertMirroredContractsDoNotDrift`), que compara as chaves de nível superior dos dois tipos e falha caso um dos lados mude sem o outro acompanhar.

## Testes

`tests/bianca-social-media-design.test.mjs` cobre: validade do manifesto, resolução de cliente pela Valentina, consulta à Clara com os módulos corretos, execução com e sem Ícaro (incluindo falha do Ícaro sem interromper a execução), geração completa da especificação de design, planejamento de múltiplos slides para carrossel e de um único slide para peças avulsas, montagem do briefing para o Pedro, tratamento de cliente não encontrado e de contexto insuficiente, validação da solicitação, logs e eventos esperados, pureza das funções `buildBaselineDesign`/`buildPedroBriefing`, ausência de imports de providers de IA concretos, ausência de chamadas diretas a outra Skill — e, desta rodada em diante, os cinco campos novos: tamanho e posição/destaque de CTA (geral e por slide), composição de capa de Reels (presente só quando o formato pede, ausente nos demais), regras dedicadas de contraste, diretrizes de acessibilidade visual, regras de padronização visual sempre presentes, e o aprimoramento desses campos via Ícaro.
