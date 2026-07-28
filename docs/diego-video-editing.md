# Diego, Especialista em Edição de Vídeo

Diego é a décima Skill real do Zuno e a terceira etapa de uma pipeline de vídeo própria: João → Bruno → Vanessa → Diego → Rafa → Lucas → Ana. Ele é uma Skill operacional: transforma a direção audiovisual produzida por Vanessa (combinada com o roteiro original de Bruno) em um plano técnico de edição, pronto para orientar a Skill Rafa.

Diego é exclusivamente Editor de Vídeo: timeline, ordem das cenas, cortes, duração de cada trecho, legendas por cena, textos na tela, transições, efeitos visuais, efeitos sonoros, trilha sugerida, assets necessários, instruções de edição e checklist técnico. Diego **não** cria roteiro (isso é exclusivo do Bruno), **não** dirige vídeo (enquadramento, composição visual, movimento de câmera, luz e cor são exclusivos da Vanessa — Diego nunca os redefine), **não** renderiza vídeo, **não** publica vídeo e **não** gera vídeo final — essas responsabilidades pertencem às próximas Skills da pipeline de vídeo (Rafa e Ana). Diego também não define layout, grid, paleta ou tipografia de peças visuais estáticas (isso continua sendo exclusivo de Sofia/Bianca, na pipeline de imagens) e não executa nem chama outra Skill diretamente.

Diego conhece apenas três abstrações: `ValentinaTenantPort` para identificar o cliente, `ClaraKnowledgePort` para obter identidade visual, marca, público, conteúdo e publicação e, de forma opcional, `IcaroBrainPort` para pedir apoio de IA na hora de aprimorar o plano de edição. Diego funciona integralmente sem o Ícaro: toda a timeline, cortes, legendas e textos na tela são construídos de forma determinística, por heurística própria, a partir do roteiro real de Bruno e da direção real de Vanessa.

## Responsabilidade

Diego recebe uma solicitação de plano de edição — o pedido original do usuário, a estratégia completa produzida pelo João, o roteiro estruturado que Bruno já prepara pensando na etapa de direção, a direção audiovisual estruturada que a própria Vanessa já prepara pensando nesta etapa, além de canal, formato e objetivo do vídeo — e devolve um plano de edição completo: timeline técnica cena a cena, plano de trilha, assets necessários, instruções de edição, checklist técnico, riscos, observações, próximos passos e um briefing estruturado pronto para a futura Rafa.

## Contrato de entrada

A entrada de Diego é `DiegoEditingRequestInput`:

- `clientId` ou `tenantId` (pelo menos um dos dois é obrigatório);
- `originalRequest`: o pedido original do usuário, em texto livre;
- `joaoStrategy`: a estratégia completa produzida pelo João (`DiegoJoaoStrategySummary`);
- `brunoScript`: o roteiro estruturado que Bruno prepara para a etapa de direção (`DiegoBrunoScriptSummary`), com cenas contendo texto falado, texto na tela e duração — a fonte de verdade para timing e conteúdo textual;
- `vanessaDirection`: a direção audiovisual estruturada que a própria Vanessa já monta pensando em Diego (`DiegoVanessaDirectionSummary`), com o mapa de cenas contendo enquadramento, composição, movimento de câmera, transição e efeitos visuais — a fonte de verdade para decisões visuais;
- `channel`: canal desejado para este vídeo (`instagram`, `facebook`, `threads`, `linkedin`, `tiktok`, `pinterest`, `youtube`, `google_business`, `meta_ads` ou `google_ads`);
- `format`: formato desejado, em texto livre (por exemplo "reels", "tiktok", "shorts");
- `videoObjective`: o objetivo específico deste vídeo, em texto livre;
- `workflowContext`: contexto opcional adicional vindo do workflow.

Diego é a primeira Skill da pipeline de vídeo a receber duas entradas de etapas anteriores simultaneamente (roteiro de Bruno **e** direção de Vanessa), em vez de uma única cadeia — porque a timeline técnica de edição precisa combinar o "o quê" (texto e tempo, decididos por Bruno) com o "como filmar" (composição e efeitos, decididos por Vanessa).

## Contrato de saída

Diego nunca devolve texto solto. Ele devolve `DiegoEditingOutput`, contendo:

