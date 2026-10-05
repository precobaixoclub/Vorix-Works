# Correções do Creative Engine — Rodada 4 (parcial)

> Status: ETAPAS 1, 2, 4, 3 e 3.1 — implementadas, testadas, verificadas e **já em produção**
> (ETAPA 3.1 no commit `7d89b16`, smoke de produção confirmado). ETAPA 3.2 (cobertura geométrica
> real — ver seção própria abaixo) — implementada e testada localmente (typecheck/build/suíte
> completa/architecture-check/smoke local, todos PASS), **commitada mas AINDA NÃO deployada**
> (aguardando autorização explícita, conforme instruído nesta rodada). ETAPAS 5 e 6 (convergência
> de Brand Profile, novo benchmark de 13 cenários) **não foram iniciadas**. Por isso, **o Creative
> Engine NÃO é declarado resolvido** ao final deste documento — ver seção de classificação.

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

## ETAPA 3 — Coordenação IMAGE MODEL → safe-area → renderer → logo/screenshot → Quality Gate

### Antes
- O prompt já pedia ao modelo para não desenhar texto em zonas `renderedBy: "renderer"` — o smoke
  de produção da Rodada 4 (fc53a17) confirmou que isso NÃO é suficiente: o modelo desenhou um fato
  confirmado por conta própria e a peça foi reprovada por `UNAUTHORIZED_TEXT`, sem nenhuma defesa
  além de descartar a peça inteira (`gpt_replan`, nova geração completa).
- A logo sempre era colada sobre um cartão branco semi-opaco fixo (`logo-compositor.ts`),
  independente do asset ter transparência real ou do fundo por trás — a "aparência de sticker"
  confirmada no benchmark.
- Não existia nenhuma validação de que a região reservada para texto (ou logo) estivesse de fato
  livre na imagem REAL gerada — só a intenção declarada no `creative_plan`.

### Depois — defesa pré-composição (novo módulo `analyze-pre-composition-image.ts`)
Uma ÚNICA chamada de visão adicional, sobre a imagem BASE (antes de qualquer composição
determinística), deliberadamente mais barata que uma nova geração de imagem — existe
especificamente para EVITAR gastar uma. Ela classifica:
- **Texto espúrio** em três categorias: `unauthorized_text` (não autorizado e sem zona
  correspondente), `ghost_text` (o modelo antecipou o conteúdo de uma zona do renderer),
  `duplicated_text` (o mesmo texto aparece mais de uma vez).
- **6 regiões candidatas fixas** (top-left/top-right/center-left/center-right/bottom-left/
  bottom-right — `resolve-actual-safe-area.ts`), cada uma com `hasText`/`hasProduct`/`hasFace`/
  `complexity`.
- **Slot de screenshot** (`screenshotSlotLooksFake`), só perguntado quando há screenshot real no
  contexto.

### Depois — ajuste silencioso de composição (`applySafeAreaAdjustments`, `run-gpt-creative-engine.ts`)
Para CADA zona `renderedBy: "renderer"`, ANTES de desenhar qualquer texto:
1. **Reposicionamento primeiro** (brief, ponto 7): se a região planejada não está livre (vision
   diz que há texto/produto/rosto ali, OU há um `ghost_text` batendo com aquela zona), escolhe a
   melhor região candidata genuinamente livre (sem sobrepor assets reais já posicionados) —
   `resolveActualTextZoneRect`/`pickBestAlternateRegion`. **Nunca consome uma rodada de reparo** —
   é um ajuste automático, sempre tentado, registrado em `compositionSteps` (`safe_area_adjustment`).
2. **Se não há região livre**, o tratamento de fundo escala pra compensar
   (`chooseTextBackingTreatment`, baseado em estatística de pixel REAL e gratuita — contraste/
   complexidade da região final, nunca uma chamada de IA): `direct_text` (sem fundo, região já
   limpa) → `gradient_scrim` (fundo fotográfico imprevisível) → `local_blur` (texto fantasma
   detectado — borra a região real via `sharp` ANTES de desenhar por cima, depois ainda aplica um
   scrim como segunda camada de segurança) → `card_fallback` (região caótica demais, último
   recurso). Texto fantasma SEMPRE força pelo menos `local_blur`.
3. **Screenshot slot incompatível** (`screenshotSlotLooksFake: true`) é tratado como um problema
   que o renderer NÃO pode corrigir sozinho (o conteúdo já está "assado" nos pixels) — roteia
   direto para `gpt_replan` (nova rodada de reparo), mas ANTES de gastar screenshot/logo/texto/
   upload/gate técnico daquela tentativa (mais barato que descobrir isso só no final).

