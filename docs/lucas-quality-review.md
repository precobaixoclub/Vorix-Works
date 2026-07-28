# Lucas, Especialista em Revisão de Qualidade

Lucas ocupa a capability `quality_review`, que Arthur já reservava desde o primeiro plano de execução como a etapa "Revisão", posicionada logo após copy, direção visual, design e imagem, e imediatamente antes do `human_gate` de aprovação humana. Lucas é uma Skill operacional: revisa o pacote de publicação completo — estratégia do João, copy da Maria, direção visual da Sofia, especificação de design da Bianca e imagens do Pedro — e, quando o comando aciona a pipeline de vídeo, também o pacote de vídeo completo — roteiro do Bruno, direção audiovisual da Vanessa, plano técnico de edição do Diego e vídeo final registrado pelo Rafa — antes que qualquer um dos dois pacotes siga para aprovação humana ou publicação.

Lucas não cria estratégia, não cria copy, não cria imagens, não cria roteiro, não dirige, edita ou renderiza vídeo, não publica, não cria campanhas, não consulta métricas, não acessa storage diretamente e não conversa diretamente com OpenAI, Gemini, Claude ou qualquer provider concreto. Lucas também não executa nem chama outra Skill diretamente — nem Maria, nem Sofia, nem Bianca, nem Pedro, nem Bruno, nem Vanessa, nem Diego, nem Rafa, nem qualquer outra. Sua função é exclusivamente **apontar** problemas, nunca corrigi-los: Lucas não altera automaticamente a copy, a imagem nem o vídeo.

Lucas conhece três abstrações: `ValentinaTenantPort` para identificar o cliente, `ClaraKnowledgePort` para obter regras de marca, tom de voz, palavras proibidas, CTAs, identidade e publicação, e, apenas quando disponível, `IcaroBrainPort` para pedir apoio de IA que complemente a revisão.

## Responsabilidade

Lucas recebe o pacote completo produzido pelas Skills anteriores — a estratégia do João, a copy da Maria, a direção visual da Sofia, a especificação de design da Bianca, as imagens do Pedro e, quando a pipeline de vídeo roda, o roteiro do Bruno, a direção audiovisual da Vanessa, o plano de edição do Diego e o vídeo final do Rafa — e devolve uma revisão estruturada com status, score, aprovação recomendada, problemas encontrados (com severidade), sugestões de ajuste, riscos, um checklist de dezenove itens validado, observações e próximos passos. Lucas nunca reescreve nada: seu papel é auditar a coerência e a qualidade do que já foi produzido, seja o pacote visual estático, o pacote de vídeo, ou os dois ao mesmo tempo.

## Contrato de entrada

A entrada de Lucas é `LucasQualityReviewRequestInput`:

- `clientId` ou `tenantId` (pelo menos um dos dois é obrigatório);
- `originalRequest`: o pedido original do usuário;
- `joaoStrategy`: a estratégia produzida pelo João (`LucasJoaoStrategySummary`);
- `mariaCopy`: a copy produzida pela Maria (`LucasMariaCopy`);
- `sofiaDirection` **(opcional)**: a direção visual produzida pela Sofia (`LucasSofiaDirection`, hoje restrita a conceito, estilo, paleta, formato, proporção, restrições e riscos — sem os campos de layout que migraram para a Bianca);
- `biancaDesign` **(opcional)**: um resumo da especificação de design produzida pela Bianca (`LucasBiancaDesign`, com `designConcept`, `gridSystem`, `slides` e `designRisks`);
- `pedroImages` **(opcional)**: as imagens/artefatos produzidos pelo Pedro (`LucasPedroImages`, com `imageCount` e a lista `images`);
- `brunoScript` **(opcional)**: o roteiro de vídeo produzido pelo Bruno (`LucasBrunoScript`, com `hook`, `totalDurationSeconds`, `scenes` — cada uma com `order`, `name`, `durationSeconds`, `spokenText`, `onScreenText` —, `finalCta` e `channel`);
- `vanessaDirection` **(opcional)**: a direção audiovisual produzida pela Vanessa (`LucasVanessaDirection`, com `sceneDirections`, `visualRhythm`, `captionStyle` e `channel`);
- `diegoEditingPlan` **(opcional)**: o plano técnico de edição produzido pelo Diego (`LucasDiegoEditingPlan`, com `editingTimeline` — cada trecho com `order`, `name`, `onScreenText` —, `totalDurationSeconds` e `channel`);
- `rafaVideo` **(opcional)**: o vídeo final registrado como artefato pelo Rafa (`LucasRafaVideo`, com `fileName`, `mimeType`, `extension`, `specs` — `width`, `height`, `aspectRatio`, `durationSeconds`, `format` — e `sizeBytes`);
- `channel`, `format`: canal e formato da peça sendo revisada;
- `workflowContext`: contexto opcional adicional vindo do workflow.

