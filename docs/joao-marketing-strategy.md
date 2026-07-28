# João, Especialista em Estratégia de Marketing

João é a segunda Especialista real do Zuno e a primeira a ocupar a capability `strategy` que Arthur já reservava desde o primeiro plano de execução. Ele é uma Skill operacional: transforma uma solicitação de marketing em uma estratégia estruturada que orienta as próximas Skills, principalmente o briefing enviado para Maria.

João não cria imagens, não cria vídeos, não publica, não cria campanhas na Meta, não consulta métricas, não acessa arquivos, não acessa storage e não conversa diretamente com OpenAI, Gemini, Claude ou qualquer provider de IA. João também não cria a copy final e não executa nem chama outra Skill diretamente — isso continua sendo papel exclusivo de Arthur, Helena e Caio.

João conhece apenas três abstrações: `ValentinaTenantPort` para identificar o cliente, `ClaraKnowledgePort` para obter conhecimento do cliente e, de forma opcional, `IcaroBrainPort` para pedir apoio de IA na hora de aprimorar a estratégia.

## Responsabilidade

João recebe uma solicitação de marketing (pedido original do usuário, canal desejado, formato desejado e objetivo desejado, associados a um cliente) e devolve uma estratégia completa: objetivo, público-alvo, canal, formato, tom de voz, ângulo de comunicação, promessa central, proposta de valor, mensagens principais, CTA recomendado, riscos de comunicação, observações, próximos passos, um briefing estruturado pronto para a Maria e um briefing preliminar para a Sofia.

## Contrato de entrada

A entrada de João é `JoaoStrategyRequestInput`:

- `clientId` ou `tenantId` (pelo menos um dos dois é obrigatório);
- `originalRequest`: o pedido original do usuário, em texto livre;
- `desiredChannel`: canal desejado (`instagram`, `facebook`, `threads`, `linkedin`, `tiktok`, `pinterest`, `youtube`, `google_business`, `meta_ads` ou `google_ads`);
- `desiredFormat`: formato desejado, em texto livre (por exemplo "carrossel", "reels", "post único");
- `desiredObjective`: objetivo desejado, em texto livre;
- `editorialBrief`: opcional. Quando presente, é o Editorial Brief estruturado que o Eduardo (Especialista em Planejamento Editorial, sempre a primeira etapa do plano) decidiu antes de João iniciar o trabalho — ver `docs/eduardo-editorial-planning.md`. Quando presente, sobrescreve `format` e `recommendedCta` da estratégia de João, e alimenta `observations` e `sofiaBriefing.notes` com a justificativa, a estrutura narrativa e a emoção principal recomendadas. Ausente (ex.: João chamado isoladamente em teste), João mantém seu comportamento heurístico de sempre;
- `workflowContext`: contexto opcional adicional vindo do workflow.

## Contrato de saída

João nunca devolve texto solto. Ele devolve `JoaoMarketingStrategyOutput`, contendo:

- `overallStrategy`: resumo em uma frase da estratégia geral;
- `objective`, `targetAudience`, `channel`, `format`, `toneOfVoice`, `angle`, `centralPromise`, `valueProposition`;
- `keyMessages`: lista de mensagens principais;
- `recommendedCta`: CTA recomendado;
- `risks`: riscos de comunicação identificados;
- `observations`: observações sobre lacunas de conhecimento ou pontos de atenção;
- `nextSteps`: próximos passos recomendados;
- `mariaBriefing`: briefing estruturado pronto para a Maria (`JoaoMariaBriefing`), incluindo `forbiddenTerms`, `mandatoryWords` e `preferredHashtags` quando `BrandContext` da Clara os declarar;
- `sofiaBriefing`: briefing preliminar para a Sofia (`JoaoSofiaBriefing`);
- `aiSupportUsed`: indica se o Ícaro conseguiu aprimorar a estratégia nesta execução.

Quando a solicitação é inválida ou a Valentina não encontra o cliente, João devolve `status: "failed"`. Quando a Clara devolve contexto insuficiente (sem `BrandContext` e sem `AudienceContext`), João devolve `status: "needs_more_context"` em vez de arriscar uma estratégia sem fundamento.

## Fluxo interno

1. Valida a solicitação recebida (cliente, pedido original, canal, formato e objetivo).
2. Consulta a Valentina para resolver o cliente, usando `getClientContext` quando recebe `tenantId` ou `getTenant` seguido de `getClientContext` quando recebe apenas `clientId`.
3. Consulta a Clara por `requestContext`, pedindo explicitamente os módulos `BrandContext`, `AudienceContext`, `ProductContext`, `CampaignContext`, `ContentContext`, `IdentityContext` e `PublishingContext` — exatamente o conjunto de marca, público, produtos, serviços, campanhas, conteúdo, identidade e publicação citado no escopo de João.
4. Avalia se o contexto devolvido é suficiente. Se não houver nem `BrandContext` nem `AudienceContext`, João interrompe com `needs_more_context`.
5. Monta uma estratégia base de forma determinística, cruzando a solicitação com o conhecimento devolvido pela Clara (heurística própria, sem depender de IA).
6. Se o Ícaro estiver configurado, monta um prompt e pede uma tarefa `analysis` para aprimorar apenas ângulo, promessa central, proposta de valor, mensagens principais e riscos. Se o Ícaro não estiver configurado ou falhar, João segue com a estratégia heurística e registra o ocorrido nos logs, sem falhar a execução.
7. Monta o `mariaBriefing`, convertendo o canal desejado para o vocabulário de canais orgânicos que a Maria aceita (por exemplo `meta_ads` é convertido para `instagram`).
8. Monta o `sofiaBriefing`, um briefing preliminar que já aproveita `IdentityContext` (cores, estilo visual, diretrizes visuais) da Clara. Esse briefing, somado à própria saída completa de João, é o que a Sofia (Especialista em Direção de Arte) recebe como `joaoSofiaBriefing` e `joaoStrategy` em sua entrada.
9. Devolve a estratégia completa como saída estruturada e um artefato do tipo `plan`.

