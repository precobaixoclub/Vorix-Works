# Relatório técnico — Bianca como referência definitiva de layout e composição visual

Esta rodada evoluiu a Bianca já existente (não criou uma Skill nova) para cobrir cinco responsabilidades explicitamente pedidas que ainda não existiam como campo estruturado, e auditou a fronteira Sofia → Bianca → Pedro para confirmar que nenhuma decisão de layout está indevidamente no Pedro.

## O que já existia na Bianca (confirmado antes de qualquer alteração)

Antes desta rodada, investigação completa do código confirmou que a Bianca já era uma Skill real, completa e integrada — **não uma Skill nova a ser criada**:

- `src/skills/bianca-social-media-design/` com Skill, manifesto TS, manifesto JSON, contrato de log, `index.ts`.
- Posicionada exatamente entre Sofia e Pedro no `ExecutionPlan` de Arthur (`capabilities: ["social_media_design"]`).
- Já definia: grid, hierarquia visual, alinhamentos, espaçamentos, margens (por slide), peso visual, tamanho de título/subtítulo/corpo, posição de logo, área de respiro, sequência de slides, fluxo/consistência de carrossel.
- Já produzia `pedroBriefing`, e Pedro já usava esse briefing como entrada principal — `PedroImageGenerationRequestInput` nunca teve campo `sofiaDirection`.
- Já tinha `docs/bianca-social-media-design.md` e `tests/bianca-social-media-design.test.mjs` (20 testes) cobrindo o fluxo completo.

## O que foi acrescentado

Cinco campos estruturados que faltavam, agora presentes em `BiancaDesignCore` e espelhados em `BiancaPedroBriefing`/`PedroBiancaDesignSummary`/`PedroBiancaBriefing`:

1. **Posição e destaque do CTA**: `ctaPlacement` (política geral) + `typographyScale.cta` (tamanho) no nível da peça, e `BiancaSlideDesign.ctaPlacement` (opcional) por slide — presente apenas nos slides que de fato têm CTA (o slide único e o slide de fechamento do carrossel; ausente no gancho e nas mensagens de apoio).
2. **Composição para Reels Cover**: `reelsCoverComposition` (opcional) — só populado quando o `format` menciona "reels cover"/"capa de reels"/"reels"; ausente (não vazio, `undefined`) nos demais formatos, para não sugerir uma composição que não se aplica.
3. **Regras dedicadas de contraste**: `contrastRules: string[]` — distintas de `colorApplication` (que descreve a aplicação da paleta, não o contraste em si).
4. **Regras de acessibilidade visual**: `accessibilityGuidelines: string[]` — leitura por daltonismo, tamanho mínimo de fonte, uso de texto alternativo.
5. **Padronização visual entre slides/peças**: `visualStandardizationRules: string[]` — sempre presente (diferente de `carouselFlow.consistencyRules`, que só existe para carrossel); para peça única cobre consistência com as demais peças da marca, para carrossel ganha regras adicionais de numeração/CTA entre slides.

Todos os cinco são heurísticos por padrão (função pura, determinística, mesma disciplina dos campos já existentes); três deles (`contrastRules`, `accessibilityGuidelines`, `reelsCoverComposition`) também entraram na lista de campos que o Ícaro pode aprimorar quando configurado, seguindo exatamente o mesmo padrão de "apoio opcional" já usado para `gridSystem`/`colorApplication`/etc.

## O que foi movido do Pedro para a Bianca

**Nada.** Auditoria completa do código-fonte de Pedro (1957 linhas) e de Sofia (arquivo completo) confirmou que nenhuma decisão de layout estava no lugar errado:

- Toda menção a grid/hierarquia/alinhamento em Pedro cai em duas categorias, nenhuma delas uma decisão: (a) `evaluateProductionReadiness` **valida** se a Bianca preencheu o campo, nunca inventa um valor quando ausente (blocking issue em vez de fallback); (b) o prompt final instrui a IA de geração a **executar fielmente** o que a Bianca decidiu, com a restrição explícita "não alterar paleta, grid, hierarquia, estilo, posicionamento ou posição/tamanho de CTA decididos pela Bianca" (agora reforçada com a menção explícita a CTA nesta rodada).
- As únicas ocorrências de `grid`/`hierarchy` fora desse padrão são classes CSS (`.stat-grid`, `.quality-grid`) da página HTML de entrega que Pedro monta — um artefato totalmente separado (o "envelope" de entrega, não a imagem em si) e fora do escopo de "layout da peça".
- Sofia já negava explicitamente qualquer decisão de layout em três pontos do seu próprio código-fonte ("isso é responsabilidade exclusiva de Bianca"), sem nenhuma ocorrência de decisão estrutural real.

Como não havia nada de errado para corrigir, nenhum código foi movido — apenas as instruções do prompt de Pedro foram enriquecidas para citar explicitamente os cinco novos campos, mantendo o mesmo padrão de "renderizar fielmente, nunca decidir".

## Ainda existe alguma sobreposição entre Sofia, Bianca e Pedro?

**Não.** Fronteira confirmada, sem ambiguidade:

| Skill | Decide | Nunca decide |
|---|---|---|
| **Sofia** | Conceito criativo, paleta, tipografia (fontes), moodboard, estilo, emoção, referências de design | Grid, hierarquia, espaçamento, CTA, layout — qualquer coisa estrutural |
| **Bianca** | Grid, hierarquia, espaçamento, margens, alinhamento, tipografia (tamanhos), posição/destaque de CTA, posição de logo, composição por formato (incluindo Reels Cover), contraste, acessibilidade, padronização visual, layout de cada slide | Conceito criativo, paleta, copy, estratégia, geração de pixels |
| **Pedro** | Nada de estrutural — só validação de completude do briefing e execução fiel via IA (ou intervenção assistida) | Qualquer decisão de layout, grid, hierarquia, posicionamento, CTA, tipografia — tudo isso vem pronto da Bianca |

## Integração com o workflow

Nenhuma mudança de integração foi necessária — a posição de Bianca no plano (`Arthur` → `Caio` → `Helena`), a capability (`social_media_design`), a descoberta automática (`FileSystemSkillDiscovery`) e o catálogo de planos da Valentina já estavam corretos. Apenas os manifestos (TS e JSON, de Bianca e de Pedro) foram atualizados para descrever os novos campos nas descrições de output/input.

## Arquivos alterados

**Tipos:**
- `src/skills/bianca-social-media-design/bianca-social-media-design.types.ts` — `BiancaTypographyScale.cta`, `BiancaSlideDesign.ctaPlacement`, cinco novos campos em `BiancaDesignCore`/`BiancaPedroBriefing`, três novos campos opcionais em `BiancaDesignEnhancement`.
- `src/skills/pedro-image-generation/pedro-image-generation.types.ts` — os mesmos campos espelhados em `PedroTypographyScale`, `PedroSlideDesign`, `PedroBiancaDesignSummary`, `PedroBiancaBriefing`; `PedroAgencyQualityChecklist` ganhou `accessibilityGuided`/`visualStandardizationGuided`.

**Lógica:**
- `src/skills/bianca-social-media-design/bianca-social-media-design.skill.ts` — `buildCtaPlacement`, `buildReelsCoverComposition`, `buildContrastRules`, `buildAccessibilityGuidelines`, `buildVisualStandardizationRules` (novas funções puras); `buildTypographyScale` ganhou `cta`; slides de CTA (único e fechamento) ganharam `ctaPlacement`; `buildIcaroDesignPrompt`/`parseDesignEnhancement`/`mergeDesignEnhancement` passaram a cobrir os três campos aprimoráveis por IA.
- `src/skills/pedro-image-generation/pedro-image-generation.skill.ts` — `evaluateProductionReadiness` passou a exigir `ctaPlacement` (bloqueante, como os demais campos estruturais) e avisar (não bloquear) a ausência de `contrastRules`/`accessibilityGuidelines`/`visualStandardizationRules`; `agencyChecklist.contrastGuided`/`ctaGuided` ficaram mais rigorosos; `buildFinalImagePrompt` passou a instruir explicitamente sobre os cinco campos novos; `buildSlideProductionSpecs` passou a incluir `ctaPlacement` por slide; `hasTypographyScale` passou a exigir `cta`.

