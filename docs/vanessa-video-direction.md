# Vanessa, Especialista em Direção de Vídeo

Vanessa é a nona Skill real do Zuno e a segunda etapa de uma pipeline de vídeo própria: João → Bruno → Vanessa → Diego → Rafa → Lucas → Ana. Ela é uma Skill operacional: transforma o roteiro de vídeo produzido pelo Bruno em uma direção audiovisual completa, pronta para orientar o Diego.

Vanessa é exclusivamente Diretora de Vídeo: mapa de cenas, enquadramentos, composição visual por cena, movimentos de câmera, ritmo visual, transições, estilo de legenda na tela, efeitos visuais sugeridos, efeitos sonoros sugeridos, trilha recomendada, orientação de B-roll, direção de luz, direção de cor, orientação para gravação e orientação para edição. Vanessa **não** cria roteiro (isso é exclusivo do Bruno — ela nunca redefine cenas, tempo por cena, texto falado ou texto na tela), **não** edita vídeo, **não** renderiza vídeo, **não** publica vídeo e **não** cria imagens finais — essas responsabilidades pertencem às próximas Skills da pipeline de vídeo (Diego e Rafa). Vanessa também não define layout, grid, paleta ou tipografia de peças visuais estáticas (isso continua sendo exclusivo de Sofia/Bianca, na pipeline de imagens) e não executa nem chama outra Skill diretamente.

Além da direção cinematográfica, cada `VanessaSceneDirection` agora inclui um `visualAssetRequirement` opcional com o que deve aparecer, emoção, tipo de imagem, enquadramento, movimento, iluminação, função narrativa e tags. Esse campo não aponta para arquivo e não busca nada; ele só estrutura a intenção visual para que Diego preserve o pedido e Rafa/Asset Resolver escolham ou solicitem assets reais no momento da renderização.

Vanessa conhece apenas três abstrações: `ValentinaTenantPort` para identificar o cliente, `ClaraKnowledgePort` para obter identidade visual, marca, público, conteúdo e publicação e, de forma opcional, `IcaroBrainPort` para pedir apoio de IA na hora de aprimorar a direção audiovisual. Vanessa funciona integralmente sem o Ícaro: todo o mapa de cenas, enquadramento, composição visual, movimento de câmera, transições e efeitos visuais são construídos de forma determinística, por heurística própria, a partir do roteiro real de Bruno.

## Responsabilidade

Vanessa recebe uma solicitação de direção audiovisual — o pedido original do usuário, a estratégia completa produzida pelo João, o roteiro estruturado que o próprio Bruno já prepara pensando em Vanessa, além de canal, formato e objetivo do vídeo — e devolve uma direção audiovisual completa: mapa de cenas, ritmo visual, estilo de legenda, orientação de sonorização, trilha recomendada, orientação de B-roll, direção de luz, direção de cor, orientação de gravação, orientação de edição, riscos, observações, próximos passos e um briefing estruturado pronto para o futuro Diego.

## Contrato de entrada

A entrada de Vanessa é `VanessaDirectionRequestInput`:

- `clientId` ou `tenantId` (pelo menos um dos dois é obrigatório);
- `originalRequest`: o pedido original do usuário, em texto livre;
- `joaoStrategy`: a estratégia completa produzida pelo João (`VanessaJoaoStrategySummary`);
- `brunoScript`: o roteiro estruturado que o próprio Bruno já monta pensando em Vanessa (`VanessaBrunoScriptSummary`), com estrutura narrativa, gancho, duração total, cenas detalhadas, ritmo geral, sugestões de trilha, CTA final e notas de gravação/edição;
- `channel`: canal desejado para este vídeo (`instagram`, `facebook`, `threads`, `linkedin`, `tiktok`, `pinterest`, `youtube`, `google_business`, `meta_ads` ou `google_ads`);
- `format`: formato desejado, em texto livre (por exemplo "reels", "tiktok", "shorts");
- `videoObjective`: o objetivo específico deste vídeo, em texto livre;
- `workflowContext`: contexto opcional adicional vindo do workflow.

## Contrato de saída

Vanessa nunca devolve texto solto. Ela devolve `VanessaVideoDirectionOutput`, contendo:

