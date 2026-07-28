# Relatório — Elevação permanente da direção visual (Sofia, Bianca, Pedro)

## 1. Objetivo

Resolver estruturalmente o maior gargalo de qualidade visual do Zuno: Sofia, Bianca e Pedro
descreviam **conceitos**, não **cenas**. "Caixa de presente" chegava a Pedro como uma frase de três
palavras, sem luz, profundidade, material ou emoção — o resultado tendia a clipart, ícone ou
template, mesmo com um prompt de regras de layout longuíssimo. Esta mudança é permanente e vale
para **todas as campanhas futuras**, não só para uma peça: nenhum código de campanha específica foi
tocado, só as três Skills.

Nenhuma Skill nova foi criada. Nenhuma mudança em Arthur, Caio, Helena ou na arquitetura de
`ExecutionPlan`/workflow. Tudo abaixo vive dentro de Sofia, Bianca e Pedro (mais um arquivo
compartilhado em `src/shared`, que nunca foi uma Skill — mesmo padrão já usado por
`content-format-classification.ts`).

## 2. Auditoria (antes de qualquer mudança de código)

Leitura completa de `sofia-art-direction.skill.ts`, `bianca-social-media-design.skill.ts` e
`pedro-image-generation.skill.ts` (~4000 linhas) revelou três causas-raiz consistentes:

1. **Sofia nunca descrevia cena.** `buildVisualConcept()` era um template de concatenação de
   string: `Conceito visual alinhado ao ângulo "X", comunicando "Y" através de ${visualObjective}`.
   Se `visualObjective` fosse `"caixa de presente"`, essa frase inteira ia parar no prompt final do
   Pedro, sem luz, profundidade, textura ou emoção.
2. **Bianca pensava só em layout.** `BiancaSlideDesign` tinha grid, alinhamento, margens e tamanho
   de fonte — mas nenhum campo respondia "o que domina este slide", "quanto da tela isso ocupa",
   "para onde o olho vai primeiro" ou "existe tensão visual aqui". Decisões de composição
   aconteciam só na "letra pequena" (`compositionStrategy` genérico), nunca por slide.
3. **Pedro recebia um manual de regras, não uma cena.** `buildFinalImagePrompt()` já era rigoroso
   sobre grid, safe area, contraste e CTA — mas o "negative prompt" só dizia "evitar aparência de
   template genérico", sem banir explicitamente clipart/ícone/PowerPoint/Canva, e nenhuma etapa
   transformava o conceito recebido em cena antes de montar o prompt.

## 3. O que foi construído

### 3.1 Biblioteca de referências visuais (`src/shared/utils/visual-reference-library.ts`)

Novo arquivo compartilhado (não é Skill — Sofia, Bianca e Pedro importam diretamente, sem violar
isolamento). Contém:

- **`VISUAL_REFERENCE_LIBRARY`** — seis referências de gênero pedidas: fotografia publicitária,
  editorial de luxo, campanha premium, fotografia de casamento de alto padrão, direção
  cinematográfica, campanha minimalista moderna.
- **`ANTI_GENERIC_VISUAL_CONSTRAINTS`** — lista negativa explícita: nunca clipart, nunca ícone
  simples, nunca desenho/ilustração de contorno, nunca vetor genérico, nunca ilustração infantil,
  nunca aparência de PowerPoint, nunca template pronto de Canva, nunca template genérico.
- **`enrichVisualConcept(rawConcept, emotionHint)`** — o motor do estágio "Visual Enrichment": função
  pura e determinística que reconhece o conceito (caixa de presente, dinheiro/notas, aliança,
  convite, flores, casal — ou um fallback genérico para qualquer outro conceito) e devolve uma cena
  completa: protagonista, elemento secundário, plano de fundo, iluminação, profundidade de campo,
  lente simulada, enquadramento, composição, movimento implícito, emoção visual, textura, materiais,
  qualidade fotográfica e um parágrafo `sceneDescription` pronto para uso.
- **`inferVisualEmotionHint(...textos)`** — deriva perda/ganho/neutro a partir de qualquer texto de
  contexto disponível (ângulo, objetivo emocional, pedido original), para que "dinheiro" vire uma
  cena de perda ou de conquista conforme a campanha.

Por ser uma função pura e determinística (não depende de IA), o enriquecimento **nunca falha** —
funciona igual com ou sem apoio do Ícaro/IA desenvolvedora.

### 3.2 Pedro — novo estágio interno "Visual Enrichment"

`buildVisualEnrichments(input)` (nova função exportada em `pedro-image-generation.skill.ts`) roda
**antes** da montagem do prompt final: para cada slide (ou para a peça única), pega o
`focalPoint`/`emphasis` que a Bianca já decidiu e passa por `enrichVisualConcept`. O resultado:

