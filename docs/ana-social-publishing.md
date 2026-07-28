# Ana, Especialista em Publicação Social

Ana ocupa a capability `social_publishing`, que Arthur já reservava desde o primeiro plano de execução como a etapa "Publicação", posicionada logo após o `human_gate` de aprovação humana — a última etapa da cadeia de produção de conteúdo. Na pipeline estática, ela fecha João → Maria/Sofia → Bianca → Pedro → Lucas → aprovação humana → **Ana**. Na pipeline de vídeo, ela também fecha João → Bruno → Vanessa → Diego → Rafa → Lucas → aprovação humana → **Ana**. Ana é uma Skill operacional responsável, nesta fase, exclusivamente pela publicação orgânica na Meta: Instagram e Facebook, aceitando imagem única, carrossel e vídeo sem criar uma nova capability.

Ana não cria estratégia, não cria copy, não cria imagens, não faz revisão de qualidade, não cria campanhas pagas, não consulta métricas, não usa Inteligência Artificial, não conversa com o Ícaro, não acessa storage diretamente e não chama outra Skill. É a primeira Skill do Zuno que não depende de IA de forma alguma — seu trabalho é inteiramente determinístico: validar regras e, se tudo estiver certo, delegar a publicação de verdade a uma porta abstrata.

Ana conhece quatro abstrações: `ValentinaTenantPort` para obter dados administrativos do cliente e integrações conectadas, `ClaraKnowledgePort` para obter regras de publicação do cliente, `ArtifactHostingPort` para transformar artefatos locais em URLs públicas quando a publicação é real, e `SocialPublisherPort` para solicitar a publicação em si. Ana nunca conversa diretamente com a API da Meta, nunca acessa disco para verificar vídeo e nunca importa Rafa, Pedro ou Lucas diretamente. A existência técnica do vídeo continua sendo responsabilidade do Rafa; Ana valida apenas o contrato recebido (`uri`/caminho, `mimeType`, extensão, tamanho e duração).

## Revisão do contrato `SocialPublisherPort` antes de implementar Ana

Antes de escrever qualquer código de Ana, revisei `SocialPublisherPort` em `src/application/ports/social-publisher.port.ts`. Na forma anterior, o contrato tinha apenas `publish(draft)` e `schedule(draft)`, com um `SocialPostDraft` contendo `channel`, `caption` opcional, `assetUris` (array, já suportando imagem única ou carrossel) e `scheduledAt` opcional — e retornos ad-hoc e distintos para cada método (`{externalId, url}` para `publish`, `{externalId, scheduledAt}` para `schedule`). Confirmei que esse contrato nunca tinha sido usado por nenhum código além de sua própria declaração, então pude evoluí-lo livremente.

Faltavam, de forma genérica (não específica da Ana): hashtags e CTA estruturados no draft (existiam apenas embutidos em texto livre, se é que existiam); um status explícito de publicação; um formato de erro estruturado por chamada; e uma forma de o chamador saber, **antes** de tentar agendar, se o provider suporta agendamento. Evoluí o contrato assim: `SocialPostDraft` ganhou `cta?: string`, `hashtags?: string[]` e `links?: string[]`; os dois métodos passaram a devolver o mesmo tipo unificado `SocialPublicationResult` (`channel`, `status: "published" | "scheduled" | "failed"`, `externalId?`, `url?`, `scheduledAt?`, `error?: { code, message, retryable }`, `metadata?`); e a porta ganhou uma propriedade obrigatória `capabilities: { supportsScheduling: boolean }`, seguindo o mesmo padrão já usado por `AIProviderPort.profile` no restante do projeto — uma propriedade descritiva ao lado dos métodos, não um método adicional.

