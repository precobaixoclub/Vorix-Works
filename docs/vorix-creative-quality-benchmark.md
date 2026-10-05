# Benchmark de Qualidade Criativa — Vorix vs. GPT Direto (Rodada 3)

> **Regra desta rodada**: nada aqui foi implementado. Este documento é diagnóstico.
> Nenhuma mudança de custo, budget, modelo ou prompt criativo foi feita. Apenas o
> incidente de quota da OpenAI (seção 0) foi corrigido, por ser um bloqueio de produção
> anterior ao benchmark, autorizado explicitamente antes de retomar esta rodada.

## 0. Pré-requisito: incidente de produção (resolvido antes do benchmark)

Durante a construção do harness, uma sonda direta à API da OpenAI revelou
`insufficient_quota`/`credit_balance_exhausted` na conta de produção — um incidente real
afetando 100% dos clientes. Isso foi resolvido (crédito restaurado pelo usuário) e
seguido de uma auditoria completa de classificação de erros antes de retomar o
benchmark, com gate de verificação completo (typecheck/build/testes/architecture-check)
e smoke test real. Commit `6b2c6b3`. Detalhes técnicos completos (arquivos, testes,
política de retry) estão registrados no histórico da sessão; resumo funcional:

- `quota_exhausted` agora é um `kind`/`category` distinto de `rate_limit` em toda a
  cadeia (`ai-provider.port.ts`, `ai-media-provider-adapter.port.ts`,
  `openai-image-provider-adapter.ts`, `openai-icaro-text-provider.ts`, `icaro-brain.ts`).
- Nunca retentado automaticamente; aborta antes de gastar as tentativas do próprio
  Creative Engine.
- Mensagem ao cliente nunca expõe `insufficient_quota`/billing/OpenAI — mensagem
  genérica sanitizada.
- Log interno: `provider=openai category=quota_exhausted operation=image_generation`
  (nunca o segredo).
- `health()` do adapter reporta `ok=false` sem precisar de nova chamada paga (usa o
  sinal da última falha real).
- 20 testes novos/atualizados, 53/53 no alvo, 3159/3161 na suíte completa (2 flakes
  pré-existentes e não relacionados).

Classificação deste bloco: **ver seção 8**.

## 1. Metodologia

- Harness standalone (`scratch-creative-benchmark.mjs`, não commitado — artefato
  descartável), rodado dentro do container de produção via `docker exec`, importando os
  módulos `dist/` REAIS (mesmo código do Creative Engine em produção).
- Para cada cenário: mesmo `CreativeContext` (mesma marca, mesmos fatos confirmados,
  mesmos assets) é usado em dois caminhos:
  - **(B) Vorix completo**: `runGptCreativeEngine` real — Creative Plan → geração de
    imagem → composição determinística (logo/screenshot/texto) → Quality Gate → Visual
    Quality Score → (repair se aplicável).
  - **(C) GPT direto**: a mesma chamada de geração de imagem (`gpt-image-1`, mesmo
    provider, `quality:"medium"`), mas com um prompt único e direto — "como um usuário
    normal pediria no ChatGPT" — sem Creative Plan, sem composição determinística, sem
    Quality Gate.
  - **(A) Modelo puro / pré-overlay**: snapshot do buffer de imagem do Vorix
    ANTES de qualquer composição determinística (logo/screenshot/texto), capturado por
    instrumentação dos três compositores. Serve para isolar defeitos do MODELO dos
    defeitos do RENDERER.
- 10 cenários cobrindo produto físico (com e sem preço), serviço, promoção sem preço,
  institucional/branding premium (par com 2 marcas visualmente distintas, para testar
  influência do Brand Visual Profile), anúncio SaaS com screenshot real, publicação
  educativa, story de urgência (Black Friday), produto físico lifestyle, oferta densa
  com múltiplos fatos (preço + parcelamento + CTA).
- Custo de cada chamada registrado via `estimateGptImage1CostUsd` (não otimizado nesta
  rodada — apenas medido).
- Nenhum dado real/sensível de cliente foi usado; todos os assets (logo, screenshot)
  são sintéticos (`placehold.co`), hospedados publicamente apenas pelo tempo do teste.

**Limitação confessa do design do benchmark**: nenhum dos 10 cenários usou uma foto real
de produto como asset de referência (`original_asset`/`reference_edit`). Isso significa
que a fidelidade ao produto (dimensão 7) e o caminho `REFERENCE_EDIT` não puderam ser
testados neste benchmark — ficou coberto apenas por auditoria de código (seção 7.2).

