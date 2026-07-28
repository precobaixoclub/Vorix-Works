# Relatório técnico — Diego, terceira etapa da pipeline de vídeo

Este relatório documenta a implementação de Diego, Especialista em Edição de Vídeo, a décima Skill real do Zuno e a terceira etapa da pipeline de vídeo: João → Bruno → Vanessa → Diego → Rafa → Lucas → Ana. Nenhuma etapa depois de Diego foi implementada nesta rodada, por instrução explícita do pedido.

## Arquivos criados

**Skill:**
- `src/skills/diego-video-editing/diego-video-editing.types.ts`
- `src/skills/diego-video-editing/diego-log.contract.ts`
- `src/skills/diego-video-editing/diego.manifest.ts`
- `src/skills/diego-video-editing/skill.manifest.json`
- `src/skills/diego-video-editing/diego-video-editing.skill.ts`
- `src/skills/diego-video-editing/index.ts`

**Documentação:**
- `docs/diego-video-editing.md`
- `docs/diego-video-editing-report.md` (este relatório)

**Testes:**
- `tests/diego-video-editing.test.mjs` (27 testes)

## Arquivos alterados

- `src/domain/skills/skill-capability.contract.ts` — capability `video_editing` adicionada ao catálogo, logo após `video_direction`.
- `src/application/events/zuno-event.contract.ts` — eventos `VideoEditingStarted`, `VideoEditingContextLoaded`, `VideoEditingGenerated`, `RafaBriefingCreated`, `VideoEditingFailed` adicionados.
- `src/application/orchestration/arthur.orchestrator.ts` — `video_editing` adicionado a `DEFAULT_CAPABILITIES`; nova regra de cascata (`if (required.has("video_direction")) required.add("video_editing")`); etapa "Edição de vídeo" adicionada a `createSteps`, dependente da etapa "Direção de vídeo" e recebendo três `inputBindings` (fan-in de `joaoStrategy`, `brunoScript` e `vanessaDirection`).
- `scripts/verify-skills-discovery.mjs` — Diego adicionado à lista `EXPECTED_SKILLS` (capability `video_editing`).
- `tests/skills-discovery.test.mjs` — Diego incluído nos testes de cópia de manifesto, descoberta real (10 Skills) e busca por capability.
- `tests/arthur.orchestrator.test.mjs` — 1 teste novo para a cascata `video_direction` → `video_editing` (incluindo verificação de que a etapa de edição não alimenta Revisão e dos três `inputBindings`); teste existente de ausência de etapas de vídeo atualizado para cobrir também `video_editing`.
- `package.json` — `tests/diego-video-editing.test.mjs` adicionado à lista de arquivos do script `test`.
- `README.md` — Diego mencionado no parágrafo de "Estado atual" e parágrafo dedicado descrevendo a Skill e a cascata de três capabilities.
- `src/skills/README.md` — contagem e descrição atualizadas para dez Skills reais, incluindo Diego.
- `docs/arthur-orchestrator.md` — seção "Preparação para Skills futuras" atualizada com Diego/`video_editing` e a mecânica de cascata de três níveis.
- `docs/vanessa-video-direction.md` — seções de integração e limitações atualizadas para refletir que Diego deixou de ser "futuro" e passou a ser Skill real.
- `docs/bruno-video-script.md` — seção de limitações atualizada para refletir que Vanessa e Diego já existem.

Nenhum arquivo de João, Sofia, Bianca, Pedro, Lucas ou Ana foi alterado. **Bruno e Vanessa também não foram alterados no seu código-fonte** — Diego consome os campos `vanessaBriefing` (de Bruno) e `diegoBriefing` (de Vanessa) que ambos já produziam desde suas próprias implementações, sem exigir nenhuma mudança neles.

## Decisões arquiteturais

**1. `video_editing` é acionada em cascata a partir de `video_direction`, sem palavra-chave própria.** Mesma lógica já estabelecida entre Bruno e Vanessa: `if (required.has("video_direction")) required.add("video_editing")`. Pedir um roteiro agora avança a pipeline de vídeo automaticamente até onde ela existir hoje (script → direção → edição), confirmado na validação real via CLI com um único comando gerando as três etapas em sequência.

