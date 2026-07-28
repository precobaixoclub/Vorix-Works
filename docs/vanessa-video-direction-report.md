# Relatório técnico — Vanessa, segunda etapa da pipeline de vídeo

Este relatório documenta a implementação de Vanessa, Especialista em Direção de Vídeo, a nona Skill real do Zuno e a segunda etapa da pipeline de vídeo: João → Bruno → Vanessa → Diego → Rafa → Lucas → Ana. Nenhuma etapa depois de Vanessa foi implementada nesta rodada, por instrução explícita do pedido.

## Arquivos criados

**Skill:**
- `src/skills/vanessa-video-direction/vanessa-video-direction.types.ts`
- `src/skills/vanessa-video-direction/vanessa-log.contract.ts`
- `src/skills/vanessa-video-direction/vanessa.manifest.ts`
- `src/skills/vanessa-video-direction/skill.manifest.json`
- `src/skills/vanessa-video-direction/vanessa-video-direction.skill.ts`
- `src/skills/vanessa-video-direction/index.ts`

**Documentação:**
- `docs/vanessa-video-direction.md`
- `docs/vanessa-video-direction-report.md` (este relatório)

**Testes:**
- `tests/vanessa-video-direction.test.mjs` (25 testes)

## Arquivos alterados

- `src/domain/skills/skill-capability.contract.ts` — capability `video_direction` adicionada ao catálogo, logo após `video_script`.
- `src/application/events/zuno-event.contract.ts` — eventos `VideoDirectionStarted`, `VideoDirectionContextLoaded`, `VideoDirectionGenerated`, `DiegoBriefingCreated`, `VideoDirectionFailed` adicionados.
- `src/application/orchestration/arthur.orchestrator.ts` — `video_direction` adicionado a `DEFAULT_CAPABILITIES`; nova regra de cascata (`if (required.has("video_script")) required.add("video_direction")`); etapa "Direção de vídeo" adicionada a `createSteps`, dependente da etapa "Roteiro de vídeo".
- `scripts/verify-skills-discovery.mjs` — Vanessa adicionada à lista `EXPECTED_SKILLS` (capability `video_direction`).
- `tests/skills-discovery.test.mjs` — Vanessa incluída nos testes de cópia de manifesto, descoberta real (9 Skills) e busca por capability.
- `tests/arthur.orchestrator.test.mjs` — 1 teste novo para a cascata `video_script` → `video_direction` (incluindo verificação de que a etapa de direção não alimenta Revisão); teste existente de ausência de etapas de vídeo atualizado para cobrir também `video_direction`.
- `package.json` — `tests/vanessa-video-direction.test.mjs` adicionado à lista de arquivos do script `test`.
- `README.md` — Vanessa mencionada no parágrafo de "Estado atual" e parágrafo dedicado descrevendo a Skill e a cascata de capabilities.
- `src/skills/README.md` — contagem e descrição atualizadas para nove Skills reais, incluindo Vanessa.
- `docs/arthur-orchestrator.md` — seção "Preparação para Skills futuras" atualizada com Vanessa/`video_direction` e a mecânica de cascata.
- `docs/bruno-video-script.md` — seções de integração e limitações atualizadas para refletir que Vanessa deixou de ser "futura" e passou a ser Skill real; título da seção "prepara o trabalho da Vanessa" ajustado.

Nenhum arquivo de João, Sofia, Bianca, Pedro, Lucas ou Ana foi alterado. **Bruno também não foi alterado no seu código-fonte** — Vanessa consome o campo `vanessaBriefing` que Bruno já produzia desde sua própria implementação, sem exigir nenhuma mudança nele.

## Decisões arquiteturais

