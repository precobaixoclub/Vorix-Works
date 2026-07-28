# Relatório técnico — Eduardo, Especialista em Planejamento Editorial

Implementação da nona Especialista real do Zuno: Eduardo, responsável pela capability `editorial_planning`, sempre a primeira etapa de todo `ExecutionPlan` — antes do João. Eduardo recebe apenas a solicitação do usuário e decide a melhor estratégia de conteúdo (formato, quantidade de slides/telas, duração de vídeo, emoção principal, estrutura narrativa, CTA, profundidade, complexidade e prioridade de conversão), entregando um Editorial Brief estruturado que orienta o João. Como parte desta mudança, Arthur deixou de decidir sozinho o formato final do conteúdo.

## Arquivos criados

**Skill (Eduardo):**
- `src/skills/eduardo-editorial-planning/eduardo-editorial-planning.types.ts` — tipos do Editorial Brief (`EduardoEditorialPlanningOutput`), input, enums de formato/objetivo/profundidade/complexidade/prioridade.
- `src/skills/eduardo-editorial-planning/eduardo-log.contract.ts` — `EduardoLogAction`/`EduardoLogEntry`/`EduardoLoggerPort`.
- `src/skills/eduardo-editorial-planning/eduardo.manifest.ts` e `skill.manifest.json` — manifesto (capability `editorial_planning`, dependências Valentina/Clara obrigatórias, Ícaro opcional).
- `src/skills/eduardo-editorial-planning/eduardo-editorial-planning.skill.ts` — implementação completa (heurística determinística + apoio opcional do Ícaro).
- `src/skills/eduardo-editorial-planning/index.ts` — barrel exports + `createSkill` (padrão exigido pelo `FileSystemSkillModuleLoader`).

**Documentação:**
- `docs/eduardo-editorial-planning.md` — documentação completa da Skill (responsabilidade, algoritmo de decisão, exemplos, integração).
- `docs/eduardo-editorial-planning-report.md` — este relatório.

**Testes:**
- `tests/eduardo-editorial-planning.test.mjs` — 21 testes novos.

## Arquivos alterados

**Domínio:**
- `src/domain/skills/skill-capability.contract.ts` — nova capability `editorial_planning`.

**Aplicação:**
- `src/application/events/zuno-event.contract.ts` — 5 eventos novos (`EditorialPlanningStarted`, `EditorialPlanningContextLoaded`, `EditorialPlanningGenerated`, `EduardoBriefingCreated`, `EditorialPlanningFailed`).
- `src/application/orchestration/arthur.orchestrator.ts`:
  - `DEFAULT_CAPABILITIES` e o conjunto sempre-obrigatório em `detectRequiredCapabilities` passam a incluir `editorial_planning`.
  - Nova etapa "Planejamento editorial" (`skillCapability: "editorial_planning"`), sempre a primeira do plano, sem `dependsOn`.
  - Etapa de Estratégia agora depende dela e recebe dois `inputBindings` novos: `editorialBrief` (saída inteira do Eduardo) e sobrescrita de `desiredFormat` (lida de `recommendedFormatLabel`).
  - Etapas de Direção de arte, Design de redes sociais e Geração de imagem recebem a mesma sobrescrita do campo `format` (necessário porque esses três contratos têm campo `format` próprio, que não deriva de `joaoStrategy.format`); Geração de imagem recebe adicionalmente `imageCount` a partir de `recommendedSlideCount`.
  - Etapas de Roteiro de vídeo e Revisão recebem `workflowContext.editorialBrief` para visibilidade adicional (sem alterar seus contratos tipados).
  - Removido `detectImageCount` (a decisão de quantidade passou a ser do Eduardo). `detectFormat` foi reduzido: só decide o rótulo técnico da pipeline de vídeo (tiktok/shorts/reels) — decisão estrutural que ainda precisa existir antes do Eduardo rodar (ver "Decisões arquiteturais").

**Skill (João):**
- `src/skills/joao-marketing-strategy/joao-marketing-strategy.types.ts` — novo tipo `JoaoEditorialBriefSummary` (mirror por convenção de `EduardoEditorialPlanningOutput`) e campo opcional `editorialBrief` em `JoaoStrategyRequestInput`.
- `src/skills/joao-marketing-strategy/joao-marketing-strategy.skill.ts` — `buildBaselineStrategy` usa `editorialBrief.recommendedFormatLabel`/`recommendedCta` quando presentes (com fallback ao comportamento antigo); `buildObservations` e `buildSofiaBriefing` passam a citar a justificativa, a estrutura narrativa e a emoção principal do Eduardo quando presentes.