## Uso opcional do Ícaro

Diferente da Maria, para quem o Ícaro é uma dependência obrigatória (a copy final só existe se a IA responder), o Ícaro é uma dependência opcional para João. A estratégia de João é construída de forma determinística a partir do conhecimento devolvido pela Clara e da própria solicitação; o Ícaro apenas aprimora alguns campos quando disponível e bem-sucedido. Isso está refletido no manifesto (`IcaroBrainPort` com `optional: true`) e no comportamento: falha do Ícaro nunca falha a execução de João, apenas fica registrada em log (`AISupportFailed`) e o campo `aiSupportUsed` permanece `false`.

## Integração com Valentina

João usa exclusivamente `ValentinaTenantPort.getClientContext` e `ValentinaTenantPort.getTenant` para identificar o cliente. Se `tenantId` for informado, João consulta diretamente o contexto do cliente. Se apenas `clientId` for informado, João primeiro localiza o tenant pela Valentina e depois pede o contexto do cliente pelo id do tenant encontrado. Se a Valentina não encontrar o cliente, João devolve erro estruturado `CLIENT_NOT_FOUND` e não chega a consultar a Clara.

## Integração com Clara

João usa exclusivamente `ClaraKnowledgePort.requestContext`, informando o `clientId` resolvido pela Valentina, os módulos relevantes para estratégia e um `requester` do tipo `specialist` identificado pelo id do manifesto de João. João nunca cria, atualiza ou remove conhecimento na Clara — ele apenas consome contexto já existente.

## Integração com Ícaro

Quando configurado, João usa exclusivamente `IcaroBrainPort.request` com `taskType: "analysis"`, pedindo explicitamente uma resposta em JSON e reforçando nas `constraints` que o Ícaro não deve criar copy final, imagem, vídeo, campanha ou publicação — apenas aprimorar os campos estratégicos que João já calculou heuristicamente. João nunca importa um Provider de IA concreto nem qualquer SDK externo.

## Integração com Arthur, Caio e Helena

Arthur já reservava, desde o primeiro `ExecutionPlan`, uma etapa de "Estratégia de marketing" com `skillCapability: "strategy"`, posicionada antes da etapa de copywriting. João assume exatamente essa etapa: seu manifesto declara `capabilities: ["marketing_strategy", "strategy"]`, então tanto uma futura seleção por `marketing_strategy` (capability explicitamente pedida para João) quanto a capability `strategy` já usada por Arthur e Caio localizam João pela Helena. Helena descobre o manifesto de João, valida, carrega a Skill e a executa somente quando solicitada por Arthur (via Caio). João recebe apenas a entrada da etapa e devolve uma saída estruturada, sem conhecer detalhes do workflow completo.

## Como o output de João prepara o trabalho da Maria e da Sofia

O campo `mariaBriefing` de João foi desenhado para ser estruturalmente equivalente ao contrato de entrada da Maria (`MariaCopyBriefing`): mesmo objetivo, mesmo público-alvo, mesmo tom de voz, mesmo CTA, mesma mensagem-chave e o mesmo vocabulário de canais orgânicos. Por respeito ao isolamento entre Skills (nenhuma Skill deve importar outra Skill diretamente), João não importa o tipo `MariaCopyBriefing` da Maria — ele mantém seu próprio tipo `JoaoMariaBriefing`, definido de forma independente, mas com o mesmo formato por convenção.

O mesmo raciocínio vale para o campo `sofiaBriefing`: ele foi desenhado para alimentar a entrada real da Sofia (Especialista em Direção de Arte), que recebe tanto a saída completa de João (como `joaoStrategy`) quanto o próprio `sofiaBriefing` (como `joaoSofiaBriefing`). Sofia também não importa nenhum tipo de João — ela define seus próprios tipos `SofiaJoaoStrategySummary` e `SofiaJoaoBriefing`, espelhando por convenção o formato real que João produz.

Esse desenho estrutural é o que permite que Caio encadeie automaticamente a saída de João como entrada da Maria e da Sofia: o `ExecutionPlan` produzido por Arthur declara `inputBindings` para cada etapa (a etapa de copywriting recebe um binding com `fromStepId` apontando para a etapa de estratégia e `sourcePath: "mariaBriefing"`), e `resolveStepInput` em Caio resolve esses bindings contra a saída real de João assim que a etapa termina — sem que João, Maria ou Sofia precisem conhecer umas às outras. Nenhuma transformação manual é necessária.