Com a entrada da pipeline de vídeo, `SocialPublisherPort` foi evoluída novamente sem quebrar o comportamento anterior. `SocialPostDraft` agora declara `mediaType: "image" | "carousel" | "video"`, mantém `assetUris` para imagem/carrossel e passa a aceitar `videoUri`, `thumbnailUri`, `duration`, `mimeType` e `videoMetadata`. `SocialPublisherCapabilities` também passa a aceitar `supportedMediaTypes` por canal, permitindo que Ana bloqueie a publicação antes de chamar o provider quando, por exemplo, um adapter ainda não suporta vídeo no Instagram ou Facebook.

Depois disso, uma nova porta foi criada: `ArtifactHostingPort`, documentada em `docs/artifact-hosting.md`. Ela resolve uma exigência operacional de providers reais como Meta: arquivos locais em `artifacts/` não são publicáveis diretamente. Em `dry_run`, Ana preserva os caminhos locais no payload simulado. Em `publish_now` ou `schedule`, Ana exige URL pública; se a mídia estiver local, tenta hospedá-la pela porta; se a porta não estiver configurada, bloqueia a publicação com erro claro antes de chamar `SocialPublisherPort`.

Decisões deliberadas de **não** evoluir o contrato em duas direções: primeiro, não adicionei um método de "publicação em lote" (`publishMany`) — publicação simultânea em múltiplos canais continua sendo responsabilidade de quem chama a porta, um `SocialPostDraft` por canal, disparados em paralelo via `Promise.all` do lado de Ana; a porta continua representando "publicar isto em um canal", o menor bloco possível, reutilizável por qualquer futura Skill ou canal. Segundo, não adicionei um campo `dryRun` ao contrato — `dry_run` é inteiramente resolvido por Ana **sem nunca chamar a porta**: ela monta o mesmo payload que enviaria e o devolve na saída, sem tocar em `publish` nem em `schedule`. Isso mantém a porta representando apenas ações reais, e evita que cada futura implementação de `SocialPublisherPort` precise reimplementar uma lógica de simulação que não lhe pertence.

## Responsabilidade

Ana recebe o pacote completo já produzido e revisado (estratégia, copy, direção visual, imagens do Pedro **ou** vídeo do Rafa, revisão do Lucas) mais a confirmação de aprovação humana, valida as condições obrigatórias e, se todas passarem, solicita a publicação através de `SocialPublisherPort` — imediata, agendada, ou simulada (dry run). Se qualquer condição falhar, Ana nunca chega a chamar a porta.

## Contrato de entrada

A entrada de Ana é `AnaSocialPublishingRequestInput`:

- `clientId` ou `tenantId`;
- `originalRequest`;
- `joaoStrategy`, `mariaCopy`, `sofiaDirection`, `pedroImages` ou `rafaVideo`, `lucasReview` — espelhando por convenção, sem importar, o formato real de saída de cada Skill anterior;
- `humanApproval`: `{ confirmed: boolean; approvedBy?; approvedAt?; notes? }`;
- `channels`: lista de canais (`"instagram"` e/ou `"facebook"`, únicos suportados nesta fase);
- `publishMode`: `"publish_now"`, `"schedule"` ou `"dry_run"`;
- `scheduledAt`: obrigatório quando `publishMode` é `"schedule"`;
- `workflowContext` opcional.

## Contrato de saída

Ana devolve `AnaSocialPublishingOutput`: `overallStatus` (`"published"`, `"scheduled"`, `"dry_run"`, `"local_ready"`, `"partially_published"` ou `"failed"`), `mediaType` (`"image"`, `"carousel"` ou `"video"`), `requestedChannels`, `publishedChannels`, `failedChannels`, `publishMode`, `scheduledAt`, `results` (detalhe por canal), `externalIds` e `externalUrls` (mapas canal → valor), `payloadSentToPublisher` (os `SocialPostDraft` enviados — ou que seriam enviados, em dry run/local), `warnings`, `observations`, `nextSteps`.