**Scripts e testes:**
- `scripts/verify-skills-discovery.mjs` — Eduardo adicionado a `EXPECTED_SKILLS`.
- `tests/skills-discovery.test.mjs` — Eduardo incluído nas listas de descoberta real e novo teste de capability `editorial_planning`.
- `tests/arthur.orchestrator.test.mjs` — testes que assumiam Arthur decidindo `format`/`imageCount` a partir do texto foram reescritos para validar a nova arquitetura (Eduardo sempre primeiro, valores neutros de fallback, `inputBindings` corretos); 2 testes novos (Eduardo primeiro na pipeline de imagem e na de vídeo).
- `tests/joao-marketing-strategy.test.mjs` — 1 teste novo validando a sobrescrita de formato/CTA via `editorialBrief` (sem alterar nenhum teste existente).
- `tests/organic-cycle.e2e.test.mjs` — Eduardo incluído na composição real de Skills/Helena; sequência de capabilities esperada, sequência de chamadas ao Ícaro e lista de pastas verificadas (`assertNoDirectSkillCalls`) atualizadas; novas asserções sobre a saída do Eduardo e sobre `joaoOutput.format === eduardoOutput.recommendedFormatLabel`.
- `package.json` — `tests/eduardo-editorial-planning.test.mjs` adicionado ao script `test`.

**Documentação:**
- `README.md` — novo parágrafo do Eduardo; parágrafo do Arthur/Caio/Helena atualizado (Arthur não decide mais formato sozinho); parágrafo do João atualizado.
- `docs/architecture.md` — menção ao Eduardo na descrição da camada de aplicação e na lista de Skills.
- `docs/growth-roadmap.md` — novo parágrafo sobre a introdução do Eduardo e a limitação arquitetural conhecida.
- `docs/joao-marketing-strategy.md` — documentação do campo `editorialBrief`.

## Decisões arquiteturais

1. **Eduardo é sempre a primeira etapa, não uma capability condicional como as demais.** Assim como `strategy`, `copywriting` e `quality_review` já eram sempre incluídas em todo plano de conteúdo, `editorial_planning` entrou nesse mesmo conjunto obrigatório — nenhum plano de conteúdo é montado sem planejamento editorial prévio.

2. **Arthur passa a montar planos com valores neutros de fallback (`format: "post único"`, `imageCount: 1`), nunca mais heurísticas de texto para decidir o formato final.** O Editorial Brief do Eduardo sobrescreve esses valores em runtime, pelo mesmo mecanismo genérico de `inputBindings`/`resolveStepInput` que Caio já usa para encadear João → Sofia → Bianca → Pedro — nenhuma mudança no motor de execução foi necessária.

3. **Limitação arquitetural aceita conscientemente: a escolha estrutural entre pipeline de imagem e pipeline de vídeo continua em Arthur, decidida do texto do comando, antes do Eduardo rodar.** Caio executa um plano estático — todas as etapas são decididas de uma vez por Arthur e Caio nunca insere ou remove etapas em resposta à saída de uma etapa já concluída. Isso significa que, embora o Eduardo já saiba recomendar "Reels" para um pedido como "Quero apresentar o painel dos noivos." (sem a palavra "vídeo" no texto), o plano em si continua sendo o de imagem se Arthur não detectou uma palavra-chave de vídeo. Resolver isso de verdade exigiria Caio suportar replanejamento condicional após a conclusão de uma etapa — deliberadamente fora do escopo desta mudança, documentado em `docs/eduardo-editorial-planning.md` e no roadmap.

4. **Isolamento entre Skills preservado (ADR 0002).** Eduardo não importa nenhum tipo de João, e João não importa nenhum tipo de Eduardo — `JoaoEditorialBriefSummary` é um mirror por convenção do formato real de `EduardoEditorialPlanningOutput`, no mesmo padrão já usado por `JoaoSofiaBriefing`/`SofiaJoaoBriefing`, `SofiaBiancaBriefing`/`BiancaSofiaBriefing` e `BiancaPedroBriefing`/`PedroBiancaBriefing`. Arthur e Caio também não importam nenhum tipo de Eduardo — toda a integração acontece por `skillCapability`, nomes de campo em texto (`inputBindings`) e o campo opcional e genérico `editorialBrief`.