**1. `video_direction` é acionada em cascata a partir de `video_script`, sem palavra-chave própria.** Diferente de Bruno (acionado por "roteiro"), Vanessa depende inteiramente da saída de Bruno — não faz sentido pedir uma direção audiovisual sem antes ter um roteiro. Em vez de inventar uma segunda palavra-chave que o usuário precisaria lembrar de digitar, a regra é: `if (required.has("video_script")) required.add("video_direction")`. Pedir um roteiro já avança a pipeline de vídeo até onde ela existir hoje — exatamente o comportamento confirmado na validação real via CLI, onde um único comando gerou automaticamente as etapas "Roteiro de vídeo" e "Direção de vídeo" em sequência.

**2. Vanessa consome o briefing de Bruno, não o roteiro "cru".** Bruno já expõe (desde sua própria implementação) um campo `vanessaBriefing` — um documento autocontido pensado especificamente para esta etapa. O `inputBinding` de Arthur usa exatamente esse campo (`sourcePath: "vanessaBriefing"`), o mesmo padrão que Sofia → Bianca e João → Sofia já usam. Vanessa nunca importa o tipo real de Bruno; define seu próprio tipo espelhado `VanessaBrunoScriptSummary`/`VanessaBrunoScene`, preservando o isolamento entre Skills (ADR 0002).

**3. Mapa de cenas é gerado 1:1 a partir das cenas de Bruno, nunca recriado.** `buildSceneDirections` mapeia cada `VanessaBrunoScene` para exatamente uma `VanessaSceneDirection` com a mesma `order`/`name` — Vanessa nunca adiciona, remove ou reordena cenas. A decisão de "o que acontece" em cada cena (texto falado, texto na tela, duração) permanece 100% de Bruno; Vanessa decide apenas "como filmar e compor" essa cena (enquadramento, composição, câmera, transição, efeitos visuais). A diferenciação por `scene.name` ("Gancho", "CTA final", "Desenvolvimento N") reaproveita a mesma convenção de nomenclatura que Bruno já estabelece, sem precisar de nenhum campo estrutural novo em Bruno.

**4. Direção audiovisual é inteiramente determinística; o Ícaro é só um polimento textual opcional em 5 campos.** Seguindo exatamente a mesma disciplina de Bruno, todo o mapa de cenas e as orientações de produção (sonorização, B-roll, gravação, edição) são heurísticas puras. O Ícaro, quando configurado, só pode aprimorar `visualRhythm`, `captionStyle`, `musicDirection`, `lightDirection` e `colorDirection` — nunca o mapa de cenas. A validação em CLI confirmou isso na prática: mesmo com o `DeterministicFakeIcaroProvider` da CLI (que não devolve o JSON esperado por Vanessa), a execução produziu uma direção completa e correta via `AISupportFailed`.

**5. Direção de luz e cor usam a identidade visual real da Clara quando disponível, com fallback claro quando não.** Mesma disciplina de Sofia: `buildLightDirection`/`buildColorDirection` leem `IdentityContext.imageStyle`/`colors`; na ausência desses dados, devolvem uma heurística genérica que menciona explicitamente "até a identidade visual real ser cadastrada na Clara" — nunca inventam uma identidade visual que a marca não tem.

**6. Etapa de direção de vídeo não alimenta Revisão nem Aprovação, assim como a de roteiro.** Lucas ainda não sabe revisar direção audiovisual, e adaptar Lucas para isso está fora do escopo desta rodada ("não implemente Diego" implica não implementar nada que dependa de uma pipeline de vídeo completa). Confirmado por teste dedicado (`reviewStep.dependsOn.includes(directionStep.id) === false`) e por validação real via CLI, onde a Revisão completou normalmente sem depender da etapa de Vanessa.

**7. Nenhuma capability nova de imagem foi tocada.** `video_direction` não interfere em `art_direction`/`social_media_design`/`image_generation` — nenhuma dessas condições de detecção foi alterada. Confirmado pela suíte completa (315/315) e pela validação manual mostrando as duas etapas de imagem ausentes quando o pedido só menciona vídeo.

## Como Vanessa usa o roteiro de Bruno

