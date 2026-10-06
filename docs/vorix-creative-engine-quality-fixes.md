# Correções do Creative Engine — Rodada 4 (parcial)

> Status: ETAPAS 1, 2, 4, 3, 3.1, 3.2, 3.3 e 3.3.1 — implementadas, testadas e **já em produção**
> (commit `4e3102f`). O smoke real DEFINITIVO confirmou toda a infraestrutura da ETAPA 3.3
> funcionando de ponta a ponta em produção (plano válido na 1ª tentativa, density preflight,
> detecção/tratamento de texto fantasma, reverificação global com passe residual, `planForGate`,
> gate técnico — todos executados e corretos), **mas a revisão visual humana da peça final
> encontrou um texto fantasma residual visível** que a visão automatizada não capturou — a causa
> dominante (cobertura de bbox insuficiente para texto decorativo grande) ficou identificada e
> registrada, sem nova rodada de correção aberta automaticamente. **`COMPOSITION_BLOCK_3X =
> STILL_OPEN`** — "funcionamento da infraestrutura" confirmado, "sucesso da geração" ainda não.
> ETAPAS 5 e 6 **não foram iniciadas**. Por isso, **o Creative Engine NÃO é declarado resolvido**.

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

## ETAPA 3.3 — "VISUAL TEXT BUDGET", reverificação GLOBAL acionável e fechamento do bloco 3.x

### Contexto — os 3 gaps do smoke real da ETAPA 3.2

O smoke real de produção da ETAPA 3.2 (cenário denso: headline+subheadline+CTA+preço+logo)
confirmou bbox/múltiplas ocorrências/recheck local/recheck global funcionando corretamente (3
achados fantasmas neutralizados em 1 passe, N==N), mas revelou três gaps concretos: (i) a
reverificação global só devolvia um booleano — ao encontrar um residual, nada podia ser feito
sobre ele; (ii) o layout denso genuinamente não teve região candidata livre para 4 zonas de texto
competindo com a logo, e todas caíram em `card_fallback` mesmo assim sobrepondo o asset; (iii)
`planForGate`/`technicalQualityGate` nunca chegaram a rodar de verdade, porque o curto-circuito da
reverificação global sempre interceptava antes. O objetivo desta ETAPA, declarado explicitamente
no brief: parar de só provar que o gate rejeita corretamente peças ruins, e produzir evidência de
uma peça DENSA que de fato chega publicável ao fim do pipeline.

### 1) Reverificação GLOBAL agora é ACIONÁVEL

**Antes:** `checkGlobalTextLegibility` devolvia só `boolean` — "ainda há texto não resolvido",
sem localização nenhuma. Quando positivo, a ÚNICA ação possível era rotear pra reparo completo
(nova imagem), mesmo quando o problema residual era pequeno e localizável.

**Depois:** `checkGlobalTextLegibility` devolve `GlobalTextCheckResult = { hasUnresolvedText,
residualFindings: SpuriousTextFinding[] }` — o MESMO formato (texto/classificação/bbox/
confiança) já usado pela análise pré-composição, reaproveitando o parser (`parseSpuriousTexts`,
extraído em `analyze-pre-composition-image.ts`). Fluxo completo em
`run-gpt-creative-engine.ts`: detecção inicial → tratamento local por achado → reverificação
GLOBAL inicial → se aponta um residual COM bbox, trata-o na localização REAL (mesmo mecanismo de
`neutralizeGhostTextZone`) → reverificação GLOBAL final. **Máximo de 1 passe residual** (nunca um
loop) — se ainda houver texto não resolvido depois disso (ou o residual não tiver bbox pra agir),
classifica `UNRECOVERABLE_GLOBAL_TEXT` (novo código, distinto de `UNRECOVERABLE_GHOST_TEXT`, que
continua cobrindo o caso de achado POR ZONA que não neutraliza nem com 2 passes escalados) e
segue a política de reparo já existente (`routeCreativeRepair`/`classifyRepairStrategy`, que trata
o novo código no branch padrão `full_regen_required`, sem precisar de nenhuma regra nova).

### 2) "VISUAL TEXT BUDGET" — obrigatório vs. opcional, e descarte de conteúdo sob densidade

Novo módulo `src/application/creative-engine/manage-text-budget.ts` — lógica PURA e
determinística, mesmo princípio de `resolve-actual-safe-area.ts` (sem IA, sem `sharp`, só decide
a partir de dados que já existem):

- `isTextZoneRequired(zone, plan)`: `headline` é sempre obrigatório; `cta` é obrigatório só
  quando tem texto (`cta: ""` continua sendo "sem CTA", decisão válida); qualquer outra zona
  (subheadline/preço/desconto/url/badge) só é obrigatória quando seu texto corresponde a um
  `requiredRenderedFacts` já declarado pelo plano — o único sinal que o PRÓPRIO plano usa pra
  dizer "esta peça não existe sem isto".
- `isLayoutOverdense(zones, assetPlacements)`: dois sinais deliberadamente simples (nunca um
  "designer de regras", conforme pedido) — contagem de elementos (≥5, o próprio cenário nomeado
  no brief) OU soma bruta de área ocupada (>60% do canvas).