5. **Ícaro só aprimora o que é seguro aprimorar.** Assim como o João nunca deixa o Ícaro decidir canal/formato/objetivo, Eduardo restringe o apoio de IA a `formatJustification`, `narrativeStructure`, `primaryEmotion` e `recommendationsForJoao` — nunca `recommendedFormat`, `recommendedSlideCount`, `recommendedVideoDurationSeconds`, `recommendedChannel` ou `recommendedCta`. Isso é reforçado tanto nas `constraints` do prompt quanto estruturalmente (`EduardoStrategyEnhancement` só declara esses quatro campos) — mesmo que o Ícaro tentasse devolver outros campos, `mergeStrategyEnhancement` os ignora.

6. **Eduardo nunca bloqueia o pipeline por falta de contexto.** Diferente do João (que devolve `needs_more_context` sem `BrandContext`/`AudienceContext`), todo campo do Editorial Brief tem um valor padrão heurístico razoável — Eduardo sempre completa, mesmo com Clara vazia, para nunca travar o início do workflow logo na primeira etapa.

## Como Eduardo decide o formato ideal

Decisão inteiramente determinística, em três passos (ver `docs/eduardo-editorial-planning.md` para o detalhe completo):

1. Classifica o pedido em um objetivo de conteúdo (`conversao`, `demonstracao`, `educacao`, `engajamento` ou `awareness`) por palavras-chave.
2. Decide o formato: palavra explícita de formato no texto sempre vence; sem ela, um assunto de urgência (RSVP/confirmação de presença/lembrete) recomenda Story, um objetivo de demonstração recomenda Reels, um objetivo de conversão recomenda carrossel, e qualquer outro caso recomenda imagem única.
3. Decide quantidade/duração: um número explícito no texto sempre vence; sem ele, o carrossel usa o tamanho da própria estrutura narrativa escolhida, o Story usa 3 telas e o Reels usa 30 segundos.

Estrutura narrativa, emoção principal, profundidade, complexidade e prioridade de conversão vêm de tabelas de decisão dedicadas a partir do par (formato, objetivo).

## Como influencia o João

`JoaoStrategyRequestInput.editorialBrief` (opcional) passa a sobrescrever `format` e `recommendedCta` da estratégia de João, e alimenta `observations` e `sofiaBriefing.notes` com a justificativa, a estrutura narrativa e a emoção principal — sem quebrar nenhum uso existente de João sem o brief (comportamento heurístico antigo preservado como fallback).

## Como evita acoplamento entre Skills

Nenhum import cruzado entre Eduardo e João (nem entre Eduardo e Arthur/Caio). Toda comunicação acontece por: capability (`editorial_planning`), `inputBindings` declarativos no `ExecutionPlan` (nomes de campo em texto, nunca tipos), e um tipo espelhado por convenção (`JoaoEditorialBriefSummary`). O teste `assertNoDirectSkillCalls` em `tests/organic-cycle.e2e.test.mjs` passou a cobrir também a pasta de Eduardo, confirmando estaticamente (via leitura do código-fonte) que ele só importa `../../application`, `../../domain`, `../../shared` ou arquivos do próprio diretório.

## Exemplos de decisões (validados em teste)

| Pedido | Formato | Detalhe | Objetivo | Estrutura narrativa |
| --- | --- | --- | --- | --- |
| "Quero falar sobre taxa zero." | Carrossel | 5 slides | Conversão | Problema → Solução → Benefícios → Comparação → CTA |
| "Quero apresentar o painel dos noivos." | Reels | 30 segundos | Demonstração | Hook → Demonstração → Benefícios → CTA |
| "Quero divulgar a confirmação de presença." | Story | 3 telas | Awareness | Abertura → Informação principal → CTA |
| "Quero falar sobre taxa zero em 7 slides." | Carrossel | 7 slides (número explícito vence) | Conversão | Problema → Solução → Benefícios → Comparação → CTA |

## Testes criados

**`tests/eduardo-editorial-planning.test.mjs` (21 testes):** manifesto válido; resolução de cliente por tenantId/clientId; módulos consultados na Clara (`BrandContext`/`AudienceContext`/`ContentContext`); funciona sem Ícaro; usa Ícaro só nos 4 campos permitidos; segue heurística quando Ícaro falha; os 3 exemplos do usuário validados exatamente; quantidade explícita no texto vence sobre a heurística; recomendações estruturadas para o João; não cria copy/imagem/vídeo; erro de cliente não encontrado; validação de entrada; logs e eventos esperados; `buildBaselineEditorialBrief` puro e reutilizável; não importa providers de IA concretos; não chama João nem storage diretamente.