**2. Diego é a primeira Skill da pipeline de vídeo a fazer fan-in de duas etapas anteriores simultaneamente.** Diferente de Bruno (só consome João) e Vanessa (só consome Bruno), o pedido do usuário foi explícito: Diego precisa de "roteiro do Bruno" **e** "direção audiovisual da Vanessa" como entradas separadas — porque a direção de Vanessa (`VanessaDiegoBriefing`) não carrega o texto falado, o texto na tela nem a duração exata de cada cena (esses campos só existem no roteiro de Bruno). O `inputBinding` de Arthur reflete isso: a etapa "Edição de vídeo" tem três bindings — `joaoStrategy` (da etapa de estratégia), `brunoScript` (da etapa de roteiro, via `sourcePath: "vanessaBriefing"` — o mesmo binding que a etapa de Vanessa já usa) e `vanessaDirection` (da etapa de direção, via `sourcePath: "diegoBriefing"`). O `dependsOn` da etapa, porém, é só `[videoDirectionStepId]` — não precisa listar a etapa de roteiro, porque `inputBindings` pode referenciar qualquer etapa já executada anteriormente, independente do `dependsOn` (mesmo mecanismo que a etapa de Revisão do Lucas já usa para agregar várias etapas anteriores).

**3. A timeline técnica é montada por combinação 1:1, casando pelo campo `order`.** `buildEditingTimeline` usa `brunoScript.scenes` como fonte de verdade para ordem, tempo e texto, e busca a `DiegoVanessaSceneDirection` correspondente em `vanessaDirection.sceneDirections` por `order` para completar transição e efeitos visuais. Diego nunca decide um novo enquadramento, uma nova composição ou um novo efeito visual — ele só empacota o que Bruno e Vanessa já decidiram dentro de uma estrutura com tempos concretos (`startSeconds`/`endSeconds`) e um tipo de corte técnico (`cutType`).

**4. Tipo de corte é derivado do nome da cena, seguindo a mesma convenção de nomenclatura que Bruno e Vanessa já estabelecem.** Cenas `"Gancho"` recebem corte seco de entrada sem fade; cenas `"CTA final"` recebem corte seco final sem fade de saída; as demais recebem corte dinâmico com fade curto. Nenhum campo estrutural novo precisou ser adicionado a Bruno ou Vanessa para isso — Diego reaproveita a convenção de nomes que já existia.

**5. Plano de edição é inteiramente determinístico; o Ícaro é só um polimento textual opcional em 4 campos.** Seguindo a mesma disciplina de Bruno e Vanessa, toda a timeline é heurística pura. O Ícaro, quando configurado, só pode aprimorar `musicTrackPlan`, `requiredAssets`, `editingInstructions` e `technicalChecklist` — nunca a timeline. A validação em CLI confirmou isso na prática: mesmo com o `DeterministicFakeIcaroProvider` da CLI, a execução produziu um plano completo e correto via `AISupportFailed`.

**6. Etapa de edição de vídeo não alimenta Revisão nem Aprovação, assim como as de roteiro e direção.** Lucas ainda não sabe revisar plano de edição, e adaptar Lucas para isso está fora do escopo desta rodada ("não implemente Rafa" implica não implementar nada que dependa de uma pipeline de vídeo completa). Confirmado por teste dedicado e por validação real via CLI, onde a Revisão completou normalmente sem depender da etapa de Diego.

**7. Nenhuma capability nova de imagem foi tocada.** `video_editing` não interfere em `art_direction`/`social_media_design`/`image_generation`. Confirmado pela suíte completa (341/341) e pela validação manual mostrando as duas etapas de imagem ausentes quando o pedido só menciona vídeo.

## Como Diego usa a direção da Vanessa

Ver "Decisões arquiteturais" itens 2-4. Diego consome `vanessaDirection: DiegoVanessaDirectionSummary` (espelho de `VanessaDiegoBriefing`) para transição (`transitionToNext`) e efeitos visuais (`visualEffects`) por cena, e para as heurísticas de nível de produção: `musicTrackPlan` cita textualmente `musicDirection`; `editingInstructions` cita `captionStyle` e `colorDirection`; `requiredAssets` referencia `captionStyle` e a identidade visual real da Clara. Nenhum desses campos é redecidido — apenas referenciado e traduzido em instrução técnica.