- `editingTimeline`: timeline técnica — lista de `DiegoTimelineEntry`, uma por cena (mesma `order`/`name` de Bruno e Vanessa), cada uma com `startSeconds`, `endSeconds`, `durationSeconds`, `captionText` (legenda, extraída do texto falado de Bruno), `onScreenText` (opcional, extraído de Bruno), `cutType`, `transitionToNext` (opcional, extraído de Vanessa), `visualEffects` (extraído de Vanessa), `soundEffectSuggestions` (extraído de Bruno) e `visualAssetRequirement` preservado da direção de Vanessa para Rafa/Asset Resolver;
- `totalDurationSeconds`: duração total, herdada diretamente do roteiro de Bruno;
- `musicTrackPlan`: plano de trilha com timing concreto, refinando a direção musical de Vanessa;
- `requiredAssets`: lista de assets necessários para o editor iniciar o trabalho;
- `editingInstructions`: instruções gerais de edição;
- `technicalChecklist`: checklist técnico de verificação antes de seguir adiante;
- `risks`: riscos identificados;
- `observations`: observações sobre lacunas de conhecimento ou pontos de atenção;
- `nextSteps`: próximos passos recomendados;
- `rafaBriefing`: briefing estruturado pronto para a futura Rafa (`DiegoRafaBriefing`);
- `aiSupportUsed`: indica se o Ícaro conseguiu aprimorar o plano nesta execução.

Quando a solicitação é inválida ou a Valentina não encontra o cliente, Diego devolve `status: "failed"`. Quando a Clara devolve contexto insuficiente (sem `IdentityContext` e sem `BrandContext`), Diego devolve `status: "needs_more_context"`.

## Fluxo interno

1. Valida a solicitação recebida (cliente, pedido original, canal, formato, objetivo do vídeo, presença mínima de `joaoStrategy`, de `brunoScript` com ao menos uma cena, e de `vanessaDirection` com ao menos uma direção de cena).
2. Consulta a Valentina para resolver o cliente.
3. Consulta a Clara por `requestContext`, pedindo os módulos `BrandContext`, `AudienceContext`, `ContentContext`, `IdentityContext` e `PublishingContext`.
4. Avalia se o contexto devolvido é suficiente. Se não houver nem `IdentityContext` nem `BrandContext`, Diego interrompe com `needs_more_context`.
5. Monta um plano de edição base de forma determinística: cada `DiegoTimelineEntry` combina a cena correspondente de Bruno (timing, texto falado, texto na tela, efeitos sonoros) com a direção correspondente de Vanessa (transição, efeitos visuais), casadas pelo campo `order`; o tipo de corte (`cutType`) é derivado do nome da cena (corte seco sem fade no Gancho e no CTA final, corte dinâmico com fade curto no Desenvolvimento); plano de trilha, assets, instruções de edição e checklist técnico são derivados da direção de Vanessa e da identidade visual real da Clara quando existente.
6. Se o Ícaro estiver configurado, monta um prompt e pede uma tarefa `analysis` para aprimorar apenas o plano de trilha, os assets necessários, as instruções de edição e o checklist técnico — nunca a timeline, cortes, legendas ou textos na tela, que permanecem decisão determinística de Diego. Se o Ícaro não estiver configurado ou falhar, Diego segue com o plano heurístico e registra o ocorrido nos logs, sem falhar a execução.
7. Monta o `rafaBriefing`, reunindo todo o plano de edição finalizado em um documento autocontido já pensado para a futura Rafa.
8. Devolve o plano de edição completo como saída estruturada e um artefato do tipo `plan`.

## Como Diego usa a direção da Vanessa

Diego consome exatamente o campo `diegoBriefing` que a própria Vanessa já monta pensando nesta etapa (`VanessaDiegoBriefing`), o mesmo padrão de "briefing autocontido para o próximo especialista" que João → Sofia → Bianca → Pedro e Bruno → Vanessa já usam entre si. Cada `DiegoTimelineEntry` reaproveita diretamente `transitionToNext` e `visualEffects` da `VanessaSceneDirection` correspondente — Diego nunca decide uma nova transição ou um novo efeito visual, apenas encaixa o que Vanessa já decidiu dentro de uma timeline com tempos concretos. `musicTrackPlan`, `editingInstructions` e parte de `requiredAssets` também citam textualmente `musicDirection`, `captionStyle` e `colorDirection` de Vanessa, garantindo que o plano técnico nunca contradiga a direção audiovisual. Por respeito ao isolamento entre Skills (ADR 0002), Diego não importa nenhum tipo de Vanessa — define seu próprio tipo espelhado `DiegoVanessaDirectionSummary`/`DiegoVanessaSceneDirection`.

Ao mesmo tempo, Diego consome o roteiro de Bruno diretamente (`DiegoBrunoScriptSummary`, espelhando `BrunoVanessaBriefing`) para obter o que Vanessa não carrega em seu próprio briefing: o texto falado (usado como `captionText`), o texto na tela (`onScreenText`) e a duração exata de cada cena (`startSeconds`/`durationSeconds`). Isso torna Diego a primeira Skill da pipeline de vídeo a fazer um "fan-in" de duas etapas anteriores simultaneamente, em vez de uma cadeia estritamente linear de um único briefing.