**Testes existentes adaptados:**
- `tests/arthur.orchestrator.test.mjs` — 2 testes reescritos (comportamento antigo de `detectFormat`/`detectImageCount` não existe mais) + 2 testes novos (Eduardo primeiro nas pipelines de imagem e de vídeo).
- `tests/joao-marketing-strategy.test.mjs` — 1 teste novo (sobrescrita via `editorialBrief`).
- `tests/organic-cycle.e2e.test.mjs` — Eduardo integrado à composição real de Skills; sequência de capabilities, chamadas ao Ícaro e verificação estática de imports atualizadas; 3 novas asserções sobre a saída do Eduardo.
- `tests/skills-discovery.test.mjs` — Eduardo incluído na descoberta real via `dist/skills`; 1 teste novo de capability.
- `scripts/verify-skills-discovery.mjs` — Eduardo incluído em `EXPECTED_SKILLS`.

## Validações executadas

- `npm run typecheck` — sem erros, na primeira tentativa.
- `npm test` — **436/436 testes passando** (partindo de 411 antes desta sessão: +21 novos em `tests/eduardo-editorial-planning.test.mjs`, +2 novos em Arthur, +1 novo em João, +1 novo em skills-discovery — mais novas asserções dentro de testes já existentes no e2e, sem aumentar sua contagem).
- `npm run architecture:check` — build completo + descoberta real das 12 Skills em `dist/skills`, incluindo Eduardo pela capability `editorial_planning`.
- **Bug real encontrado e corrigido durante a validação** (não estava nos testes automatizados na primeira tentativa): ao rodar manualmente `crie um carrossel com 2 imagens...` via CLI, a etapa "Geração de imagem" falhava. Causa raiz: Sofia, Bianca e Pedro têm cada um seu próprio campo `format: string` no contrato de entrada (não derivado de `joaoStrategy.format`), e a sobrescrita do Eduardo só havia sido aplicada ao `desiredFormat` da etapa de Estratégia. Bianca, recebendo o valor neutro antigo ("post único"), montava só 1 slide (`isCarouselFormat` falso), enquanto Pedro esperava 2 (via `imageCount` já corretamente sobrescrito) — Pedro then bloqueava com "Carrossel solicitado com 2 imagens, mas Bianca descreveu apenas 1 slide(s)." Corrigido adicionando a mesma sobrescrita de `format` (lida de `recommendedFormatLabel`) às três etapas. Revalidado manualmente via CLI real (pausou corretamente em `WAITING_ASSISTED_GENERATION` pedindo 2 imagens) e via `npm test` (436/436).

## Impacto esperado na qualidade estratégica do Zuno

- **Decisão de formato deixa de ser um efeito colateral de regex dentro do orquestrador** e passa a ser uma decisão explícita, testável isoladamente, documentada e evoluível (ex.: novas palavras-chave, novos objetivos de conteúdo, novas tabelas de estrutura narrativa) sem tocar em Arthur.
- **Consistência entre slides/duração e a narrativa realmente planejada**: a quantidade de slides de um carrossel agora nasce do número de etapas da própria estrutura narrativa escolhida (ex.: 5 etapas de conversão → 5 slides), em vez de um número fixo arbitrário.
- **Rastreabilidade**: o Editorial Brief completo fica disponível em `workflowContext.editorialBrief` para Sofia/Bianca/Pedro/Lucas/Bruno, e as decisões (formato, emoção, estrutura, profundidade, complexidade, prioridade de conversão) aparecem nas observações e nos briefings encadeados, não apenas no output do Eduardo.
- **Zero regressão**: todos os 411 testes pré-existentes continuam passando (2 foram adaptados por descreverem um comportamento que deliberadamente deixou de existir, não por quebra).

## Recomendações futuras

1. **Replanejamento condicional em Caio**: permitir que uma etapa decida dinamicamente quais etapas seguintes entram no plano (ex.: Eduardo recomendando vídeo ativar a pipeline de vídeo mesmo sem palavra-chave explícita no texto do usuário) — hoje isso exigiria Arthur "adivinhar" a pipeline certa antes do Eduardo rodar.
2. **Levar `recommendedVideoDurationSeconds` do Eduardo até Rafa/Diego de forma tipada** (hoje só chega como `workflowContext.editorialBrief` ao Bruno, não tipado nos quatro contratos da pipeline de vídeo).
3. **Considerar Eduardo também revisando/sugerindo sequência de publicações** ("existe oportunidade de criar uma sequência de conteúdos?") como um campo estruturado adicional do brief, hoje coberto apenas implicitamente pelas `recommendationsForJoao`.
4. **Ícaro real**: quando um provider de IA de verdade existir, reavaliar se as 4 melhorias hoje permitidas (justificativa/estrutura narrativa/emoção/recomendações) continuam sendo o conjunto certo, ou se vale ampliar com salvaguardas equivalentes.