Assim como Sofia, Bianca e Pedro fazem com o output do especialista anterior, Lucas não importa nenhum tipo de João, Maria, Sofia, Bianca, Pedro, Bruno, Vanessa, Diego ou Rafa — ele define seus próprios tipos, espelhando por convenção o formato real que cada um produz, preservando o isolamento entre Skills (ADR 0002).

### Campanhas somente texto e campanhas sem vídeo

`sofiaDirection`, `biancaDesign` e `pedroImages` só existem na entrada de Lucas quando o `ExecutionPlan` do Arthur incluiu as etapas visuais correspondentes — uma campanha em que Arthur não detectou nenhum canal visual (por exemplo, um comando que não menciona Instagram, Facebook ou qualquer formato visual) nunca aciona Sofia, Bianca ou Pedro, e por isso nunca produz esses campos. Isso não é um erro: `validateRequestInput` só exige a forma completa desses três campos **quando ao menos um deles estiver presente** (`hasVisualComponent`) — dado parcial nesse caso indicaria uma falha real de encadeamento entre etapas, não a ausência legítima de componente visual. Da mesma forma, as validações que dependem desses campos (`evaluateVisual`, `evaluateImages`, e as comparações de formato/proporção dentro de `evaluateCoherence`) simplesmente não rodam quando o campo correspondente está ausente, em vez de gerar um problema — uma campanha somente texto pode alcançar `reviewStatus: "approved"` e score 100 normalmente, sem qualquer penalidade pelos itens visuais do checklist.

`brunoScript`, `vanessaDirection` e `diegoEditingPlan` seguem exatamente o mesmo raciocínio (`hasVideoComponent`): só existem quando o comando aciona a pipeline de vídeo (menciona "roteiro"), e sua ausência conjunta nunca é um problema. `rafaVideo` é a única exceção deliberada: quando os outros três campos de vídeo estão presentes mas `rafaVideo` está ausente, isso **não** é um erro de validação — é um cenário de revisão legítimo (o vídeo ainda não foi renderizado/salvo por Rafa) que Lucas sinaliza como o problema bloqueante `NO_VIDEO_FILE`, análogo a `NO_IMAGES_GENERATED` para o Pedro.

## Contrato de saída

Lucas devolve `LucasQualityReviewOutput`, contendo:

- `reviewStatus`: um de `"approved"`, `"approved_with_warnings"`, `"needs_adjustments"` ou `"rejected"`;
- `overallScore`: score geral de 0 a 100;
- `approvalRecommended`: booleano, verdadeiro para `approved` e `approved_with_warnings`;
- `issues`: lista de problemas encontrados, cada um com `code`, `category` (`strategy`, `copy`, `visual`, `coherence`, `tone`, `cta`, `brand` ou `risk`), `message` e `severity` (`low`, `medium` ou `high`);
- `suggestions`: sugestões de ajuste, uma por problema (mais as complementares do Ícaro, quando usado);
- `risks`: riscos agregados (das etapas anteriores mais os problemas de severidade alta encontrados por Lucas — incluindo os de vídeo);
- `checklist`: os dezenove itens de verificação (dez do pacote visual estático, nove do pacote de vídeo), cada um com `passed` e, quando aplicável, `notes`;
- `observations`, `nextSteps`;
- `aiSupportUsed`: indica se o Ícaro complementou a revisão nesta execução.

Quando a solicitação é inválida ou a Valentina não encontra o cliente, Lucas devolve `status: "failed"`. Quando a Clara devolve contexto de marca insuficiente (sem `IdentityContext` e sem `BrandContext`), Lucas devolve `status: "needs_more_context"` — essa é uma falha de infraestrutura de revisão, distinta do `reviewStatus: "rejected"`, que é um resultado válido e esperado de uma revisão que de fato aconteceu.

## Como Lucas consulta Valentina

Idêntico ao padrão de João, Sofia e Pedro: `getClientContext(tenantId)` quando a solicitação já traz `tenantId`, ou `getTenant({ clientId, status: "all" })` seguido de `getClientContext(tenant.id)` quando só há `clientId`. Falha na resolução do cliente interrompe a execução com `status: "failed"` e `error.code: "CLIENT_NOT_FOUND"`.

## Como Lucas consulta Clara

