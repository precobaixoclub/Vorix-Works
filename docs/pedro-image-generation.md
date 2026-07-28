# Pedro, Especialista em Geração de Imagens

Pedro é a quinta Skill real do Zuno e a primeira a efetivamente produzir um artefato visual — todas as Skills anteriores (João, Maria, Sofia, Bianca) produzem apenas texto estruturado ou planos. Ele ocupa a capability `image_generation`, que Arthur já reservava desde o primeiro plano de execução como a etapa "Geração de imagem", condicionada à necessidade de conteúdo visual. Pedro é uma Skill puramente operacional: transforma o briefing de design extremamente detalhado que a Bianca preparou em uma imagem ou conjunto de imagens, sem tomar nenhuma decisão de layout por conta própria.

Pedro não cria estratégia de marketing, não cria copy, não cria direção de arte, não toma decisões de layout, grid, hierarquia visual, espaçamento ou posicionamento de elementos — isso é responsabilidade exclusiva da Bianca —, não publica, não cria campanhas, não consulta métricas, não acessa storage diretamente e não conversa diretamente com OpenAI, Gemini, Claude ou qualquer provider concreto. Pedro também não executa nem chama outra Skill diretamente (incluindo a Ana) — isso continua sendo papel exclusivo de Arthur, Helena e Caio.

Pedro conhece cinco abstrações: `ValentinaTenantPort` para identificar o cliente, `ClaraKnowledgePort` para obter identidade visual, marca e publicação, `IcaroBrainPort` para solicitar a geração de imagem em si (no modo `ai_provider` — ver seção "Developer Assisted Mode" abaixo para o modo oficial da CLI local, que não usa o Ícaro), `StoragePort` para persistência externa opcional e `ArtifactDeliveryPort` para salvar e ler arquivos locais de entrega quando configurado.

## Prontidão profissional antes da geração

Pedro agora executa uma validação de prontidão visual antes de acionar o Ícaro. Essa validação não cria layout nem corrige decisões da Bianca; ela apenas verifica se o briefing recebido tem dados suficientes para que Pedro não precise inventar direção visual durante a geração. O relatório resultante (`qualityReport`) acompanha a saída da Skill, o `metadata.json` e a página HTML de entrega.

O relatório avalia se existem informações mínimas para uma peça em padrão de agência: conceito visual, estilo, paleta com contraste, grid, hierarquia, escala tipográfica (incluindo CTA), espaçamento, posicionamento de logo, posição/destaque de CTA, quantidade suficiente de slides para carrossel, papel narrativo de cada slide, ponto focal, peso visual, alinhamento, margens, espaço em branco e orientações de CTA/textos visíveis. A ausência de regras dedicadas de contraste, diretrizes de acessibilidade visual ou regras de padronização visual gera avisos (não bloqueia a geração, já que são reforços de qualidade, não pré-requisitos estruturais) e aparece em `agencyChecklist.accessibilityGuided`/`.visualStandardizationGuided`. Quando faltam decisões estruturais que pertencem à Bianca ou à cadeia anterior, Pedro retorna `needs_more_context` em vez de gerar uma peça pobre ou assumir decisões indevidas.

Quando o briefing está tecnicamente utilizável, mas ainda possui riscos — por exemplo, ausência de CTA autorizado no `workflowContext` ou falta de `carouselFlow` detalhado — Pedro segue com `ready_with_warnings`, registra recomendações upstream e inclui esses alertas na entrega.

## Página local de entrega

Quando `ArtifactDeliveryPort` está disponível, Pedro salva as imagens em `artifacts/<executionId>/images`, cria `index.html`, `caption.txt`, `metadata.json` e, no caso de carrossel, `carousel.zip`. O HTML usa links relativos para os arquivos salvos fisicamente, atributo `download` nos botões de download, abertura em nova aba e cópia de legenda/hashtags/CTA com `navigator.clipboard.writeText` e fallback manual (`document.execCommand('copy')`).

