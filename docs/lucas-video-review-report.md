# Relatório técnico — Lucas evolui para revisar pacotes de vídeo

Este relatório documenta a evolução de Lucas, Especialista em Revisão de Qualidade, para também revisar o pacote de vídeo produzido pela pipeline João → Bruno → Vanessa → Diego → Rafa, sem criar nenhuma Skill nova e sem alterar Bruno, Vanessa, Diego ou Rafa.

## Arquivos alterados

**Skill Lucas:**
- `src/skills/lucas-quality-review/lucas-quality-review.types.ts` — 8 tipos novos espelhados (`LucasBrunoScene`, `LucasBrunoScript`, `LucasVanessaSceneDirection`, `LucasVanessaDirection`, `LucasDiegoTimelineEntry`, `LucasDiegoEditingPlan`, `LucasRafaVideoSpecs`, `LucasRafaVideo`); 4 novos campos opcionais em `LucasQualityReviewRequestInput` (`brunoScript`, `vanessaDirection`, `diegoEditingPlan`, `rafaVideo`); 10 novos `LucasIssueCode` de vídeo.
- `src/skills/lucas-quality-review/lucas-quality-review.skill.ts` — `hasVideoComponent`, validação condicional dos três campos de roteiro/direção/edição, 8 novas funções `evaluateVideo*`, `collectVideoText` (estende a checagem de regras de marca para o texto do vídeo), `NO_VIDEO_FILE` adicionado a `BLOCKING_ISSUE_CODES`, 9 novos itens de checklist, 10 novos casos em `suggestionFor`.
- `src/skills/lucas-quality-review/lucas.manifest.ts` e `skill.manifest.json` — descrição, `allowed`/`forbidden` e versão (`0.2.0` → `0.3.0`) atualizados para refletir a revisão de vídeo.

**Integração com o workflow:**
- `src/application/orchestration/arthur.orchestrator.ts` — capturado `videoRenderingStepId` (antes descartado); Revisão passou a incluir esse id no `dependsOn` e a receber `brunoScript`/`vanessaDirection`/`diegoEditingPlan`/`rafaVideo` por `inputBinding`, condicionalmente, quando a pipeline de vídeo existe no plano.

**Testes:**
- `tests/lucas-quality-review.test.mjs` — `checklist.length` corrigido de 10 para 19; 4 fixtures novas (`createBrunoScript`, `createVanessaDirection`, `createDiegoEditingPlan`, `createRafaVideo`) e `createVideoInput`; 13 testes novos.
- `tests/arthur.orchestrator.test.mjs` — 1 teste pré-existente corrigido (a suposição de que a Renderização de vídeo nunca alimentaria Revisão mudou por design nesta rodada); 2 testes novos (bindings de vídeo presentes quando a pipeline de vídeo roda; ausentes quando não roda).

**Documentação:**
- `docs/lucas-quality-review.md` — reescrito nas seções de responsabilidade, contrato de entrada/saída, validações, score/status, integração e fechamento do ciclo.
- `docs/lucas-video-review-report.md` (este relatório).
- `README.md`, `src/skills/README.md`, `docs/arthur-orchestrator.md`, `docs/growth-roadmap.md` — atualizados para refletir a revisão de vídeo e a nova conexão Arthur↔Revisão↔Rafa.

Nenhum arquivo de João, Maria, Sofia, Bianca, Pedro, Ana, Bruno, Vanessa, Diego ou Rafa foi alterado.

## Como Lucas passou a revisar vídeo

**Entrada.** Quatro campos opcionais foram adicionados ao contrato de entrada, cada um espelhando por convenção (ADR 0002) o formato real que a Skill correspondente já produzia — nenhum deles exigiu qualquer mudança em Bruno/Vanessa/Diego/Rafa:

- `brunoScript` ← campo `vanessaBriefing` real de Bruno (o mesmo que Vanessa já consome).
- `vanessaDirection` ← campo `diegoBriefing` real de Vanessa (o mesmo que Diego já consome).
- `diegoEditingPlan` ← campo `rafaBriefing` real de Diego (o mesmo que Rafa já consome).
- `rafaVideo` ← campo `video` do artefato real registrado por Rafa após validação do MP4.