Lucas usa somente `ClaraKnowledgePort.requestContext`, pedindo os três módulos citados no escopo do prompt — marca, identidade e publicação (`BrandContext`, `IdentityContext`, `PublishingContext`) —, o mesmo conjunto consultado pelo Pedro. `BrandContext` é o mais determinante: é dali que vêm tom de voz esperado, palavras proibidas, hashtags proibidas, palavras obrigatórias e CTAs preferidos, usados diretamente na validação de regras de marca. A mesma regra de completude usada por Sofia e Pedro se repete: sem `IdentityContext` e sem `BrandContext` ao mesmo tempo, Lucas recusa revisar sem uma base mínima de regras de marca.

## Como Lucas usa Ícaro

O Ícaro é uma dependência **opcional** para Lucas (`IcaroBrainPort` com `optional: true`), assim como para João, Sofia e Bianca. A revisão em si é inteiramente determinística e heurística — nunca depende de IA para calcular score, status ou checklist. Quando o Ícaro está configurado, Lucas pede `taskType: "review"` (o único Especialista a usar esse task type, o mais semanticamente correto para a função de revisão), enviando a revisão heurística já calculada e pedindo apenas observações e sugestões complementares em JSON. As `constraints` do pedido reforçam explicitamente que o Ícaro não deve alterar copy, imagem, score, status ou checklist. O resultado é **apenas somado** (`additionalObservations`, `additionalSuggestions`) à revisão heurística, nunca substituindo ou recalculando nada — essa foi uma decisão deliberada para manter o score e o status sempre determinísticos e auditáveis, mesmo quando a IA participa. Falha do Ícaro nunca falha a execução: fica registrada em log (`AISupportFailed`) e `aiSupportUsed` permanece `false`.

## Como Lucas valida estratégia, copy, direção visual e imagens

A função pura `buildBaselineReview` roda nove validações independentes do pacote visual estático, cada uma podendo gerar um ou mais problemas (`LucasIssue`):

- **Estratégia**: sinaliza (severidade média) quando o João não definiu nenhuma mensagem principal.
- **Copy**: sinaliza (severidade alta) título ou legenda ausentes na copy da Maria, e (severidade média) quando a própria autoavaliação de qualidade da Maria veio abaixo de 70 pontos.
- **Direção visual**: sinaliza (severidade alta) ausência de conceito visual definido pela Sofia — só roda quando `sofiaDirection` está presente.
- **Imagens**: sinaliza (severidade alta, bloqueante) quando nenhuma imagem foi gerada pelo Pedro, e (severidade média) quando a quantidade declarada diverge da quantidade de imagens efetivamente recebidas — só roda quando `pedroImages` está presente.
- **Coerência entre texto e visual**: compara o formato recomendado pela Sofia com o formato solicitado (só quando `sofiaDirection` está presente), o canal da estratégia do João com o canal solicitado (roda sempre), e a proporção da primeira imagem gerada com a proporção recomendada pela Sofia (só quando ambos estão presentes).
- **Tom de voz**: compara o tom usado pela Maria com o tom esperado (o da marca na Clara, com fallback para o tom definido pelo João).
- **CTA**: compara o CTA da copy com o CTA recomendado pela estratégia.
- **Regras da marca**: procura palavras proibidas e hashtags proibidas (severidade alta, bloqueante) e palavras obrigatórias ausentes (severidade baixa) no texto combinado — a copy da Maria **e**, quando presente, o texto falado/na tela de todas as cenas do roteiro de Bruno (`collectVideoText`) —, todas vindas de `BrandContext`.
- **Riscos**: sinaliza (severidade baixa) quando nem o João, nem a Sofia, nem a Bianca documentaram nenhum risco — a agregação de riscos (`buildRisks`) também passou a incluir `biancaDesign.designRisks`.

## Como Lucas valida o pacote de vídeo

Oito validações independentes cobrem exatamente as onze dimensões de revisão de vídeo pedidas, todas condicionadas à presença dos campos correspondentes (nenhuma roda para um pacote somente-imagem):