O HTML segue sempre a mesma ordem de seções, independente do cenário: **Preview** (galeria com zoom) → **Ações** (toolbar de botões) → **Legenda** → **Hashtags** → **CTA** (só aparece quando o `workflowContext` traz um CTA) → **Resumo técnico da execução** → **Relatório das Skills utilizadas** (só aparece quando o Caio envia `upstreamSkillsReport` no `workflowContext`) → **Gerar novamente** → **Publicar** (só aparece quando `workflowContext.publishingEnabled` é `true`).

- **Preview com zoom e navegação**: cada imagem da galeria é clicável e abre um overlay em tela cheia (lightbox) com um botão "Ampliar" dedicado; o overlay tem zoom por clique (alterna entre ajustar à tela e tamanho ampliado com scroll), fecha com Esc ou clique fora, e mostra botões "Anterior"/"Próxima" apenas quando há mais de uma imagem (carrossel). Todo o comportamento é JavaScript inline auto-contido, sem dependência externa.
- **Resumo técnico da execução**: além do relatório de prontidão visual, inclui um `stat-grid` com tempo de execução (`executionDurationMs`, formatado como "Xs"/"Xm Ys"), provider e modelo utilizados, tokens consumidos (entrada/saída/total) e custo estimado — todos vindos de `PedroImageGenerationOutput.cost`/`.usage`/`.providerUsed`/`.modelUsed`.
- **Gerar novamente**: mostra e permite copiar o comando `npm run zuno -- "<originalRequest>" --client-id <clientId>`, montado a partir do próprio pedido original recebido pela etapa.
- **Publicar**: mostra e permite copiar `npm run zuno -- --approve <executionId>` apenas quando o plano do Caio inclui uma etapa de `social_publishing` (`workflowContext.publishingEnabled === true`, um booleano genérico injetado pelo Caio — Pedro nunca sabe o que é "Ana" ou o que é publicação social, apenas lê esse flag).

## Developer Assisted Mode

`imageGenerationMode` (`PedroImageGenerationSkillDependencies`) controla como Pedro obtém pixels reais:

- **`ai_provider`** (padrão do construtor, usado pelos testes automatizados): Pedro pede a imagem ao Ícaro via `IcaroBrainPort.request({ taskType: "image_generation", ... })`, exatamente como antes. Quem está por trás do Ícaro (fake determinístico em teste, ou um provider real quando algum existir) é irrelevante para Pedro — ele só materializa os bytes que recebe.
- **`developer_assisted`** (modo oficial da CLI local, `src/interfaces/cli/run-command.ts`): Pedro **nunca chama o Ícaro** para gerar pixels. Isso existe porque o Claude Code não possui geração de imagem nativa e esta fase não integra nenhum provider externo (ver `src/infrastructure/ai/README.md`).

No `LOCAL_PRODUCTION`, a CLI injeta sempre `imageGenerationMode: "developer_assisted"` em Pedro. Assim, comandos como `npm run zuno -- --mode local-production "crie um carrossel com 5 imagens sobre RSVP"` pausam até que cada `images/slide-NN.png` exista fisicamente em `artifacts/<executionId>/`. Depois do `--continue`, Pedro valida os PNGs, registra artefatos locais, gera ZIP quando houver múltiplas imagens e deixa o material pronto para revisão/publicação manual — sem provider externo e sem upload.

No modo `developer_assisted`, `runAssistedGeneration` (privado):