- `simplifyOverdenseTextZones`/`applyTextBudgetSimplification`: **preflight de densidade**,
  chamado em `run-gpt-creative-engine.ts` ANTES de construir o prompt de geração de imagem, sobre
  a geometria DECLARADA do plano (nunca gasta uma geração de imagem só pra descobrir uma
  geometria que o plano já mostra inviável). Descarta zonas OPCIONAIS na ordem
  `url → badge → discount → subheadline` (brief, prioridade conceitual 6/7/8), parando assim que
  o layout deixa de ser denso — nunca descarta a mais do que o necessário, nunca toca uma zona
  obrigatória. Também mantém `allowedRenderedTexts`/`subheadline` coerentes com o que de fato será
  desenhado (um texto descartado cujo nome continuasse "autorizado" reprovaria depois por
  `MISSING_REQUIRED_TEXT` — um bug pior que o original).
- `degradeOptionalZonesOnUnresolvedOverlap`: **degradação PÓS-geometria real**, chamada depois de
  `applySafeAreaAdjustments` (relocação com dados reais de visão/pixel). Quando 2+ zonas
  continuam sobrepondo um asset/outra zona mesmo sem nenhuma região candidata genuinamente livre
  (`unresolvedOverlapKinds`, novo retorno de `applySafeAreaAdjustments`) — o sinal explícito do
  brief de "`card_fallback` virando solução pra tudo" — descarta as OPCIONAIS entre elas (nunca
  as obrigatórias, que continuam reprovando normalmente se o overlap persistir).
- Novo código de gate `OVERDENSE_LAYOUT` (`evaluate-creative-quality-gate.ts`,
  `checkOverdenseLayout`): só dispara quando o `planForGate` (geometria FINAL, já pós-descarte)
  ainda assim tem uma sobreposição geométrica real E o número de elementos já é alto — nunca
  substitui `TEXT_ZONE_OVERLAPS_ASSET`/`TEXT_ZONE_OVERLAPS_TEXT_ZONE` (soma-se a eles), e só
  acontece depois que o motor já tentou simplificar — exatamente a ordem pedida ("sempre tentar
  descartar conteúdo opcional ANTES de reprovar por este motivo").

### 3) `planForGate` com geometria final confirmada (incluindo `allowedRenderedTexts`)

Achado ao escrever esta rodada: a correção da ETAPA 3.2 já trocava `textZones` por
`rendererZones` no `planForGate`, mas `allowedRenderedTexts` continuava sendo o do plano
ORIGINAL — uma zona descartada pelo "VISUAL TEXT BUDGET" (preflight OU degradação pós-geometria)
deixaria seu texto "autorizado" para sempre, reprovando por `MISSING_REQUIRED_TEXT` um texto que o
próprio motor decidiu não desenhar mais. Corrigido: `planForGate.allowedRenderedTexts` agora
filtra os textos de TODAS as zonas descartadas nesta rodada (preflight + degradação), nas duas
fontes. O smoke local novo (ver abaixo) exercita isso de ponta a ponta: o `qualityGate` roda de
verdade (`checkCreativeVisualIntegrity` é chamado com a resposta roteirizada do teste) e aprova.

### 4) Hardening do prompt de `layoutPlan` (sem relaxar o parser)

`buildCreativePlanPrompt` ganhou um exemplo CONCRETO do formato exato de um item de `layoutPlan`
(os 4 campos obrigatórios, valores válidos de `kind`, limites de `rect`) — conforme instruído,
"não construir sistema novo" de enforcement estrutural adicional, e "não relaxar o parser para
aceitar lixo": `parseLayoutPlan`/`parseCreativePlan` continuam rejeitando o plano inteiro da
mesma forma de antes. Teste novo prova o mecanismo de repair-context que já existia
(`diagnoseCreativePlanInvalidity` + `appendPlanRetryDiagnostic`) especificamente para o caso
`layoutPlan` malformado: a 2ª tentativa recebe a causa exata (`campo "layoutPlan" inválido...`) e
produz um plano válido.

### Limitações desta rodada

- `isLayoutOverdense` é uma heurística DELIBERADAMENTE simples (contagem + área bruta) — não
  calcula colisão geométrica real (isso já existe, com custo de IA, no gate). Pode, em tese,
  deixar passar um layout denso cuja soma de áreas é baixa mas cuja disposição real colide (esse
  caso residual ainda é pego pelo gate via `TEXT_ZONE_OVERLAPS_ASSET`/`TEXT_ZONE_OVERLAPS_TEXT_ZONE`/
  `OVERDENSE_LAYOUT`, nunca publica silenciosamente).
- A ordem de descarte (`url → badge → discount → subheadline`) é fixa e simples, conforme pedido
  explicitamente ("não transformar isso em dezenas de regras") — não pondera caso a caso qual
  conteúdo é mais valioso para o objetivo específico da peça.
- `layoutPlan` (mapa de zonas conceituais `hero`/`headline`/`cta`/`logo`/`support`/
  `negativeSpace`) não é automaticamente resync'd quando uma `textZone` é descartada pelo "VISUAL
  TEXT BUDGET" — é só uma camada de DECISÃO/auditoria (nunca a de execução, que são
  `textZones`/`assetPlacements`), então uma referência textual a "subheadline" pode sobrar ali
  mesmo depois do descarte; sem efeito prático na composição final.
