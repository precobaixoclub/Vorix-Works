# Eduardo, Especialista em Planejamento Editorial

Eduardo é a nona Especialista real do Zuno e a primeira a ocupar a capability `editorial_planning`. Diferente de todas as Skills anteriores, ele não fica depois do João — ele fica antes. Eduardo recebe apenas a solicitação do usuário e decide a melhor estratégia de conteúdo antes de qualquer outra Skill começar a trabalhar.

Eduardo não cria copy, não cria imagem, não cria vídeo, não define layout, paleta ou tipografia (isso continua sendo exclusivo da Sofia e da Bianca) e não define ângulo, promessa central ou mensagens-chave (isso continua sendo exclusivo do João). Sua responsabilidade é decidir a **forma** do conteúdo, não o conteúdo em si.

## Responsabilidade

Eduardo recebe uma solicitação (pedido original do usuário, canal desejado e objetivo desejado, associados a um cliente) e devolve um Editorial Brief estruturado:

- `campaignObjective`: rótulo do objetivo de campanha (Conversão, Demonstração, Educação, Engajamento ou Awareness);
- `recommendedFormat`/`recommendedFormatLabel`: formato recomendado (`imagem_unica`, `carrossel`, `reels`, `video` ou `story`) e seu rótulo em texto livre, no mesmo vocabulário já usado por João/Sofia/Bianca/Pedro;
- `formatJustification`: justificativa da escolha de formato;
- `recommendedSlideCount`: quantidade recomendada de slides ou telas (quando o formato for carrossel ou Story);
- `recommendedVideoDurationSeconds`: duração recomendada em segundos (quando o formato for Reels/vídeo);
- `recommendedChannel`: canal recomendado (herda o canal já identificado por Arthur);
- `primaryEmotion`: emoção principal que o conteúdo deve transmitir;
- `narrativeStructure`: estrutura narrativa sugerida, como lista ordenada de etapas (ex.: `["Problema", "Solução", "Benefícios", "Comparação", "CTA"]`);
- `recommendedCta`: CTA recomendado;
- `depthLevel`, `contentComplexity`, `conversionPriority`: nível de profundidade, complexidade do conteúdo e prioridade de conversão;
- `recommendationsForJoao`: lista de recomendações estruturadas em texto livre para orientar o João;
- `aiSupportUsed`: indica se o Ícaro conseguiu aprimorar o brief nesta execução.

## Como Eduardo decide o formato ideal

A decisão é inteiramente determinística (mesma filosofia do João: heurística própria, sem depender de IA para decidir nada estrutural), em três passos:

1. **Objetivo de conteúdo** (`classifyContentObjective`): classifica o pedido em `conversao`, `demonstracao`, `educacao`, `engajamento` ou `awareness`, a partir de palavras-chave no pedido original e no objetivo desejado (ex.: "taxa zero", "desconto", "vender" → conversão; "apresentar", "demonstrar", "painel" → demonstração).
2. **Formato recomendado** (`classifyRecommendedFormat`): palavras explícitas de formato sempre vencem ("story"/"stories" → Story; "vídeo"/"reels"/"tiktok"/"shorts" → Reels; "carrossel"/"slides" → carrossel; "imagem única"/"post único" → imagem única). Na ausência de palavra explícita, um assunto de urgência/confirmação (ex.: "confirmação de presença", "RSVP", "lembrete") recomenda Story; um objetivo de demonstração recomenda Reels; um objetivo de conversão recomenda carrossel (uma narrativa em várias etapas aumenta retenção e percepção de valor antes do CTA); qualquer outro caso recomenda imagem única.
3. **Quantidade e duração**: um número explícito no texto (“5 slides”, “3 telas”, “30 segundos”) sempre vence. Sem número explícito, um carrossel usa o tamanho da própria estrutura narrativa escolhida (ex.: a estrutura de conversão tem 5 etapas → 5 slides), um Story usa 3 telas e um Reels/vídeo usa 30 segundos.