- **Coerência entre roteiro, direção e edição** (`evaluateVideoCoherence`): compara o número de cenas entre `brunoScript.scenes`, `vanessaDirection.sceneDirections` e `diegoEditingPlan.editingTimeline` — qualquer divergência indica uma falha real de encadeamento entre as três etapas (severidade alta).
- **Duração do vídeo** (`evaluateVideoDuration`): compara `rafaVideo.specs.durationSeconds` com a duração planejada (`diegoEditingPlan.totalDurationSeconds`, com fallback para `brunoScript.totalDurationSeconds`) — divergência ou duração não positiva geram problema de severidade média.
- **Formato vertical e proporção 9:16** (`evaluateVideoFormat`): se `width >= height`, sinaliza severidade alta (vídeo não vertical); senão, se `aspectRatio !== "9:16"`, sinaliza severidade média.
- **Clareza do gancho inicial** (`evaluateVideoHook`): sinaliza (severidade média) quando `brunoScript.hook` está vazio.
- **Presença e consistência do CTA** (`evaluateVideoCta`): sinaliza (severidade alta) quando `brunoScript.finalCta` está vazio; quando presente mas diverge do `recommendedCta` da estratégia, sinaliza severidade média.
- **Ritmo** (`evaluateVideoRhythm`): sinaliza (severidade baixa) quando `vanessaDirection.visualRhythm` está vazio.
- **Legibilidade dos textos na tela** (`evaluateVideoOnScreenTextLegibility`): sinaliza (severidade baixa) quando alguma cena do `diegoEditingPlan.editingTimeline` tem `onScreenText` com mais de 60 caracteres — limite heurístico para leitura rápida em vídeo curto.
- **Qualidade técnica mínima do arquivo** (`evaluateVideoFile`): sinaliza `NO_VIDEO_FILE` (severidade alta, **bloqueante**) quando não há `rafaVideo`; quando há, sinaliza `VIDEO_TECHNICAL_QUALITY_LOW` (severidade alta) se o tamanho for menor que 100KB ou a extensão não for `mp4` — o mesmo limiar que o próprio Rafa usa para rejeitar placeholders (`MP4_MIN_SIZE_BYTES`), reaplicado por Lucas como defesa em profundidade, sem importar nada do Rafa.

"Consistência com a marca" e "riscos de comunicação" (as duas últimas dimensões pedidas) não exigiram nenhum problema novo: a checagem de regras de marca já estendida (acima) cobre a primeira, e a agregação de riscos por severidade alta (`buildRisks`, inalterada) já cobre a segunda — qualquer issue de vídeo com severidade alta entra automaticamente em `risks`. "Se o vídeo está pronto para aprovação" é respondida pelo mesmo par `reviewStatus`/`approvalRecommended` que já serve o pacote visual, sem nenhum campo de saída adicional.

## Como Lucas calcula o score

O score começa em 100 e cada problema encontrado subtrai uma penalidade fixa por severidade: 20 pontos para `high`, 10 para `medium`, 5 para `low`, com piso em zero. O cálculo é uma função pura (`computeScore`), somando as penalidades de todos os problemas simultaneamente — não há pesos diferentes por categoria nem por pacote (visual ou vídeo), mantendo o cálculo simples, previsível e fácil de auditar.

## Como Lucas define o status da revisão

`determineReviewStatus` segue uma ordem de decisão clara: primeiro verifica se algum problema encontrado é **bloqueante** (`NO_IMAGES_GENERATED`, `FORBIDDEN_WORD_FOUND`, `FORBIDDEN_HASHTAG_FOUND` ou `NO_VIDEO_FILE`) — se for, o status é sempre `"rejected"`, independentemente do score, porque esses quatro problemas representam risco real de publicar algo sem conteúdo visual/de vídeo ou violando regra explícita da marca. Se não houver bloqueio, o status segue por faixas de score: `"approved"` exige score de pelo menos 90 e nenhum problema de severidade alta; `"approved_with_warnings"` cobre score de pelo menos 70 (mesmo com algum problema de severidade alta isolado); `"needs_adjustments"` cobre score de pelo menos 40; abaixo disso, `"rejected"`. `approvalRecommended` é verdadeiro exatamente para `"approved"` e `"approved_with_warnings"`.

## Logs implementados

`LucasLogAction` tem treze ações cobrindo as oito categorias pedidas mais granularidade de erro: `RequestReceived` (solicitação recebida), `ClientResolved`/`ClientNotFound` (cliente resolvido/erro), `ContextConsulted`/`ContextIncomplete` (contexto consultado/incompleto), `ReviewStarted` (revisão iniciada), `AISupportRequested`/`AISupportApplied`/`AISupportSkipped`/`AISupportFailed` (apoio de IA solicitado/aplicado/pulado/falho), `ChecklistValidated` (checklist validado), `ReviewFinished` (revisão finalizada) e `Error`. Nenhuma ação nova foi necessária para a revisão de vídeo — o mesmo conjunto de treze ações já cobre genericamente qualquer tipo de pacote revisado.

## Eventos implementados

