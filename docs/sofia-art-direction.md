# Sofia, Especialista em Direção de Arte

Sofia é a terceira Skill real do Zuno e a primeira a ocupar a capability `art_direction`, que Arthur já reservava desde o primeiro plano de execução como a etapa "Direção de arte", condicionada à necessidade de conteúdo visual. Ela é uma Skill operacional: transforma a estratégia de marketing produzida pelo João em uma direção visual estruturada que orienta a Bianca, responsável por transformar essa direção em um layout detalhado.

Sofia é exclusivamente Diretora de Arte: conceito criativo, identidade visual, paleta de cores, tipografia, moodboard, estilo visual, linguagem estética, referências de design e a emoção que o material deve transmitir. Sofia não define layout, grid, hierarquia visual detalhada, espaçamentos, cards, ícones, botões ou posicionamento de elementos — essa responsabilidade passou integralmente para a Bianca. Sofia também não gera imagens finais, não publica, não cria campanhas, não consulta métricas, não chama Meta, Instagram ou Facebook, não acessa storage diretamente e não conversa diretamente com OpenAI, Gemini, Claude ou qualquer provider de IA. Sofia também não executa nem chama outra Skill diretamente — isso continua sendo papel exclusivo de Arthur, Helena e Caio.

Sofia conhece apenas três abstrações: `ValentinaTenantPort` para identificar o cliente, `ClaraKnowledgePort` para obter identidade visual e contexto da marca e, de forma opcional, `IcaroBrainPort` para pedir apoio de IA na hora de aprimorar a direção visual.

## Responsabilidade

Sofia recebe uma solicitação de direção de arte — o pedido original do usuário, a estratégia completa produzida pelo João, o briefing preliminar que o próprio João já preparou pensando em Sofia, além de canal, formato e objetivo visual definidos para esta etapa — e devolve uma direção visual completa: conceito visual, estilo recomendado, emoção a transmitir, paleta sugerida, tipografia, moodboard, referências de design, formato recomendado, proporção recomendada, restrições visuais, riscos visuais, observações, próximos passos e um briefing estruturado pronto para a Bianca.

## Contrato de entrada

A entrada de Sofia é `SofiaArtDirectionRequestInput`:

- `clientId` ou `tenantId` (pelo menos um dos dois é obrigatório);
- `originalRequest`: o pedido original do usuário, em texto livre;
- `joaoStrategy`: a estratégia completa produzida pelo João (`SofiaJoaoStrategySummary`), incluindo objetivo, público-alvo, ângulo, promessa central, proposta de valor, mensagens principais, CTA recomendado, entre outros;
- `joaoSofiaBriefing`: o briefing preliminar que o próprio João já monta pensando em Sofia (`SofiaJoaoBriefing`), com ângulo, promessa central, mensagens principais e notas de identidade visual;
- `channel`: canal desejado para esta peça visual (`instagram`, `facebook`, `threads`, `linkedin`, `tiktok`, `pinterest`, `youtube`, `google_business`, `meta_ads` ou `google_ads`);
- `format`: formato desejado, em texto livre (por exemplo "carrossel", "reels", "post único");
- `visualObjective`: o objetivo visual específico desta peça, em texto livre;
- `workflowContext`: contexto opcional adicional vindo do workflow.

`channel` e `format` existem como campos próprios da etapa de Sofia porque a etapa de direção visual pode, em tese, receber uma orientação de canal/formato específica para a peça visual, distinta (ou apenas confirmando) o canal/formato geral que João já recomendou na estratégia.

## Contrato de saída

Sofia nunca devolve texto solto. Ela devolve `SofiaArtDirectionOutput`, contendo:

- `visualConcept`, `recommendedStyle`, `emotionalTone`;
- `suggestedPalette`: lista de cores sugeridas;
- `typography`: lista descrevendo as fontes da marca e seus papéis (título, apoio), ou um aviso genérico quando nenhuma fonte real está registrada;
- `moodboard`: lista de referências de humor/tom visual;
- `designReferences`: lista de referências de design (campanhas, estilo editorial) relevantes ao canal e formato;
- `recommendedFormat`, `recommendedAspectRatio`;
- `visualConstraints`: restrições visuais a respeitar (diretrizes de marca, fontes, fluxo de aprovação);
- `visualRisks`: riscos visuais identificados;
- `observations`: observações sobre lacunas de conhecimento ou pontos de atenção;
- `nextSteps`: próximos passos recomendados;
- `biancaBriefing`: briefing estruturado pronto para a Bianca (`SofiaBiancaBriefing`);
- `aiSupportUsed`: indica se o Ícaro conseguiu aprimorar a direção nesta execução.

Sofia não devolve mais `composition`, `visualHierarchy`, `onImageText` nem `carouselGuidance` — esses campos eram, na prática, decisões de layout que hoje pertencem exclusivamente à Bianca.

Quando a solicitação é inválida ou a Valentina não encontra o cliente, Sofia devolve `status: "failed"`. Quando a Clara devolve contexto visual insuficiente (sem `IdentityContext` e sem `BrandContext`), Sofia devolve `status: "needs_more_context"` em vez de arriscar uma direção visual sem fundamento — os dois pilares mínimos de qualquer direção visual são a identidade visual registrada e o contexto de marca.

## Fluxo interno