## 2. Resultado por cenário

| # | Cenário | Vorix gerou imagem? | Veredito | Defeito principal observado |
|---|---|---|---|---|
| 01 | Produto físico c/ preço (Nortrail tênis) | Sim | DIRECT_GPT_BETTER | Texto fantasma/duplicado no headline, mesmo marcado `renderedBy:"renderer"` e com instrução explícita de deixar em branco — o modelo não obedeceu; Quality Gate não pegou (publishable:true) |
| 02 | Serviço/consultoria (Âncora Capital) | Sim | DIRECT_GPT_BETTER | Nome da marca alucinado errado ("ANCORA SAVITAL" em vez de "Âncora Capital"); corrupção ortográfica em texto desenhado pelo modelo |
| 03 | Promoção sem preço, story (Casa Viva) | Sim | TIE | Resultado equivalente, sem defeitos graves de nenhum lado |
| 04 | Institucional premium luxo (Lumière Joias) | **Não — falhou 2/2 tentativas** | DIRECT_GPT_BETTER (por ausência) | Bug de validação: `cta:""` nunca pode satisfazer `allowedRenderedTexts.includes(cta)` → `CREATIVE_PLAN_INVALID` garantido (ver seção 7.7) |
| 05 | Institucional premium streetwear (Riot Wear) | **Não — falhou 2/2 tentativas** | DIRECT_GPT_BETTER (por ausência) | Mesmo bug do CTA vazio que o cenário 04 |
| 06 | Anúncio SaaS c/ screenshot real (Fluxly) | Sim, mas **rejeitado pelo Quality Gate** | DIRECT_GPT_BETTER | Screenshot real composto em posição desalinhada com a "tela do cofre" desenhada pelo modelo (falha genuína de coordenação de safe-area) + CTA/subheadline ilegíveis — o ÚNICO cenário em que o Quality Gate corretamente impediu a publicação de um defeito real |
| 07 | Publicação educativa (Sorriso Pleno Odontologia) | Sim | DIRECT_GPT_BETTER | Sobreposição entre logo e texto do headline |
| 08 | Story urgência Black Friday (TechBox) | Sim | DIRECT_GPT_BETTER | Corrupção ortográfica em CTA/preço desenhados pelo modelo ("gratis"→deformado, "necessidada", "creidito") |
| 09 | Produto físico lifestyle (Grão Raiz café) | Sim | VORIX_BETTER | Sem defeitos relevantes; melhor coerência de composição que o GPT direto |
| 10 | Oferta densa, múltiplos fatos (MadeiraViva Móveis) | Sim, mas **publicado com defeitos** | DIRECT_GPT_BETTER | Preço confirmado (`R$ 2.499,00`) **ausente da imagem final** apesar de ser fato confirmado; CTA cortado/fora da área visível (violação de safe-area); composição em colagem de dois painéis, menos coesa que o GPT direto (cena única) |

## 3. Causas raiz, por bucket

| Bucket | Evidência | Cenários afetados |
|---|---|---|
| **IMAGE GENERATION** (o modelo gpt-image-1 em si) | Texto fantasma/duplicado em zonas marcadas para não serem desenhadas pelo modelo; corrupção ortográfica recorrente em texto desenhado pelo modelo (CTA/preço/subheadline); alucinação de nome de marca | 01, 02, 08 |
| **SAFE AREA / RENDERER** (coordenação entre Creative Plan e composição determinística) | Screenshot real desalinhado com a cena desenhada; CTA cortado fora da área visível; sobreposição logo↔headline; colagem de painéis em vez de composição única | 06, 07, 10 |
| **CREATIVE PLAN / VALIDAÇÃO** | `cta:""` (correto para peças sem venda direta) rejeitado por validação que exige `allowedRenderedTexts.includes(cta)`, impossível de satisfazer com string vazia — reprovação garantida 2/2 tentativas | 04, 05 |
| **QUALITY GATE** | Não detecta texto fantasma/duplicado (sem checagem de "double-rendering"); não detecta ausência de um fato confirmado na imagem final (preço sumiu e ninguém barrou); funcionou corretamente 1 vez (cenário 06) | 01, 10 (falhas de detecção); 06 (acerto) |
| **BRAND** (Brand Visual Profile / paleta) | Cor da marca é instrução forte e repetida (prompt do plano + prompt da imagem + checagem do gate); tipografia/fonte é só uma nota livre opcional, sem campo estruturado — não dá pra confirmar fidelidade tipográfica à marca | 04/05 não puderam ser comparados (sem imagem Vorix); ver seção 7.3 |
| **ASSET SELECTION / LOGO** | Logo sempre colado sobre cartão branco fixo, sem variante clara/escura nem adaptação ao fundo — risco de contraste ruim ou "aparência de sticker colado" em fundos já claros | Visível em todos os cenários com logo (não causou falha visível no benchmark, mas é um risco estrutural confirmado em código) |
| **PROMPT / COPY** | Não foi possível isolar como causa raiz distinta de IMAGE GENERATION neste benchmark — a corrupção ortográfica parece ser do modelo de imagem, não da copy gerada pelo Ícaro/Bianca (que chega como texto limpo no plano, antes de ser desenhado) | — |
| **RETRY WASTE** | Confirmado em código (não observado diretamente no benchmark, pois nenhum cenário disparou o segundo round): um dip isolado de score estético (<6.5/10 geral OU qualquer dimensão <4/10) consome o MESMO orçamento de 1 repair round que uma falha técnica grave — ver seção 7.5 | — |