Os cinco eventos pedidos — `QualityReviewStarted`, `QualityContextLoaded`, `QualityChecklistValidated`, `QualityReviewFinished`, `QualityReviewFailed` — foram adicionados ao `ZunoEventName` compartilhado. Para o apoio opcional de IA, Lucas reaproveita `AIGenerationStarted`/`AIGenerationFinished`, o mesmo padrão de João, Sofia e Bianca.

## Integração com Arthur, Caio e Helena

Arthur já reservava, desde o primeiro `ExecutionPlan`, uma etapa "Revisão" com `skillCapability: "quality_review"`, posicionada logo antes do `human_gate` de aprovação. O manifesto de Lucas declara `capabilities: ["quality_review"]`, então ele ocupa exatamente essa etapa sem exigir nenhuma mudança na capability em Arthur. O catálogo de planos da Valentina já liberava `quality_review` em todos os planos, do FREE ao ENTERPRISE. Helena descobre o manifesto de Lucas, valida, carrega a Skill e a executa somente quando solicitada por Arthur (via Caio).

**A pipeline de vídeo agora se conecta à Revisão.** Até esta rodada, as quatro etapas de vídeo (Bruno, Vanessa, Diego, Rafa) existiam isoladas no plano, sem alimentar Revisão nem Aprovação — Lucas ainda não sabia revisar vídeo. Isso mudou: quando o comando aciona a pipeline de vídeo (menciona "roteiro"), Arthur agora também:

- adiciona a etapa de renderização de vídeo (`videoRenderingStepId`) ao `dependsOn` da Revisão — Lucas só roda depois que Rafa **completa** (não apenas quando pausa em geração assistida), garantindo que o vídeo final já exista e esteja validado antes da revisão;
- inclui quatro `inputBindings` condicionais na Revisão, no mesmo padrão já usado para `sofiaDirection`/`biancaDesign`/`pedroImages`: `brunoScript` (do passo de roteiro, via `sourcePath: "vanessaBriefing"`), `vanessaDirection` (do passo de direção, via `sourcePath: "diegoBriefing"`), `diegoEditingPlan` (do passo de edição, via `sourcePath: "rafaBriefing"`) e `rafaVideo` (do passo de renderização, via `sourcePath: "video"`) — cada um reaproveitando exatamente os mesmos campos de saída que as próprias Skills de vídeo já produziam para a etapa seguinte, sem exigir nenhuma mudança em Bruno, Vanessa, Diego ou Rafa.

Quando o comando não aciona a pipeline de vídeo, nenhum desses quatro `inputBindings` é adicionado e o `dependsOn` da Revisão permanece exatamente como antes — a pipeline de imagens não sofre nenhuma alteração de comportamento (confirmado por teste dedicado e por validação real via CLI).

## Como o resultado de Lucas prepara a aprovação humana ou publicação

O `reviewStatus` de Lucas é o sinal mais direto para decidir o próximo passo do workflow: `"approved"` e `"approved_with_warnings"` (`approvalRecommended: true`) indicam que o pacote pode seguir para o `human_gate` de aprovação já existente no plano de Arthur; `"needs_adjustments"` indica que o pacote deve voltar para ajuste antes de nova revisão; `"rejected"` indica que o pacote não deve seguir adiante de forma alguma. O `checklist`, os `issues` com severidade e as `suggestions` dão ao humano responsável pela aprovação uma visão completa do que foi verificado e do que precisa de atenção, sem que Lucas precise — ou tenha permissão para — corrigir nada por conta própria.

Ana (Especialista em Publicação Social, `docs/ana-social-publishing.md`) é a Skill real que fecha esse ciclo para o pacote visual estático: `lucasReview.approvalRecommended` é uma das nove regras obrigatórias que Ana verifica antes de sequer montar um payload de publicação — se Lucas não recomendou aprovação, Ana bloqueia a publicação, mesmo que a aprovação humana já tenha sido confirmada separadamente. Como nas demais transições entre Skills, Ana não importa nenhum tipo de Lucas; ela espelha por convenção um resumo do `LucasQualityReviewOutput` em seu próprio tipo `AnaLucasReview`.

**Publicação de vídeo ainda não existe.** Mesmo com Lucas agora revisando o pacote de vídeo e o plano de Arthur incluindo a etapa de Aprovação logo depois da Revisão (que já espera tanto o pacote visual quanto o de vídeo, quando presentes), nenhuma etapa de publicação consome `rafaVideo` ou o resultado da revisão de vídeo hoje — Ana continua publicando exclusivamente o pacote de imagem/copy. Ver recomendações em `docs/rafa-video-rendering-report.md` e no relatório desta rodada (`docs/lucas-video-review-report.md`) para o que falta antes de a publicação de vídeo existir de fato.