Quando qualquer uma das nove regras obrigatórias falha, Ana devolve `status: "failed"` com `error.code: "PUBLISHING_BLOCKED"` e a lista completa de motivos em `warnings` — nunca um `output` parcial. Quando o modo é `"schedule"` e o provider não suporta agendamento, Ana devolve `status: "failed"` com `error.code: "SCHEDULING_NOT_SUPPORTED"`. Em qualquer outro caso — publicação bem-sucedida, parcialmente bem-sucedida, totalmente falha na tentativa real, ou simulada — Ana devolve `status: "completed"` com um `output` estruturado descrevendo exatamente o que aconteceu, mesmo quando o resultado é "todos os canais falharam": a diferença é que, nesse ponto, Ana já tentou de verdade, e reportar essa tentativa é o próprio trabalho dela.

## Como Ana consulta Valentina

Diferente de todas as Skills anteriores, Ana não usa `getClientContext` — ela usa `ValentinaTenantPort.getTenant` diretamente, porque precisa do `TenantRecord` completo, com `integrations` (quais redes estão conectadas de fato) e `planLimits.integrations` (quais canais o plano libera), campos que `TenantClientContext` não expõe. Ana também usa `ValentinaTenantPort.canUseSpecialist(tenant.id, "social_publishing")` para verificar se o recurso de publicação está liberado no plano — o método já existia no contrato, desenhado exatamente para esse propósito, e Ana é a primeira Skill a usá-lo.

## Como Ana consulta Clara

Ana usa somente `ClaraKnowledgePort.requestContext`, pedindo exclusivamente o módulo `PublishingContext` — o único módulo citado no escopo de Ana ("regras de publicação do cliente"), o subconjunto mais estreito entre todas as seis Skills. De `PublishingContext.connectedSocialNetworks` (uma lista de `{ network, status }` por rede), Ana extrai uma segunda camada de verificação de canal, distinta da checagem técnica de integração feita pela Valentina: mesmo que a integração esteja tecnicamente conectada, uma regra de negócio registrada na Clara pode marcar um canal específico como `"disabled"` ou `"pending"` para fins de publicação de conteúdo, e Ana respeita essa camada de governança separadamente.

## Como Ana valida o pacote

Ana só chama `SocialPublisherPort` se todas as condições do prompt passarem, nesta ordem de verificação: cliente válido (resolvido pela Valentina); integração necessária conectada, por canal solicitado; copy válida (título e legenda presentes); mídia válida; Lucas ter recomendado aprovação (`lucasReview.approvalRecommended`); aprovação humana confirmada (`humanApproval.confirmed`); canal liberado no plano (`tenant.planLimits.integrations`); provider compatível com o tipo de mídia (`SocialPublisherCapabilities.supportedMediaTypes`); recurso de publicação liberado no plano (`canUseSpecialist`); e regras de publicação da Clara não bloqueando o canal ou o tipo de mídia. Todas são avaliadas e **todos** os motivos de falha são agregados numa única lista antes de decidir — Ana não para na primeira regra que falha, para que quem chamar a Skill veja o quadro completo de uma vez. Se a lista de motivos não estiver vazia, Ana nunca chega a tocar em `SocialPublisherPort`.

Para imagem única e carrossel, a validação continua aceitando `pedroImages.images` com pelo menos um `uri` utilizável. Se houver mais de um `uri`, Ana classifica o payload como `mediaType: "carousel"`; se houver apenas um, classifica como `mediaType: "image"`.

Para vídeo, Ana espera `rafaVideo.video` com um `uri`/`downloadHref`/`relativePath`/`localPath` utilizável, `mimeType: "video/mp4"`, extensão `mp4`, `sizeBytes >= 100KB` e duração positiva em `specs.durationSeconds`. Esse limite de 100KB acompanha a validação do próprio Rafa e serve para impedir placeholders vazios ou arquivos falsos. Ana não abre o arquivo nem lê bytes — isso violaria o isolamento e duplicaria a responsabilidade do Rafa. Ela só valida o contrato já produzido pela pipeline de vídeo.

