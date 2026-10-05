# Correções do Creative Engine — Rodada 4 (parcial)

> Status desta rodada: **PARCIAL, intencionalmente**. Das 6 etapas pedidas (ver brief completo na
> sessão), as ETAPAS 1, 2 e 4 foram implementadas, testadas e verificadas (typecheck/build/suíte
> completa/architecture-check, todos PASS). As ETAPAS 3, 5 e 6 (defesa pós-geração de safe-area,
> logo adaptativa, screenshot slot, convergência de Brand Profile, e o novo benchmark de 13
> cenários) **não foram iniciadas** — exigem capacidades novas (análise visual pós-geração,
> unificação de duas fontes de dados de marca) maiores do que cabia nesta rodada sem virar
> "big-bang sem testes intermediários". Por isso, **o Creative Engine NÃO é declarado resolvido**
> ao final deste documento — ver seção de classificação.

## Princípio seguido

Conforme instruído: nenhuma mudança de modelo, quality, budget ou número de retries como
"solução" — todas as correções abaixo atacam as COSTURAS da arquitetura (Creative Plan → geração
→ renderer → Quality Gate), não o modelo em si, replicando o diagnóstico do benchmark
(`docs/vorix-creative-quality-benchmark.md`).

## ETAPA 1 — Bugs P0 (CTA vazio, requiredRenderedFacts, gate)

### Antes
- `parseCreativePlan` exigia `allowedRenderedTexts.includes(parsed.cta)` incondicionalmente. Como
  uma string vazia nunca pode constar em `allowedRenderedTexts` (validado em
  `parseAllowedRenderedTexts`), toda peça institucional/sem CTA (`cta: ""`, decisão legítima)
  reprovava 100% das vezes, nas duas tentativas — confirmado reproduzível 2x no benchmark
  (cenários 04/05, Lumière Joias e Riot Wear).
- Não existia nenhum conceito de "fato comercial que ESTA peça decidiu que precisa aparecer".
  `MISSING_REQUIRED_TEXT` tratava todo texto autorizado com peso igual, e um preço confirmado
  (`R$ 2.499,00`, cenário 10) saiu ausente da imagem final sem nenhuma reprovação.

### Depois
- `parseCreativePlan` só exige presença em `allowedRenderedTexts` quando `cta` não é vazio
  (`src/shared/utils/gpt-creative-plan.types.ts`). `buildImageGenerationPromptFromPlan` não gera
  mais a instrução vazia `CTA (desenhar exatamente este texto): ""`.
- Novo campo `CreativePlan.requiredRenderedFacts: string[]` — o Director declara explicitamente
  quais fatos confirmados (`availableFacts` = `CreativeContext.confirmedFacts`) esta peça decidiu
  que precisam aparecer visualmente. Validado: cada item precisa corresponder a um trecho contido
  em algum texto renderável (`allowedRenderedTexts`) — um fato "obrigatório" sem texto planejado
  pra exibi-lo rejeita o plano inteiro.
- Novo código de falha dedicado `REQUIRED_FACT_MISSING` no Quality Gate
  (`evaluate-creative-quality-gate.ts`), distinto de `MISSING_REQUIRED_TEXT` — a mesma chamada de
  visão combinada (`checkCreativeVisualIntegrity`) agora recebe `requiredRenderedFacts` e pede
  verificação com "atenção redobrada" especificamente para fatos comerciais críticos. Sempre hard
  failure, nunca `renderer_reflow`-elegível.
- Testes novos: CTA vazio válido (parser + prompt de imagem), `requiredRenderedFacts` aceito/
  rejeitado, `REQUIRED_FACT_MISSING` disparado pelo gate — 148 testes no arquivo de tipos (antes
  94), todos passando.

## ETAPA 2 — Texto comercial determinístico (reversão da preferência por `image_model`)

### Antes
- Desde a Rodada 2/3, CTA/preço/desconto/URL/badge PREFERIAM `renderedBy: "image_model"` por
  padrão (só headline/subheadline eram forçados a `"renderer"`) — decisão tomada para evitar o
  efeito "caixa colada". O benchmark real confirmou o custo dessa escolha: corrupção ortográfica
  recorrente em texto desenhado pelo modelo (cenários 02 e 08 — "Duracad", "necessidada",
  "creidito") e um nome de marca inteiro alucinado errado (cenário 02 — "ANCORA SAVITAL" em vez de
  "Âncora Capital").

### Depois
- `parseTextZones` agora força `renderedBy: "renderer"` para TODO `textZone`, não só headline/
  subheadline — trava determinística (nunca confia só na instrução de prompt). `"image_model"`
  permanece no vocabulário do schema por compatibilidade, mas nunca é o valor final de um plano
  parseado.