## 4. Scoring qualitativo (1–5) por par, dimensões principais

Nota: cenários 04/05 não puderam ser pontuados no lado Vorix (nenhuma imagem foi
gerada); a imagem C (GPT direto) existe e foi revisada, mas sem par B não há
comparação par-a-par.

| Dimensão | 01 | 02 | 03 | 06 | 07 | 08 | 09 | 10 |
|---|---|---|---|---|---|---|---|---|
| Composição/hierarquia | 3 vs 4 | 3 vs 4 | 4 vs 4 | 2 vs 4 | 3 vs 4 | 3 vs 4 | 4 vs 4 | 2 vs 4 |
| Tipografia/legibilidade | 2 vs 4 | 2 vs 4 | 4 vs 4 | 2 vs 4 | 3 vs 4 | 2 vs 4 | 4 vs 4 | 3 vs 4 |
| Integração texto/imagem | 3 vs 4 | 3 vs 4 | 4 vs 4 | 2 vs 4 | 2 vs 4 | 3 vs 4 | 4 vs 4 | 3 vs 4 |
| Fidelidade à marca | 4 vs 3 | 1 vs 3 | 4 vs 3 | 3 vs 3 | 4 vs 3 | 4 vs 3 | 4 vs 3 | 4 vs 3 |
| Aparência profissional | 3 vs 4 | 2 vs 4 | 4 vs 4 | 2 vs 3 | 3 vs 4 | 3 vs 4 | 4 vs 4 | 3 vs 4 |
| Adequação ao objetivo (fatos presentes) | 4 vs 4 | 4 vs 4 | 4 vs 4 | 2 vs 4 | 4 vs 4 | 4 vs 4 | 4 vs 4 | **2 vs 4** |

(Demais 6 dimensões do brief — uso de espaço, qualidade da imagem, variedade
criativa — foram avaliadas qualitativamente nas notas da seção 2/3, não tabuladas
numericamente aqui para não simular uma precisão que a revisão visual manual não
sustenta com rigor estatístico.)

**Leitura honesta**: a fidelidade à marca tende a favorecer o Vorix (paleta de cores
obrigatória é respeitada), mas tipografia/legibilidade e aparência profissional tendem a
favorecer o GPT direto — justamente porque o GPT direto não tenta coordenar
plano+geração+composição determinística, então tem menos pontos de falha de integração.

## 5. Por que o GPT direto ainda ganha em boa parte dos casos

Não é por o modelo do GPT direto ser "melhor" — é o MESMO modelo (`gpt-image-1`) nos
dois casos. A diferença está na arquitetura em volta:

1. O Vorix pede ao modelo que **colabore** com um sistema de composição externo
   (deixar espaço em branco para texto que o renderer vai desenhar por cima, respeitar
   zonas de safe-area, não desenhar certos elementos) — e o modelo nem sempre obedece
   essas instruções de coordenação (texto fantasma, cortes).
2. Quando o modelo desenha texto que PODERIA ter sido feito pelo renderer (CTA, preço),
   ele comete erros ortográficos que um renderer determinístico jamais cometeria.
3. A composição determinística (logo + screenshot + texto) adiciona pontos de falha
   próprios (desalinhamento, sobreposição) que simplesmente não existem quando é uma
   imagem única, sem camadas.