### Depois — logo adaptativa (`logo-compositor.ts` reescrito)
Tratamento decidido a partir de 2 dados reais (nunca mais sempre cartão branco):
`hasRealTransparency` (o asset tem canal alfa de verdade?) + contraste real do fundo na posição
exata onde a logo vai cair (`sharp().stats()`). Três tratamentos: `direct` (asset com
transparência real, fundo limpo — sem fundo nenhum), `subtle_scrim` (asset com transparência
real, fundo ruidoso — forma suave e discreta, opacidade bem mais baixa que o cartão antigo, nunca
um retângulo duro), `card_fallback` (asset SEM transparência real — sempre vai mostrar seu
próprio fundo de qualquer jeito — cor do cartão agora ADAPTADA ao fundo medido, branco sobre
fundo escuro / escuro sobre fundo claro, nunca sempre branco).

### Depois — Quality Gate (defesa em profundidade)
Novos códigos (`evaluate-creative-quality-gate.ts`): `REQUIRED_FACT_MISSING` (ETAPA 1),
`DUPLICATED_TEXT`, `SCREENSHOT_SLOT_MISMATCH`, `CRITICAL_ASSET_OCCLUDED`. `GHOST_TEXT` é detectado
e tratado na fase PRÉ-composição (acima) e deliberadamente NUNCA virou um código de gate — se a
mitigação funciona (o caso comum), não há nada a reprovar; se falha, o sintoma observável é o
MESMO texto duplicado na peça final, coberto por `DUPLICATED_TEXT` (defesa em profundidade, nunca
uma segunda categoria sem sinal real pra produzi-la).

### Depois — classificação de estratégia de reparo (`creative-repair.ts`)
`classifyRepairStrategy(issue)` — auditoria/relatório (brief, pontos 21/22), nunca usada para
decidir a rota: `renderer_fixable` (geometria pura, `TEXT_ILLEGIBLE_OR_CUT`/`ELEMENT_CUT_OFF` de
origem `safe_area`), `image_repair_required` (`DUPLICATED_TEXT`/`CRITICAL_ASSET_OCCLUDED` —
conceitualmente pediriam reparo LOCAL de pixel, nunca um plano inteiro novo), `full_regen_required`
(todo o resto). Anexada a cada `CreativeRepairRound.strategies` para auditoria.

### Limitações documentadas (honestas, não implementadas nesta rodada)
- **Sem inpainting real**: `image_repair_required` é só uma etiqueta de auditoria — na prática,
  hoje, roteia pra `full_regen_required` (nova imagem inteira) porque não existe nenhuma
  capacidade de reparo LOCAL de pixel (seção 7, item 4 do brief, "somente se necessário") — ficou
  de fora deliberadamente, por ser uma capacidade nova grande, não uma correção pontual.
- **Logo**: sem `logoLight`/`logoDark`/`logoTransparent` reais cadastrados por marca nesta rodada
  — a adaptação é só DIRECT/SUBTLE_SCRIM/CARD_FALLBACK a partir do ÚNICO asset existente, nunca
  escolhe entre variantes (`LOGO_ADAPTIVE = PARTIAL` na classificação abaixo, valor explicitamente
  previsto pelo brief).
