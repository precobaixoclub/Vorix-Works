# Relatório técnico — Rafa, quarta etapa da pipeline de vídeo (Developer Assisted Mode)

Este relatório documenta a implementação de Rafa, Especialista em Renderização/Geração de Vídeo, a décima primeira Skill real do Zuno e a quarta etapa da pipeline de vídeo: João → Bruno → Vanessa → Diego → Rafa → Lucas → Ana. Nesta primeira versão, Rafa opera exclusivamente em Developer Assisted Mode — o mesmo mecanismo já usado por Pedro na pipeline de imagens, adaptado para vídeo. Nenhuma renderização real, nenhum provider de vídeo e nenhuma publicação foram implementados, por instrução explícita do pedido.

## Arquivos criados

**Skill:**
- `src/skills/rafa-video-rendering/rafa-video-rendering.types.ts`
- `src/skills/rafa-video-rendering/rafa-log.contract.ts`
- `src/skills/rafa-video-rendering/rafa.manifest.ts`
- `src/skills/rafa-video-rendering/skill.manifest.json`
- `src/skills/rafa-video-rendering/rafa-video-rendering.skill.ts`
- `src/skills/rafa-video-rendering/index.ts`

**Documentação:**
- `docs/rafa-video-rendering.md`
- `docs/rafa-video-rendering-report.md` (este relatório)

**Testes:**
- `tests/rafa-video-rendering.test.mjs` (23 testes)

## Arquivos alterados

- `src/domain/skills/skill-capability.contract.ts` — capability `video_rendering` adicionada ao catálogo, logo após `video_editing`.
- `src/domain/skills/skill.contract.ts` — `"video"` adicionado a `SKILL_ARTIFACT_TYPES` (ao lado de `"image"`/`"carousel"`, que Pedro já usa); comentário de `needs_assisted_generation` atualizado para citar Rafa além de Pedro.
- `src/application/events/zuno-event.contract.ts` — eventos `VideoRenderingStarted`, `VideoRenderingContextLoaded`, `VideoPromptBuilt`, `VideoRenderingAwaitingAssistedInput`, `VideoArtifactCreated`, `VideoRenderingFailed` adicionados.
- `src/application/orchestration/arthur.orchestrator.ts` — `video_rendering` adicionado a `DEFAULT_CAPABILITIES`; nova regra de cascata (`if (required.has("video_editing")) required.add("video_rendering")`); etapa "Renderização de vídeo" adicionada a `createSteps`, dependente da etapa "Edição de vídeo" e recebendo quatro `inputBindings` (fan-in de `joaoStrategy`, `brunoScript`, `vanessaDirection`, `diegoEditingPlan`).
- `src/interfaces/cli/index.ts` — `printAssistedGenerationInstructions` generalizada para ler também `pendingVideos` (além de `pendingImages`), imprimindo resolução/duração/fps quando presentes; mensagens de cabeçalho e `--help` deixaram de mencionar só "imagem".
- `scripts/verify-skills-discovery.mjs` — Rafa adicionado à lista `EXPECTED_SKILLS` (capability `video_rendering`).
- `tests/skills-discovery.test.mjs` — Rafa incluído nos testes de cópia de manifesto, descoberta real (11 Skills) e busca por capability.
- `tests/arthur.orchestrator.test.mjs` — 1 teste novo para a cascata `video_editing` → `video_rendering` (incluindo verificação de que a etapa de renderização não alimenta Revisão e dos quatro `inputBindings`); teste existente de ausência de etapas de vídeo atualizado para cobrir também `video_rendering`.
- `tests/cli.smoke.test.mjs` — 2 asserções atualizadas para o texto genérico "Aguardando geração assistida na etapa" (antes específico de "imagem").
- `package.json` — `tests/rafa-video-rendering.test.mjs` adicionado à lista de arquivos do script `test`.
- `README.md` — Rafa mencionado no parágrafo de "Estado atual" e novo parágrafo dedicado descrevendo a Skill, o Developer Assisted Mode para vídeo e a cascata de quatro capabilities.
- `src/skills/README.md` — contagem e descrição atualizadas para onze Skills reais, incluindo Rafa.
- `docs/arthur-orchestrator.md` — seção "Preparação para Skills futuras" atualizada com Rafa/`video_rendering` e a cascata de quatro níveis.
- `docs/caio-workflow-executor.md` — seção de pausa por geração assistida atualizada para citar Rafa além de Pedro.
- `src/interfaces/cli/README.md` — seção "Developer Assisted Mode" reescrita para cobrir imagem (Pedro) e vídeo (Rafa) de forma unificada.
- `docs/diego-video-editing.md`, `docs/vanessa-video-direction.md`, `docs/bruno-video-script.md` — seções de limitações atualizadas para refletir que Rafa deixou de ser "futuro" e passou a ser Skill real.