## Como Diego gera o plano de edição

`buildBaselineEditingPlan` monta, nesta ordem: `editingTimeline` (combinação 1:1 de Bruno+Vanessa por `order`), `totalDurationSeconds` (herdado diretamente de `brunoScript.totalDurationSeconds`), `musicTrackPlan` (direção musical de Vanessa + timing concreto), `requiredAssets` (lista de assets citando identidade visual real quando disponível, com fallback claro quando não), `editingInstructions` e `technicalChecklist` (boas práticas de vídeo vertical curto, parametrizadas pelo canal e pela duração real). Validado ao vivo via CLI: 5 entradas de timeline somando exatamente os 30 segundos do roteiro real, cores de marca reais citadas em `requiredAssets`.

## Como Diego prepara o briefing do Rafa

`buildRafaBriefing` reúne `editingTimeline`, `totalDurationSeconds`, `musicTrackPlan`, `requiredAssets`, `editingInstructions` e `technicalChecklist` em um objeto autocontido com `status: "preliminary"`, `channel` e `notes` explicando que renderização e publicação continuam responsabilidade de Rafa e Ana — mesmo padrão que `buildVanessaBriefing`/`buildDiegoBriefing` já estabeleceram nas etapas anteriores.

## Testes criados

`tests/diego-video-editing.test.mjs` (27 testes) cobre: manifesto válido; resolução de cliente; consulta correta à Clara (5 módulos); funcionamento completo sem Ícaro; uso opcional do Ícaro com sucesso; degradação graciosa quando o Ícaro falha; garantia de que o Ícaro nunca redefine a timeline; geração de uma `DiegoTimelineEntry` por cena combinando timing/texto de Bruno com transição/efeitos de Vanessa (incluindo verificação específica do Gancho e do CTA final); cálculo correto de `totalDurationSeconds`; geração completa do plano de edição; citação da identidade visual real nos assets; briefing estruturado para Rafa; ausência de campos de vídeo renderizado; tratamento de cliente não encontrado; tratamento de contexto insuficiente; validação de entrada (incluindo `brunoScript` sem cenas e `vanessaDirection` sem direções de cena, como testes separados); logs e eventos esperados; pureza de `buildBaselineEditingPlan`/`buildRafaBriefing`; isolamento (nenhum provider de IA concreto, nenhuma outra Skill chamada diretamente — incluindo verificação explícita de que Bruno, Vanessa e Rafa não são importados —, nenhum acesso a storage, nenhum `child_process`/`ffmpeg`/`spawn`/`execSync`).

`tests/arthur.orchestrator.test.mjs` ganhou 1 teste novo cobrindo a cascata completa de três capabilities (nome/tipo/`dependsOn`/os três `inputBindings` corretos da etapa "Edição de vídeo", e confirmação de que Revisão não depende dela), e o teste de ausência foi estendido para cobrir `video_editing` junto de `video_script`/`video_direction`.

`tests/skills-discovery.test.mjs` ganhou verificação de que o manifesto de Diego é copiado para `dist/skills`, que Helena o descobre como décima Skill `READY`, e que é encontrado pela capability `video_editing`.

## Validações executadas

- `npx tsc --noEmit` — sem erros.
- `npm test` — **341/341 testes passando** (315 antes desta rodada + 27 novos, entre Diego e os ajustes em Arthur/skills-discovery — a diferença líquida reflete 27 testes de Diego − 1 já contado no total anterior).
- `npm run architecture:check` — build completo, **dez Skills descobertas**, `video_editing` → `diego-video-editing` confirmado junto às outras nove capabilities.
- **Validação end-to-end real via CLI**: `npm run zuno -- "Crie um roteiro de vídeo curto para o Rumo ao Altar sobre taxa zero na lista de presentes."` produziu um plano com as etapas Estratégia → Roteiro de vídeo → Direção de vídeo → **Edição de vídeo** → Criação da copy → Revisão → Aprovação, todas `COMPLETED` até a pausa esperada em aprovação humana. Inspecionei o JSON persistido e confirmei: 5 `DiegoTimelineEntry` somando exatamente os 30 segundos reais do roteiro de Bruno (0-6s, 6-12s, 12-18s, 18-24s, 24-30s), cada uma com `captionText`/`onScreenText` reais de Bruno e `transitionToNext`/`visualEffects` reais de Vanessa, tipos de corte corretos (seco no Gancho e no CTA final, dinâmico no meio), `musicTrackPlan` e `editingInstructions` citando textualmente a direção real de Vanessa, `requiredAssets` citando as cores reais da marca (`#C97F91`, `#111111`, `#FFFFFF`), e `rafaBriefing` completo com `status: "preliminary"`. Confirmei também que nenhuma etapa de imagem apareceu no plano.