1. Valida a solicitação recebida (cliente, pedido original, canal, formato, objetivo visual, e presença mínima de `joaoStrategy` e `joaoSofiaBriefing`).
2. Consulta a Valentina para resolver o cliente, usando `getClientContext` quando recebe `tenantId` ou `getTenant` seguido de `getClientContext` quando recebe apenas `clientId`.
3. Consulta a Clara por `requestContext`, pedindo exatamente os módulos `BrandContext`, `AudienceContext`, `ContentContext`, `IdentityContext` e `PublishingContext`.
4. Avalia se o contexto visual devolvido é suficiente. Se não houver nem `IdentityContext` nem `BrandContext`, Sofia interrompe com `needs_more_context`.
5. Monta uma direção visual base de forma determinística, cruzando a estratégia do João com o conhecimento devolvido pela Clara (heurística própria, sem depender de IA): conceito e estilo derivados do ângulo estratégico e da identidade visual real quando existente, emoção derivada da promessa central e do tom de voz da marca, paleta extraída de `IdentityContext.colors`, tipografia extraída de `IdentityContext.fonts`, moodboard e referências de design derivados do ângulo e do formato, e restrições e riscos derivados de diretrizes visuais, fontes e fluxo de aprovação da Clara.
6. Se o Ícaro estiver configurado, monta um prompt e pede uma tarefa `analysis` para aprimorar apenas conceito visual, estilo recomendado, emoção, moodboard e referências de design — nunca layout. Se o Ícaro não estiver configurado ou falhar, Sofia segue com a direção heurística e registra o ocorrido nos logs, sem falhar a execução.
7. Monta o `biancaBriefing`, reunindo toda a direção visual finalizada em um documento autocontido já pensado para a Bianca.
8. Devolve a direção visual completa como saída estruturada e um artefato do tipo `plan`.

## Uso opcional do Ícaro

Assim como o João, e ao contrário da Maria (para quem o Ícaro é obrigatório), o Ícaro é uma dependência opcional para Sofia — o manifesto declara `IcaroBrainPort` com `optional: true`. A direção visual de Sofia é construída de forma determinística a partir da estratégia do João e do conhecimento devolvido pela Clara; o Ícaro apenas aprimora alguns campos criativos quando disponível e bem-sucedido. Falha do Ícaro nunca falha a execução de Sofia: fica registrada em log (`AISupportFailed`) e o campo `aiSupportUsed` permanece `false`.

## Integração com Valentina

Sofia usa exclusivamente `ValentinaTenantPort.getClientContext` e `ValentinaTenantPort.getTenant`, com a mesma lógica de resolução de cliente usada por João: `tenantId` quando disponível, ou `getTenant` seguido de `getClientContext` quando só há `clientId`. Se a Valentina não encontrar o cliente, Sofia devolve erro estruturado `CLIENT_NOT_FOUND` e não chega a consultar a Clara.

## Integração com Clara

Sofia usa exclusivamente `ClaraKnowledgePort.requestContext`, informando o `clientId` resolvido pela Valentina, os cinco módulos relevantes para direção visual e um `requester` do tipo `specialist` identificado pelo id do manifesto de Sofia. Sofia nunca cria, atualiza ou remove conhecimento na Clara — ela apenas consome contexto já existente, com destaque para `IdentityContext` (cores, fontes, estilo de imagem, diretrizes visuais), que é o módulo mais determinante para a qualidade da direção visual.

## Integração com Ícaro

Quando configurado, Sofia usa exclusivamente `IcaroBrainPort.request` com `taskType: "analysis"` — deliberadamente não `"image_generation"`, porque Sofia nunca deve pedir a geração de uma imagem de verdade, apenas o aprimoramento textual da direção visual. O prompt pede explicitamente uma resposta em JSON e reforça nas `constraints` que o Ícaro não deve gerar imagem final nem definir layout, apenas aprimorar conceito visual, estilo, emoção, moodboard e referências de design. Sofia nunca importa um Provider de IA concreto nem qualquer SDK externo.

## Integração com Arthur, Caio e Helena

Arthur já reservava, desde o primeiro `ExecutionPlan`, uma etapa de "Direção de arte" com `skillCapability: "art_direction"`, incluída no plano sempre que a intenção detectada envolve canais visuais ou palavras como "imagem", "arte", "visual", "criativo". O manifesto de Sofia declara `capabilities: ["art_direction"]`, então ela ocupa exatamente essa etapa sem exigir nenhuma mudança em Arthur. O catálogo de planos da Valentina (`valentina-plan-catalog.ts`) também já liberava `art_direction` no plano PRO e superiores, então Sofia já está disponível para qualquer cliente nesses planos. Helena descobre o manifesto de Sofia, valida, carrega a Skill e a executa somente quando solicitada por Arthur (via Caio). Sofia recebe apenas a entrada da etapa e devolve uma saída estruturada, sem conhecer detalhes do workflow completo.

## Como o output de Sofia prepara o trabalho da Bianca

O campo `biancaBriefing` de Sofia reúne toda a direção de arte finalizada — conceito, estilo, emoção, paleta, tipografia, moodboard, referências de design, formato, proporção e restrições — em um único objeto autocontido, já pensado no formato que a Skill da Bianca (Design para Redes Sociais) consome como entrada. Por respeito ao isolamento entre Skills (ADR 0002: nenhuma Skill deve importar outra Skill diretamente), Sofia não importa nenhum tipo da Bianca — ela define seu próprio tipo `SofiaBiancaBriefing`, com `status: "preliminary"` e `notes` explicando explicitamente que decisões de layout são responsabilidade da Bianca. Bianca, por sua vez, também não importa nenhum tipo de Sofia: ela define seus próprios tipos `BiancaSofiaDirectionSummary` e `BiancaSofiaBriefing`, espelhando por convenção o formato real que Sofia produz. Esse é o mesmo padrão de "briefing autocontido para o próximo especialista" que o próprio João já usa para preparar o trabalho de Sofia — a cadeia João → Sofia → Bianca → Pedro segue, em cada elo, a mesma convenção, sem nunca importar ou executar a Skill seguinte diretamente. Detalhes completos da implementação de Bianca estão em `docs/bianca-social-media-design.md`.