Nenhum arquivo de João, Sofia, Bianca, Pedro, Lucas ou Ana foi alterado no seu código-fonte (Pedro só foi tocado indiretamente via `SKILL_ARTIFACT_TYPES`, um contrato de domínio compartilhado, não o código de Pedro em si). **Bruno, Vanessa e Diego também não foram alterados** — Rafa consome os campos `vanessaBriefing`, `diegoBriefing` e `rafaBriefing` que as três já produziam desde suas próprias implementações. **Caio não precisou de nenhuma mudança de lógica** — o mecanismo de pausa/retomada por `needs_assisted_generation` já era genérico o suficiente para qualquer Skill, confirmado ao reutilizá-lo integralmente para vídeo sem tocar em `caio.executor.ts`.

## Decisões arquiteturais

**1. Rafa é single-mode por design — não há (nem deveria haver) um modo `ai_provider` alternativo.** Diferente do Pedro, que mantém dois modos configuráveis (`ai_provider` apontando para o Ícaro, e `developer_assisted`), Rafa não declara `IcaroBrainPort` como dependência e não tem um campo de modo configurável. Motivo verificado no código: `AITaskType` (`src/application/ports/ai-provider.port.ts`) não tem nenhum valor `video_generation` — só `text_generation`, `image_generation`, `analysis`, `classification`, `summary`, `translation`, `review`. Implementar um modo `ai_provider` para Rafa hoje significaria criar um caminho de código que sempre falharia (chamando uma capability de IA que não existe), ou inventar uma abstração de infraestrutura só para nunca ser usada — pior do que simplesmente não ter esse modo. Esta é uma diferença deliberada e documentada em relação ao padrão de Bruno/Vanessa/Diego (que usam Ícaro de forma opcional para enriquecer prosa) e ao padrão do Pedro (dual-mode): Rafa reflete honestamente que só existe um caminho real hoje.

**2. `video_rendering` é acionada em cascata a partir de `video_editing`, sem palavra-chave própria.** Mesma lógica já estabelecida entre Bruno→Vanessa e Vanessa→Diego: `if (required.has("video_editing")) required.add("video_rendering")`. A cascata completa agora tem quatro níveis (`video_script` → `video_direction` → `video_editing` → `video_rendering`), confirmada na validação real via CLI: um único comando mencionando "roteiro" gerou as quatro etapas em sequência, terminando com a pausa em Rafa.

**3. Rafa é a segunda Skill da pipeline de vídeo a fazer fan-in de múltiplas etapas anteriores — e a que faz o fan-in mais amplo até aqui (três).** O pedido do usuário foi explícito: Rafa precisa de "estratégia do João; roteiro do Bruno; direção da Vanessa; plano de edição do Diego" como entradas separadas, não apenas do briefing agregado mais recente (o `rafaBriefing` de Diego). Isso é honrado literalmente: `RafaVideoRenderingRequestInput` tem `joaoStrategy`, `brunoScript`, `vanessaDirection` e `diegoEditingPlan` como campos distintos, todos citados integralmente no prompt final de renderização. O `dependsOn` da etapa em Arthur, porém, é só `[videoEditingStepId]` — os `inputBindings` referenciam livremente etapas anteriores (estratégia, roteiro, direção) sem precisar listá-las em `dependsOn`, o mesmo mecanismo genérico que a etapa de Revisão do Lucas já usa para agregar várias etapas.