A estrutura narrativa, a emoção principal, o nível de profundidade, a complexidade e a prioridade de conversão são todos derivados do par (formato, objetivo de conteúdo) por tabelas de decisão dedicadas (`narrativeStructureFor`, `primaryEmotionFor`, `classifyDepthComplexityAndPriority`). O CTA recomendado usa o `preferredCtas` da marca na Clara quando disponível, com um `defaultCtaFor` heurístico como alternativa.

### Exemplos (validados em `tests/eduardo-editorial-planning.test.mjs`)

| Pedido do usuário | Formato | Detalhe | Objetivo | Estrutura narrativa |
| --- | --- | --- | --- | --- |
| "Quero falar sobre taxa zero." | Carrossel | 5 slides | Conversão | Problema → Solução → Benefícios → Comparação → CTA |
| "Quero apresentar o painel dos noivos." | Reels | 30 segundos | Demonstração | Hook → Demonstração → Benefícios → CTA |
| "Quero divulgar a confirmação de presença." | Story | 3 telas | Awareness | Abertura → Informação principal → CTA |

## Uso opcional do Ícaro

Assim como o João, o Ícaro é uma dependência opcional para Eduardo. Quando configurado, Eduardo pede uma tarefa `analysis` para aprimorar **apenas** `formatJustification`, `narrativeStructure`, `primaryEmotion` e `recommendationsForJoao` — nunca `recommendedFormat`, `recommendedSlideCount`, `recommendedVideoDurationSeconds`, `recommendedChannel` ou `recommendedCta`, que permanecem inteiramente heurísticos e previsíveis mesmo com IA disponível. Isso é reforçado tanto no prompt (constraints explícitas) quanto no código (`EduardoStrategyEnhancement` só declara esses quatro campos). Falha do Ícaro nunca falha a execução de Eduardo; apenas fica registrada em log (`AISupportFailed`) e `aiSupportUsed` permanece `false`.

## Integração com Valentina e Clara

Eduardo usa `ValentinaTenantPort` exatamente como o João (resolve por `tenantId` quando presente, senão por `clientId` via `getTenant` + `getClientContext`). Na Clara, Eduardo pede apenas os módulos relevantes para planejamento editorial — `BrandContext`, `AudienceContext` e `ContentContext` — um subconjunto menor do que os sete módulos que o João consulta, porque Eduardo decide forma, não mensagem, e não precisa de `ProductContext`, `CampaignContext`, `IdentityContext` ou `PublishingContext` para isso. Diferente do João, Eduardo não bloqueia a execução com `needs_more_context` quando a Clara devolve pouco contexto — todos os campos do brief têm um valor padrão heurístico razoável mesmo sem `BrandContext`/`AudienceContext`, para nunca travar o início do pipeline.

## Como o Editorial Brief influencia o João

`JoaoStrategyRequestInput` ganhou um campo opcional `editorialBrief?: JoaoEditorialBriefSummary` — mirror por convenção (ADR 0002) do formato real de `EduardoEditorialPlanningOutput`, sem importar o tipo de Eduardo. Quando presente:

- `format` da estratégia de João passa a ser `editorialBrief.recommendedFormatLabel` (em vez de `desiredFormat`, que Arthur ainda envia como valor neutro de fallback);
- `recommendedCta` passa a ser `editorialBrief.recommendedCta` (em vez do CTA da marca ou do heurístico próprio de João);
- uma observação é adicionada em `observations` citando o formato e a justificativa do Eduardo;
- o `sofiaBriefing.notes` ganha duas notas citando a estrutura narrativa e a emoção principal recomendadas.

Quando `editorialBrief` está ausente (ex.: João chamado isoladamente em teste unitário, sem Eduardo na cadeia), João mantém exatamente o comportamento heurístico que já tinha antes — nenhum teste existente de João precisou mudar por causa disso.

## Integração com Quality Feedback