- Entra em uma nova seção do prompt final, **"VISUAL ENRICHMENT — CENA PUBLICITÁRIA POR IMAGEM"**,
  com a cena completa de cada imagem e a biblioteca de referências de estilo.
- Entra na especificação operacional de cada slide (`artDirection`/`visualEnrichment` por slide).
- Fica disponível no `PedroImageGenerationOutput.visualEnrichments` (novo campo), auditável no
  `execution-report.json` de qualquer execução real.
- Alimenta o negative prompt com `ANTI_GENERIC_VISUAL_CONSTRAINTS` — agora toda geração bane
  clipart/ícone/PowerPoint/Canva/template explicitamente, não só "template genérico" de forma vaga.

Não é uma etapa nova do `ExecutionPlan` nem uma Skill — é uma função pura chamada pelo próprio Pedro.

### 3.3 Sofia — de conceito para cena cinematográfica

`buildVisualConcept()` agora chama `enrichVisualConcept()` sobre o `visualObjective` recebido e
compõe o `visualConcept` final a partir da cena, não do texto cru. `buildMoodboard()` e
`buildDesignReferences()` citam explicitamente a referência de estilo escolhida e o padrão
anti-genérico. O prompt de apoio de IA (`buildIcaroDirectionPrompt`) foi reescrito para exigir cena
cinematográfica — inclui o próprio exemplo do pedido original como referência de formato esperado — e
herda a lista negativa completa.

### 3.4 Bianca — de layout para Diretora de Arte

Novo tipo `BiancaArtDirectorAssessment` (8 campos: elemento dominante, percentual de tela ocupado,
para onde o olho vai primeiro, emoção antes da leitura, tempo de compreensão, tensão visual,
equilíbrio, avaliação de contraste), preenchido em **todo** slide via `buildArtDirectorAssessment()` —
um perfil por papel de slide (peça única, gancho, mensagem de apoio, fechamento), sempre
determinístico. `illustrationStyle`/`photographyUsage`/`illustrationUsage` também passaram a citar o
padrão anti-genérico. O campo é espelhado (por convenção, sem import direto — ADR 0002) em
`PedroSlideDesign.artDirection`, então Pedro já recebe o julgamento de Bianca pronto para o prompt.

## 4. Exemplo real: "caixa de presente" — antes e depois

### Sofia (`visualConcept`)

**Antes** (template puro, o que o pedido original criticou):

> Conceito visual alinhado ao ângulo "Aversão à perda", comunicando "Seu presente deveria ser do
> casal. Não da plataforma." através de caixa de presente reforçando a promessa da marca
> "Casamentos sem taxas escondidas".

**Depois** (saída real de `buildBaselineDirection`, capturada nesta sessão):

> Uma caixa de presente premium aberta sobre uma superfície elegante, iluminada por luz natural
> suave, enquanto notas de dinheiro reais escapam lentamente da embalagem antes de chegar ao
> destino, criando uma sensação imediata de perda financeira. Cena alinhada ao ângulo "Aversão à
> perda" e comunicando "Seu presente deveria ser do casal. Não da plataforma." reforçando a promessa
> da marca "Casamentos sem taxas escondidas". Referência de estilo: Fotografia publicitária: produto
> real fotografado com luz de estúdio controlada, sombra natural e acabamento comercial de campanha.
> Nunca clipart, ícone, desenho simples, vetor genérico ou aparência de template — sempre cena
> fotográfica de campanha premium.

### Pedro (`enrichVisualConcept("caixa de presente", "loss")`, JSON real)

```json
{
  "protagonist": "Uma caixa de presente premium aberta sobre uma superfície elegante",
  "secondaryElement": "notas de dinheiro reais",
  "background": "Superfície nobre desfocada ao fundo (mármore claro ou madeira escura), sem elementos concorrentes",
  "lighting": "luz natural suave",
  "depthOfField": "Profundidade de campo rasa (f/2.8 simulado): caixa em foco nítido, fundo suavemente desfocado em bokeh",
  "simulatedLens": "Lente macro/50mm simulada, ângulo levemente elevado, perspectiva editorial",
  "framing": "Enquadramento fechado no objeto, com espaço negativo generoso ao redor para respiro",
  "composition": "Composição na regra dos terços, protagonista deslocado do centro geométrico para criar tensão visual",
  "implicitMovement": "escapam lentamente da embalagem antes de chegar ao destino",
  "visualEmotion": "perda financeira",
  "texture": "Textura real de papel de presente com leve brilho e trama visível do laço de tecido",
  "materials": "Papel de presente premium, fita de cetim, notas de dinheiro brasileiras com relevo e textura reais",
  "photographicQuality": "Qualidade de campanha publicitária, alta resolução, acabamento comercial premium, sem ruído, sem serrilhado e sem artefato digital.",
  "referenceStyle": "photographicAdvertising",
  "sceneDescription": "Uma caixa de presente premium aberta sobre uma superfície elegante, iluminada por luz natural suave, enquanto notas de dinheiro reais escapam lentamente da embalagem antes de chegar ao destino, criando uma sensação imediata de perda financeira."
}
```