4. Um bug de validação (CTA vazio) derruba 100% de uma categoria inteira de peças antes
   mesmo de chegar à geração de imagem.

Ou seja: o "custo da arquitetura" (fatos confirmados, marca, safe-area, auditabilidade)
está, hoje, sendo pago em qualidade visual, em vez de ser absorvido de forma invisível.
Isso não significa que a arquitetura deva ser abandonada — significa que os PONTOS DE
COSTURA entre as camadas (plano↔modelo, modelo↔renderer, renderer↔gate) precisam de mais
rigor do que têm hoje.

## 6. Custo por cenário (medido, não otimizado)

Custo real por par (Vorix completo vs. GPT direto única chamada) foi registrado no
`SUMMARY.json` do harness por `estimateGptImage1CostUsd`. Nenhuma ação de otimização de
custo foi tomada nesta rodada, por instrução explícita. Achado relevante apenas como
dado, não como gatilho de mudança: cenários com 2 gerações de imagem (replan por falha
de validação, casos 04/05) custam aproximadamente o dobro de uma geração única do GPT
direto, sem produzir NENHUMA imagem publicável — ou seja, o pior cenário de custo
(dobro) coincide com o pior cenário de resultado (zero).

## 7. Achados de auditoria de código

### 7.1 Logo — sempre cartão branco fixo
`src/infrastructure/media/logo-compositor.ts`: a logo é **sempre** colada sobre um
cartão branco semi-opaco com cantos arredondados (`fill="#ffffff" fill-opacity="0.94"`),
independentemente da cor de fundo da imagem ou da paleta da marca. Não existe seleção de
variante clara/escura da logo nem caminho que pule o cartão. Isso é uma decisão de
design deliberada (documentada no código, para garantir contraste em qualquer fundo),
mas tem o efeito colateral de sempre produzir a "aparência de sticker colado" que o
brief original pediu para investigar — confirmado como estrutural, não um bug isolado.

### 7.2 REFERENCE_EDIT / ORIGINAL_ASSET / GENERATED_REFERENCE
Decisão é determinística, baseada em "Asset Suitability Score" (análise de pixel:
uniformidade de borda, resolução, contraste produto/fundo, limpeza de extração), não em
confiança do próprio modelo de linguagem:
- score ≥ 75 → `original_asset` (usa o recorte real do produto)
- score 45–74 (ou sem score calculável) → `reference_edit` (usa a referência como base
  de edição)
- sem imagem de referência → `generated_reference` (gera do zero)

Nenhum dos 10 cenários do benchmark usou uma foto real de produto, então este caminho
não foi exercitado neste teste — permanece validado apenas por leitura de código.

### 7.3 Brand Visual Profile — cor é forte, tipografia é fraca
Cor da marca é injetada como instrução obrigatória e repetida (no prompt do Creative
Plan E no prompt de geração de imagem), além de checada pelo Quality Gate
(`colorPaletteViolated`). Tipografia/estilo da marca, porém, é só uma nota de texto
livre opcional (`visualIdentityNotes`) — sem campo estruturado de fonte/peso. Ou seja: o
Brand Visual Profile influencia fortemente a cor, mas não garante nada sobre tipografia.
Além disso, a entidade `BrandVisualProfile` (cores/tipografia estruturadas) existe no
código mas **não é usada pelo GPT Creative Engine** — é consumida só pelo caminho legado
de overlay (Bianca/Pedro). O Creative Engine usa uma fonte de cor de marca diferente
(`CreativeBrandProfile.brandColors`, resolvida via Clara). Isso não foi detectado no
brief original e é uma divergência de arquitetura que vale nota própria: duas fontes de
"perfil de marca" coexistem, servindo caminhos diferentes.

### 7.4 Quality Gate — cobertura real
O gate técnico (pass/fail) cobre: aspect ratio, asset obrigatório ausente, fatos
comerciais inventados/errados, violação de safe-area (zonas de texto e assets),
sobreposição texto↔asset e texto↔texto, e uma checagem de visão combinada (produto
errado, logo errada, screenshot mal representado, texto ilegível/cortado, paleta de cor
violada, e diff de texto contra uma lista fechada permitida). **Não cobre**: densidade de
texto, contraste genérico medido (só como instrução de prompt), score de composição,
cobertura percentual de imagem, nem detecção de texto duplicado/fantasma como categoria
própria (a checagem de "lista fechada" pega texto não autorizado, não duplicação
literal). Isso explica diretamente por que o cenário 01 (texto fantasma) e o cenário 10
(preço ausente) passaram pelo gate sem serem barrados.