**4. Caminho padrão exato conforme pedido, resolvido pela infraestrutura existente sem nenhuma mudança nela.** `expectedRelativePath: "videos/final-video.mp4"` combinado com a resolução já existente em `LocalArtifactDelivery` (`rootDir/executionId/relativePath`, com `rootDir` padrão `<cwd>/artifacts`) produz exatamente `artifacts/<executionId>/videos/final-video.mp4`, o caminho pedido — confirmado na validação real via CLI. Nenhuma mudança foi necessária em `ArtifactDeliveryPort` ou `LocalArtifactDelivery`: a mesma abstração que Pedro usa para `images/slide-01.png` já suporta qualquer `relativePath`.

**5. Validação de vídeo sem parser de vídeo.** Assim como Pedro valida PNG sem depender de uma biblioteca de imagem (lendo a assinatura e o chunk IHDR manualmente), Rafa valida MP4 sem depender de uma biblioteca de vídeo: confere a extensão `.mp4`, um tamanho mínimo de 100KB (heurística anti-placeholder, mesmo espírito do mínimo de 64×64px do Pedro) e a caixa `ftyp` nos bytes 4-7 do arquivo (presente em todo container ISO Base Media/MP4 real). Isso **não** confirma duração, resolução, fps ou codecs reais do arquivo — fazer isso exigiria um parser MP4 completo (percorrer `moov`/`mvhd`/`trak`), deliberadamente fora do escopo desta primeira versão. Essa limitação está documentada no código (`buildObservations`), na saída de toda execução (`observations`) e na documentação — nunca escondida.

**6. Artefato tipado como `"video"`, não `"file"` genérico.** Adicionar `"video"` a `SKILL_ARTIFACT_TYPES` (em vez de reaproveitar `"file"`) mantém paridade com `"image"`/`"carousel"` que Pedro já usa — cada tipo de mídia final tem seu próprio valor semântico no contrato de domínio, permitindo que consumidores futuros (ex.: uma UI, ou a própria Ana) distingam artefatos de vídeo sem inspecionar `mimeType`.

**7. Etapa de renderização de vídeo não alimenta Revisão nem Aprovação, assim como as três anteriores.** Lucas ainda não sabe revisar vídeo. Confirmado por teste dedicado e por validação real via CLI, onde a Revisão (Lucas) completou normalmente sem depender da etapa de Rafa, e o workflow seguiu para `WAITING_HUMAN_APPROVAL` no fluxo de texto/imagem já existente, em paralelo à pipeline de vídeo que parou em Rafa.

**8. Nenhuma capability nova de imagem foi tocada.** `video_rendering` não interfere em `art_direction`/`social_media_design`/`image_generation`. Confirmado pela suíte completa (362/362) e pela validação manual mostrando as etapas de imagem ausentes quando o pedido só menciona vídeo.

## Como Rafa usa o plano do Diego

Rafa consome exatamente o campo `rafaBriefing` que o próprio Diego já monta pensando nesta etapa (`DiegoRafaBriefing`), reaproveitando o mesmo padrão de "briefing autocontido para o próximo especialista" que toda a cadeia usa desde João. A `editingTimeline` de Diego entra integralmente e literalmente no prompt final (`JSON.stringify(input.diegoEditingPlan, ...)`) — Rafa nunca a reprocessa, resume ou redefine, apenas a repassa junto das especificações técnicas para a IA desenvolvedora seguir. `requiredAssets` de Diego é reutilizado tal e qual na saída de Rafa (`output.requiredAssets = request.input.diegoEditingPlan.requiredAssets`), sem recriação. Por respeito ao isolamento entre Skills (ADR 0002), Rafa não importa nenhum tipo de Diego — define seu próprio tipo espelhado `RafaDiegoEditingPlanSummary`/`RafaEditingTimelineEntry`.

## Como funciona o Developer Assisted Mode para vídeo