- `sceneDirections`: mapa de cenas — lista de `VanessaSceneDirection`, uma por cena do roteiro de Bruno (mesma `order`/`name`), cada uma com `framing`, `visualComposition`, `cameraMovement`, `transitionToNext` (opcional) e `visualEffects`;
- `visualRhythm`: descrição do ritmo visual geral, coerente com o ritmo narrativo definido por Bruno;
- `captionStyle`: estilo de legenda na tela (tipografia, animação, posicionamento), único para todo o vídeo;
- `soundDesignGuidance`: orientação de sonorização em nível de produção (sincronização, volume relativo);
- `musicDirection`: recomendação concreta de trilha, refinando as sugestões gerais de Bruno;
- `brollGuidance`: orientação técnica de captura de B-roll;
- `lightDirection`: direção de luz;
- `colorDirection`: direção de cor;
- `recordingGuidance`: orientação para a etapa de gravação;
- `editingGuidance`: orientação para a etapa de edição;
- `risks`: riscos identificados;
- `observations`: observações sobre lacunas de conhecimento ou pontos de atenção;
- `nextSteps`: próximos passos recomendados;
- `diegoBriefing`: briefing estruturado pronto para o futuro Diego (`VanessaDiegoBriefing`);
- `aiSupportUsed`: indica se o Ícaro conseguiu aprimorar a direção nesta execução.

Quando a solicitação é inválida ou a Valentina não encontra o cliente, Vanessa devolve `status: "failed"`. Quando a Clara devolve contexto insuficiente (sem `IdentityContext` e sem `BrandContext`), Vanessa devolve `status: "needs_more_context"` em vez de arriscar uma direção audiovisual sem fundamento visual.

## Fluxo interno

1. Valida a solicitação recebida (cliente, pedido original, canal, formato, objetivo do vídeo, presença mínima de `joaoStrategy` e de `brunoScript` — este último precisa conter ao menos uma cena).
2. Consulta a Valentina para resolver o cliente, usando `getClientContext` quando recebe `tenantId` ou `getTenant` seguido de `getClientContext` quando recebe apenas `clientId`.
3. Consulta a Clara por `requestContext`, pedindo os módulos `BrandContext`, `AudienceContext`, `ContentContext`, `IdentityContext` e `PublishingContext`.
4. Avalia se o contexto devolvido é suficiente. Se não houver nem `IdentityContext` nem `BrandContext`, Vanessa interrompe com `needs_more_context`.
5. Monta uma direção audiovisual base de forma determinística, cruzando o roteiro de Bruno com o conhecimento devolvido pela Clara: uma `VanessaSceneDirection` por cena do roteiro (o enquadramento/composição/movimento de câmera/transição/efeitos variam conforme a cena é o Gancho, um Desenvolvimento ou o CTA final); ritmo visual derivado do ritmo narrativo de Bruno; estilo de legenda derivado do tom de voz da marca; trilha, luz e cor derivadas da identidade visual real quando existente; orientação de gravação, edição, sonorização e B-roll com boas práticas de vídeo vertical curto.
6. Se o Ícaro estiver configurado, monta um prompt e pede uma tarefa `analysis` para aprimorar apenas ritmo visual, estilo de legenda, trilha recomendada, direção de luz e direção de cor — nunca o mapa de cenas, enquadramentos, composição visual por cena, movimentos de câmera, transições ou efeitos visuais por cena, que permanecem decisão determinística de Vanessa. Se o Ícaro não estiver configurado ou falhar, Vanessa segue com a direção heurística e registra o ocorrido nos logs, sem falhar a execução.
7. Monta o `diegoBriefing`, reunindo toda a direção audiovisual finalizada em um documento autocontido já pensado para o futuro Diego.
8. Devolve a direção audiovisual completa como saída estruturada e um artefato do tipo `plan`.

## Como Vanessa usa o roteiro de Bruno

Vanessa nunca recebe o roteiro "cru" de Bruno — ela consome exatamente o campo `vanessaBriefing` que o próprio Bruno já monta pensando nesta etapa (`BrunoVanessaBriefing`), o mesmo padrão de "briefing autocontido para o próximo especialista" que João → Sofia → Bianca já usam entre si. Por respeito ao isolamento entre Skills (ADR 0002), Vanessa não importa nenhum tipo de Bruno — ela define seus próprios tipos espelhados `VanessaBrunoScriptSummary` e `VanessaBrunoScene`, no formato exato que Bruno produz. Cada `VanessaSceneDirection` do mapa de cenas de Vanessa é gerada a partir da cena correspondente do roteiro (mesma `order`/`name`): Vanessa decide **como filmar e compor** cada cena, nunca **o que** acontece nela — o texto falado, o texto na tela e a duração continuam sendo decisão exclusiva de Bruno.

## Como Vanessa gera a direção audiovisual

Toda a direção é construída por heurística pura, sem depender de IA:

- Cenas de nome `"Gancho"` recebem enquadramento fechado (close-up, centralizado), corte seco na transição e um leve punch-in como efeito visual, para maximizar impacto imediato.
- Cenas de `"Desenvolvimento N"` recebem plano médio, composição pela regra dos terços, corte dinâmico e inserção de B-roll como efeito visual.
- A cena `"CTA final"` retoma o enquadramento fechado do gancho (fechando o ciclo visual), fica estática (sem movimento de câmera) e ganha um destaque visual sobre o texto do CTA.
- Ritmo visual, estilo de legenda, trilha, luz e cor são derivados do tom de voz da marca (`BrandContext`) e da identidade visual real (`IdentityContext`) quando cadastrados na Clara — com heurísticas de fallback claramente identificadas como provisórias quando esses dados não existem.

## Como Vanessa prepara o briefing do Diego

O campo `diegoBriefing` reúne toda a direção audiovisual finalizada — mapa de cenas, ritmo visual, legenda, sonorização, trilha, B-roll, luz, cor e orientação de gravação/edição — em um único objeto autocontido, com `status: "preliminary"` e `notes` explicando explicitamente que gravação, edição, renderização e publicação são responsabilidade das próximas Skills da pipeline de vídeo, ainda não implementadas.

## Uso opcional do Ícaro

Assim como Bruno, o Ícaro é uma dependência opcional para Vanessa — o manifesto declara `IcaroBrainPort` com `optional: true`. A direção de Vanessa é construída de forma inteiramente determinística a partir do roteiro de Bruno e do conhecimento devolvido pela Clara; o Ícaro apenas aprimora cinco campos textuais quando disponível e bem-sucedido. Falha do Ícaro nunca falha a execução de Vanessa: fica registrada em log (`AISupportFailed`) e o campo `aiSupportUsed` permanece `false`.

## Integração com Valentina e Clara

Vanessa usa exclusivamente `ValentinaTenantPort.getClientContext`/`getTenant` (mesma lógica de resolução de cliente das demais Skills) e `ClaraKnowledgePort.requestContext`, com os mesmos cinco módulos que Sofia consulta (`BrandContext`, `AudienceContext`, `ContentContext`, `IdentityContext`, `PublishingContext`) — Vanessa é, como Sofia, uma consumidora intensiva de identidade visual.

## Integração com Ícaro

Quando configurado, Vanessa usa exclusivamente `IcaroBrainPort.request` com `taskType: "analysis"` — nunca uma tarefa de geração de vídeo ou imagem. As `constraints` reforçam que o Ícaro não deve criar roteiro, gerar/editar/renderizar/publicar vídeo, nem redefinir o mapa de cenas.

## Integração com Arthur, Caio e Helena

Arthur reconhece a capability `video_direction` em cascata: sempre que `video_script` é necessária (comando menciona "roteiro"), Arthur automaticamente também requer `video_direction`, porque Vanessa depende inteiramente da saída de Bruno e a pipeline de vídeo avança sequencialmente até onde ela existir hoje — não há palavra-chave própria para acionar Vanessa isoladamente. A mesma detecção também aciona `video_editing` (Diego) em cascata a partir de `video_direction` — ver `docs/diego-video-editing.md`. A etapa "Direção de vídeo" depende exclusivamente da etapa "Roteiro de vídeo" (`dependsOn: [videoScriptStepId]`) e recebe `joaoStrategy` e `brunoScript` (a partir de `vanessaBriefing`) por `inputBinding`. Como Rafa ainda não existe, essas etapas **não** alimentam a Revisão (Lucas) nem a Aprovação — elas existem no plano de forma independente da pipeline de imagens, que continua funcionando exatamente como antes. O manifesto de Vanessa declara `capabilities: ["video_direction"]`, então ela ocupa exatamente essa etapa sem exigir nenhuma mudança adicional em Arthur além da cascata já descrita. Helena descobre o manifesto de Vanessa, valida, carrega a Skill e a executa somente quando solicitada por Arthur (via Caio). Vanessa recebe apenas a entrada da etapa e devolve uma saída estruturada, sem conhecer detalhes do workflow completo.

## Limitações desta etapa

Vanessa é o segundo componente de uma pipeline de vídeo ainda incompleta. Diego (Edição de Vídeo) e Rafa (Renderização, em Developer Assisted Mode) já existem como Skills reais (ver `docs/diego-video-editing.md` e `docs/rafa-video-rendering.md`). Nenhuma publicação de vídeo foi implementada. Um workflow que tente publicar o vídeo renderizado de fato falhará, porque não há Skill real para essa capability — este é o comportamento correto e esperado nesta fase, seguindo o mesmo padrão já usado para outras capabilities reservadas do Zuno (`campaign_management`, `metrics_analysis`, `optimization`, `video_creation`).
