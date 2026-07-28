# Relatório técnico — Correção do BUG-06 (proporção/resolução de Story)

**Data:** 2026-07-10
**Escopo exclusivo:** BUG-06 — Stories gerados em proporção 4:5 (1080x1350) em vez de 9:16 (1080x1920). Nenhuma funcionalidade nova, nenhuma Skill nova e nenhuma alteração de arquitetura foram feitas; a correção é inteiramente contida na decisão de proporção/resolução e em como ela é propagada pelo workflow já existente.

---

## 1. Causa raiz confirmada

Duas causas, ambas confirmadas por leitura direta do código antes de qualquer alteração:

1. **Arthur usava um valor estático.** Em `src/application/orchestration/arthur.orchestrator.ts`, a etapa "Geração de imagem" (Pedro) recebia `input: { imageCount, desiredAspectRatio: "4:5" }` — um valor fixo, igual para todo formato e canal, sem nenhum `inputBinding` que o sobrescrevesse. Sofia (`src/skills/sofia-art-direction`) já calculava uma proporção sensível a canal/formato (`recommendedAspectRatio`) e Bianca já repassava esse valor adiante (`biancaDesign.recommendedAspectRatio`), mas essa informação nunca chegava a Pedro — a única etapa que efetivamente gera a imagem. Pedro já tinha, inclusive, uma checagem de divergência entre o que Bianca recomendava e o que ele recebia (`briefing.recommendedAspectRatio !== input.desiredAspectRatio`), mas ela só gerava um **warning**, nunca corrigia o valor — por isso o "4:5" estático sempre vencia silenciosamente.
2. **A própria decisão de Sofia estava incompleta.** A função privada `defaultAspectRatioFor(channel, format)` de Sofia já tratava corretamente Story/Reels/TikTok (9:16) e carrossel (4:5), mas seu valor padrão para qualquer outro caso (feed comum, imagem única) era `"1:1"` — divergente do comportamento esperado (`"4:5"` para feed vertical) e sem nenhum caminho para um pedido explícito de imagem quadrada.

## 2. Arquivos alterados

**Novo (autoridade única, não é uma Skill — `src/shared` não viola o isolamento entre Skills, ADR 0002):**
- `src/shared/utils/aspect-ratio.ts` — `resolveAspectRatio(channel, format)`, `resolutionForAspectRatio(aspectRatio)`, `resolutionLabelForAspectRatio(aspectRatio)`, `areAspectRatiosEquivalent(a, b)`.

**Skills (usam a autoridade única, nenhuma calcula mais seu próprio valor isoladamente):**
- `src/skills/sofia-art-direction/sofia-art-direction.skill.ts` — passa a chamar `resolveAspectRatio` em vez da função privada `defaultAspectRatioFor` (removida).
- `src/skills/pedro-image-generation/pedro-image-generation.skill.ts` — passa a chamar `resolutionForAspectRatio`/`resolutionLabelForAspectRatio` compartilhados (as duas funções privadas equivalentes foram removidas) e usa `areAspectRatiosEquivalent` no lugar da comparação literal de string no warning de proporção divergente.
- `src/skills/lucas-quality-review/lucas-quality-review.skill.ts` — `evaluateCoherence` passa a usar `areAspectRatiosEquivalent` em vez de `!==` ao comparar a proporção da imagem gerada com a recomendação da Sofia.

**Orquestração (propagação):**
- `src/application/orchestration/arthur.orchestrator.ts` — novo `inputBinding` na etapa "Geração de imagem": `desiredAspectRatio` passa a vir da mesma etapa de onde já vêm `biancaDesign`/`biancaPedroBriefing` (Bianca), lendo `recommendedAspectRatio` — substituindo o valor estático em runtime sempre que a etapa de Design de redes sociais existe (o que já é sempre verdade quando há geração de imagem).

**Testes (novos, todos de regressão):**
- `tests/sofia-art-direction.test.mjs` (+5)
- `tests/pedro-image-generation.test.mjs` (+3)
- `tests/lucas-quality-review.test.mjs` (+3)
- `tests/arthur.orchestrator.test.mjs` (+asserções em teste já existente, sem novo bloco `test()`)

Nenhum manifesto de Skill, contrato de porta/adapter ou capability foi criado, removido ou teve assinatura alterada.

## 3. Autoridade definida para formato, proporção e resolução