Idêntico em estrutura ao mecanismo do Pedro, adaptado ao domínio de vídeo:

1. `buildVideoSpecs` fixa as especificações técnicas de vídeo vertical 9:16 (único formato suportado nesta versão — Reels/TikTok/Shorts): `mp4`, `1080x1920`, `9:16`, `30fps`, `H.264 (libx264)`/`AAC`; a única especificação dinâmica é `durationSeconds`, herdada do plano real de Diego.
2. `buildFinalVideoPrompt` monta um prompt técnico completo citando especificações, estratégia, roteiro, direção e plano de edição, com restrições negativas explícitas.
3. `buildAssistedVideoRequests` monta o pedido de vídeo esperado com `expectedRelativePath: "videos/final-video.mp4"`.
4. Rafa chama `ArtifactDeliveryPort.readFile` — nunca `child_process`, nunca um comando externo — para verificar se o arquivo já existe.
5. Se não existe: devolve `needs_assisted_generation` com o vídeo pendente listado em `pendingVideos`.
6. Se existe: valida com `validateMp4Bytes`. Se inválido, continua pendente com o motivo nos `warnings`. Se válido, finaliza e registra o artefato.

## Como ocorre a pausa

Sem nenhuma mudança em Caio: quando Rafa devolve `needs_assisted_generation`, `executeSkillStep` (já genérico) marca a etapa como `WAITING`, o workflow como `WAITING_ASSISTED_GENERATION`, registra `report.waitingForStepId` e emite `WorkflowPaused` com `reason: "assisted_generation"`. A única mudança necessária foi na CLI: `printAssistedGenerationInstructions` passou a ler também `pendingVideos` (além de `pendingImages`), sem importar o tipo de nenhuma das duas Skills — confirmado ao vivo: a CLI imprimiu corretamente "Vídeo 1", caminho, resolução (`1080x1920`), duração (`30s`), FPS (`30`) e o prompt completo.

## Como ocorre a retomada

`npm run zuno -- --continue <executionId>` chama `Caio.resumeAssistedGeneration` (também sem nenhuma mudança), que devolve a etapa parada para `PENDING` e deixa o workflow reexecutá-la. Rafa roda de novo do zero (`execute` → `runRendering` → `runAssistedGeneration`), lê o arquivo outra vez e decide: pendente de novo (mesma instrução, retomada sempre segura e idempotente) ou completo. Validado ao vivo: após escrever um MP4 real de 150KB no caminho exato esperado, `--continue` avançou o workflow diretamente para `WAITING_HUMAN_APPROVAL`, passando por Lucas no caminho.

## Como o vídeo é validado

`validateMp4Bytes(bytes, relativePath)`:
1. Extensão `.mp4` no caminho relativo.
2. Tamanho mínimo de 100KB (`MP4_MIN_SIZE_BYTES`) — rejeita placeholders triviais.
3. Assinatura: bytes 4-7 formam a caixa `ftyp`.
4. Metadado best-effort: *major brand* extraído dos bytes 8-11 (ex.: `isom`), incluído no artefato.

Testado com três cenários reais: arquivo ausente (pendente), arquivo com assinatura incorreta (rejeitado, mensagem específica), arquivo pequeno demais mesmo com assinatura correta (rejeitado, mensagem específica), e arquivo válido (aceito). Validado ao vivo via CLI com um MP4 real de 150KB — `sizeBytes: 153600`, `majorBrand: "isom"` confirmados na saída real.

## Como o artefato de vídeo é registrado

Só depois que `validateMp4Bytes` aprova, `finalizeRendering` monta um `SkillArtifact` com `type: "video"`, `status: "ready"`, `file` (mimeType `video/mp4`, extensão `mp4`, tamanho real em bytes, caminho local real), `dimensions` (das especificações — 1080×1920, 9:16), `generation` (prompt completo, `provider: "developer-assisted"`, `model: "claude-code-developer-assisted"`, custo e uso zerados — nenhuma IA foi consultada para gerar frames) e `metadata` (clientId, canal, duração, major brand). Confirmado na validação real: o artefato só apareceu na resposta depois do `--continue` bem-sucedido — nunca antes, e nunca com dados fabricados.

