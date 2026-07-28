# Bruno, Especialista em Estratégia e Roteirização de Vídeos Curtos

Bruno é a oitava Skill real do Zuno e o primeiro componente de uma pipeline de vídeo futura e independente da pipeline de imagens: João → Bruno → Vanessa → Diego → Rafa → Lucas → Ana. Ele é uma Skill operacional: transforma a estratégia de marketing produzida pelo João diretamente em um roteiro de vídeo curto profissional para Reels, TikTok, Shorts e vídeos verticais, pronto para orientar a futura Vanessa.

Bruno é exclusivamente Roteirista: estrutura narrativa, gancho inicial, tempo total do vídeo, divisão em cenas, texto falado, texto na tela, sugestões de B-roll, enquadramentos, movimentos de câmera, ritmo, pausas, transições sugeridas, efeitos sonoros sugeridos, sugestões de trilha, CTA final, observações para gravação e observações para edição. Bruno **não** gera vídeo, **não** edita vídeo, **não** renderiza vídeo, **não** publica vídeo e **não** cria imagens — essas responsabilidades pertencem às próximas Skills da pipeline de vídeo (Vanessa, Diego, Rafa), nenhuma delas implementada ainda. Bruno também não define layout, grid, paleta ou tipografia de peças visuais estáticas (isso continua sendo exclusivo de Sofia/Bianca, na pipeline de imagens) e não executa nem chama outra Skill diretamente — isso continua sendo papel exclusivo de Arthur, Helena e Caio.

Bruno conhece apenas três abstrações: `ValentinaTenantPort` para identificar o cliente, `ClaraKnowledgePort` para obter marca, público, conteúdo e publicação e, de forma opcional, `IcaroBrainPort` para pedir apoio de IA na hora de aprimorar o roteiro. Bruno funciona integralmente sem o Ícaro: toda a estrutura narrativa, cenas, tempo, texto falado/na tela, B-roll, enquadramento, movimento de câmera, ritmo, pausas, transições e efeitos sonoros são construídos de forma determinística, por heurística própria.

## Responsabilidade

Bruno recebe uma solicitação de roteiro — o pedido original do usuário, a estratégia completa produzida pelo João, além de canal, formato, objetivo do vídeo e, opcionalmente, a duração desejada em segundos — e devolve um roteiro completo: estrutura narrativa, gancho, duração total, cenas detalhadas, ritmo geral, sugestões de trilha, CTA final, observações de gravação, observações de edição, riscos, observações gerais, próximos passos e um briefing estruturado pronto para a futura Vanessa.

## Contrato de entrada

A entrada de Bruno é `BrunoScriptRequestInput`:

- `clientId` ou `tenantId` (pelo menos um dos dois é obrigatório);
- `originalRequest`: o pedido original do usuário, em texto livre;
- `joaoStrategy`: a estratégia completa produzida pelo João (`BrunoJoaoStrategySummary`), incluindo objetivo, público-alvo, ângulo, promessa central, mensagens principais e CTA recomendado;
- `channel`: canal desejado para este vídeo (`instagram`, `facebook`, `threads`, `linkedin`, `tiktok`, `pinterest`, `youtube`, `google_business`, `meta_ads` ou `google_ads`);
- `format`: formato desejado, em texto livre (por exemplo "reels", "tiktok", "shorts");
- `videoObjective`: o objetivo específico deste vídeo, em texto livre;
- `desiredDurationSeconds`: duração total desejada, opcional — quando ausente, Bruno assume 30 segundos, padrão de vídeo curto vertical;
- `workflowContext`: contexto opcional adicional vindo do workflow.

## Contrato de saída

Bruno nunca devolve texto solto. Ele devolve `BrunoVideoScriptOutput`, contendo:

- `narrativeStructure`: a estrutura narrativa do vídeo (ex.: Problema → Solução → Prova → CTA), inferida a partir do ângulo estratégico do João;
- `hook`: o gancho inicial, descrevendo como capturar atenção nos primeiros segundos;
- `totalDurationSeconds`: a duração total do vídeo;
- `scenes`: lista de `BrunoVideoScene`, cada uma com `order`, `name`, `startSeconds`, `durationSeconds`, `spokenText`, `onScreenText` (opcional), `brollSuggestions`, `framing`, `cameraMovement`, `rhythm`, `pauseNotes` (opcional), `transitionToNext` (opcional) e `soundEffectSuggestions`;
- `overallRhythm`: descrição do ritmo geral do vídeo;
- `musicSuggestions`: sugestões de trilha sonora;
- `finalCta`: a chamada para ação final, herdada diretamente do `recommendedCta` da estratégia do João;
- `recordingNotes`: observações para a etapa de gravação;
- `editingNotes`: observações para a etapa de edição;
- `risks`: riscos identificados;
- `observations`: observações sobre lacunas de conhecimento ou pontos de atenção;
- `nextSteps`: próximos passos recomendados;
- `vanessaBriefing`: briefing estruturado pronto para a futura Vanessa (`BrunoVanessaBriefing`);
- `aiSupportUsed`: indica se o Ícaro conseguiu aprimorar o roteiro nesta execução.

Quando a solicitação é inválida ou a Valentina não encontra o cliente, Bruno devolve `status: "failed"`. Quando a Clara devolve contexto insuficiente (sem `BrandContext` e sem `AudienceContext`), Bruno devolve `status: "needs_more_context"` em vez de arriscar um roteiro sem fundamento.

## Fluxo interno

1. Valida a solicitação recebida (cliente, pedido original, canal, formato, objetivo do vídeo, presença mínima de `joaoStrategy` e, quando informada, que `desiredDurationSeconds` seja um número positivo).
2. Consulta a Valentina para resolver o cliente, usando `getClientContext` quando recebe `tenantId` ou `getTenant` seguido de `getClientContext` quando recebe apenas `clientId`.
3. Consulta a Clara por `requestContext`, pedindo os módulos `BrandContext`, `AudienceContext`, `ContentContext` e `PublishingContext`.
4. Avalia se o contexto devolvido é suficiente. Se não houver nem `BrandContext` nem `AudienceContext`, Bruno interrompe com `needs_more_context`.
5. Monta um roteiro base de forma determinística, cruzando a estratégia do João com o conhecimento devolvido pela Clara: estrutura narrativa e gancho derivados do ângulo estratégico; cenas construídas proporcionalmente à duração total (uma cena de gancho, uma cena de desenvolvimento por mensagem-chave — até três — e uma cena de CTA final), cada uma com texto falado, texto na tela, B-roll, enquadramento, movimento de câmera, ritmo, pausas, transição e efeitos sonoros próprios; ritmo geral e sugestões de trilha derivados do tom de voz da marca; observações de gravação e edição com boas práticas de vídeo vertical curto (enquadramento 9:16, áudio limpo, legendas embutidas, zonas seguras de UI).
6. Se o Ícaro estiver configurado, monta um prompt e pede uma tarefa `analysis` para aprimorar apenas estrutura narrativa, gancho, ritmo geral, sugestões de trilha e CTA final — nunca as cenas, o tempo por cena, o texto falado/na tela, B-roll, enquadramento, movimento de câmera, pausas, transições ou efeitos sonoros, que permanecem decisão determinística de Bruno. Se o Ícaro não estiver configurado ou falhar, Bruno segue com o roteiro heurístico e registra o ocorrido nos logs, sem falhar a execução.
7. Monta o `vanessaBriefing`, reunindo todo o roteiro finalizado em um documento autocontido já pensado para a futura Vanessa.
8. Devolve o roteiro completo como saída estruturada e um artefato do tipo `plan`.

## Uso opcional do Ícaro

Assim como João e Sofia, o Ícaro é uma dependência opcional para Bruno — o manifesto declara `IcaroBrainPort` com `optional: true`. O roteiro de Bruno é construído de forma inteiramente determinística a partir da estratégia do João e do conhecimento devolvido pela Clara; o Ícaro apenas aprimora alguns campos textuais quando disponível e bem-sucedido. Falha do Ícaro nunca falha a execução de Bruno: fica registrada em log (`AISupportFailed`) e o campo `aiSupportUsed` permanece `false`.

## Integração com Valentina

Bruno usa exclusivamente `ValentinaTenantPort.getClientContext` e `ValentinaTenantPort.getTenant`, com a mesma lógica de resolução de cliente usada por João e Sofia. Se a Valentina não encontrar o cliente, Bruno devolve erro estruturado `CLIENT_NOT_FOUND` e não chega a consultar a Clara.