Separado disso existe uma camada de **Visual Quality Score**, numérica (0–10 por
dimensão), que roda só depois que o gate pass/fail já passou.

### 7.5 Retry/repair — um dip de score sozinho já dispara regeneração completa
`MAX_CREATIVE_REPAIR_ROUNDS = 1`. Confirmado em código: uma falha técnica grave e um
simples dip de score estético (`overallScore < 6.5` OU qualquer dimensão `< 4`)
consomem o MESMO único repair round disponível — ou seja, uma peça pode "gastar" sua
única chance de reparo por causa de um número baixo em UMA dimensão de 12, sem nenhuma
falha concreta nomeada. Isso é exatamente o tipo de "retry desperdiçado" que o brief
pediu para investigar.

### 7.6 `renderedBy` — coerção confirmada, escopo correto
Confirmado: apenas `headline`/`subheadline` são forçados a `"renderer"` no parser
(trava determinística, por incidente real documentado de corte de borda). CTA/preço/
desconto/URL/badge não são forçados no parser — só há uma preferência no nível de
prompt sugerindo `"image_model"` para esses casos. Isso bate com o entendimento da
Rodada 2; o problema real não é essa coerção (que está correta e bem justificada), é que
o modelo desenha mal quando `renderedBy:"image_model"` é escolhido (corrupção
ortográfica confirmada nos cenários 02/08).

### 7.7 Bug confirmado: CTA vazio sempre reprova
`parseCreativePlan` checa `allowedRenderedTexts.includes(parsed.cta)`. Como
`allowedRenderedTexts` nunca pode legalmente conter uma string vazia (validado em
`parseAllowedRenderedTexts`), qualquer peça em que o Diretor corretamente produza
`cta:""` (peças institucionais, sem venda direta) reprova 100% das vezes, nas duas
tentativas. Não existe nenhum caso especial para string vazia em lugar nenhum da função.
Nenhum teste de regressão cobre esse caso especificamente. Reproduzido de forma
determinística duas vezes, de forma independente, via scripts de debug isolados — **não
é artefato do harness, é um bug real e reprodutível em produção.**

## 8. Bloco de classificação final

```
OPENAI_PRODUCTION_QUOTA = RECOVERED
OPENAI_AUTH = OK
IMAGE_GENERATION_SMOKE = PASS
IMAGE_PERSISTENCE = PASS
IMAGE_COST_TRACKING = PASS
QUOTA_CLASSIFICATION = PASS
RATE_LIMIT_CLASSIFICATION = PASS
QUOTA_RETRY_POLICY = PASS (never retried; non-retryable confirmed by test)
OPERATIONAL_ALERT = N/A (no existing alerting infra fit naturally; health() signal added instead, no new platform built)
IMAGE_GENERATION_INCIDENT = CLOSED

DIRECT_GPT_BENCHMARK = COMPLETED
SCENARIOS = 10 (8 comparable pairs, 2 total Vorix failures)
VORIX_BETTER = 1 (scenario 09)
TIE = 1 (scenario 03)
DIRECT_GPT_BETTER = 8 (scenarios 01, 02, 04, 05, 06, 07, 08, 10)
SAFE_AREA_COORDINATION = FAILED (confirmed failures: screenshot misalignment [06], CTA cropped off-canvas [10], logo/headline overlap [07])
RENDERER_INTEGRATION = PARTIAL (headline/subheadline coercion correctly scoped; no cross-layer defense against model-drawn ghosted text or missing confirmed facts)
HEADLINE_QUALITY = DEFECTIVE (ghosted/duplicate text observed in raw model output despite explicit "leave blank" instruction and renderedBy:"renderer")
LOGO_INTEGRATION = STRUCTURAL_RISK (always a fixed white card, no light/dark variant, confirmed in code — "sticker" look is a deliberate but unexamined tradeoff)
BRAND_FIDELITY = PARTIAL (color: strong and enforced; typography: unstructured/unverified; two divergent "brand profile" data sources coexist)
PRODUCT_FIDELITY = NOT_TESTED (benchmark design gap — no scenario used a real product photo reference)
CREATIVE_VARIETY = NOT_SYSTEMATICALLY_ASSESSED (8 successful outputs did not show obvious template repetition, but this was not scored rigorously)
RETRY_WASTE = CONFIRMED (a pure aesthetic score dip in one of 12 dimensions consumes the same single repair-round budget as a hard technical failure)
QUALITY_TARGET_80_PERCENT = NOT_MET (tie-or-better = 2/10 = 20%)
```