## Como Diego gera o plano de edição

- **Timeline**: `buildEditingTimeline` percorre as cenas do roteiro de Bruno (fonte de verdade para ordem e tempo) e busca a direção correspondente de Vanessa pelo campo `order`, combinando os dois em cada `DiegoTimelineEntry`.
- **Tipo de corte**: cenas `"Gancho"` recebem corte seco de entrada sem fade (impacto imediato); cenas `"CTA final"` recebem corte seco final sem fade de saída (encerramento abrupto que reforça urgência); as demais recebem corte dinâmico com fade curto de 2 a 3 quadros.
- **Plano de trilha**: parte da `musicDirection` de Vanessa e acrescenta timing concreto (fade-in de 1s no início, plano de fundo durante a narração, fade-out nos últimos 2 segundos).
- **Assets, instruções e checklist**: heurísticas que citam explicitamente os elementos definidos por Vanessa (`captionStyle`, `colorDirection`) e pela identidade visual real da Clara (cores da marca), com fallback claro quando a identidade visual ainda não está cadastrada.

## Como Diego prepara o briefing do Rafa

O campo `rafaBriefing` reúne toda a timeline, o plano de trilha, os assets, as instruções de edição e o checklist técnico finalizados em um único objeto autocontido, com `status: "preliminary"` e `notes` explicando explicitamente que renderização e publicação continuam responsabilidade de Rafa e de Ana, ainda não implementadas para vídeo nesta fase.

## Uso opcional do Ícaro

Assim como Bruno e Vanessa, o Ícaro é uma dependência opcional para Diego — o manifesto declara `IcaroBrainPort` com `optional: true`. O plano de edição de Diego é construído de forma inteiramente determinística a partir do roteiro de Bruno, da direção de Vanessa e do conhecimento devolvido pela Clara; o Ícaro apenas aprimora quatro campos (`musicTrackPlan`, `requiredAssets`, `editingInstructions`, `technicalChecklist`) quando disponível e bem-sucedido. Falha do Ícaro nunca falha a execução de Diego: fica registrada em log (`AISupportFailed`) e o campo `aiSupportUsed` permanece `false`.

## Integração com Valentina e Clara

Diego usa exclusivamente `ValentinaTenantPort.getClientContext`/`getTenant` (mesma lógica de resolução de cliente das demais Skills) e `ClaraKnowledgePort.requestContext`, com os mesmos cinco módulos que Sofia e Vanessa consultam (`BrandContext`, `AudienceContext`, `ContentContext`, `IdentityContext`, `PublishingContext`).

## Integração com Ícaro

Quando configurado, Diego usa exclusivamente `IcaroBrainPort.request` com `taskType: "analysis"` — nunca uma tarefa de geração ou renderização de vídeo. As `constraints` reforçam que o Ícaro não deve criar roteiro, dirigir, renderizar ou publicar vídeo, nem redefinir a timeline.

## Integração com Arthur, Caio e Helena

Arthur reconhece a capability `video_editing` em cascata: sempre que `video_direction` é necessária (que por sua vez já é encadeada a partir de `video_script`), Arthur automaticamente também requer `video_editing`, porque Diego depende inteiramente da saída de Vanessa e a pipeline de vídeo avança sequencialmente até onde ela existir hoje — mesma mecânica de cascata já usada entre Bruno e Vanessa, sem palavra-chave própria. A etapa "Edição de vídeo" depende exclusivamente da etapa "Direção de vídeo" (`dependsOn: [videoDirectionStepId]`) e recebe `joaoStrategy`, `brunoScript` (a partir de `vanessaBriefing`) e `vanessaDirection` (a partir de `diegoBriefing`) por `inputBinding`. Como Rafa ainda não existe, essa etapa **não** alimenta a Revisão (Lucas) nem a Aprovação — ela existe no plano de forma independente da pipeline de imagens, que continua funcionando exatamente como antes. Helena descobre o manifesto de Diego, valida, carrega a Skill e a executa somente quando solicitada por Arthur (via Caio).

## Limitações desta etapa

Diego é o terceiro componente de uma pipeline de vídeo: Bruno (roteiro), Vanessa (direção), Rafa (renderização — automática local via `VideoRenderingPort`/FFmpeg por padrão, com Developer Assisted Mode como fallback; ver `docs/rafa-video-rendering.md` e `docs/video-rendering.md`), Lucas (revisão) e Ana (publicação, sempre `local_ready`/`dry_run` em `LOCAL_PRODUCTION`) já existem como Skills reais para vídeo.