1. Reaproveita o mesmo `finalPrompt` rico já construído por `buildFinalImagePrompt` — nenhuma perda de qualidade de prompt entre os dois modos.
2. Para cada imagem esperada, calcula o caminho relativo (`images/slide-01.png`, `images/slide-02.png`, ...) e a resolução alvo (a partir de `resolutionForAspectRatio`), e verifica via `ArtifactDeliveryPort.readFile` se o arquivo já existe — nunca por `child_process`, nunca por nenhuma execução de comando externo.
3. Se o arquivo existir, valida que é um **PNG real e plausível** antes de aceitar: assinatura de arquivo PNG correta, chunk `IHDR` presente, dimensões lidas diretamente dos bytes (sem nenhuma dependência externa) batendo com a resolução esperada, e dimensão mínima de 64×64 — rejeitando explicitamente qualquer placeholder trivial (como um PNG 1×1 transparente) que tentasse passar por imagem real.
4. Se **todas** as imagens esperadas existirem e forem válidas, Pedro continua exatamente o mesmo fluxo do modo `ai_provider` a partir daí (mesma função `finalizeGeneration`: cria artefatos, HTML, ZIP, caption, metadata) — usando um `IcaroAIResponse` sintético só para preencher `providerUsed: "developer-assisted"` / `modelUsed: "claude-code-developer-assisted"` / custo e tokens zerados (nenhuma IA foi consultada).
5. Se **qualquer** imagem esperada ainda não existir (ou não for válida), Pedro devolve `status: "needs_assisted_generation"` com um `PedroAssistedGenerationOutput`: `instruction` ("Crie a imagem usando este prompt e salve neste caminho."), a lista `pendingImages` (prompt + caminho + resolução por imagem) e `resumeCommand` (`npm run zuno -- --continue <executionId>`).

`Caio` trata `needs_assisted_generation` como uma pausa, não uma falha: marca o workflow em `WAITING_ASSISTED_GENERATION`, análogo a `WAITING_HUMAN_APPROVAL` para `human_gate`, e `Caio.resumeAssistedGeneration(executionId)` simplesmente reexecuta a mesma etapa — se o arquivo já existir dessa vez, o workflow segue; se não, pausa de novo com a mesma mensagem (retomada idempotente). Ver `docs/caio-workflow-executor.md`.

O relatório final sempre distingue a origem da imagem: `PedroImageGenerationOutput.generationMode` (`"ai_provider"` ou `"developer_assisted"`) e `providerUsed` (`"fake-icaro-provider"` em teste, `"developer-assisted"` em modo assistido, ou o id de um provider real quando algum existir).

## Revisão do contrato `SkillArtifact` antes de implementar Pedro

Antes de escrever qualquer código de Pedro, revisei o contrato `SkillArtifact` em `src/domain/skills/skill.contract.ts`. Na forma anterior, ele tinha apenas `id`, `type`, `name`, `uri` opcional e um `metadata` genérico — suficiente para os artefatos de texto e plano que Maria, João e Sofia produziam, mas insuficiente para descrever uma imagem de verdade: não havia como expressar mime type, extensão, largura, altura, proporção, tamanho de arquivo, caminho local, prompt utilizado, provider, modelo, custo, tokens/unidades consumidas ou status do artefato de forma estruturada — tudo isso teria que ser espremido dentro do `metadata` solto, sem tipagem.

Evoluí o contrato de forma genérica, sem criar nenhum campo exclusivo do Pedro:

- `status?: SkillArtifactStatus` (`"ready" | "pending" | "failed"`) — aplicável a qualquer artefato de qualquer Skill, não só imagem;
- `file?: SkillArtifactFileInfo` — `mimeType`, `extension`, `sizeBytes`, `localPath`, reutilizável por qualquer Skill que produza arquivos (imagem, vídeo, documento, planilha de métricas exportada, etc.);
- `dimensions?: SkillArtifactDimensions` — `width`, `height`, `aspectRatio`, reutilizável por qualquer artefato visual, incluindo futuros vídeos;
- `generation?: SkillArtifactGenerationInfo` — `prompt`, `provider`, `model`, `cost`, `usage`, `durationMs`, reutilizável por qualquer artefato gerado por IA, não só imagem (útil também se, no futuro, quisermos anexar essa informação a um artefato de texto);
- `items?: SkillArtifact[]` — auto-referência que permite um artefato composto (como um carrossel) agrupar outros artefatos, sem precisar inventar um tipo paralelo só para isso; genérico o suficiente para qualquer Skill futura que precise agrupar múltiplos arquivos sob um único artefato;
- o campo `uri` já existente foi mantido como referência genérica, e o novo `file.localPath` cobre especificamente "caminho local" como pedido.

Todos os campos novos são opcionais. Não foi necessário alterar uma linha sequer de Maria, João ou Sofia: os artefatos que eles já criavam (`{ id, type, name, metadata }`) continuam válidos exatamente como estavam, e confirmei isso rodando `npm run typecheck` e a suíte completa de testes antes e depois da mudança, sem qualquer alteração adicional fora do próprio arquivo de contrato.