**Validação estrutural.** `hasVideoComponent` segue exatamente o padrão já usado por `hasVisualComponent`: `brunoScript`/`vanessaDirection`/`diegoEditingPlan` são exigidos **em conjunto** quando qualquer um deles aparece (dado parcial indicaria falha real de encadeamento, não ausência legítima). `rafaVideo` foi deliberadamente excluído dessa exigência — sua ausência com os outros três presentes é o cenário legítimo "roteiro/direção/edição prontos, vídeo ainda não renderizado", tratado como problema de **revisão** (`NO_VIDEO_FILE`), não como erro de validação.

**As oito validações de vídeo**, cada uma implementando literalmente uma das dimensões pedidas:

| Dimensão pedida | Função | Código | Severidade |
|---|---|---|---|
| Coerência roteiro/direção/edição | `evaluateVideoCoherence` | `VIDEO_COHERENCE_MISMATCH` | alta |
| Duração do vídeo | `evaluateVideoDuration` | `VIDEO_DURATION_MISMATCH` | média |
| Formato vertical | `evaluateVideoFormat` | `VIDEO_NOT_VERTICAL` | alta |
| Proporção 9:16 | `evaluateVideoFormat` | `VIDEO_ASPECT_RATIO_INVALID` | média |
| Clareza do gancho | `evaluateVideoHook` | `VIDEO_HOOK_UNCLEAR` | média |
| Presença/consistência do CTA | `evaluateVideoCta` | `VIDEO_CTA_MISSING` / `VIDEO_CTA_DIVERGENT` | alta / média |
| Ritmo | `evaluateVideoRhythm` | `VIDEO_RHYTHM_UNDEFINED` | baixa |
| Legibilidade dos textos na tela | `evaluateVideoOnScreenTextLegibility` | `VIDEO_ON_SCREEN_TEXT_TOO_LONG` | baixa |
| Qualidade técnica do arquivo | `evaluateVideoFile` | `NO_VIDEO_FILE` (bloqueante) / `VIDEO_TECHNICAL_QUALITY_LOW` | alta |

As duas dimensões restantes não exigiram código novo: **consistência com a marca** estendeu `evaluateBrandRules` (via `collectVideoText`, que concatena `spokenText`+`onScreenText` de todas as cenas de Bruno) para reutilizar os três códigos já existentes (`FORBIDDEN_WORD_FOUND`, `FORBIDDEN_HASHTAG_FOUND`, `MANDATORY_WORD_MISSING`) também sobre o texto do vídeo; **riscos de comunicação** já eram cobertos pela agregação genérica de `buildRisks` (qualquer issue de severidade alta — incluindo as de vídeo — já entra em `risks`). "Pronto para aprovação humana" é respondido pelo par `reviewStatus`/`approvalRecommended`, que já é genérico o suficiente para qualquer tipo de pacote.

**Checklist e status.** 9 itens novos foram adicionados ao checklist (10 → 19), cada um `passed: !hasIssue(código)`. Como todas as funções `evaluateVideo*` retornam cedo quando o campo correspondente está ausente, um pacote somente-imagem nunca gera issues de vídeo, e os 9 itens de vídeo aparecem como `passed: true` — o mesmo padrão de "não aplicável conta como aprovado" já usado pelos itens visuais para campanhas somente-texto. `NO_VIDEO_FILE` foi adicionado a `BLOCKING_ISSUE_CODES` (ao lado de `NO_IMAGES_GENERATED`, `FORBIDDEN_WORD_FOUND`, `FORBIDDEN_HASHTAG_FOUND`): vídeo ausente força `reviewStatus: "rejected"` independentemente do score, o mesmo tratamento que imagem ausente já recebia.

## Como manteve compatibilidade com imagem

Quatro garantias estruturais, todas confirmadas por teste e por validação real:

1. **Todos os novos campos são opcionais** e todas as novas funções `evaluate*` retornam imediatamente quando o campo correspondente está ausente — zero issues de vídeo, zero impacto no score, para qualquer input que não inclua os campos novos.
2. **`checklist.length` mudou de 10 para 19** de forma incondicional (os itens de vídeo sempre existem, só variam entre `passed: true`/`false`) — a suíte de testes foi atualizada para refletir isso, e a validação real confirmou os 19 itens presentes e os 9 de vídeo com `passed: true` num pacote somente-imagem.
3. **Arthur só adiciona os quatro `inputBindings` de vídeo à Revisão quando a pipeline de vídeo existe no plano** (`videoScriptStepId`/`videoDirectionStepId`/`videoEditingStepId`/`videoRenderingStepId` condicionais, idêntico ao padrão já usado para `sofiaDirection`/`biancaDesign`/`pedroImages`). Um comando que não menciona "roteiro" produz um plano cujo `dependsOn`/`inputBindings` da Revisão são idênticos aos de antes desta rodada — confirmado por teste dedicado.
4. **Validação real via CLI, lado a lado**: rodei um comando de post de imagem simples (`"crie um post para o Rumo ao Altar no Instagram e Facebook"`) do início ao fim (incluindo salvar um PNG real e retomar com `--continue`) e confirmei `reviewStatus: "approved"`, `checklist.length: 19`, e o único problema encontrado (`ASPECT_RATIO_MISMATCH`, severidade baixa) é um issue pré-existente do pacote de imagem, sem nenhuma relação com as mudanças desta rodada.

## Testes criados

`tests/lucas-quality-review.test.mjs` ganhou 13 testes novos, cobrindo exatamente os 11 cenários pedidos (dois deles — "vídeo sem arquivo"/"status rejected" e "pacote de vídeo aprovado"/"status approved" — compartilham fixture mas foram escritos como testes distintos para rastreabilidade literal contra a lista pedida) mais 2 adicionais (validação estrutural conjunta; extensão da checagem de marca ao texto de vídeo):

- revisão de pacote de imagem continua funcionando (regressão explícita, além de todos os testes pré-existentes continuarem passando);
- revisão de pacote de vídeo aprovado;
- revisão de vídeo sem arquivo (`NO_VIDEO_FILE`);
- revisão de vídeo com proporção inválida (`VIDEO_ASPECT_RATIO_INVALID`);
- revisão de vídeo sem CTA (`VIDEO_CTA_MISSING`);
- revisão de vídeo com duração incompatível (`VIDEO_DURATION_MISMATCH`);
- revisão de vídeo com problema de coerência (`VIDEO_COHERENCE_MISMATCH`);
- status `approved`;
- status `approved_with_warnings` (um problema alto isolado — CTA ausente);
- status `needs_adjustments` (quatro problemas médios combinados — proporção, duração, gancho, CTA divergente — somando 40 pontos de penalidade, score 60);
- status `rejected` (vídeo sem arquivo, bloqueante).

`tests/arthur.orchestrator.test.mjs` ganhou 2 testes novos (bindings de vídeo presentes/ausentes na Revisão conforme a pipeline de vídeo existe ou não no plano) e 1 teste existente foi corrigido para refletir a nova conexão Revisão↔Renderização de vídeo.

## Validações executadas

- `npx tsc --noEmit` — sem erros.
- `npm test` — **377/377 testes passando** (362 antes desta rodada + 15 novos, líquido de 2 correções em testes pré-existentes que já contavam no total anterior).
- `npm run architecture:check` — build completo, onze Skills descobertas, todas as capabilities corretas, nenhuma mudança de descoberta.
- **Validação end-to-end real via CLI, dois cenários lado a lado**:
  - **Vídeo**: `npm run zuno -- "Crie um roteiro de vídeo curto para o Rumo ao Altar sobre taxa zero na lista de presentes."` pausou em Rafa (`WAITING_ASSISTED_GENERATION`); salvei um MP4 real de 150KB no caminho exato; `--continue` avançou automaticamente por Rafa **e em seguida pela Revisão do Lucas**, chegando a `WAITING_HUMAN_APPROVAL`. Inspecionei o JSON persistido: `reviewStatus: "approved"`, `overallScore: 100`, `issues: []`, `checklist` com os 19 itens, todos `passed: true` — confirmando que Lucas recebeu e avaliou positivamente o roteiro, a direção, o plano de edição e o vídeo final reais produzidos pela pipeline completa.
  - **Imagem (regressão)**: `npm run zuno -- "crie um post para o Rumo ao Altar no Instagram e Facebook"` pausou em Pedro; salvei um PNG real; `--continue` completou normalmente até `WAITING_HUMAN_APPROVAL`, com `index.html` gerado. `reviewStatus: "approved"`, `checklist.length: 19`, um único issue pré-existente (`ASPECT_RATIO_MISMATCH`, baixa severidade, sem relação com vídeo) — confirmando ausência de regressão.