Eduardo recebe `qualityFeedback?: QualityFeedbackPort` como dependência opcional (mesmo padrão do `IcaroBrainPort`). Antes de finalizar o brief, se configurado, consulta `getInsightsForClient(clientId)` e usa o resultado (`QualityFeedbackInsights`) só para acrescentar entradas em `recommendationsForJoao` — nunca para alterar `recommendedFormat`, `recommendedSlideCount`, `recommendedVideoDurationSeconds`, `recommendedChannel` ou `recommendedCta`, que continuam vindo inteiramente da heurística determinística. O campo `feedbackInformed` no output indica se o histórico influenciou alguma recomendação nessa execução. Falha na consulta nunca falha Eduardo (log `FeedbackHistoryFailed`). Detalhes completos, incluindo os três exemplos do pedido original (CTA, hashtags, vídeo vs. carrossel), em `docs/quality-feedback.md`.

## Integração com Arthur, Caio e Helena

Arthur deixou de decidir sozinho o formato final do conteúdo. A etapa "Planejamento editorial" (`skillCapability: "editorial_planning"`) é agora sempre a **primeira** etapa de todo `ExecutionPlan` (antes até da Estratégia de marketing), sem `dependsOn`. A etapa de Estratégia de marketing passa a depender dela e recebe dois `inputBindings` novos: o Editorial Brief inteiro (`editorialBrief`) e uma sobrescrita pontual de `desiredFormat` (lida de `recommendedFormatLabel`). As etapas de Direção de arte, Design de redes sociais e Geração de imagem também recebem uma sobrescrita do campo `format` da mesma forma — necessário porque esses três contratos têm campo `format` próprio, que não deriva de `joaoStrategy.format` — e a etapa de Geração de imagem recebe adicionalmente `imageCount` a partir de `recommendedSlideCount`. Todas essas sobrescritas usam o mesmo mecanismo genérico de `inputBindings`/`resolveStepInput` que já encadeia João → Sofia → Bianca → Pedro; Arthur e Caio nunca importam nenhum tipo da Skill do Eduardo (ADR 0002).

Isso significa que, na prática, Arthur planeja um plano com valores neutros de fallback (`format: "post único"`, `imageCount: 1`) e o Eduardo, ao executar como a primeira etapa real do workflow, sobrescreve esses valores para toda a pipeline de imagem antes que qualquer Skill downstream os leia.

### Limitação arquitetural conhecida (pipeline de vídeo vs. imagem)

Caio executa um **plano estático**: todas as etapas do `ExecutionPlan` são decididas por Arthur de uma vez, antes de qualquer Skill rodar, e Caio nunca insere ou remove etapas em resposta à saída de uma etapa já executada. Isso significa que a escolha estrutural entre a pipeline de imagem (Sofia → Bianca → Pedro) e a pipeline de vídeo (Bruno → Vanessa → Diego → Rafa) ainda precisa ser feita por Arthur, a partir do texto do comando, **antes** do Eduardo rodar — porque essa escolha decide quais etapas existem no plano, não apenas quais valores elas recebem.

Na prática, isso é inofensivo para os dois exemplos mais comuns citados no pedido original: comandos que já mencionam "vídeo", "reels", "tiktok" ou "roteiro" ativam a pipeline de vídeo em Arthur do mesmo jeito que antes, e o Eduardo então decide duração/estrutura/emoção dentro dela. Mas um comando como "Quero apresentar o painel dos noivos." (sem palavra de vídeo explícita) faz Eduardo recomendar Reels internamente enquanto Arthur, sem essa palavra-chave, monta a pipeline de imagem — o Editorial Brief é gerado corretamente (`recommendedFormat: "reels"`), mas o plano em si não muda de pipeline. Resolver isso de verdade exigiria Caio suportar replanejamento condicional depois de uma etapa concluir (fora do escopo desta mudança); ver "Recomendações futuras" no relatório desta sessão.

## Capability

`editorial_planning` é uma capability nova em `SKILL_CAPABILITIES`, sempre incluída no conjunto de capabilities obrigatórias que Arthur monta para qualquer plano de conteúdo (junto com `strategy`, `copywriting` e `quality_review`), analogamente a como essas três já eram tratadas.