## Responsabilidade

Pedro recebe uma solicitação de geração de imagem — o pedido original do usuário, a especificação de design completa produzida pela Bianca, o briefing que a própria Bianca já preparou pensando em Pedro, canal, formato, quantidade de imagens e proporção desejada — e devolve um resultado estruturado contendo resumo da geração, prompt final utilizado, quantidade de imagens geradas, as imagens em si, os artefatos correspondentes, provider e modelo utilizados, custo estimado e real, tempo de execução, warnings, observações e próximos passos.

## Contrato de entrada

A entrada de Pedro é `PedroImageGenerationRequestInput`:

- `clientId` ou `tenantId` (pelo menos um dos dois é obrigatório);
- `originalRequest`: o pedido original do usuário, em texto livre;
- `biancaDesign`: a especificação de design completa produzida pela Bianca (`PedroBiancaDesignSummary`), incluindo conceito de design, grid, estratégia de hierarquia visual, escala tipográfica (incluindo tamanho de CTA), aplicação de cor, sistema de espaçamento, estilo de componentes, estilo de ilustração e de mockup, posicionamento de logo, posição/destaque de CTA, composição de capa de Reels quando aplicável, regras dedicadas de contraste, diretrizes de acessibilidade visual, regras de padronização visual, layout de cada slide (incluindo `ctaPlacement` quando o slide tem CTA) e fluxo do carrossel quando aplicável;
- `biancaPedroBriefing`: o briefing que a própria Bianca já monta pensando em Pedro (`PedroBiancaBriefing`);
- `channel`: canal desejado para esta peça (mesmo vocabulário de canais já usado pelas demais Skills);
- `format`: formato desejado, em texto livre;
- `imageCount`: quantidade de imagens a gerar (inteiro maior que zero);
- `desiredAspectRatio`: proporção desejada, em texto livre (por exemplo "1:1", "4:5", "9:16");
- `workflowContext`: contexto opcional adicional vindo do workflow.

Pedro não recebe mais `sofiaDirection`/`sofiaPedroBriefing` diretamente — o briefing da Bianca já incorpora tudo que Pedro precisa da direção de arte da Sofia (conceito, paleta, estilo), então Pedro passou a depender de um único elo da cadeia (Bianca), e não de dois.

## Contrato de saída

Pedro nunca devolve apenas um arquivo solto. Ele devolve `PedroImageGenerationOutput`, contendo `generationSummary`, `finalPrompt`, `imageCount`, `images` (lista de `PedroGeneratedImage`, cada uma com id, índice, texto alternativo, mime type, extensão, largura, altura, proporção, tamanho em bytes, uri/caminho local e o prompt usado), `artifacts` (a mesma lista de `SkillArtifact` que também é devolvida no envelope padrão da resposta), `providerUsed`, `modelUsed`, `cost` (reaproveitando o tipo `AICostReport` já existente em `AIProviderPort`, em vez de reinventar um tipo de custo próprio), `usage` (reaproveitando `AITokenUsage`), `executionDurationMs`, `warnings`, `observations` e `nextSteps`.

Quando a solicitação é inválida ou a Valentina não encontra o cliente, Pedro devolve `status: "failed"`. Quando a Clara devolve contexto visual insuficiente (sem `IdentityContext` e sem `BrandContext`), Pedro devolve `status: "needs_more_context"`. Quando o Ícaro falha — já que, ao contrário de João e Sofia, o Ícaro é obrigatório para Pedro —, a execução inteira falha com `status: "failed"` e `error.code: "IMAGE_GENERATION_FAILED"`, sem tentativa adicional.

## Como Pedro consulta Valentina

Idêntico ao padrão de João e Sofia: `getClientContext(tenantId)` quando a solicitação já traz `tenantId`, ou `getTenant({ clientId, status: "all" })` seguido de `getClientContext(tenant.id)` quando só há `clientId`. Falha na resolução do cliente interrompe a execução antes de qualquer consulta à Clara ou ao Ícaro.