## Impactos na pipeline de vídeo

- **A pipeline de vídeo agora tem um "gate" de qualidade real antes da aprovação humana**, assim como a pipeline de imagens sempre teve. Antes desta rodada, um vídeo mal formado (proporção errada, sem CTA, cenas incoerentes) chegaria à aprovação humana sem nenhuma checagem automatizada — agora Lucas intercepta isso com o mesmo rigor já aplicado a imagens.
- **Revisão passou a depender da conclusão de Rafa** (não apenas da sua pausa em geração assistida): se o vídeo ainda não foi salvo e validado, a Revisão simplesmente não roda — o workflow permanece pausado em Rafa até o vídeo real existir, e só então avança para a Revisão com o pacote completo.
- **Nenhuma etapa de Aprovação ou Publicação foi alterada.** A etapa "Aprovação" (`human_gate`) continua exatamente como antes; a publicação de vídeo continua não implementada — Ana não consome `rafaVideo` nem o resultado da revisão de vídeo hoje. Isso foi uma decisão deliberada de escopo: o pedido era evoluir Lucas, não implementar publicação de vídeo.
- **Nenhuma capability nova foi criada** e nenhuma capability existente mudou de significado — `quality_review` continua sendo a única capability de Lucas, agora simplesmente capaz de revisar mais tipos de pacote.

## Recomendações para publicação de vídeo

1. **Decidir a forma do artefato de vídeo para Ana.** `SocialPublisherPort`/`SocialPostDraft` hoje só modelam posts de imagem/texto. Antes de conectar publicação de vídeo, será preciso decidir se `SocialPostDraft` ganha um campo de vídeo opcional ou se surge um tipo de draft dedicado — e se Ana processa os dois formatos ou se surge uma variante/nova responsabilidade para publicação de vídeo.
2. **Conectar `lucasReview` (agora com o pacote de vídeo avaliado) à etapa de publicação**, reaproveitando exatamente o mesmo campo `approvalRecommended` que já bloqueia publicação de imagem — nenhuma mudança de contrato deveria ser necessária em Lucas para isso, já que sua saída já é genérica.
3. **Render real (não assistido) antes de publicar em produção.** Developer Assisted Mode é apropriado para este estágio de desenvolvimento, mas uma pipeline de publicação de vídeo de verdade eventualmente precisará de um caminho de renderização real (ex.: `video_generation` no `AITaskType`, um worker de renderização, ou um provider externo) — decisão arquitetural própria, não incidental à publicação.
4. **Fechar a lacuna de parsing real de metadados de vídeo em Rafa** (documentada em `docs/rafa-video-rendering.md`/`docs/rafa-video-rendering-report.md`): hoje `rafaVideo.specs.durationSeconds` vem do plano de Diego, não de uma leitura real do arquivo. Antes de publicar de fato, vale a pena um parser MP4 mínimo para confirmar duração/resolução reais contra o que foi pedido — o mesmo tipo de checagem que Lucas já faz estruturalmente, mas hoje sobre dados declarados, não medidos.
5. **Avaliar se Lucas precisa de um modo de revisão "somente vídeo" mais rigoroso** antes de publicação em produção — por exemplo, elevar a severidade de `VIDEO_ASPECT_RATIO_INVALID`/`VIDEO_RHYTHM_UNDEFINED` se a experiência de uso mostrar que essas dimensões merecem bloquear a aprovação com mais força do que hoje (atualmente nenhuma delas, isoladamente, impede `"approved"` ou `"approved_with_warnings"`).