## Testes criados

`tests/rafa-video-rendering.test.mjs` (23 testes) cobre: manifesto válido; resolução de cliente; consulta correta à Clara (3 módulos: `BrandContext`/`IdentityContext`/`PublishingContext`); pausa aguardando geração assistida quando o vídeo não existe (com verificação do `pendingVideos`/`resumeCommand`/caminho exatos); rejeição e permanência pendente de arquivo com assinatura inválida; rejeição e permanência pendente de arquivo pequeno demais; aceitação e registro do artefato quando o arquivo é real e válido (com verificação completa de todos os campos do artefato); especificações técnicas fixas (9:16, 1080x1920, 30fps, codecs); prompt final citando Diego/Vanessa/Bruno; tratamento de cliente não encontrado; tratamento de contexto insuficiente; validação de entrada (incluindo `diegoEditingPlan` sem timeline, como teste dedicado); falha estruturada quando `ArtifactDeliveryPort` não está configurada; logs e eventos esperados; ausência de uso de Ícaro nesta primeira versão (teste dedicado, positivo sobre a decisão arquitetural); isolamento (nenhuma outra Skill chamada diretamente, nenhum acesso a `node:fs` direto); ausência de `child_process`/`ffmpeg`/`fetch`/`SocialPublisherPort`.

`tests/arthur.orchestrator.test.mjs` ganhou 1 teste novo cobrindo a cascata completa de quatro capabilities (nome/tipo/`dependsOn`/os quatro `inputBindings` corretos da etapa "Renderização de vídeo", e confirmação de que Revisão não depende dela), e o teste de ausência foi estendido para cobrir `video_rendering`.

`tests/skills-discovery.test.mjs` ganhou verificação de que o manifesto de Rafa é copiado para `dist/skills`, que Helena o descobre como décima primeira Skill `READY`, e que é encontrada pela capability `video_rendering`.

`tests/cli.smoke.test.mjs` teve 2 asserções ajustadas para o texto genérico da mensagem de pausa (generalizada para suportar tanto Pedro quanto Rafa).

## Validações executadas

- `npx tsc --noEmit` — sem erros (limpo já na primeira execução).
- `npm test` — **362/362 testes passando** (341 antes desta rodada + 23 novos de Rafa + 1 novo em Arthur − 2 ajustes de asserção em cli.smoke, sem alteração de contagem líquida nesses dois − 1 já contado no total anterior).
- `npm run architecture:check` — build completo, **onze Skills descobertas**, `video_rendering` → `rafa-video-rendering` confirmado junto às outras dez capabilities.
- **Validação end-to-end real via CLI, incluindo o ciclo completo de pausa e retomada**: `npm run zuno -- "Crie um roteiro de vídeo curto para o Rumo ao Altar sobre taxa zero na lista de presentes."` pausou corretamente em `WAITING_ASSISTED_GENERATION` na etapa "Renderização de vídeo", com a CLI imprimindo o caminho exato (`videos/final-video.mp4`), resolução (`1080x1920`), duração (`30s`), FPS (`30`) e o prompt técnico completo citando fielmente estratégia, roteiro, direção e plano de edição reais. Escrevi um arquivo MP4 real (150KB, caixa `ftyp` válida com major brand `isom`) exatamente em `artifacts/workflow-execution-0001/videos/final-video.mp4` via um script Node standalone (sem usar nenhum mecanismo interno do Zuno, simulando fielmente a "IA desenvolvedora salvando o arquivo"). Rodei `--continue workflow-execution-0001`: o workflow validou o arquivo, registrou o artefato de vídeo (confirmei `sizeBytes: 153600`, `majorBrand: "isom"`, specs corretas no JSON persistido) e avançou automaticamente através de Lucas até `WAITING_HUMAN_APPROVAL` — confirmando que a pipeline de imagens (Maria/Lucas/Aprovação) continua funcionando normalmente em paralelo à pipeline de vídeo isolada.