- **Formato:** continua sendo decisão do Eduardo (`recommendedFormat`/`recommendedFormatLabel`), sem nenhuma alteração — fora do escopo do BUG-06.
- **Proporção (`recommendedAspectRatio`):** a autoridade única passou a ser **Sofia**, através da função compartilhada `resolveAspectRatio(channel, format)` — a mesma implementação que Bianca, Pedro e Lucas agora leem, direta ou indiretamente. Sofia já era a primeira Skill a decidir algo sobre proporção; a mudança foi tornar essa decisão **completa e consistente com a tabela esperada** (em vez de incompleta, com "1:1" como padrão indevido) e garantir que ela **realmente chegue a Pedro** (antes só chegava a Bianca/Lucas).
- **Resolução (largura x altura):** derivada deterministicamente da proporção pela mesma função compartilhada (`resolutionForAspectRatio`/`resolutionLabelForAspectRatio`) — nunca mais duas cópias divergentes da mesma tabela (antes, Pedro tinha sua própria cópia privada idêntica por coincidência; agora há uma só).
- **Equivalência entre representações** ("9:16" vs. "1080:1920" etc.): também centralizada em `areAspectRatiosEquivalent`, usada tanto por Pedro (para não gerar warning de divergência falso) quanto por Lucas (para não gerar `ASPECT_RATIO_MISMATCH` falso).

## 4. Como os valores são propagados pelo workflow

1. **Eduardo** decide `recommendedFormat`/`recommendedFormatLabel` (inalterado).
2. **Sofia** recebe `format`/`channel` (já vindos do Editorial Brief do Eduardo, via `inputBinding` já existente) e calcula `recommendedAspectRatio = resolveAspectRatio(channel, format)` — a autoridade única.
3. **Bianca** recebe `sofiaDirection` inteiro (já existia) e repassa `recommendedAspectRatio` sem reinterpretar (`buildBaselineDesign`, inalterado) — Bianca usa esse valor para compor a área segura corretamente, pois ele já chega certo.
4. **Pedro** — a mudança central: Arthur agora sobrescreve `desiredAspectRatio` da etapa de Pedro com o `recommendedAspectRatio` vindo da mesma etapa de Bianca de onde já vêm `biancaDesign`/`biancaPedroBriefing` (novo `inputBinding`, name-based, seguindo exatamente o mesmo padrão já usado para `imageCount`/`format`/`recommendedSlideCount` — ADR 0002, nenhuma Skill importa outra). Pedro usa esse valor tanto para o prompt de geração quanto para calcular a resolução exata dos arquivos esperados no modo assistido.
5. **Lucas** compara a proporção da primeira imagem gerada por Pedro com `sofiaDirection.recommendedAspectRatio`, agora usando `areAspectRatiosEquivalent` em vez de igualdade estrita de string.

Resultado: as quatro Skills enxergam a mesma decisão, propagada por `inputBinding` (a mesma técnica genérica já usada em toda a base — nenhuma Skill precisou importar outra), sem nenhuma calcular seu próprio valor isoladamente.

## 5. Testes adicionados

- **Sofia (5):** Story no Instagram e no Facebook → 9:16; Reels no Instagram (sem TikTok) → 9:16; feed vertical/imagem única → 4:5 (não mais 1:1); carrossel de feed → 4:5 (sem regressão); feed quadrado solicitado explicitamente → 1:1.
- **Pedro (3):** Story único → 1080x1920 no arquivo esperado do modo assistido; Story com 3 telas → as três em 1080x1920; nenhum warning de "Proporção divergente" quando `desiredAspectRatio` e `recommendedAspectRatio` são representações equivalentes ("9:16" vs. "1080:1920").
- **Lucas (3):** reconhece "1080:1920" como equivalente a "9:16" (sem `ASPECT_RATIO_MISMATCH`); reconhece "1080:1350" como equivalente a "4:5" (sem `ASPECT_RATIO_MISMATCH`); continua identificando uma divergência real ("1080:1350" vs. "9:16") — garantindo que a normalização não crie falsos negativos.
- **Arthur (asserções novas em teste existente):** confirma que a etapa de Geração de imagem tem um `inputBinding` de `desiredAspectRatio` a partir da etapa de Design de redes sociais, `sourcePath: "recommendedAspectRatio"`.

## 6. Resultados dos quatro cenários de Story (reexecução ao vivo, CLI real, `LOCAL_PRODUCTION`)