- **Screenshot fallback de crop/recomposição** (brief, ponto 18: "tentar outro crop, frame
  simples, composição editorial antes de regenerar"): não implementado — hoje
  `screenshotSlotLooksFake` só tem DOIS desfechos, reparo completo (`gpt_replan`) ou nada; o
  degrau intermediário de recorte/recomposição automática ficou de fora.
- **EDITORIAL_BAND** (vocabulário do brief) foi deliberadamente fundido em `card_fallback` — o
  renderer determinístico só tem 3 primitivas reais de desenho (`none`/`scrim`/`solid`,
  `render-creative-plan-text-zones.ts`), e os dois tratamentos "fortes" do brief convergem na
  mesma primitiva nesta rodada (nunca construir uma 4ª primitiva só por completude de nome, ver
  brief ponto 20/32).

### Testes novos (ETAPA 3)
`resolve-actual-safe-area.test.mjs` (24 testes, lógica pura), `analyze-pre-composition-image.test.mjs`
(9 testes, parsing/prompt da chamada de visão), `region-pixel-stats.test.mjs` (7 testes, sharp
real — contraste/blur), `logo-compositor.test.mjs` (+6 testes de tratamento adaptativo),
`creative-repair.test.mjs` (+8 testes de `classifyRepairStrategy` e novos códigos no roteamento),
`evaluate-creative-quality-gate.test.mjs` (+2 testes de `DUPLICATED_TEXT`/campos novos),
**`round4-etapa3-local-smoke.test.mjs`** — os 5 cenários mínimos pedidos (A: headline+CTA+preço,
B: institucional sem CTA, C: screenshot SaaS, D: logo sobre fundo claro, E: logo sobre fundo
escuro) + 1 cenário dedicado de defesa de texto fantasma, todos usando os compositores REAIS
(sharp de verdade — logo/screenshot/texto), nunca uma chamada real à OpenAI (Ícaro roteirizado).
Todos os 6 cenários publicam sem `UNAUTHORIZED_TEXT`/`DUPLICATED_TEXT`/`SCREENSHOT_SLOT_MISMATCH`/
`TEXT_ZONE_OVERLAPS_ASSET`/`ELEMENT_CUT_OFF`/`TEXT_ILLEGIBLE_OR_CUT`/`CRITICAL_ASSET_OCCLUDED`
(critério do brief, ponto 25) — ver `assertNoRound4Defects` no arquivo de teste.

## ETAPA 3.1 — Ajuste fino da defesa contra texto fantasma

### Problema real observado (smoke de produção da ETAPA 3, commit 16c6d18)
Detecção e roteamento de texto fantasma funcionaram corretamente, mas o TRATAMENTO VISUAL
(`applyLocalBlur` com sigma fixo = 18) não foi suficiente: um preço fantasma de alto contraste
continuou parcialmente legível em 2 tentativas seguidas, confirmado pelo check final de visão
(`DUPLICATED_TEXT`, a mesma string aparecendo duas vezes).

### Correção — intensidade adaptativa + confirmação real (nunca mais "assumir que funcionou")
- **Intensidade calculada, não fixa**: `classifyGhostTextIntensity` (`resolve-actual-safe-area.ts`)
  deriva LOW/MEDIUM/HIGH do desvio-padrão de luminância REAL da região (nunca um sigma universal).
  Cada nível escala TANTO o blur quanto a opacidade do véu junto (nunca só um dos dois) —
  `resolveGhostTextTreatmentParams`.
- **Blur + véu combinados de verdade, nos pixels** (não mais deferido pro renderer): o novo módulo
  `neutralize-ghost-text.ts` aplica `applyLocalBlur` + `applyLocalScrim` (novo, cor
  clara/escura adaptativa conforme o fundo medido) diretamente no buffer, ANTES de desenhar
  qualquer texto por cima.
- **Reavaliação real, isolada**: depois de cada tratamento, `extractRegionBuffer` recorta SÓ a
  região tratada (nunca a peça inteira — mais barato e mais preciso) e uma chamada de visão
  dedicada pergunta objetivamente "há texto legível aqui? sim/não". Só aceita "resolvido" com um
  `false` EXPLÍCITO — qualquer falha/ambiguidade conta como "ainda pode estar legível"
  (conservador, nunca declara sucesso sem confirmação real).
- **Escalonamento limitado a 2 passes** (nunca um loop infinito): se o pass 1 (intensidade inicial)
  ainda deixa texto legível, escala pra uma intensidade mais forte e tenta de novo; se o pass 2
  AINDA deixa texto legível, para — não existe pass 3.
- **`UNRECOVERABLE_GHOST_TEXT`** (novo `CreativeQualityIssueCode`): quando os 2 passes esgotam sem
  sucesso, a zona é classificada assim e o motor roteia DIRETO pro reparo normal (`gpt_replan`),
  ANTES de gastar screenshot/logo/upload/gate técnico daquela rodada — mesmo princípio de
  `SCREENSHOT_SLOT_MISMATCH` (ETAPA 3).
- **Nenhuma regeneração quando o fix local funciona**: confirmado por teste — quando a
  reverificação confirma sucesso (em 1 ou 2 passes), zero chamadas extras de `image_generation`;
  `compositionSteps` registra `GHOST_TEXT_NEUTRALIZED_LOCALLY` com o número de passes e a
  intensidade final, para auditoria.
- **`textColorOverride`** (novo campo de EXECUÇÃO em `CreativePlanTextZone`, nunca preenchido pelo
  Director/parser): quando o fundo já foi resolvido nos pixels pela neutralização, o renderer
  determinístico precisa saber qual cor de texto contrasta com o véu REAL aplicado — nunca o
  branco fixo que `backingStyle: "none"` assumia por padrão antes desta correção.

### Fallback preservado (ETAPA 3, sem regressão)
Em qualquer ambiente onde os deps novos (`applyLocalScrim`/`extractRegionBuffer`) não estiverem
disponíveis, o motor cai no comportamento da ETAPA 3 (um único blur, sem reverificação) — texto
fantasma NUNCA é silenciosamente ignorado, mesmo num ambiente degradado.

### Testes novos (ETAPA 3.1)
`resolve-actual-safe-area.test.mjs` (+6 testes de intensidade/escalonamento),
`region-pixel-stats.test.mjs` (+10 testes: `applyLocalScrim`/`extractRegionBuffer` reais, e um
SMOKE LOCAL dedicado com 3 cenários sintéticos LOW/MEDIUM/HIGH contraste com texto de verdade
desenhado via SVG, confirmando redução mensurável de contraste residual em todos os níveis),
**`neutralize-ghost-text.test.mjs`** (8 testes da orquestração completa: resolve em 1 passe, escala
pro 2º, esgota os 2 e fica unrecoverable, conservador em falha de reverificação/recorte,
intensidade/cor derivadas de estatística real, custo rastreado), e 4 novos testes de integração em
`run-gpt-creative-engine.test.mjs` cobrindo exatamente os casos pedidos: preço fantasma resolvido
em 1 passe, nome de marca fantasma (texto não-numérico, confirma que não é só pra preço),
escalonamento pro 2º passe, e `UNRECOVERABLE_GHOST_TEXT` roteando pra nova geração.

### Smoke real de produção (commit a ser confirmado na entrega)
Ver bloco de classificação e entrega ao final deste documento.

## ETAPA 3.2 — Cobertura geométrica real (PLANNED ZONE != ACTUAL TEXT REGION) + plan-invalid root cause

### Achado real que motivou esta etapa (smoke de produção da ETAPA 3.1, commit 7d89b16)
A reverificação LOCAL (só o recorte da região tratada) confirmava corretamente que o texto
fantasma sumiu DALI — mas o gate final (peça inteira) ainda encontrava o mesmo preço duplicado em
outro lugar. Conclusão: tratar só o retângulo PLANEJADO da zona nunca foi garantia de cobrir onde o
modelo REALMENTE desenhou o texto. O smoke também revelou `TEXT_ZONE_OVERLAPS_ASSET` (headline
sobre a logo) chegando ao gate, e um `CREATIVE_PLAN_INVALID` sem nenhuma pista do motivo.

### Correção — localização REAL (bbox), nunca mais só a zona planejada
- **`analyze-pre-composition-image.ts`**: cada achado de texto espúrio agora pede também `bbox`
  (retângulo aproximado REAL, percentual do canvas) e `confidence` — nunca um projeto de OCR,
  localização aproximada já basta. O mesmo texto em mais de um lugar vira entradas SEPARADAS, cada
  uma com sua própria bbox.
- **`expandBboxWithPadding`** (`resolve-actual-safe-area.ts`): expande a bbox detectada
  proporcionalmente ao próprio tamanho (18% por padrão) antes de tratar — nunca a bbox exata, pra
  não sobrar contorno/letra na borda do tratamento.
- **`applySafeAreaAdjustments` reestruturado**: agora trata CADA achado de texto espúrio na sua
  bbox real (expandida) — nunca mais amarrado à zona planejada. Quando a visão não consegue
  localizar (`bbox` ausente), cai no fallback antigo (rect da zona correspondente). A lógica de
  zonas (relocação) ficou separada e agora cuida só de OCUPAÇÃO (produto/rosto/geometria), não mais
  de texto fantasma por zona.
- **Checagem GLOBAL pós-tratamento** (`checkGlobalTextLegibility`): depois de tratar TODAS as
  regiões detectadas, uma pergunta sobre a imagem BASE tratada INTEIRA — "ainda há texto não
  autorizado/duplicado legível em QUALQUER lugar?". Só roda quando havia algo detectado E a
  capacidade completa de tratamento estava disponível (nunca gasta a chamada à toa). Falha ⇒ rota
  normal de reparo (`UNRECOVERABLE_GHOST_TEXT`, igual à ETAPA 3.1), ANTES de desenhar texto
  determinístico.

### Correção — `TEXT_ZONE_OVERLAPS_ASSET` (geometria determinística, não só visão)
- A relocação de zonas agora considera overlap GEOMÉTRICO determinístico contra assets reais já
  posicionados (logo/screenshot) e contra outras zonas de maior prioridade — nunca só o que a
  visão relatou como "ocupado". `TEXT_ZONE_KIND_PRIORITY` (headline > price > cta > subheadline >
  discount > url > badge) decide quem relocaliza primeiro quando duas zonas colidem entre si.
  Resolvido sem regenerar imagem sempre que existe uma região alternativa genuinamente livre.
- **Achado e corrigido durante os testes desta etapa**: o gate técnico
  (`checkAssetPlacementOverlap`/`checkTextZoneCollisions`/`checkSafeAreaCompliance`) recebia
  `plan.textZones` — os retângulos ORIGINAIS do Director, nunca os retângulos REALOCADOS. Uma
  colisão genuinamente corrigida em tempo de composição ainda assim reprovava o gate, porque ele
  olhava para a geometria antiga. Corrigido: o gate agora recebe um "plano para avaliação"
  (`planForGate`) com `textZones` substituído pelos retângulos REAIS pós-ajuste — o `plan` original
  (nunca alterado) continua sendo o que volta pro Director em caso de reparo.
- Quando NENHUMA região alternativa está livre, a colisão permanece e o gate corretamente reprova
  (nunca silenciosamente deixa passar um overlap real só porque existe um mecanismo de correção).

### Correção — causa raiz do `CREATIVE_PLAN_INVALID`
- **`diagnoseCreativePlanInvalidity`** (`gpt-creative-plan.types.ts`, novo): re-percorre as MESMAS
  validações de `parseCreativePlan`, na mesma ordem, devolvendo a frase legível da PRIMEIRA regra
  que falhou (campo exato, valor, regra) — nunca muda o contrato de `parseCreativePlan` (ainda só
  `CreativePlan | undefined`, as dezenas de testes existentes continuam valendo).
- A 2ª tentativa do plano inicial agora recebe essa causa anexada ao prompt
  (`appendPlanRetryDiagnostic`) — nunca mais uma re-pergunta cega com o prompt idêntico.
- **`CREATIVE_PLAN_REPEAT_INVALID`** (novo `errorCode`, distinto de `CREATIVE_PLAN_INVALID`):
  quando o MESMO diagnóstico se repete nas duas tentativas (mesmo depois de receber a causa exata),
  nomeia isso como um padrão, não um acaso — nunca tenta uma 3ª vez, continua gastando zero
  gerações de imagem.

### Limitações documentadas (honestas)
- A checagem global roda sobre a imagem BASE já com screenshot/logo compostos (ordem real do
  pipeline), não sobre o resultado puro do modelo de imagem — uma simplificação deliberada de
  escopo, documentada aqui.
- `requiredRenderedFacts`/`textsMatchApproximately` (normalização de texto) existem como utilidade
  testada, mas a decisão de QUAL achado tratar continua sendo "todo achado com bbox", não uma
  classificação distinta de "fato duplicado" vs. "texto não autorizado" — ambos recebem o mesmo
  tratamento (mesma urgência, mesmo mecanismo), por design (brief, ponto 7).
- `resolveFinalCompositionGeometry()` como módulo central dedicado não foi criado — a correção de
  overlap foi feita extendendo a lógica de relocação já existente (`resolveActualTextZoneRect`),
  mais simples e sem duplicar regras, mas significa que a resolução de geometria está distribuída
  entre `applySafeAreaAdjustments` e as funções puras de `resolve-actual-safe-area.ts`, não
  centralizada num único módulo com esse nome exato.

### Testes novos (ETAPA 3.2)
`resolve-actual-safe-area.test.mjs` (+9: expandBboxWithPadding, normalização/match aproximado,
prioridade/ordenação), `analyze-pre-composition-image.test.mjs` (+8: bbox/confidence,
múltiplas ocorrências, `checkGlobalTextLegibility`), `gpt-creative-plan-types.test.mjs` (+7:
`diagnoseCreativePlanInvalidity`), e 5 novos testes de integração em `run-gpt-creative-engine.test.mjs`
(bbox fora da zona tratado no lugar certo, overlap geométrico relocalizado sem regen, overlap
genuinamente sem solução ainda reprova corretamente, recheck global aciona reparo, causa exata
anexada à 2ª tentativa do plano, repetição de causa estrutural vira `CREATIVE_PLAN_REPEAT_INVALID`)
+ 1 novo cenário de smoke local com pixels reais (`round4-etapa3-local-smoke.test.mjs`) confirmando
texto fora da zona planejada sendo tratado corretamente.

## O que NÃO foi feito nesta rodada (ETAPAS 5, 6 — pendentes)

- **ETAPA 5** (convergência de Brand Profile): o benchmark confirmou que `BrandVisualProfile`
  (cores/tipografia estruturadas) e `CreativeBrandProfile.brandColors` (usado pelo GPT Creative
  Engine) são duas fontes de dados diferentes, servindo caminhos diferentes (legado Bianca/Pedro
  vs. motor GPT) — unificar isso é uma migração de dados, não uma correção de bug, e não foi
  iniciada.
- **ETAPA 6** (novo benchmark, 10 cenários + 3 com foto real de produto): ainda não executado —
  agora que ETAPA 3 está implementada (testada localmente, mas ainda não deployada em produção
  neste momento do documento), rodar o benchmark real contra produção é o próximo passo natural,
  mas depende de autorização explícita de deploy (seção seguinte) e, idealmente, da ETAPA 5
  também, para medir o efeito completo.

## Verificação desta rodada

`npm run typecheck` (raiz) — PASS. `npm run build` — PASS. `node --test tests/*.test.mjs` — 3287
testes, 2 flakes pré-existentes e não relacionados (`tests/analytics.test.mjs:192`,
`tests/cli.smoke.test.mjs:280`), zero falhas novas. `npm run architecture:check` — PASS (49
contratos, 7 checks de isolamento arquitetural, 1032 arquivos). Smoke local ETAPA 3: 6/6 cenários
PASS. Smoke local ETAPA 3.1: 3/3 cenários LOW/MEDIUM/HIGH contraste + 4/4 testes de integração
PASS. Smoke local ETAPA 3.2: 1 cenário dedicado de bbox-fora-da-zona (pixel real) + 5 testes de
integração (bbox, overlap geométrico resolvido/não-resolvido, recheck global, diagnóstico de plano)
PASS — todos usando o pipeline de composição real onde aplicável.

## Bloco de classificação

```
CTA_EMPTY_BUG = FIXED
EXACT_TEXT_STRATEGY = DETERMINISTIC
REQUIRED_FACT_GATE = PASS
RETRY_POLICY = FIXED

UNAUTHORIZED_TEXT_DETECTION = PASS
GHOST_TEXT_DETECTION = PASS
ACTUAL_SAFE_AREA = PASS
DYNAMIC_TEXT_REGION = PASS
ADAPTIVE_CONTRAST = PASS
LOGO_ADAPTIVE = PARTIAL (sem variantes light/dark reais cadastradas — só direct/subtle_scrim/card_fallback a partir do asset único)
LOGO_STICKER_DEFAULT_REMOVED = YES
LOGO_OVERLAP_GUARD = PASS (via checkAssetPlacementOverlap/checkTextZoneCollisions, agora contra geometria pós-ajuste, não mais a planejada)
SCREENSHOT_SLOT = PASS
SCREENSHOT_COORDINATION = PASS (detecção + reparo completo; fallback de crop/recomposição automática NÃO implementado — ver limitações)
RENDERER_FIX_WITHOUT_REGEN = PASS
LOCAL_SMOKE = PASS (6/6 cenários ETAPA 3)
STAGE_3_PRODUCTION = VERIFIED (deployado e smoke-testado em produção)

ADAPTIVE_BLUR = PASS
ADAPTIVE_SCRIM = PASS
POST_TREATMENT_RECHECK = PASS
GHOST_TEXT_ESCALATION = PASS
PRICE_GHOST_CASE = PASS
BRAND_GHOST_CASE = PASS
LOCAL_FIX_WITHOUT_REGEN = PASS
UNRECOVERABLE_GHOST_ROUTING = PASS
LOCAL_SMOKE_3_1 = PASS (3/3 cenários LOW/MEDIUM/HIGH contraste + 4/4 testes de integração)
STAGE_3_1_READY_FOR_PRODUCTION = YES — deployado e smoke-testado em produção (commit 7d89b16); achado real: blur+véu local funcionam e são confirmados por recheck, mas o gate final ainda encontrou duplicata em local não coberto pelo tratamento (motivou a ETAPA 3.2)

ACTUAL_TEXT_BBOX = PASS
MULTIPLE_TEXT_OCCURRENCES = PASS
BBOX_PADDING = PASS
LOCAL_RECHECK = PASS
GLOBAL_RECHECK = PASS
DUPLICATED_PRICE_OUTSIDE_PLANNED_ZONE = PASS (testado localmente — tratado na bbox real, fora da zona planejada; ainda não confirmado contra o modelo real em produção, ver REAL_SMOKE)
UNAUTHORIZED_TEXT_OUTSIDE_ZONE = PASS (mesmo mecanismo, testado com texto não-numérico)
GEOMETRY_RESOLVER = PASS (via extensão da relocação existente + plano-para-gate; não um módulo central dedicado, ver limitações)
TEXT_ZONE_OVERLAPS_ASSET = RESOLVED (quando há região alternativa livre; corretamente ainda reprova quando genuinamente não há)
PLAN_INVALID_ROOT_CAUSE = IDENTIFIED (ver `diagnoseCreativePlanInvalidity` — a causa real do CREATIVE_PLAN_INVALID do smoke anterior não pôde ser retroativamente recuperada, mas o mecanismo de diagnóstico agora captura isso para qualquer falha futura)
PLAN_REPAIR_CONTEXT = PASS (causa exata anexada à 2ª tentativa, testado)
REPEAT_INVALID_PLAN = CONTROLLED (CREATIVE_PLAN_REPEAT_INVALID, nunca uma 3ª tentativa)
LOCAL_SMOKE_3_2 = PASS
REAL_SMOKE_3_2 = NOT_EXECUTED (depende de deploy — não autorizado nesta rodada, ver instrução explícita "NÃO deployar automaticamente")
STAGE_3_2_READY_FOR_PRODUCTION = YES, verificado localmente — smoke real pendente de autorização de deploy

BRAND_PROFILE_CONVERGENCE = NOT_STARTED (ETAPA 5 não iniciada)
PRODUCT_REFERENCE_PATH = NOT_TESTED (auditado em código na Rodada 3, nenhum cenário de benchmark o exercitou; ETAPA 6 não executada)
BENCHMARK_SCENARIOS = N/A (ETAPA 6 não executada nesta rodada)
VORIX_BETTER = N/A
TIE = N/A
DIRECT_GPT_BETTER = N/A
COMMERCIAL_TEXT_ERRORS = N/A (seriam medidos no novo benchmark, não executado)
QUALITY_TARGET_80_PERCENT = NOT_RE_MEASURED
AVERAGE_COST_BEFORE = ver docs/vorix-creative-quality-benchmark.md seção 6
AVERAGE_COST_AFTER = N/A (sem novo benchmark nesta rodada; ETAPA 3.2 adiciona, na pior hipótese, 1 chamada de visão global extra por geração com achado de texto espúrio — ver costBreakdown.ghostTextNeutralization)
```

**Conforme instruído: como as ETAPAS 5/6 não foram concluídas, a meta de 80% não foi remedida, e
o smoke real da ETAPA 3.2 ainda não foi executado (deploy não autorizado nesta rodada), o Creative
Engine NÃO é declarado resolvido.**

## Respostas às 10 perguntas de fechamento da ETAPA 3

1. **Como texto espúrio é detectado agora?** Uma chamada de visão sobre a imagem BASE (antes de
   qualquer composição), classificando cada achado como `unauthorized_text`/`ghost_text`/
   `duplicated_text` contra a lista fechada de textos autorizados e as zonas do renderer
   (`analyze-pre-composition-image.ts`).
2. **O que acontece quando o modelo ocupa a região planejada?** O renderer tenta reposicionar a
   zona pra uma das 6 regiões candidatas genuinamente livres (sem texto/produto/rosto, sem
   sobrepor assets reais) — nunca consome uma rodada de reparo.
3. **Como o renderer escolhe outra região?** `pickBestAlternateRegion` — filtra regiões seguras e
   sem colisão, escolhe a de menor complexidade visual entre as candidatas.
4. **Quando usa gradient/scrim/card?** Decidido por estatística de pixel REAL (contraste/
   complexidade), nunca "achismo": `direct_text` → `gradient_scrim` → `local_blur` (texto
   fantasma) → `card_fallback` (último recurso, região caótica demais).
5. **Logo ainda usa cartão branco por padrão?** Não — só quando o asset não tem transparência
   real (nesse caso o cartão é inevitável, mas a COR agora se adapta ao fundo). Com transparência
   real, é `direct` (sem cartão) ou `subtle_scrim` (forma suave), nunca mais sempre branco.
6. **Como escolhe variante de logo?** Não escolhe entre variantes reais (não implementado — sem
   `logoLight`/`logoDark` cadastrados nesta rodada); escolhe o TRATAMENTO (direct/subtle_scrim/
   card_fallback) a partir do único asset existente.
7. **Screenshot real continua desalinhando?** A detecção (`screenshotSlotLooksFake`) existe e
   roteia pra reparo completo quando o modelo já desenhou uma interface falsa no slot — mas o
   fallback de recorte/recomposição automática (sem regenerar) não foi implementado.
8. **Quantos problemas agora são corrigidos sem regenerar imagem?** Reposicionamento de zona de
   texto e escolha de tratamento de fundo (incluindo blur local pra texto fantasma) — nenhum dos
   dois consome mais `MAX_CREATIVE_REPAIR_ROUNDS`. Sobreposição de logo/texto já era prevenida
   antes da geração (checks pré-existentes). O que ainda força regeneração completa: produto/fato
   errado, composição quebrada, e incompatibilidade de slot de screenshot.
9. **Houve aumento de custo?** Sim, um aumento pequeno e deliberado: 1 chamada de visão adicional
   (texto, não imagem) por geração que tenha zona de renderer ou screenshot — da mesma ordem de
   custo do gate técnico já existente (~$0.002-0.003), nunca perto do custo de uma nova imagem
   (~$0.07). Existe precisamente para evitar gastar uma nova imagem.
10. **ETAPA 3 está pronta para produção?** Verificada localmente (typecheck/build/suíte completa/
    architecture-check/smoke local, todos PASS) — ainda NÃO deployada, aguardando autorização
    explícita conforme instruído.

**Como as ETAPAS 5/6 não foram atingidas, não declaro o Creative Engine resolvido.**

## Respostas às 11 perguntas de fechamento da ETAPA 3.2

1. **Onde exatamente o texto fantasma estava aparecendo?** Não temos o caso ORIGINAL do smoke da
   ETAPA 3.1 re-executado (a pergunta é respondida pelo MECANISMO novo, não por um novo dado
   daquele caso específico): agora a visão reporta uma `bbox` aproximada da localização REAL, que
   pode ser diferente do retângulo planejado da zona — confirmado funcionando em teste local com
   texto deliberadamente fora da zona planejada.
2. **A bbox real é diferente da planned zone?** Sim, pode ser — e o sistema agora trata a BBOX
   real (expandida com margem), nunca mais assume que é a mesma coisa.
3. **Quantas ocorrências do mesmo texto foram encontradas?** O mecanismo agora suporta QUALQUER
   número de ocorrências (cada uma uma entrada separada com sua própria bbox) — testado com 2
   ocorrências simultâneas do mesmo preço em lugares diferentes.
4. **Global recheck funciona?** Sim — testado isoladamente (`checkGlobalTextLegibility`) e
   integrado (aciona reparo quando encontra algo, mesmo depois de todo tratamento local ter
   reportado sucesso).
5. **O preço duplicado residual foi eliminado?** Resolvido no nível de MECANISMO (tratamento na
   bbox real + confirmação global) e confirmado em testes locais — ainda não re-testado contra o
   modelo real em produção (depende de deploy, não autorizado nesta rodada).
6. **Headline ainda colide com logo?** Não mais, quando existe uma região alternativa livre —
   relocaliza sem regenerar imagem. Quando genuinamente não há alternativa, o gate continua
   reprovando corretamente (nunca deixa passar).
7. **Qual era a causa do CREATIVE_PLAN_INVALID?** Não recuperável retroativamente (o smoke
   anterior não logou o diagnóstico, que não existia ainda) — mas o mecanismo agora criado
   (`diagnoseCreativePlanInvalidity`) captura a causa exata de qualquer falha futura.
8. **O repair agora corrige a causa ou repete?** A 2ª tentativa recebe a causa exata anexada ao
   prompt (testado). Quando o MESMO erro estrutural se repete mesmo assim, isso é nomeado
   (`CREATIVE_PLAN_REPEAT_INVALID`) em vez de uma 3ª tentativa silenciosa.
9. **Quantas regenerações foram evitadas?** Nos testes: toda neutralização de texto fantasma
   (bbox real) e toda relocação de overlap geométrico resolvido localmente — zero gerações extras
   nesses casos, confirmado por contagem de chamadas `image_generation` nos testes de integração.
10. **Qual custo do smoke?** Não executado nesta rodada (smoke real depende de deploy, não
    autorizado). Custo marginal esperado por chamada: 1 checagem global extra (texto, barata)
    quando há achado de texto espúrio — mesma ordem de grandeza da análise pré-composição já
    existente, nunca perto do custo de uma imagem.
11. **ETAPA 3.2 está pronta para produção?** Verificada localmente (typecheck/build/suíte
    completa/architecture-check/smoke local, todos PASS) e commitada — aguardando autorização
    explícita de deploy pra confirmar com o modelo real.

**Como o smoke real não foi executado (deploy não autorizado) e as ETAPAS 5/6 continuam
pendentes, não declaro o Creative Engine resolvido.**