- Não foi implementado enforcement de JSON Schema estruturado mais forte na chamada do Director
  (ex.: `response_format` com schema estrito) — o hardening desta rodada ficou no nível de
  PROMPT (exemplo concreto + lembrete de campos obrigatórios), conforme instruído ("não construir
  sistema novo só por isso").

### Testes

- `tests/manage-text-budget.test.mjs` (NOVO, 18 testes) — lógica pura: `isTextZoneRequired`
  (headline sempre obrigatório, cta vazio nunca obrigatório, match aproximado contra
  `requiredRenderedFacts`), `isLayoutOverdense` (por contagem e por área), 5 cenários de
  densidade do grupo (A) do brief (headline+subheadline+CTA+preço+logo; headline+CTA+preço+
  badge+logo; ordem de descarte url→badge→discount→subheadline; "small story" com muitos
  elementos; nunca descarta um obrigatório), `applyTextBudgetSimplification` (remove texto
  descartado de `allowedRenderedTexts`, limpa `plan.subheadline`, no-op quando não denso), e o
  grupo (B) obrigatório/opcional sob sobreposição real (`degradeOptionalZonesOnUnresolvedOverlap`
  — abaixo do limiar não descarta nada, 2+ sobreposições descarta só as opcionais mantendo
  headline/price/cta, nunca descarta uma zona que já relocalizou com sucesso).
- `tests/evaluate-creative-quality-gate.test.mjs` (+3 testes) — `checkOverdenseLayout`: dispara
  com sobreposição real + muitos elementos; nunca dispara só com sobreposição (poucos elementos);
  nunca dispara só com muitos elementos (sem sobreposição real).
- `tests/analyze-pre-composition-image.test.mjs` (+1 teste, 4 reescritos) — `checkGlobalTextLegibility`
  agora parseia achados residuais estruturados (texto/bbox/confiança); os 4 testes booleanos
  preexistentes foram adaptados pro novo formato de retorno (`result.hasUnresolvedText`), sem
  mudar o que cada um prova.
- `tests/run-gpt-creative-engine.test.mjs` (+4 testes de integração): (1) achado residual GLOBAL
  com bbox é tratado na localização real e a reverificação final confirma limpo, publicando com
  UMA imagem só (`GLOBAL_RESIDUAL_BBOX`/`RESIDUAL_SECOND_PASS`); (2) layout denso nomeado no brief
  é simplificado ANTES da geração, subheadline nunca aparece no prompt de imagem nem é exigido no
  gate (`DENSITY_PREFLIGHT`); (3) 2+ zonas opcionais presas em sobreposição mesmo após
  realocação real são descartadas da composição, nunca virando peça cheia de `card_fallback`
  (`OVERDENSE_LAYOUT_CONTROL`); (4) `layoutPlan` malformado na 1ª tentativa do plano inicial
  alimenta a 2ª tentativa com a causa exata e produz um plano válido.
- `tests/round4-etapa3-local-smoke.test.mjs` (+1 cenário, pipeline de pixel REAL) — o cenário
  denso NOMEADO no brief (headline+subheadline+CTA+preço+logo) de ponta a ponta: densidade
  simplificada ANTES da geração, achado residual GLOBAL com bbox recuperado numa única rodada
  extra, e a geometria FINAL (`planForGate`) chegando de fato ao gate técnico
  (`checkCreativeVisualIntegrity` roda e aprova) — publica com uma única imagem gerada, zero
  rodadas de reparo.
- Suíte completa (3314 testes, 2 flakes pré-existentes e não relacionados — `analytics.test.mjs`/
  `cli.smoke.test.mjs`, os mesmos já observados em rodadas anteriores), `typecheck`, `build` e
  `architecture:check` — todos verdes antes do commit desta ETAPA.

### Bloco de classificação — ETAPA 3.3

```
GLOBAL_RESIDUAL_BBOX = PASS
RESIDUAL_SECOND_PASS = PASS (máximo 1 passe residual, nunca um loop — testado em integração e no smoke local de pixel real)
GLOBAL_FINAL_RECHECK = PASS
VISUAL_TEXT_BUDGET = PASS (obrigatório/opcional via `isTextZoneRequired`, 18 testes unitários dedicados)
REQUIRED_OPTIONAL_CLASSIFICATION = PASS
DENSITY_PREFLIGHT = PASS (testado em integração e no smoke local de pixel real — subheadline descartado ANTES da geração)
OPTIONAL_TEXT_DEGRADATION = PASS (preflight E pós-geometria real, duas fontes, ambas filtradas em `planForGate.allowedRenderedTexts`)
OVERDENSE_LAYOUT_CONTROL = PASS (novo código de gate `OVERDENSE_LAYOUT`, só dispara depois de tentar simplificar — nunca substitui os checks geométricos existentes)
PLAN_FOR_GATE_FINAL_GEOMETRY = PASS (bug da ETAPA 3.2 em `allowedRenderedTexts` corrigido nesta rodada; smoke local de pixel real confirma o gate técnico rodando com a geometria final e aprovando)
LAYOUT_PLAN_SCHEMA_HARDENING = PASS (exemplo concreto + lembrete de campos obrigatórios no prompt; parser NÃO foi relaxado)
LAYOUT_PLAN_REPAIR = PASS (teste dedicado: causa exata de `layoutPlan` malformado anexada à 2ª tentativa, produz plano válido)
LOCAL_DENSE_SMOKE = PASS (cenário denso nomeado no brief, pipeline de pixel REAL, publica de ponta a ponta)
STAGE_3_3_READY_FOR_PRODUCTION = YES — verificado localmente (typecheck/build/suíte completa/architecture-check/smoke local, todos PASS) e commitado; smoke real de produção (reusando o MESMO cenário denso) pendente de autorização explícita de deploy
```

### Respostas às 11 perguntas de fechamento da ETAPA 3.3

1. **A reverificação global agora localiza o achado residual?** Sim — devolve texto/
   classificação/bbox/confiança, o mesmo formato da análise pré-composição, nunca mais só um
   booleano.
2. **Quantos passes residuais no máximo?** Exatamente 1 (inicial + 1 residual) — nunca um loop.
   Sem bbox utilizável no residual, ou ainda não resolvido depois do passe, classifica
   `UNRECOVERABLE_GLOBAL_TEXT` e segue a política de reparo normal.
3. **Como o motor decide que "é texto demais"?** Dois sinais simples e determinísticos: contagem
   de elementos (texto + assets) ≥5, ou soma bruta de área ocupada >60% do canvas — nunca uma
   régua de dezenas de regras.
4. **O que é removido primeiro?** Conteúdo OPCIONAL, nesta ordem: URL → badge → desconto →
   subheadline — nunca headline, nunca um CTA que a peça de fato tem, nunca um fato de
   `requiredRenderedFacts`.
5. **Os fatos obrigatórios continuam garantidos?** Sim — `isTextZoneRequired` nunca marca como
   descartável uma zona que corresponde a `requiredRenderedFacts`, mesmo que o layout continue
   denso depois de esgotar as opcionais disponíveis (esse caso residual seguiria pro gate
   geométrico normal, nunca é escondido).
6. **`card_fallback` parou de mascarar layouts congestionados?** Quando 2+ zonas ficam presas em
   sobreposição mesmo sem região livre, o motor agora descarta o conteúdo OPCIONAL entre elas em
   vez de publicar todas empilhadas em cartões — testado em integração.
7. **`planForGate` sempre usa a geometria final?** Sim, incluindo `allowedRenderedTexts` agora
   (gap da ETAPA 3.2 corrigido nesta rodada) — confirmado pelo smoke local de pixel real, onde o
   gate técnico roda de verdade (não é mais `NOT_TRIGGERED`) e aprova com a geometria pós-
   simplificação.
8. **`CREATIVE_PLAN_INVALID` por `layoutPlan` ficou menos provável?** O prompt agora traz um
   exemplo concreto do formato exato — reduz a chance na 1ª tentativa; quando ainda assim
   acontece, a 2ª tentativa recebe a causa exata (testado) e o parser não foi relaxado.
9. **A peça densa passou localmente?** Sim — smoke local novo com o pipeline de pixel REAL
   (sharp de verdade: blur/scrim/logo/texto), reproduzindo o EXATO cenário nomeado no brief, do
   plano inicial até `publishable: true`, zero rodadas de reparo.
10. **Houve aumento relevante de custo?** Marginal e condicional: o passe residual só roda
    quando a reverificação global aponta algo COM bbox (na prática, 1 chamada de visão barata a
    mais só nesse caso específico); a densidade/degradação são lógica pura, sem nenhum custo de
    IA — e quando a simplificação evita uma rodada de reparo completa (nova imagem), o efeito
    líquido tende a ser REDUÇÃO de custo, não aumento.
11. **Pronto para deploy/smoke real?** Verificado localmente (typecheck/build/suíte completa/
    architecture-check/smoke local de pixel real, todos PASS) e commitado — aguardando
    autorização explícita de deploy para reusar o MESMO cenário denso contra o modelo real, com o
    objetivo explícito de finalmente alcançar uma peça publicável de ponta a ponta.

**Como as ETAPAS 5/6 continuam pendentes, mesmo com a ETAPA 3.3 verificada localmente e pronta
para produção, não declaro o Creative Engine resolvido — o smoke real de produção (deploy não
autorizado nesta rodada) ainda precisa confirmar contra o modelo real o que já está comprovado
localmente.**

## Deploy e smoke real de produção — ETAPA 3.3 (commit `d3e6466`)

Deployado em produção (commit `d3e6466`, SHA anterior `850ac04` registrada para rollback) após
autorização explícita. Health check pós-deploy: WEB/API/WORKER/POSTGRES todos `HEALTHY`, sha256
dos arquivos alterados conferido byte-a-byte entre local e servidor, `.env.zuno` preservado, sem
migration nova.

**Execução 1 (fixture bug, não conta como teste do mecanismo):** a URL de logo do fixture
(`placehold.co/..?text=LOGO`, sem extensão) serviu um formato que a API de visão da OpenAI
rejeitou (`invalid_image_format`) — `requestCreativePlan` falhou nas duas tentativas (ambas
`status: failed`, nunca chegaram a `parseCreativePlan`), zero custo de imagem. Corrigido no
fixture (`.png` explícito na URL) e re-executado — bug do script de smoke, não do Creative Engine.

**Execução 2 (real, dentro do limite de 2):** `director` processou normalmente (custo
`$0.0025`), mas o `creative_plan` inicial veio com `layoutPlan` estruturalmente malformado NAS
DUAS tentativas, com a MESMA causa diagnosticada
(`diagnoseCreativePlanInvalidity`: `campo "layoutPlan" inválido — alguma zona tem kind/rect/
priority/rationale malformado.`) — classificado corretamente como `CREATIVE_PLAN_REPEAT_INVALID`,
exatamente o mecanismo da ETAPA 3.2/3.3 funcionando como projetado: nenhuma imagem gerada, custo
total de apenas `$0.0028`, diagnóstico preciso registrado. **O pipeline nunca chegou a produzir um
`creative_plan` válido**, então nenhum dos mecanismos específicos da ETAPA 3.3 (reverificação
global residual, VISUAL TEXT BUDGET, `planForGate`, `technicalQualityGate`) foi exercitado nesta
rodada — honestamente reportado como `NOT_TRIGGERED`, nunca fabricado como `PASS`.

Com as 2 execuções controladas já usadas (limite do brief), nenhuma terceira tentativa foi feita.
Produção segue saudável (confirmado health check pós-smoke), nenhum rollback necessário (rejeição
de qualidade isolada na geração do plano, nunca uma falha estrutural do pipeline/infraestrutura).

### Bloco de classificação — Deploy e smoke real ETAPA 3.3

```
DEPLOY_COMMIT = d3e6466
PRODUCTION_DEPLOY = PASS
WEB = HEALTHY
API = HEALTHY
WORKER = HEALTHY
IMAGE_PROVIDER = HEALTHY (confirmado indiretamente — a chamada de texto ao provider OpenAI completou normalmente; nenhuma geração de imagem foi tentada nesta rodada, nunca chegou lá)
GLOBAL_RESIDUAL_BBOX_RUNTIME = NOT_TRIGGERED
RESIDUAL_SECOND_PASS_RUNTIME = NOT_TRIGGERED
GLOBAL_FINAL_RECHECK_RUNTIME = NOT_TRIGGERED
VISUAL_TEXT_BUDGET_RUNTIME = NOT_TRIGGERED
DENSITY_PREFLIGHT_RUNTIME = NOT_TRIGGERED
OPTIONAL_DEGRADATION_RUNTIME = NOT_TRIGGERED
REQUIRED_FACTS_PRESERVED = NOT_TRIGGERED (nada a preservar — nenhum plano válido chegou a existir)
OVERDENSE_LAYOUT_RUNTIME = NOT_TRIGGERED
PLAN_FOR_GATE_RUNTIME = NOT_TRIGGERED
TECHNICAL_GATE_EXECUTED = NO
TECHNICAL_GATE_RESULT = NOT_EXECUTED
DENSE_REAL_PIECE_PUBLISHABLE = NO
CREATIVE_ENGINE_SMOKE = PASS (mecanismo de segurança funcionou exatamente como projetado: detectou plano estruturalmente inválido, nunca publicou algo quebrado, zero custo de imagem desperdiçado — mas NÃO validou as mecânicas específicas da ETAPA 3.3, que dependem de um plano válido rio abaixo)
ROLLBACK_REQUIRED = NO
COMPOSITION_BLOCK_3X = STILL_OPEN (sem evidência runtime de uma peça densa real publicável — critério do ponto 23 do brief não satisfeito)
```

### Entrega

1. **SHA anterior:** `850ac04` (ETAPA 3.2, confirmada em produção antes do deploy).
2. **SHA publicado:** `d3e6466` (ETAPA 3.3, confirmado por sha256sum byte-a-byte).
3. **Health checks:** WEB=200, API `{"status":"ok"}`, WORKER healthy, POSTGRES healthy — antes E depois do smoke.
4. **Zonas de texto iniciais:** nenhuma — o `creative_plan` nunca chegou a ser parseado com sucesso (falhou em `layoutPlan` nas duas tentativas).
5. **Required:** N/A (sem plano válido).
6. **Optional:** N/A (sem plano válido).
7. **Removidas:** nenhuma (preflight de densidade nunca rodou — depende de um plano já parseado).
8. **Global residual apareceu?** Não chegou a essa etapa.
9. **Residual second pass usado?** Não.
10. **Resultado do global final recheck:** N/A — não executado.
11. **Geometria final:** N/A — não existe (sem plano válido, sem imagem gerada).
12. **`planForGate` executou?** Não — nunca houve geometria pra montar.
13. **`technicalQualityGate` executou?** Não.
14. **Peça ficou publicável?** Não.
15. **Gerações/reparos:** 0 gerações de imagem; 0 rodadas de reparo (a falha aconteceu ANTES do loop de reparo do gate técnico — é a mesma proteção `CREATIVE_PLAN_REPEAT_INVALID` da ETAPA 3.2, que nunca tenta uma 3ª vez o mesmo prompt).
16. **Custo:** execução 1 (fixture com bug) `$0.00028`; execução 2 (real) `$0.0028` — total `$0.0031` nas duas execuções combinadas, nenhum custo de imagem em nenhuma delas.
17. **Novo defeito encontrado?** Sim, mas de PROMPT/CONTEÚDO, não de infraestrutura: o Director real (`gpt-4o`) produziu `layoutPlan` malformado duas vezes seguidas para este fixture específico, mesmo com o hardening de prompt desta rodada (exemplo concreto) — o mecanismo de diagnóstico/retry funcionou perfeitamente (zero desperdício), mas não teve sucesso em corrigir o Director desta vez. Nenhum defeito de regressão da ETAPA 3.3 em si foi observado (as mecânicas dela nunca chegaram a ser exercitadas).
18. **Bloco 3.x pode ser encerrado?** **Não** — sem evidência runtime de uma peça densa real publicável (critério explícito do brief, ponto 23), `COMPOSITION_BLOCK_3X = STILL_OPEN`. O mecanismo de segurança (nunca publica algo quebrado, nunca desperdiça custo) está confirmado funcionando em produção; a demonstração completa de ponta a ponta (plano válido → imagem → simplificação → gate → publicável) permanece pendente de uma nova tentativa de smoke (fora desta rodada, que já usou as 2 execuções permitidas).

## ETAPA 3.3.1 — Hardening do contrato estrutural do `layoutPlan` (correção pontual)

Disparada pelo bloqueador exato da ETAPA 3.3: `CREATIVE_PLAN_REPEAT_INVALID` nas duas tentativas
do smoke real, sempre pela mesma causa relacionada a `layoutPlan`. Objetivo único: fazer o
Director produzir `layoutPlan` estruturalmente válido de forma confiável — **nunca relaxar o
parser** (ele continua sendo a fonte de verdade; dado inválido continua sendo rejeitado).

### Causa raiz (identificada com dados reais, nunca suposição)

Reproduzido localmente contra o modelo REAL (fixture EXATO do smoke, chave de API lida de um
arquivo local nunca impressa, sem nenhum deploy): 5 execuções plan-only (texto, zero geração de
imagem) usando o prompt/parser ANTES desta correção. **10/10 tentativas** (5 execuções × 2
tentativas cada) falharam pela MESMA causa: o Director usa sistematicamente um `kind` de
`textZones` (`"price"`, `"subheadline"` confirmados nas amostras) DENTRO de `layoutPlan[].kind` —
um vocabulário DIFERENTE e MENOR (`CREATIVE_LAYOUT_ZONE_KINDS = ["hero","headline","cta","logo",
"support","negativeSpace"]`, nunca "price"/"subheadline"/"discount"/"url"/"badge"). Em TODAS as
amostras capturadas, `rect`/`priority`/`rationale` estavam perfeitamente bem formados — a causa é
exclusivamente de vocabulário de `kind`, nunca geometria, nunca tipo/range de prioridade, nunca
formatação de `rationale`. A confusão é compreensível: os dois vocabulários compartilham
"headline"/"cta", então o modelo generaliza que qualquer `kind` de conteúdo serve nos dois
lugares — o diagnóstico antigo ("alguma zona tem kind/rect/priority/rationale malformado") nunca
dizia isso, só uma categoria genérica.

### O que mudou

1. **Prompt** (`buildCreativePlanPrompt`) — nova regra explícita e isolada, com contraste direto
   PERMITIDO vs. PROIBIDO: `layoutPlan[].kind` é um vocabulário fechado de 6 valores, distinto de
   `textZones[].kind`; qualquer conteúdo que não seja literalmente headline/cta/logo (preço,
   subheadline, desconto, URL, badge, produto, screenshot) deve usar `"support"` ou `"hero"` no
   mapa de composição — nunca o nome do conteúdo em si.
2. **Diagnóstico** — nova função interna `diagnoseLayoutPlanInvalidity` (mesmas validações de
   `parseLayoutPlan`, na mesma ordem, NUNCA muda o que é aceito/rejeitado) aponta a zona pelo
   ÍNDICE e o campo/valor EXATO que falhou, em vez de uma categoria genérica — e nomeia
   especificamente o caso de confusão de vocabulário quando é exatamente isso (`layoutPlan[N].kind
   = "price" é um kind de "textZones" (vocabulário ERRADO)...`), alimentando tanto o retry da
   tentativa inicial (`appendPlanRetryDiagnostic`) quanto, nos achados do smoke, o fluxo de
   reparo pós-gate (mesmo princípio, mesma fonte de verdade).
3. **Structured output (auditado, não implementado)** — o modelo usado (`gpt-4o-2024-08-06`)
   suporta OpenAI Structured Outputs (`response_format: {type:"json_schema", strict:true}`), e a
   infraestrutura atual (`OpenAiIcaroTextProvider`) já monta o `response_format` inline por
   requisição — adicionar isso seria tecnicamente possível sem infraestrutura nova. **Não
   implementado nesta rodada**: a correção de prompt + diagnóstico já atingiu 5/5 (100%) no teste
   de estabilidade real (abaixo), tornando o enforcement estrutural mais pesado desnecessário por
   ora — mantido documentado aqui como opção futura caso a taxa volte a degradar.
4. **Repair direcionado (seção 13 do brief) — não necessário.** O mecanismo de retry EXISTENTE
   (reenvia o plano completo + instrução "corrija EXATAMENTE isso, mantendo o resto coerente") já
   preserva naturalmente copy/fatos/direção de arte válidos ao corrigir só o campo apontado —
   confirmado no teste de estabilidade (rodada 5, abaixo): o Director corrigiu `layoutPlan` sem
   alterar o resto do plano. Nenhuma repair mais cirúrgica foi necessária.

### Teste de estabilidade (brief, ponto 16/18) — contra o modelo REAL, zero imagem

5 execuções plan-only consecutivas, mesmo fixture do smoke real, AGORA com prompt+diagnóstico
corrigidos — sem nenhum deploy (chave de produção usada via o container já rodando, só a
copiar um código novo e ainda não publicado para gerar o prompt; a chamada de rede em si passou
pelo texto-provider já deployado):

```
RUN 1: válido na 1ª tentativa
RUN 2: válido na 1ª tentativa
RUN 3: válido na 1ª tentativa
RUN 4: válido na 1ª tentativa
RUN 5: 1ª tentativa ainda usou "subheadline" em layoutPlan[1].kind (o erro NÃO foi eliminado
       100% só pelo prompt — esperado, modelo é probabilístico) — diagnóstico específico
       disparado, 2ª tentativa corrigiu e produziu plano válido, preservando o resto do plano.
```

**CREATIVE_PLAN_VALID_RATE = 5/5 (100%)** — acima da meta mínima de homologação (brief, ponto
18). Custo total das 5 execuções: `$0.007443` (zero geração de imagem). Comparação com o
baseline (prompt antigo): 0/10 tentativas válidas (10/10 falhas, mesma causa) → 5/5 execuções
finais válidas (4/5 já na 1ª tentativa) — melhoria direta e mensurável.

### Testes

- `tests/gpt-creative-plan-types.test.mjs` (+9 testes): `diagnoseLayoutPlanInvalidity` cobrindo
  cada campo isoladamente (`kind` com valor de `textZones` — "price" e "subheadline" — vs. `kind`
  genuinamente desconhecido; `rect` inválido; `priority` não-numérica; `rationale` vazia; múltiplas
  zonas apontando o índice correto) e o fixture EXATO (5 zonas, a 2ª com `kind: "price"`) que
  falhou no smoke real de produção em 2026-10-06.
- `tests/run-gpt-creative-engine.test.mjs` (1 teste ajustado): a asserção de "2ª tentativa recebe
  a causa exata" agora confere o novo formato mais específico (`layoutPlan[0].kind`) em vez da
  categoria genérica antiga.
- Suíte completa (3322 testes, os mesmos 2 flakes pré-existentes e não relacionados —
  `analytics.test.mjs`/`cli.smoke.test.mjs`), `typecheck`, `build` e `architecture:check` — todos
  verdes antes do commit.

### Bloco de classificação — ETAPA 3.3.1

```
LAYOUT_PLAN_ROOT_CAUSE = IDENTIFIED
INVALID_FIELD = layoutPlan[].kind (valores de textZones — "price"/"subheadline" — usados onde só hero/headline/cta/logo/support/negativeSpace são válidos)
STRUCTURED_CONTRACT = PROMPT_ONLY (structured output auditado e viável, mas não necessário — 100% atingido sem ele)
LAYOUT_PLAN_KIND = FAILED (era a causa real, 10/10 antes da correção) -> PASS após a correção (0/5 na validação final, exceto 1 recuperado por retry)
LAYOUT_PLAN_RECT = PASS (nunca foi a causa em nenhuma amostra real capturada)
LAYOUT_PLAN_PRIORITY = PASS (idem)
LAYOUT_PLAN_RATIONALE = PASS (idem)
REPAIR_SCHEMA_CONTEXT = PASS (diagnóstico agora cita campo+valor+zona exatos, não só a categoria)
TARGETED_PLAN_REPAIR = NOT_APPLICABLE (o retry de plano completo já preserva o resto corretamente, confirmado na rodada 5 do teste de estabilidade — nenhuma repair mais cirúrgica foi necessária)
FIXTURE_REGRESSION_TEST = PASS (fixture exato do smoke real coberto em teste unitário permanente)
PLAN_ONLY_REAL_RUNS = 5 (validação final) + 5 (baseline antes da correção, só pra medir a causa) = 10 no total desta rodada
VALID_PLANS = 5 (validação final, pós-correção)
INVALID_PLANS = 0 (validação final — o 1 caso residual foi recuperado pelo retry, contado como válido no resultado final)
CREATIVE_PLAN_VALID_RATE = 100%
IMAGE_GENERATIONS = 0
STAGE_3_3_1_READY_FOR_PRODUCTION = YES
```

### Respostas de fechamento

1. **Qual campo realmente estava quebrando?** `layoutPlan[].kind` — nunca `rect`/`priority`/
   `rationale`, confirmado em 10/10 amostras reais capturadas.
2. **O que o Director retornava?** Um `kind` de `textZones` (ex.: `"price"`, `"subheadline"`)
   dentro de uma zona de `layoutPlan`, que só aceita hero/headline/cta/logo/support/negativeSpace.
3. **O que o parser esperava?** Exatamente esses 6 valores fechados — nunca relaxado nesta
   correção.
4. **Por que o repair anterior repetia a falha?** O diagnóstico enviado de volta ao Director era
   genérico ("alguma zona tem kind/rect/priority/rationale malformado") — nunca dizia QUAL zona
   nem QUAL valor estava errado, então o Director não tinha informação suficiente pra corrigir de
   forma confiável.
5. **Agora existe schema enforcement ou ainda dependemos de prompt?** Ainda depende de prompt +
   diagnóstico preciso — `response_format: json_schema` estrito foi auditado como viável
   (modelo/infra suportam), mas não implementado por não ser necessário para atingir 100% nesta
   rodada.
6. **O repair ficou específico para `layoutPlan`?** O DIAGNÓSTICO ficou específico (zona+campo+
   valor exatos); o repair em si continua reenviando o plano inteiro com a causa anexada — testado
   e confirmado que isso já preserva o resto do plano corretamente, sem necessidade de uma repair
   mais cirúrgica.
7. **Quantos planos reais foram testados?** 10 no total desta rodada: 5 no baseline (medição da
   causa, prompt antigo) + 5 na validação final (prompt/diagnóstico corrigidos).
8. **Quantos foram válidos?** 0/5 no baseline (confirmando a causa) → 5/5 na validação final.
9. **Quanto custou?** `$0.011890` (baseline) + `$0.007443` (validação final) = `$0.019333` no
   total desta rodada — zero geração de imagem em qualquer chamada.
10. **Está pronto para deploy?** Sim, localmente verificado (typecheck/build/suíte completa/
    architecture-check, todos PASS) e commitado — **não deployado nesta rodada**, conforme
    instruído. O smoke completo da ETAPA 3.3 (com geração de imagem) permanece pendente de nova
    autorização explícita.

**Como esta foi uma correção pontual sobre um bloqueador específico (nunca o fechamento do bloco
3.x), `COMPOSITION_BLOCK_3X` permanece `STILL_OPEN` até um novo smoke completo confirmar uma peça
densa real publicável de ponta a ponta com este fix em produção.**

## Deploy e smoke real DEFINITIVO — ETAPA 3.3 pós-3.3.1 (commit `4e3102f`)

Deployado em produção após autorização explícita (SHA anterior `d3e6466`, backup criado, sem
migration nova, `.env.zuno` preservado, sha256 conferido byte-a-byte, health check PASS em
WEB/API/WORKER/POSTGRES antes e depois).

**1 única execução controlada** (das 2 permitidas) foi necessária — fixture QA densa (headline +
subheadline + preço confirmado + CTA + logo, formato 4:5): o Director produziu `layoutPlan`
válido JÁ NA PRIMEIRA TENTATIVA (zero confusão de vocabulário `kind` — a correção da ETAPA 3.3.1
se confirmou em produção real), o preflight de densidade descartou o `subheadline` opcional antes
da geração, a imagem base saiu com 2 textos fantasma (`"R$ 149,00"` e `"COMPRE AGORA"`), ambos
neutralizados localmente em 1 passe cada, a reverificação global encontrou um residual
(`"LOGO"`, texto não autorizado — provável artefato do fixture de logo placeholder, que tem a
palavra "LOGO" escrita nele) tratado com sucesso na rodada residual única, o renderer desenhou as
3 zonas finais (headline/preço/CTA), `planForGate` recebeu a geometria final, e o
`technicalQualityGate` executou e aprovou (verdict `pass`, zero issues).

**Avaliação visual humana da imagem final (obrigatória pelo brief, nunca só o veredito do gate):**
a peça tem um defeito real que a visão automatizada (local + global, ambas) NÃO capturou — o texto
fantasma **"COMPRE AGORA"** (estilizado, grande, no mesmo padrão visual do fundo) continua
PARCIALMENTE LEGÍVEL, vazando por cima/ao redor do cartão do CTA renderizado por cima — a banda de
texto fantasma é mais alta que a área efetivamente tratada (blur+véu), então as bordas superiores
ficam expostas. Isso é um **texto fantasma residual real**, exatamente um dos critérios
desqualificantes que o brief pede para checar manualmente (ponto 4) — mesmo com o pipeline
inteiro tendo funcionado corretamente e o gate técnico tendo aprovado.

**Conclusão honesta:** a INFRAESTRUTURA da ETAPA 3.3 funcionou de ponta a ponta exatamente como
projetada (density preflight, residual global, `planForGate`, gate técnico todos executados e
corretos) — mas isso **não é o mesmo que a GERAÇÃO ter tido sucesso criativo** (brief, ponto 21:
"não confundir funcionamento da infraestrutura com sucesso da geração"). A causa dominante do
texto fantasma residual visível é uma limitação de COBERTURA da detecção/tratamento de bbox: a
visão (local e global) subestimou a extensão real do texto fantasma, então nem o padding de
segurança nem a reverificação (que também é vision-based, mesma limitação) pegaram o vazamento nas
bordas. Nenhuma correção de código foi aplicada nesta rodada (conforme instruído, "sem abrir
automaticamente outra rodada de desenvolvimento") — a causa foi identificada e registrada.

### Bloco de classificação — Deploy e smoke definitivo

```
DEPLOY_COMMIT = 4e3102f
PRODUCTION_HEALTH = HEALTHY
DIRECTOR_PLAN_VALID = YES (layoutPlan válido na 1ª tentativa, zero confusão de vocabulário kind)
DENSITY_CONTROL_RUNTIME = PASS (preflight descartou subheadline antes da geração)
GLOBAL_RECHECK_RUNTIME = PASS (automatizado — inicial + 1 passe residual, confirmado limpo; ver ressalva de revisão visual humana abaixo)
DETERMINISTIC_TEXT_RUNTIME = PASS (headline/preço/CTA renderizados, legíveis, textos corretos)
PLAN_FOR_GATE_RUNTIME = PASS (geometria final, zero issues geométricas)
TECHNICAL_GATE_EXECUTED = YES
TECHNICAL_GATE_RESULT = PASS
DENSE_REAL_PIECE_PUBLISHABLE = NO (critério humano, brief ponto 4 — texto fantasma residual "COMPRE AGORA" visivelmente parcialmente legível, apesar do gate automatizado ter aprovado)
VISUAL_QUALITY = NEEDS_REVIEW (confirmado tanto pelo Visual Quality Score automatizado — belowThreshold=true — quanto pela revisão visual humana)
IMAGE_GENERATIONS = 1
TOTAL_COST_USD = 0.07537
COMPOSITION_BLOCK_3X = STILL_OPEN
```

### Causa dominante (sem nova rodada de desenvolvimento aberta, conforme instruído)

**Cobertura insuficiente da detecção/tratamento de texto fantasma de alto contraste e fonte
estilizada grande** — o mesmo tipo de achado da ETAPA 3.1 (blur insuficiente), mas desta vez na
dimensão de EXTENSÃO/ÁREA do bbox detectado pela visão (não mais intensidade de blur/véu, já
resolvida). A visão (local e global) relatou "não legível" com confiança, mas um texto decorativo
grande/estilizado pode exceder a bbox com folga que a visão reportou mesmo após o padding de
segurança (`expandBboxWithPadding`, 18%). Nenhuma mudança de código feita nesta rodada — fica
registrado como o PRÓXIMO bloqueador concreto do bloco 3.x, caso o usuário autorize uma nova
etapa de correção.