## Integração com Clara

Bruno usa exclusivamente `ClaraKnowledgePort.requestContext`, informando o `clientId` resolvido pela Valentina, os quatro módulos relevantes para roteirização e um `requester` do tipo `specialist` identificado pelo id do manifesto de Bruno. Bruno nunca cria, atualiza ou remove conhecimento na Clara — ele apenas consome contexto já existente.

## Integração com Ícaro

Quando configurado, Bruno usa exclusivamente `IcaroBrainPort.request` com `taskType: "analysis"` — nunca uma tarefa de geração de vídeo ou imagem. O prompt pede explicitamente uma resposta em JSON e reforça nas `constraints` que o Ícaro não deve gerar, editar, renderizar ou publicar vídeo, nem redefinir cenas — apenas aprimorar estrutura narrativa, gancho, ritmo geral, trilha e CTA final. Bruno nunca importa um Provider de IA concreto nem qualquer SDK externo.

## Integração com Arthur, Caio e Helena

Arthur reconhece a capability `video_script`: quando o comando em texto menciona "roteiro" (ou variações como "roteirizar"), Arthur inclui no plano uma etapa "Roteiro de vídeo" com `skillCapability: "video_script"`, dependente apenas da etapa de estratégia e recebendo `joaoStrategy` por `inputBinding`, do mesmo jeito que a etapa de Direção de Arte recebe a estratégia do João. A mesma detecção também aciona em cascata a capability `video_direction` (Vanessa), que depende diretamente da etapa de Bruno — ver `docs/vanessa-video-direction.md`. Como a pipeline de vídeo ainda não tem as próximas Skills depois de Vanessa (Diego, Rafa), essas etapas **não** alimentam a Revisão (Lucas) nem a Aprovação — elas existem no plano de forma independente da pipeline de imagens, que continua funcionando exatamente como antes. O manifesto de Bruno declara `capabilities: ["video_script"]`, então ele ocupa exatamente essa etapa sem exigir nenhuma mudança adicional em Arthur. Helena descobre o manifesto de Bruno, valida, carrega a Skill e a executa somente quando solicitada por Arthur (via Caio). Bruno recebe apenas a entrada da etapa e devolve uma saída estruturada, sem conhecer detalhes do workflow completo.

## Como o output de Bruno prepara o trabalho da Vanessa

O campo `vanessaBriefing` de Bruno reúne todo o roteiro finalizado — estrutura narrativa, gancho, duração total, cenas, ritmo geral, trilha, CTA final e observações de gravação/edição — em um único objeto autocontido, com `status: "preliminary"` e `notes` explicando explicitamente que produção, filmagem, edição, renderização e publicação são responsabilidade das próximas Skills da pipeline de vídeo, ainda não implementadas. Por respeito ao isolamento entre Skills (ADR 0002: nenhuma Skill deve importar outra Skill diretamente), Bruno não importa nenhum tipo do João — ele define seu próprio tipo `BrunoJoaoStrategySummary`, espelhando por convenção o formato real que João produz (`JoaoMarketingStrategyCore`). Esse é o mesmo padrão de "briefing autocontido para o próximo especialista" que João, Sofia e Bianca já usam entre si — a diferença é que a cadeia de Bruno é uma pipeline nova e paralela, iniciada diretamente a partir de João, sem depender de Maria, Sofia, Bianca ou Pedro. Vanessa, por sua vez, consome exatamente esse campo através do seu próprio tipo espelhado `VanessaBrunoScriptSummary`, sem importar nada de Bruno.

## Limitações desta etapa

Bruno é apenas o primeiro componente de uma pipeline de vídeo ainda incompleta. Vanessa (Direção de Vídeo, `docs/vanessa-video-direction.md`), Diego (Edição de Vídeo, `docs/diego-video-editing.md`) e Rafa (Renderização, em Developer Assisted Mode, `docs/rafa-video-rendering.md`) já existem como Skills reais. Nenhuma publicação de vídeo foi implementada. Um workflow que tente publicar o vídeo renderizado de fato falhará, porque não há Skill real para essa capability — este é o comportamento correto e esperado nesta fase, seguindo o mesmo padrão já usado para outras capabilities reservadas do Zuno (`campaign_management`, `metrics_analysis`, `optimization`, `video_creation`).