- Prompt do Director atualizado: toda instrução que antes "preferia image_model" para texto
  comercial agora instrui SEMPRE `"renderer"`, explicando o motivo (corrupção ortográfica/nome de
  marca confirmados no benchmark). O modelo de imagem passa a ser responsável só por conceito
  visual/fotografia/cenário/produto/iluminação/composição ao redor de cada zona de texto — nunca
  pelo texto exato.
- **Defesa explícita contra o "sticker look" (preocupação direta do brief)**: a reversão para
  `"renderer"` universal NÃO reabre o problema da Rodada 1, porque o mecanismo de
  `backingStyle`/`align` (introduzido na Rodada 2, já existente) continua disponível e agora é
  citado explicitamente no prompt — o Director escolhe `"none"` quando a região já tem contraste
  suficiente, reservando `"scrim"`/`"solid"` para fundos imprevisíveis, em vez de todo texto virar
  um bloco visual idêntico.
- Testes atualizados (comportamento antigo documentado como revertido, nunca um teste
  silenciosamente apagado) e novos — 165 testes nos 4 arquivos tocados, todos passando.

## ETAPA 4 — Política de retry (retry waste confirmado no benchmark)

### Antes
- `MAX_CREATIVE_REPAIR_ROUNDS = 1`, compartilhado entre o gate técnico (falhas duras) e o Visual
  Quality Score (estética). `belowThreshold` disparava reparo sempre que a média geral ficava
  abaixo de 6.5 OU qualquer uma das 12 dimensões ficava abaixo de 4 — um dip MEDIANO (ex.: média
  6.2, uma dimensão em 3.8, "espaçamento imperfeito") consumia a MESMA única rodada de reparo que
  um defeito técnico grave, sem nenhum motivo concreto nomeado. Confirmado como "retry
  desperdiçado" no benchmark (seção 7.5 do relatório).

### Depois
- Novo campo `VisualQualityScoreResult.requiresRepair`, com piso estritamente mais baixo e
  catastrófico (`VISUAL_QUALITY_CRITICAL_OVERALL_SCORE = 4.5`,
  `VISUAL_QUALITY_CRITICAL_DIMENSION_SCORE = 3` — abaixo, nunca igual) — calibrado para NUNCA
  disparar no exemplo documentado do benchmark (média 6.2 / dimensão 3.8) e CONTINUAR disparando
  para um defeito isolado realmente catastrófico (ex.: uma dimensão em 2/10).
- `belowThreshold`/`weakDimensions` (piso antigo, 6.5/4) continuam existindo e sendo calculados —
  viram só dado de telemetria/relatório, nunca mais o gatilho de reparo.
- `run-gpt-creative-engine.ts` troca a condição de disparo de reparo estético de `belowThreshold`
  para `requiresRepair` — uma peça com dip mediano publica diretamente (o gate técnico já garantiu
  ausência de defeito grave), o score baixo fica registrado no resultado para análise, nunca bloqueia
  nem gasta a rodada de reparo compartilhada.
- Teste novo cobrindo exatamente o exemplo do brief (média 6.2, dimensão 3.8) confirmando zero
  chamadas extras de plano/imagem e `repairRounds.length === 0`; testes existentes recalibrados
  para o novo piso catastrófico (dimensão 2/10 continua disparando reparo, como antes).

## O que NÃO foi feito nesta rodada (ETAPAS 3, 5, 6 — pendentes)

- **ETAPA 3** (safe-area pós-geração, logo adaptativa, screenshot slot): exigiria uma nova
  capacidade de análise visual da imagem JÁ GERADA antes de compor texto/assets por cima (hoje o
  Quality Gate só analisa a peça já FINALIZADA) — escopo de design novo, não uma correção pontual.
  A logo continua sempre colada sobre cartão branco fixo (`logo-compositor.ts`, confirmado no
  benchmark, não alterado). O prompt de screenshot (seção 20 do brief) já instruía o modelo a
  nunca desenhar a interface do site quando há screenshot real — isso já existia antes desta
  rodada e não mudou; a coordenação de "slot" geométrico validado pós-geração (seção 21) não foi
  implementada.
- **ETAPA 5** (convergência de Brand Profile): o benchmark confirmou que `BrandVisualProfile`
  (cores/tipografia estruturadas) e `CreativeBrandProfile.brandColors` (usado pelo GPT Creative
  Engine) são duas fontes de dados diferentes, servindo caminhos diferentes (legado Bianca/Pedro
  vs. motor GPT) — unificar isso é uma migração de dados, não uma correção de bug, e não foi
  iniciada.
- **ETAPA 6** (novo benchmark, 10 cenários + 3 com foto real de produto): depende de ETAPA 3/5
  estarem completas para que a comparação seja justa — rodar o benchmark agora mediria só o
  efeito de ETAPAS 1/2/4, sem capturar o que mais pesou nos achados do benchmark original
  (coordenação de safe-area, logo). Não executado.