## Como Pedro consulta Clara

Pedro usa somente `ClaraKnowledgePort.requestContext`, pedindo exatamente os três módulos citados no escopo do prompt — marca (`BrandContext`), identidade visual (`IdentityContext`) e publicação (`PublishingContext`) —, o subconjunto mais estreito entre todos os Especialistas de conteúdo visual até agora (Sofia consulta cinco módulos, incluindo público e conteúdo, que não são necessários no momento de gerar a imagem final). A mesma verificação de completude usada por Sofia se repete aqui: sem `IdentityContext` e sem `BrandContext` ao mesmo tempo, Pedro recusa gerar imagem sem fundamento visual.

## Como Pedro usa Ícaro

No modo `ai_provider`, o Ícaro é uma dependência obrigatória para Pedro (assim como para Maria) — isso está refletido no manifesto (`IcaroBrainPort` com `optional: false`) e no construtor, que não aceita um Ícaro ausente. No modo `developer_assisted` (oficial na CLI local), Pedro constrói o prompt normalmente mas **nunca chama** `icaro.request` — ver "Developer Assisted Mode" acima. Quando o modo `ai_provider` está ativo, Pedro pede `taskType: "image_generation"` — o único dos quatro Especialistas de conteúdo a efetivamente usar esse task type, já que João e Sofia usam deliberadamente `"analysis"` para não sugerir que estão gerando imagem de verdade. O pedido usa `expectedOutput: "json"`, não `"image"`: Pedro pede ao Ícaro uma resposta estruturada em JSON descrevendo a imagem (texto alternativo, mime type, largura, altura e, opcionalmente, o conteúdo em base64 ou uma referência de uri), seguindo a mesma convenção de parsing de JSON já usada por Maria, João e Sofia, em vez de inventar um caminho de binário bruto que nenhum outro ponto do sistema ainda suporta. Se o Ícaro falhar (erro de rede, resposta não concluída, JSON inválido), Pedro não tenta novamente — devolve falha estruturada imediatamente, diferente do laço de múltiplas tentativas da Maria.

## Como Pedro monta o prompt final de imagem

`buildFinalImagePrompt` (função pura exportada, testável isoladamente) combina: instruções de papel e limites ("gerar somente imagens; não criar estratégia, copy, direção de arte ou decisões de layout — seguir exatamente o briefing da Bianca"), a quantidade exata de imagens a gerar, o pedido original do usuário, a especificação de design completa da Bianca, o briefing que a Bianca preparou para Pedro, a identidade visual extraída da Clara (cores, fontes, estilo de imagem, diretrizes visuais, promessa e tom de voz da marca), o fluxo de aprovação quando registrado na Clara, canal, formato, proporção desejada, e o formato JSON obrigatório de resposta.

## Como Pedro gera imagem única

Quando `imageCount` é `1` (ou quando o Ícaro devolve apenas uma imagem), Pedro cria um único `SkillArtifact` do tipo `"image"`, com `status: "ready"`, `file` (mime type, extensão, tamanho em bytes quando persistido), `dimensions` (largura, altura, proporção) e `generation` (prompt, provider, modelo, custo, uso, duração). Esse artefato único é devolvido diretamente na lista `artifacts`, sem nenhum agrupamento.

## Como Pedro gera carrossel

Quando o Ícaro devolve mais de uma imagem, Pedro cria um `SkillArtifact` para cada imagem individual (todos do tipo `"image"`) e depois os agrupa dentro de um único artefato pai do tipo `"carousel"`, usando o novo campo genérico `items: SkillArtifact[]`. A lista `artifacts` da resposta contém, nesse caso, apenas esse artefato de carrossel — as imagens individuais ficam disponíveis em `artifacts[0].items`, evitando duplicação na lista plana. A decisão de agrupar é baseada na quantidade real de imagens devolvidas pelo Ícaro (mais de uma), não apenas no texto do campo `format`, para que o comportamento seja sempre consistente com o que foi de fato gerado.

## Como Pedro cria artefatos