Após validar o pacote, Ana prepara a mídia para publicação. Se o modo for `dry_run`, nenhuma hospedagem é exigida. Se o modo for `publish_now` ou `schedule`, todos os artefatos precisam estar em URL pública. URLs `http://` ou `https://` passam direto. Caminhos locais, relativos ou vindos de `artifacts/` são enviados para `ArtifactHostingPort`, item por item. `file://` é bloqueado e nunca é convertido em gambiarra. Se a hospedagem falhar, Ana retorna `ARTIFACT_HOSTING_FAILED` e não chama o publisher.

## Como Ana respeita a aprovação humana

A aprovação humana chega como parte da entrada (`humanApproval.confirmed`), não como algo que Ana verifica em outro sistema — ela é uma das nove regras obrigatórias, tratada com o mesmo peso que qualquer outra: sua ausência bloqueia a publicação por completo, com a mensagem "Aprovação humana não foi confirmada." Isso reflete a posição de Ana no plano de Arthur, sempre depois do `human_gate`: Ana confia que, se foi chamada, a aprovação já deveria ter acontecido, mas nunca assume isso sem confirmação explícita no próprio pacote recebido.

## Como Ana publica agora (`publish_now`)

Depois que as regras passam e a mídia está pública, Ana monta um `SocialPostDraft` por canal solicitado (mesma legenda, CTA, hashtags e mídia, cada um com seu próprio `channel`) e chama `SocialPublisherPort.publish(draft)` para cada um, em paralelo via `Promise.all`. Para imagem/carrossel, o draft usa `assetUris` já públicos. Para vídeo, o draft usa `mediaType: "video"`, `videoUri` público, `thumbnailUri` público quando existir, `duration`, `mimeType` e `videoMetadata` com os dados técnicos do Rafa e da hospedagem. Cada chamada é isolada em try/catch: uma exceção ou um retorno com `status: "failed"` vira um resultado de canal com erro, sem interromper os demais canais. Ao final, `overallStatus` é `"published"` se todos os canais tiveram sucesso, `"failed"` se todos falharam, ou `"partially_published"` no meio-termo.

## Como Ana agenda publicação (`schedule`)

Antes de considerar agendar, a validação das nove regras já inclui uma décima checagem específica de agendamento: `scheduledAt` precisa existir, ser uma data válida e estar no futuro em relação ao relógio de Ana. Depois que as regras passam, Ana verifica `socialPublisher.capabilities.supportsScheduling` **antes** de chamar qualquer método — se o provider configurado não suporta agendamento, Ana devolve `error.code: "SCHEDULING_NOT_SUPPORTED"` imediatamente, sem nunca chamar `schedule()`. Ana não implementa nenhum scheduler próprio: ela apenas delega ao `SocialPublisherPort.schedule(draft)`, incluindo o timezone do cliente (`tenant.settings.timezone`) como metadado do draft, para que o provider real interprete a data corretamente.

## Como Ana simula publicação (`dry_run`)

Em modo `dry_run`, Ana constrói os mesmos `SocialPostDraft` que construiria em `publish_now`, incluindo `mediaType` e campos de vídeo quando aplicável, mas nunca chama `SocialPublisherPort` — nem `publish`, nem `schedule`. Cada canal recebe um resultado simulado com `status: "dry_run"`, sem `externalId` nem `url`. O `payloadSentToPublisher` da saída mostra exatamente o que teria sido enviado, permitindo inspecionar o resultado antes de publicar de verdade.

No `LOCAL_PRODUCTION`, o `dry_run` ganha uma semântica mais explícita: Ana retorna `overallStatus: "local_ready"` e resultados por canal também em `local_ready`. Isso significa que as regras foram validadas, a aprovação humana foi confirmada, o payload foi montado e o material está pronto para publicação manual — mas nada foi publicado, nada foi agendado, nenhum upload foi feito e `ArtifactHostingPort` não foi acionado. Essa distinção evita confundir "simulação para teste" com "pacote local pronto".

## Como Ana publica no Instagram e no Facebook