## Impacto na arquitetura do Zuno

- **Isolamento entre Skills preservado**: Diego não importa nada de Bruno, Vanessa, João, Sofia, Bianca, Pedro, Lucas ou Ana; define seus próprios tipos espelhados. Bruno e Vanessa não precisaram de nenhuma alteração para alimentar Diego — as interfaces já existiam (`vanessaBriefing`, `diegoBriefing`).
- **Padrão de fan-in introduzido na pipeline de vídeo**: até Diego, a pipeline de vídeo era estritamente linear (uma entrada, um briefing de saída). Diego introduz o primeiro fan-in real (duas entradas simultâneas), mas usando o mesmo mecanismo genérico de `inputBindings` que Lucas já usa há mais tempo na pipeline de imagens — nenhuma mudança de infraestrutura foi necessária no Caio.
- **Pipeline de imagens intacta**: confirmado por testes automatizados (341/341) e validação manual.
- **Precedente reaproveitado**: capabilities reservadas sem Skill (`campaign_management`, `metrics_analysis`, `optimization`, `video_creation`) continuam falhando de forma imediata e clara via checagem prévia do Caio — o mesmo se aplicará automaticamente quando alguém tentar avançar a pipeline de vídeo além de Diego.

## Recomendações para a próxima Skill (Rafa)

- Rafa deve consumir `DiegoRafaBriefing` através de um tipo espelhado próprio (`RafaDiegoBriefing` ou nome equivalente), exatamente como Diego espelha o briefing de Vanessa — nunca importando os tipos de Diego diretamente.
- Como `editingTimeline` já traz tempos exatos, cortes, legendas, textos na tela, transições e efeitos por cena, Rafa pode focar em renderização técnica (composição de camadas, exportação, formatos de saída) sem precisar reinterpretar decisões de conteúdo, direção ou edição.
- Diferente de Bruno/Vanessa/Diego (cada um consumindo apenas a etapa anterior, ou no caso de Diego, duas etapas anteriores), Rafa provavelmente precisará do `rafaBriefing` de Diego como entrada única e suficiente — ele já agrega tudo que as três etapas anteriores decidiram. Vale considerar se algum dado adicional (ex.: `joaoStrategy` para contexto de marca) ainda é necessário diretamente, ou se o briefing agregado já é suficiente; a experiência desta rodada (Diego precisando de duas fontes) sugere avaliar caso a caso, não assumir sempre uma cadeia estritamente linear.
- Ao integrar Rafa ao plano de Arthur, a etapa "Edição de vídeo" deixará de ser a última da cascata — seguirá o mesmo padrão já estabelecido (`if (required.has("video_editing")) required.add("video_rendering")` ou capability equivalente).
- Esta é provavelmente a última etapa antes de a pipeline de vídeo se conectar à Revisão (Lucas) e à Aprovação, já que Rafa produz o vídeo final — nesse momento, valerá a pena revisar se Lucas precisa de um modo de revisão específico para vídeo, adiado nas três rodadas anteriores por não haver ainda um artefato final revisável.
- Manter a mesma disciplina das rodadas anteriores: nenhuma renderização real de vídeo, nenhum `child_process`/binário externo (ffmpeg etc.) sem uma decisão arquitetural explícita e documentada. Diferente das etapas anteriores (puramente heurísticas em texto), Rafa provavelmente vai precisar de uma decisão real sobre renderização (motor de renderização, formato de entrega), que deve ser tratada como uma decisão arquitetural separada e explícita quando chegar a hora, não implementada de forma implícita.