Vanessa recebe `brunoScript: VanessaBrunoScriptSummary` — o espelho do `vanessaBriefing` real que Bruno produz — contendo `narrativeStructure`, `hook`, `totalDurationSeconds`, `scenes[]`, `overallRhythm`, `musicSuggestions`, `finalCta`, `recordingNotes`, `editingNotes`, `channel` e `notes`. A validação de entrada exige que `brunoScript.scenes` seja um array não vazio (testado explicitamente). A partir daí:
- `visualRhythm` referencia textualmente o `overallRhythm` de Bruno, garantindo coerência entre ritmo narrativo e ritmo visual.
- `musicDirection` incorpora a primeira sugestão de `musicSuggestions` de Bruno, refinando-a em uma recomendação concreta.
- Cada cena do mapa de cenas (`sceneDirections`) é gerada a partir da cena correspondente de `scenes[]`, preservando `order`/`name` e reaproveitando `cameraMovement` como base quando aplicável.

## Como Vanessa gera a direção audiovisual

Ver "Decisões arquiteturais" item 3 para o mapa de cenas. Para as orientações de nível de produção (não específicas de uma cena): ritmo visual, legenda, sonorização, trilha, B-roll, luz, cor, gravação e edição são todas heurísticas puras derivadas do roteiro de Bruno e do `BrandContext`/`IdentityContext` da Clara, testadas individualmente (13 dos 25 testes de Vanessa cobrem diretamente a geração determinística desses campos).

## Como Vanessa prepara o briefing do Diego

`buildDiegoBriefing` reúne todo `VanessaVideoDirectionCore` em um objeto autocontido com `status: "preliminary"`, `channel` e `notes` explicando que gravação, edição, renderização e publicação continuam responsabilidade de Diego e Rafa — mesmo padrão que `buildVanessaBriefing` de Bruno já estabeleceu.

## Testes criados

`tests/vanessa-video-direction.test.mjs` (25 testes) cobre: manifesto válido; resolução de cliente por `tenantId`/`clientId`; consulta correta à Clara (5 módulos); funcionamento completo sem Ícaro; uso opcional do Ícaro com sucesso; degradação graciosa quando o Ícaro falha; garantia de que o Ícaro nunca redefine o mapa de cenas; geração de uma `VanessaSceneDirection` por cena de Bruno com `order`/`name` preservados; comportamento específico do Gancho (enquadramento fechado, corte seco) e do CTA final (retoma o enquadramento do gancho, câmera estática); geração completa da direção audiovisual; fallback de luz/cor quando `IdentityContext` está ausente; briefing estruturado para Diego; ausência de campos de vídeo real; tratamento de cliente não encontrado; tratamento de contexto insuficiente; validação de entrada (incluindo `brunoScript` sem cenas); logs e eventos esperados; pureza de `buildBaselineDirection`/`buildDiegoBriefing`; isolamento (nenhum provider de IA concreto, nenhuma outra Skill chamada diretamente — incluindo verificação explícita de que Bruno e Diego não são importados —, nenhum acesso a storage, nenhum `child_process`/`ffmpeg`/`spawn`/`execSync`).

`tests/arthur.orchestrator.test.mjs` ganhou 1 teste novo cobrindo a cascata completa (capability presente, nome/tipo/`dependsOn`/`inputBindings` corretos da etapa "Direção de vídeo", e confirmação de que Revisão não depende dela), e o teste de ausência foi estendido para cobrir `video_direction` junto de `video_script`.

`tests/skills-discovery.test.mjs` ganhou verificação de que o manifesto de Vanessa é copiado para `dist/skills`, que Helena a descobre como nona Skill `READY`, e que é encontrada pela capability `video_direction`.

## Validações executadas