| Cenário | Prompt | Resultado antes (BUG-06) | Resultado agora |
|---|---|---|---|
| 3 | "crie um conteúdo para Instagram divulgando a confirmação de presença antes do prazo" | `COMPLETED`, 3 imagens em 1080x1350 | `COMPLETED`, 3 imagens em **1080x1920**, 0 warnings de proporção |
| 7 | "crie um story para Facebook lembrando o prazo final de confirmação de presença" | `COMPLETED`, 3 imagens em 1080x1350 | `COMPLETED`, 3 imagens em **1080x1920**, 0 warnings de proporção |
| 12 | "crie um story de 3 telas para Instagram sobre o painel dos noivos" | `COMPLETED`, 3 imagens em 1080x1350 | `COMPLETED`, 3 imagens em **1080x1920**, 0 warnings de proporção |
| 31 | "crie um story de enquete perguntando se os convidados preferem presentear por Pix" | `COMPLETED`, 3 imagens em 1080x1350 | `COMPLETED`, 3 imagens em **1080x1920**, 0 warnings de proporção |

Todos os quatro completaram o ciclo completo (geração assistida real, `--continue`, `--approve`) sem nenhum warning de "Proporção divergente" e com `recommendedSlideCount: 3` = `slideCount` da Bianca = `imageCount` do Pedro = 3 imagens, todas 1080x1920 — BUG-06 eliminado nos quatro cenários que o expuseram.

## 7. Regressões verificadas em feed, carrossel e Reels

- **Feed (imagem única):** "crie uma imagem única com uma mensagem emocionante para os noivos" → `COMPLETED`, `recommendedFormat: imagem_unica`, imagem em **1080x1350 (4:5)** — inalterado.
- **Carrossel:** "crie um carrossel para Instagram sobre taxa zero na lista de presentes do Rumo ao Altar" → `COMPLETED`, 5 imagens, todas **1080x1350 (4:5)** — inalterado.
- **Reels (pipeline de vídeo real, Bruno→Vanessa→Diego→Rafa):** "crie um reels para Instagram apresentando o painel dos noivos" → `COMPLETED`; Rafa já entregava `aspectRatio: "9:16"` de forma independente (não passa por Sofia/Bianca/Pedro) e continua entregando — nenhum código do pipeline de vídeo foi tocado nesta correção.
- **Observação sem impacto negativo:** um pedido de imagem cujo texto contém "apresentando" (ex.: "crie um post no Instagram apresentando o Rumo ao Altar") é classificado pelo Eduardo como `demonstracao` → `recommendedFormat: reels` (comportamento já existente desde a correção do BUG-03 na RC2 anterior, não alterado agora). Como o rótulo de formato passado a Sofia é "reels", a nova `resolveAspectRatio` corretamente recomenda 9:16 para essa peça — consistente com a própria tabela pedida ("Reels: 1080x1920, 9:16"), não uma regressão.

`npm test` completo (502/502, incluindo os testes de carrossel/imagem única/vídeo já existentes antes desta correção) confirma ausência de regressão em toda a base, não apenas nos três casos verificados manualmente acima.

## 8. Resultado das validações

- `npm run typecheck` — sem erros.
- `npm test` — **502/502 testes passando** (491 antes desta correção + 11 novos testes de regressão: 5 em Sofia, 3 em Pedro, 3 em Lucas, mais novas asserções em um teste já existente de Arthur).
- `npm run architecture:check` — build completo + descoberta real de Skills validada; as 12 Skills continuam descobertas corretamente, nenhuma capability órfã ou duplicada, nenhuma mudança na topologia do plano de execução (mesmas etapas, mesma ordem — apenas um `inputBinding` novo).
- Verificação manual ao vivo (CLI real, `LOCAL_PRODUCTION`, geração assistida real): os quatro cenários de Story (seção 6) e os três cenários de não-regressão (seção 7), todos completando com sucesso e com a resolução correta.

## 9. Recomendação final

O BUG-06 está corrigido na causa raiz (autoridade única de proporção/resolução em Sofia, propagada por `inputBinding` a Bianca/Pedro/Lucas), confirmado por 11 novos testes automatizados e por reexecução ao vivo dos quatro cenários que originalmente o expuseram — todos agora entregando Story em 1080x1920 (9:16), sem nenhum warning de proporção divergente. Feed, carrossel e Reels foram verificados sem regressão, tanto pela suíte automatizada completa (502/502) quanto por execução real da CLI.

Com a correção do BUG-06, todos os itens Críticos, Altos e o único achado de qualidade visual pendente da RC2 estão resolvidos. Não há nenhum bug conhecido, de qualquer severidade acima de Baixa, em aberto.

**Recomendação: Zuno está pronto para liberação da versão 1.0.**