**Manifestos:**
- `bianca.manifest.ts`, `skill.manifest.json` (Bianca) — descrição atualizada para "Especialista em Layout e Composição Visual", `allowed` ganhou 6 novas responsabilidades explícitas.
- `pedro.manifest.ts`, `skill.manifest.json` (Pedro) — descrição de input atualizada para citar os campos novos e reforçar que Pedro nunca decide nenhum deles.

**Documentação:**
- `docs/bianca-social-media-design.md` — título, responsabilidade, contrato de saída, planejamento de slides, nova seção "Composição por formato", testes.
- `docs/pedro-image-generation.md` — prontidão profissional e contrato de entrada atualizados.

**Testes:**
- `tests/bianca-social-media-design.test.mjs` — 7 testes novos (CTA geral/por slide, Reels Cover presente/ausente, contraste/acessibilidade, padronização com/sem múltiplos slides, aprimoramento via Ícaro dos três campos). 20 → 26.
- `tests/pedro-image-generation.test.mjs` — fixture `createBiancaDesign` atualizada com os 5 campos novos (sem isso, todos os testes existentes quebravam por `blockingIssues`); 2 testes novos (prompt relaia os campos sem decidir nada; `ctaPlacement` bloqueante vs. os outros três apenas avisam). 35 → 37.

## Validações executadas

- `npx tsc --noEmit` — sem erros.
- `npm test` — **263/263 testes passando** (255 antes desta rodada + 7 novos em Bianca + 2 novos em Pedro − 1 já contado — total líquido +8... na prática 255 → 263).
- `npm run architecture:check` — build completo, sete Skills descobertas, `social_media_design` → `bianca-social-media-design` e `image_generation` → `pedro-image-generation` corretos, nenhuma capability nova criada.
- **Validação end-to-end real via CLI**: rodei `npm run zuno -- "crie um post para o Rumo ao Altar no Instagram sobre taxa zero na lista de presentes"`, inspecionei a execução persistida e confirmei os cinco campos populados de verdade pela Bianca (`ctaPlacement`, `typographyScale.cta`, `contrastRules` com 3 regras, `accessibilityGuidelines` com 4 diretrizes, `visualStandardizationRules` com 3 regras, `reelsCoverComposition` corretamente `undefined` para um post de feed); completei o fluxo (Developer Assisted Mode → Lucas → aprovação → Ana) até `COMPLETED`, com `metadata.json`/`index.html` finais confirmando a entrega.

## Melhorias futuras (sugestões para elevar ainda mais a qualidade visual)

- **Reels Cover mais granular**: hoje `reelsCoverComposition` é um único campo de texto; poderia evoluir para uma estrutura com zonas seguras explícitas (percentuais de topo/base/laterais) se algum dia um renderizador programático precisar delas de forma mais mecânica que textual.
- **Contraste calculado, não só descrito**: `contrastRules` hoje são heurísticas em texto; um passo futuro (fora do escopo desta rodada, que não deveria criar funcionalidade nova) seria calcular a razão de contraste real entre as cores de `suggestedPalette` e validar contra WCAG AA/AAA automaticamente, em vez de apenas instruir.
- **Biblioteca de composições por formato**: hoje só Reels Cover tem um campo dedicado; se o produto crescer para cobrir Stories e Feed com regras tão específicas quanto as do Reels Cover (não apenas grid/proporção geral), caberia um campo `formatSpecificComposition` mais genérico, parametrizado por formato.
- **Validação cruzada de acessibilidade real**: hoje `accessibilityGuidelines` é prosa; poderia futuramente ser verificada automaticamente pelo Lucas (Revisão de Qualidade) como um checklist adicional, fechando o ciclo entre "Bianca recomenda" e "Lucas confirma que foi seguido".