Nesta fase, `AnaSupportedChannel` é deliberadamente restrito a `"instagram"` e `"facebook"` — refletindo o escopo explícito do prompt ("Ana será responsável inicialmente apenas por publicação orgânica na Meta"), embora `SocialPublisherPort` em si continue genérico e suporte oito canais diferentes, para não amarrar o contrato compartilhado ao escopo atual de uma única Skill. A validação de entrada de Ana rejeita qualquer canal fora desses dois. O suporte a vídeo foi adicionado dentro da mesma capability `social_publishing`, sem criar uma Skill separada.

## Bloqueios implementados

Nove verificações de regra de negócio (cliente válido, integração conectada, copy válida, imagem válida, aprovação do Lucas, aprovação humana, canal no plano, recurso no plano, regra da Clara), mais uma décima específica de agendamento (data/hora válidas e futuras), todas agregadas em uma única lista de motivos antes de decidir bloquear — e uma verificação adicional e distinta, de capacidade do provider (`supportsScheduling`), avaliada somente depois que todas as regras já passaram.

## Logs implementados

`AnaLogAction` registra `RequestReceived` (solicitação recebida), `ClientResolved`/`ClientNotFound` (cliente resolvido), `PublishingRulesConsulted` (regras de publicação consultadas), `ValidationStarted` (validação iniciada), `ValidationFailed` (validação falhou), `MediaValidated` (mídia validada e classificada como imagem, carrossel ou vídeo), `ArtifactHostingStarted`, `ArtifactHosted`, `ArtifactHostingFailed`, `PublicationStarted` (publicação iniciada), `PublicationScheduled` (publicação agendada), `PublicationCompleted` (publicação concluída) e `PublicationFailed` (publicação falhou).

## Eventos implementados

Os cinco eventos pedidos — `SocialPublishingStarted`, `SocialPublishingValidationFailed`, `SocialPublishingScheduled`, `SocialPublishingFinished`, `SocialPublishingFailed` — foram adicionados ao `ZunoEventName` compartilhado. `SocialPublishingValidationFailed` é específico das nove regras de negócio (e da validação de forma da solicitação); `SocialPublishingFailed` cobre a falta de suporte a agendamento pelo provider e o caso em que todos os canais falham numa tentativa real; `SocialPublishingScheduled` é exclusivo do sucesso completo em modo `schedule`; `SocialPublishingFinished` fecha toda execução que chegou a produzir um relatório, com sucesso total, parcial ou mesmo falha completa na tentativa.

## Integração com Arthur, Caio e Helena

Arthur já reservava, desde o primeiro `ExecutionPlan`, uma etapa de "Publicação" com `skillCapability: "social_publishing"`, posicionada depois do `human_gate` de aprovação. O manifesto de Ana declara `capabilities: ["social_publishing"]`, ocupando exatamente essa etapa sem exigir nenhuma mudança em Arthur. O catálogo de planos da Valentina já liberava `social_publishing` no plano PRO em diante. Helena descobre, valida, carrega e executa Ana como qualquer outra Skill.

## Como uma futura integração Meta deverá implementar `SocialPublisherPort`

Um adaptador real de Meta (Instagram/Facebook Graph API) deve viver inteiramente em `src/infrastructure/social-networks/`, implementando `SocialPublisherPort` sem vazar nenhum detalhe da API para a aplicação ou para Ana: `capabilities.supportsScheduling` deve refletir a capacidade real da API; `capabilities.supportedMediaTypes` deve declarar por canal se aceita imagem, carrossel e/ou vídeo; `publish`/`schedule` devem traduzir `SocialPostDraft` (caption, cta, hashtags, links, assetUris, videoUri, thumbnailUri, duration, mimeType e videoMetadata) para o formato de requisição do provider, tratar erros específicos da Meta (rate limit, mídia inválida, token expirado) como `SocialPublicationError` estruturado com `retryable` corretamente definido, e devolver `externalId`/`url` reais. Nenhuma dessas mudanças deve exigir alterar Ana: ela já está pronta para qualquer implementação que respeite o contrato.