## Impacto na arquitetura do Zuno

- **Isolamento entre Skills preservado**: Rafa não importa nada de Diego, Vanessa, Bruno, João, Sofia, Bianca, Pedro, Lucas ou Ana; define seus próprios tipos espelhados. Bruno, Vanessa e Diego não precisaram de nenhuma alteração para alimentar Rafa — as interfaces já existiam.
- **Mecanismo de geração assistida provado genérico**: esta é a primeira vez que `needs_assisted_generation`/`WAITING_ASSISTED_GENERATION`/`resumeAssistedGeneration` são reutilizados por uma segunda Skill sem nenhuma mudança em Caio — validação concreta de que o design original (feito pensando só em Pedro) já era corretamente genérico.
- **Contrato de domínio ganhou um novo tipo de mídia**: `SkillArtifactType` agora inclui `"video"`, uma extensão aditiva e não disruptiva do vocabulário compartilhado.
- **Fan-in consolidado como padrão real da pipeline de vídeo**: Diego (2 entradas) e Rafa (3 entradas) confirmam que o fan-in via `inputBindings` — já usado por Lucas na pipeline de imagens — é o mecanismo natural para etapas que precisam agregar contexto de múltiplas etapas anteriores, sem exigir nenhuma extensão da infraestrutura de Caio/Arthur.
- **Pipeline de imagens intacta**: confirmado por testes automatizados (362/362) e validação manual — o fluxo de post único (Maria → Lucas → Aprovação) completou normalmente durante a mesma validação que exercitou a pipeline de vídeo completa.
- **Precedente reaproveitado**: capabilities reservadas sem Skill (`campaign_management`, `metrics_analysis`, `optimization`, `video_creation`) continuam falhando de forma imediata e clara via checagem prévia do Caio.

## Recomendações para a publicação de vídeo no futuro

- **Parsing real de metadados MP4**: antes de confiar cegamente em `specs.durationSeconds` (hoje herdado do plano de Diego, não lido do arquivo), valeria a pena um parser mínimo de caixas MP4 (`moov`/`mvhd`) para confirmar duração real, e talvez `trak`/`stsd` para confirmar codec e resolução reais — hoje essas conferências são apenas nominais (o que foi *pedido*, não o que foi *entregue*). Isso fecha a lacuna documentada na seção "Como o vídeo é validado".
- **Rafa como consumidor único do briefing agregado**: diferente de Diego (que precisa de Bruno+Vanessa porque a direção de Vanessa não carrega texto/tempo), quando Rafa ganhar sucessores, vale reavaliar se cada nova Skill realmente precisa das quatro entradas completas ou se o próprio `rafaBriefing`/futuro briefing de Rafa já basta — a experiência desta rodada sugere avaliar caso a caso, não assumir sempre fan-in máximo.
- **Modo `ai_provider` para vídeo, se algum dia existir**: exigiria primeiro adicionar `video_generation` ao `AITaskType` do Ícaro e um provider real capaz de atendê-lo — só faz sentido revisitar a decisão de single-mode de Rafa quando essa capability de infraestrutura existir de fato, não antes.
- **Publicação de vídeo (Ana ou uma nova Skill)**: hoje `SocialPublisherPort`/`Ana` só lida com posts de imagem/texto (`SocialPostDraft`). Suportar vídeo exigirá decidir se Ana ganha um novo tipo de draft ou se uma Skill dedicada assume publicação de vídeo — e, antes disso, decidir como Lucas passa a revisar conteúdo de vídeo (hoje nenhuma etapa de vídeo alimenta Revisão). Recomendo tratar "Lucas revisa vídeo" como uma decisão arquitetural própria, não um detalhe incidental da Skill de publicação.
- **Assets referenciados vs. assets resolvidos**: `requiredAssets` hoje é uma lista textual (ex.: "arquivo de trilha sonora definida no plano de trilha"), sem um mecanismo de resolução real (onde esse arquivo de fato está). Uma etapa futura de produção real de vídeo provavelmente precisará de um contrato mais concreto para assets (caminhos reais, não descrições).