## Verificação desta rodada

`npm run typecheck` (raiz) — PASS. `npm run build` — PASS. `node --test tests/*.test.mjs` — 2
flakes pré-existentes e não relacionados (`tests/analytics.test.mjs:192`,
`tests/cli.smoke.test.mjs:280`), zero falhas novas. `npm run architecture:check` — PASS (49
contratos, 7 checks de isolamento arquitetural). Testes direcionados somam 165 (antes: 94) nos
arquivos tocados (`gpt-creative-plan-types`, `evaluate-creative-quality-gate`,
`evaluate-visual-quality-score`, `run-gpt-creative-engine`).

## Bloco de classificação (parcial — ver nota no topo)

```
CTA_EMPTY_BUG = FIXED
EXACT_TEXT_STRATEGY = DETERMINISTIC
REQUIRED_FACT_GATE = PASS
GHOST_TEXT_DEFENSE = NOT_STARTED (ETAPA 3 não iniciada)
SAFE_AREA_POST_GENERATION = NOT_STARTED (ETAPA 3 não iniciada)
LOGO_ADAPTIVE = NOT_STARTED (ETAPA 3 não iniciada — logo continua sempre cartão branco fixo)
SCREENSHOT_COORDINATION = PARTIAL (prompt já pedia frame vazio antes desta rodada; slot geométrico validado pós-geração não implementado)
BRAND_PROFILE_CONVERGENCE = NOT_STARTED (ETAPA 5 não iniciada)
RETRY_POLICY = FIXED
PRODUCT_REFERENCE_PATH = NOT_TESTED (auditado em código na Rodada 3, nenhum cenário de benchmark o exercitou; ETAPA 6 não executada)
BENCHMARK_SCENARIOS = N/A (ETAPA 6 não executada nesta rodada)
VORIX_BETTER = N/A
TIE = N/A
DIRECT_GPT_BETTER = N/A
COMMERCIAL_TEXT_ERRORS = N/A (seriam medidos no novo benchmark, não executado)
QUALITY_TARGET_80_PERCENT = NOT_RE_MEASURED
AVERAGE_COST_BEFORE = ver docs/vorix-creative-quality-benchmark.md seção 6
AVERAGE_COST_AFTER = N/A (sem novo benchmark nesta rodada)
```

**Conforme instruído: como as ETAPAS 3/5/6 não foram concluídas e a meta de 80% não foi
remedida, o Creative Engine NÃO é declarado resolvido.**

## Respostas (parciais, às 13 perguntas do brief)

1. **O CTA vazio foi corrigido?** Sim — corrigido, testado, verificado.
2. **Todo texto comercial exato agora é determinístico?** Sim — todo `textZone` (headline,
   subheadline, CTA, preço, desconto, URL, badge) é forçado a `renderedBy: "renderer"`.
3. **A aparência de "texto colado" foi eliminada?** Não totalmente verificável sem rodar o
   benchmark novamente — o mecanismo para evitar isso (`backingStyle: "none"`) já existia e foi
   reforçado na instrução de prompt, mas sem uma nova geração real não há confirmação visual.
4. **Texto fantasma está protegido?** Não — essa é a ETAPA 3 (defesa pós-geração), não iniciada.
5. **Preço obrigatório nunca some?** Para peças que o declaram via `requiredRenderedFacts`, agora
   há um gate dedicado reprovando a publicação se sumir — mas depende do Director de fato marcar o
   fato como obrigatório; não há garantia de que ele sempre o fará.
6. **Logo continua parecendo sticker?** Sim, sem alteração nesta rodada (ETAPA 3 não iniciada).
7. **Screenshot real está integrado corretamente?** Sem mudança nesta rodada além do que já
   existia antes (prompt já pedia frame vazio); a validação de slot pós-geração não foi feita.
8. **Retry inútil caiu?** Sim — um dip mediano de score estético não consome mais a rodada de
   reparo compartilhada; testado explicitamente com o exemplo do brief (média 6.2/dimensão 3.8).
9. **Brand Profile está unificado?** Não — ETAPA 5 não iniciada.
10. **Foto real de produto foi testada?** Não nesta rodada (ETAPA 6 não executada).
11. **Qual o novo resultado Vorix vs. GPT direto?** Não medido nesta rodada — rodar o benchmark
    agora mediria só ETAPAS 1/2/4, sem capturar os achados mais impactantes do benchmark original.
12. **Atingimos 80%?** Não remedido.
13. **Qual o custo médio antes/depois?** Antes: ver relatório da Rodada 3. Depois: não medido
    (nenhuma nova geração real foi feita nesta rodada).

**Como a meta não foi atingida nem remedida, não declaro o Creative Engine resolvido.**