- `npx tsc --noEmit` — sem erros.
- `npm test` — **315/315 testes passando** (290 antes desta rodada + 25 novos, entre Vanessa e os ajustes em Arthur/skills-discovery).
- `npm run architecture:check` — build completo, **nove Skills descobertas**, `video_direction` → `vanessa-video-direction` confirmado junto às outras oito capabilities.
- **Validação end-to-end real via CLI**: `npm run zuno -- "Crie um roteiro de vídeo curto para o Rumo ao Altar sobre taxa zero na lista de presentes."` produziu um plano com as etapas Estratégia → **Roteiro de vídeo** → **Direção de vídeo** → Criação da copy → Revisão → Aprovação, todas `COMPLETED` até a pausa esperada em aprovação humana. Inspecionei o JSON persistido e confirmei: 5 `VanessaSceneDirection` (uma por cena real de Bruno, com `order`/`name` preservados: Gancho, Desenvolvimento 1/2/3, CTA final), Gancho com enquadramento fechado e corte seco, CTA final retomando o enquadramento do gancho com câmera estática, `visualRhythm`/`musicDirection` referenciando o roteiro real de Bruno, `lightDirection`/`colorDirection` usando a identidade visual real do cliente de demonstração (cores `#C97F91`/`#111111`/`#FFFFFF`, estilo "editorial romântico com humor leve"), e `diegoBriefing` completo com `status: "preliminary"`. Confirmei também que nenhuma etapa de imagem apareceu no plano.

## Impacto na arquitetura do Zuno

- **Isolamento entre Skills preservado**: Vanessa não importa nada de Bruno, João, Sofia, Bianca, Pedro, Lucas ou Ana; define seus próprios tipos espelhados. Bruno não precisou de nenhuma alteração para alimentar Vanessa — a interface já existia (`vanessaBriefing`).
- **Cascata de capabilities é um padrão novo, mas coerente com o existente**: diferente do bundle único de `art_direction`+`social_media_design`+`image_generation` (todas na mesma condição), a cascata `video_script` → `video_direction` é uma dependência explícita entre duas condições separadas — mais adequado aqui porque Bruno pode, em tese, ser usado de forma independente no futuro (ex.: alguém só querer o roteiro), enquanto a imagem sempre pressupõe as três etapas completas.
- **Pipeline de imagens intacta**: confirmado por testes automatizados (315/315) e validação manual.
- **Precedente reaproveitado**: capabilities reservadas sem Skill (`campaign_management`, `metrics_analysis`, `optimization`, `video_creation`) continuam falhando de forma imediata e clara via checagem prévia do Caio — o mesmo se aplicará automaticamente quando alguém tentar avançar a pipeline de vídeo além de Vanessa.

## Recomendações para a próxima Skill (Diego)

- Diego deve consumir `VanessaDiegoBriefing` através de um tipo espelhado próprio (`DiegoVanessaBriefing` ou nome equivalente), exatamente como Vanessa espelha o briefing de Bruno — nunca importando os tipos de Vanessa diretamente.
- Como `sceneDirections` já traz enquadramento, composição, câmera, transição e efeitos visuais detalhados por cena, Diego pode focar em traduzir essa direção em instruções de produção prática (equipamento, locação, talent direction, checklist de gravação) sem precisar reinterpretar ou redecidir a composição visual.
- Ao integrar Diego ao plano de Arthur, a etapa "Direção de vídeo" deixará de ser a última da cascata — ela ganhará um `dependsOn`/consumo adicional a partir da nova etapa de Diego, seguindo o mesmo padrão de cascata já estabelecido nesta rodada (`if (required.has("video_direction")) required.add("video_production")` ou capability equivalente).
- Considerar, quando Diego existir, se a etapa de Revisão (Lucas) deve ganhar um modo de revisão específico para vídeo — hoje nem o roteiro de Bruno nem a direção de Vanessa são lidos por Lucas em nenhum ponto do fluxo; isso se torna mais relevante à medida que a pipeline de vídeo se aproxima de produzir um artefato final revisável.
- Manter a mesma disciplina desta e da rodada anterior: nenhuma geração real de vídeo, nenhum `child_process`/binário externo (ffmpeg etc.) sem uma decisão arquitetural explícita e documentada.