**Em conformidade com a instrução do brief: como a meta de 80% não foi atingida, este
relatório NÃO declara o problema resolvido.** Os achados acima são diagnóstico, não
correção.

## 9. Respostas às 10 perguntas de fechamento

1. **O principal gargalo de qualidade é o modelo de imagem, o Creative Plan, o
   renderer, ou a integração entre eles?** Majoritariamente a **integração** entre
   camadas (safe-area, coordenação plano↔renderer, validação de CTA vazio) — mas o
   modelo de imagem também tem um problema próprio e recorrente: não obedece
   instruções de "não desenhar aqui" e comete erros ortográficos em texto que desenha.

2. **Headline determinística (renderer) ainda é a melhor decisão?** Sim, continua
   sendo a decisão mais segura — mas não é suficiente sozinha: o modelo ainda desenha
   texto fantasma/duplicado na MESMA área mesmo devendo deixá-la em branco, o que o
   renderer não consegue "limpar" depois. Precisa de uma defesa adicional (ex.: detectar
   e descartar texto espúrio do modelo nessa região antes de compor o renderer por
   cima), não de abandonar a decisão.

3. **CTA/preço desenhados pelo modelo (`image_model`) valem a troca pelo "visual menos
   caixa colada"?** A evidência deste benchmark pesa contra: 2 dos 8 cenários
   comparáveis tiveram corrupção ortográfica visível justamente em texto
   `image_model`-rendered. O ganho estético de evitar a "caixa" não parece compensar o
   risco de erro ortográfico em produção.

4. **O bug do CTA vazio é o maior bloqueador isolado?** Para a categoria de peças
   "institucionais/sem venda direta", sim — é um bloqueador absoluto (100% de falha).
   Para o conjunto geral do benchmark, é um entre vários problemas de mesma gravidade.

5. **A composição determinística (logo/screenshot/texto) está pronta para produção
   como está?** Não totalmente — o cenário 06 mostra que o alinhamento
   screenshot↔cena-do-modelo pode falhar de forma visível, e o cenário 10 mostra que um
   fato confirmado (preço) pode desaparecer sem o gate perceber.

6. **O Quality Gate está adequado?** Parcialmente. Ele pegou corretamente 1 defeito
   grave (cenário 06), mas deixou passar 2 outros (texto fantasma no 01, preço ausente
   no 10) por falta de checagens específicas para esses padrões.

7. **A logo deveria ter variante clara/escura?** A evidência de código (sempre cartão
   branco fixo) sugere que sim, vale investigar — mas isso não causou nenhuma falha
   visível própria neste benchmark; é um risco estrutural, não um defeito confirmado em
   produção.

8. **O Brand Visual Profile influencia o resultado visual de forma mensurável?** Não
   pôde ser testado diretamente neste benchmark (os dois cenários institucionais, 04 e
   05, que testariam isso, falharam antes da geração de imagem por causa do bug do CTA).
   Por código, cor é fortemente aplicada; tipografia não.

9. **Existe convergência de template / falta de variedade criativa?** Não foi
   observado de forma clara nos 8 cenários bem-sucedidos, mas o benchmark não teve
   desenho suficiente para afirmar isso com confiança estatística.

10. **O Vorix está pronto para competir visualmente com "um usuário bem-informado
    usando ChatGPT direto"?** Não, segundo esta amostra: 20% de empate-ou-melhor,
    abaixo da meta de 80%. A arquitetura (fatos confirmados, marca, auditabilidade) tem
    valor real que o ChatGPT direto não oferece, mas os pontos de costura entre as
    camadas precisam de correções concretas antes que a vantagem arquitetural se
    traduza em vantagem visual.

## 10. Próximos passos (apenas sugestão — nada implementado)

Por ordem de impacto esperado vs. risco de implementação, para decisão do usuário:
1. Corrigir a validação de CTA vazio (bug confirmado, isolado, baixo risco).
2. Adicionar checagem no Quality Gate para "fato confirmado obrigatório ausente da
   imagem final" (ex.: preço).
3. Investigar uma defesa para texto fantasma do modelo em zonas `renderedBy:"renderer"`.
4. Reavaliar `image_model` para CTA/preço à luz da corrupção ortográfica observada.
5. Revisitar o cartão branco fixo da logo como decisão de design, não como bug.

Nenhum destes foi implementado nesta rodada, por instrução explícita do usuário.