Para cada imagem descrita pelo Ícaro, Pedro decide como resolver a referência ao arquivo: se uma `StoragePort` foi injetada e a resposta do Ícaro trouxe conteúdo em base64 (`data`), Pedro decodifica esse conteúdo e chama `storage.save({ name, data, mimeType })`, usando o `uri` devolvido pelo `StoredAsset` e calculando `sizeBytes` a partir dos bytes reais. Se nenhuma `StoragePort` foi configurada, Pedro nunca grava nada em disco por conta própria — ele apenas usa a referência (`uri`) que o próprio Ícaro/provider já tiver devolvido, se houver, e registra nas observações que nenhuma persistência local ocorreu. Isso cumpre literalmente a regra "Pedro não pode salvar em storage diretamente se não houver port apropriada": `StoragePort` já existia no projeto (declarada em `application/ports/storage.port.ts`) mas nunca tinha sido usada por nenhuma Skill; Pedro é o primeiro consumidor dela, sempre de forma opcional e sempre por injeção, nunca importando `node:fs` ou qualquer implementação de infraestrutura diretamente.

## Integração com Arthur, Caio e Helena

Arthur já reservava, desde o primeiro `ExecutionPlan`, uma etapa de "Geração de imagem" com `skillCapability: "image_generation"`, incluída no plano sempre que a intenção detectada envolve canais visuais. O manifesto de Pedro declara `capabilities: ["image_generation"]`, então ele ocupa exatamente essa etapa sem exigir nenhuma mudança em Arthur — o mesmo encaixe limpo que Sofia já teve com `art_direction`. O catálogo de planos da Valentina também já liberava `image_generation` no plano PRO e superiores. Helena descobre o manifesto de Pedro, valida, carrega a Skill e a executa somente quando solicitada por Arthur (via Caio).

## Como Pedro usa o output da Bianca

Os campos `biancaDesign` e `biancaPedroBriefing` da entrada de Pedro foram modelados para espelhar, por convenção, o formato real que Bianca já produz em sua saída (`BiancaDesignCore` e `BiancaPedroBriefing`). Por respeito ao isolamento entre Skills, Pedro não importa nenhum tipo do módulo de Bianca — ele declara seus próprios tipos `PedroBiancaDesignSummary` e `PedroBiancaBriefing`, comentados explicitamente como espelhos por convenção, fechando a mesma cadeia de "briefing autocontido para o próximo especialista" já estabelecida entre João → Sofia → Bianca e agora entre Bianca → Pedro. Diferente do elo anterior (Sofia → Pedro), `BiancaPedroBriefing`/`PedroBiancaBriefing` são deliberadamente literais planos (não interseções de tipos), justamente para que esse espelhamento continue verificável campo a campo pelo teste `organic-cycle.e2e.test.mjs`.

## Como futuras Skills poderão consumir os artefatos de Pedro

Qualquer Skill futura que precise trabalhar sobre uma imagem já gerada — uma Skill de publicação, por exemplo — pode consumir os artefatos de Pedro diretamente pela estrutura genérica do `SkillArtifact`, sem precisar conhecer nada específico de Pedro: `type` diz se é uma imagem única ou um carrossel; `file` diz o mime type, a extensão e o tamanho; `dimensions` diz a resolução e a proporção; `generation` diz o prompt, o provider, o modelo e o custo envolvidos; `items`, quando presente, lista as imagens individuais de um carrossel. Como toda essa evolução foi feita no contrato de domínio `SkillArtifact` — e não em um tipo específico de Pedro —, qualquer Skill futura herda automaticamente a mesma capacidade de descrever seus próprios artefatos visuais, sem precisar de mais nenhuma alteração de contrato.

Lucas (Especialista em Revisão de Qualidade, `docs/lucas-quality-review.md`) já é a primeira Skill real a consumir o output de Pedro, mas não importa o tipo `SkillArtifact` nem os tipos internos de Pedro diretamente — pelo mesmo princípio de isolamento entre Skills, ele espelha por convenção um resumo do formato de `PedroGeneratedImage` (mime type, extensão, largura, altura, proporção, texto alternativo, uri) em seu próprio tipo `LucasPedroImage`, focado no que é relevante para revisão de qualidade, não na estrutura completa de geração.