Se o mesmo conceito ("dinheiro") aparecer em uma campanha de **conquista** em vez de perda
(`emotionHint: "gain"`), a cena muda automaticamente: `implicitMovement` passa a "chegam inteiras e
alinhadas ao destino, em movimento de pouso suave" e `visualEmotion` para "ganho e confiança" — o
mesmo objeto, tratado como cena diferente conforme o objetivo da campanha, nunca um ícone estático.

### Bianca (`artDirection`, gancho vs. fechamento)

| Campo | Slide de gancho | Slide de CTA |
|---|---|---|
| `dominantElementScreenShare` | "60%-70% da área útil — é o slide de maior impacto do carrossel." | "50%-60% da área útil — precisa fechar com o mesmo impacto que o gancho abriu." |
| `visualTension` | "Alta — contraste entre o elemento visual e o espaço vazio ao redor cria tensão de leitura." | "Baixa — o fechamento precisa transmitir resolução, não mais tensão." |
| `emotionBeforeReading` | "Curiosidade ou tensão imediata, antes de qualquer leitura." | "Convite e confiança — sensação de fechamento consolidado da marca." |
| `contrastAssessment` | "Alto contraste entre elemento principal e fundo; nenhum elemento secundário pode competir." | "O maior contraste de toda a peça — o CTA precisa ser o elemento mais destacado do carrossel inteiro." |

## 5. Arquivos alterados

- `src/shared/utils/visual-reference-library.ts` (**novo**) — biblioteca + motor de enriquecimento.
- `src/skills/sofia-art-direction/sofia-art-direction.skill.ts` — `buildVisualConcept`,
  `buildMoodboard`, `buildDesignReferences`, `buildIcaroDirectionPrompt`.
- `src/skills/bianca-social-media-design/bianca-social-media-design.types.ts` — novo tipo
  `BiancaArtDirectorAssessment`, campo `artDirection` em `BiancaSlideDesign`.
- `src/skills/bianca-social-media-design/bianca-social-media-design.skill.ts` — nova função
  `buildArtDirectorAssessment`, `buildPhotographyUsage`, `buildIllustrationUsage`,
  `buildIcaroDesignPrompt`.
- `src/skills/pedro-image-generation/pedro-image-generation.types.ts` — novo tipo
  `PedroVisualEnrichment` (re-export de `EnrichedVisualScene`), `PedroArtDirectorAssessment`
  (espelhado), campo `artDirection` em `PedroSlideDesign`, campo `visualEnrichments` em
  `PedroImageGenerationOutput`.
- `src/skills/pedro-image-generation/pedro-image-generation.skill.ts` — nova função exportada
  `buildVisualEnrichments`, integração em `buildFinalImagePrompt`, `buildSlideProductionSpecs`,
  `buildNegativePrompt`, e em todo o fluxo `run → runAssistedGeneration/ai_provider →
  finalizeGeneration` para expor `visualEnrichments` no output.
- `src/skills/pedro-image-generation/pedro-log.contract.ts` — nova ação de log
  `VisualEnrichmentApplied`.
- `tests/visual-enrichment.test.mjs` (**novo**, 17 testes) — biblioteca compartilhada, estágio de
  enriquecimento do Pedro, cena cinematográfica da Sofia, julgamento de Diretora de Arte da Bianca.
- `tests/sofia-art-direction.test.mjs` — assertiva atualizada para refletir cena cinematográfica em
  vez de eco do conceito cru.

## 6. Validação técnica

- `npm run typecheck`: **limpo**, zero erros.
- `npm test`: **617/617 testes passando** (600 pré-existentes + 17 novos), incluindo todos os testes
  de isolamento arquitetural das três Skills (nenhuma passou a importar outra Skill diretamente).
- `npm run architecture:check`: **limpo** — 12 Skills descobertas, todas READY, nenhuma capability
  duplicada ou ausente.

## 7. O que isso muda para toda campanha futura

Nenhuma campanha precisa pedir "qualidade premium" explicitamente — o enriquecimento roda sempre,
para qualquer conceito, em qualquer cliente. Um conceito não reconhecido pela biblioteca (ex.: "um
gráfico de crescimento de vendas") ainda passa pelo template genérico, que preserva o conceito
original entre aspas e aplica o mesmo padrão de cena/luz/profundidade/textura — nunca fica sem
enriquecimento. À medida que padrões novos aparecerem em campanhas reais (ex.: "convite",
"cronograma", "QR code"), basta adicionar uma nova entrada a
`SIMPLE_OBJECT_SCENE_LIBRARY` em `visual-reference-library.ts` — um único lugar, reutilizado
automaticamente por Sofia e Pedro.
