# Rafa, Especialista em Renderização/Geração de Vídeo

Rafa é a décima primeira Skill real do Zuno e a quarta etapa de uma pipeline de vídeo própria: João → Bruno → Vanessa → Diego → Rafa → Lucas → Ana. Ele é uma Skill operacional: transforma o plano técnico de edição produzido por Diego em um pacote de vídeo pronto para renderização. Rafa tem hoje **dois modos**: renderização automática local (padrão, via `VideoRenderingPort` — ver `docs/video-rendering.md`) e **Developer Assisted Mode** (o mecanismo original, também usado por Pedro na pipeline de imagens, mantido como fallback quando faltam assets visuais por cena ou quando a renderização automática falha).

Rafa é exclusivamente Renderizador: prompt técnico final, caminho esperado do arquivo final, especificações técnicas (formato, resolução, duração, proporção, fps, codecs), assets necessários, instruções finais de renderização e o registro do artefato de vídeo depois que o arquivo real é validado. Rafa **não** cria roteiro (isso é exclusivo do Bruno), **não** dirige vídeo (isso é exclusivo da Vanessa), **não** edita o conteúdo conceitualmente (não redefine a timeline, cortes, legendas ou textos na tela definidos por Diego), **não** publica vídeo e **não** chama nenhuma API externa de vídeo. Para imagens por cena, Rafa conhece apenas `VisualAssetResolverPort`; quem sabe buscar em biblioteca local/provedor por manifesto é a infraestrutura, documentada em `docs/visual-asset-resolver.md`. Rafa também não define layout, grid, paleta ou tipografia de peças visuais estáticas (isso continua sendo exclusivo de Sofia/Bianca, na pipeline de imagens) e não executa nem chama outra Skill diretamente — e **nunca importa nada de `src/infrastructure/`**: só conhece `VideoRenderingPort`, `VisualAssetResolverPort` e `ArtifactDeliveryPort`, todos contratos de aplicação.

## Renderização automática local (padrão) e Developer Assisted Mode (fallback)

Desde a v1.1, Rafa prefere renderizar localmente e automaticamente, sempre que uma `VideoRenderingPort` está configurada (o padrão em `LOCAL_PRODUCTION`) — ver a arquitetura completa, a "compilação" da timeline em filtros do FFmpeg e as garantias de segurança em `docs/video-rendering.md`. Isso substitui a antiga premissa "não existe provider real de vídeo, então só resta o modo assistido": agora existe uma forma real, local e automática de gerar o MP4 final para motion graphics (fundos, texto, legendas, CTA, logo, transições, zoom/pan) — só não cobre filmagem real ou geração por IA, que continuam exigindo Developer Assisted Mode.

`videoRendering` é uma dependência **opcional** de Rafa (mesmo padrão que `artifactDelivery`): ausente, Rafa se comporta exatamente como antes desta mudança — 100% Developer Assisted Mode, código antigo inalterado. Presente, Rafa tenta renderizar localmente primeiro e só cai para o modo assistido quando um asset explicitamente pedido está ausente ou a renderização falha — nesse caso, o restante deste documento (pausa, retomada, validação de MP4) se aplica normalmente, sem nenhuma mudança de comportamento.

No `LOCAL_PRODUCTION`, comandos como `npm run zuno -- --mode local-production "crie um vídeo para Reels de 30 segundos"` hoje só pausam quando falta contexto/IA desenvolvedora nas etapas anteriores, aprovação humana ou **asset visual real**. No caminho feliz, o resolver escolhe imagens por cena, Rafa renderiza localmente e o workflow segue direto para Lucas/aprovação. A pausa assistida continua existindo e sendo testada de ponta a ponta (`ZUNO_VIDEO_RENDER_MODE=developer_assisted` força o modo antigo, usado especificamente pelos testes automatizados). Nenhum provider externo de vídeo é chamado em nenhum dos dois modos, e nenhum arquivo é enviado para hospedagem pública.

## Responsabilidade

Rafa recebe uma solicitação de renderização — o pedido original do usuário, a estratégia completa do João, o roteiro estruturado que Bruno já prepara, a direção audiovisual estruturada que Vanessa já prepara, e o plano técnico de edição estruturado que Diego já prepara pensando nesta etapa — e devolve um pacote de renderização completo: prompt técnico final, caminho esperado, especificações técnicas, assets necessários, instruções finais de renderização, riscos, observações, próximos passos e — só depois que o vídeo real existir e for validado — o artefato de vídeo registrado.

## Contrato de entrada

A entrada de Rafa é `RafaVideoRenderingRequestInput`:

- `clientId` ou `tenantId` (pelo menos um dos dois é obrigatório);
- `originalRequest`: o pedido original do usuário, em texto livre;
- `joaoStrategy`: a estratégia completa produzida pelo João (`RafaJoaoStrategySummary`);
- `brunoScript`: o roteiro estruturado que Bruno prepara para a etapa de direção (`RafaBrunoScriptSummary`), com cenas contendo texto falado, texto na tela e duração;
- `vanessaDirection`: a direção audiovisual estruturada que Vanessa prepara (`RafaVanessaDirectionSummary`), com o mapa de cenas contendo enquadramento, composição, câmera, transição e efeitos visuais;
- `diegoEditingPlan`: o plano técnico de edição estruturado que o próprio Diego já monta pensando em Rafa (`RafaDiegoEditingPlanSummary`), com a timeline completa (cortes, legendas, textos na tela, transições, efeitos, trilha, assets, instruções, checklist);
- `channel`: canal desejado para este vídeo;
- `format`: formato desejado, em texto livre (por exemplo "reels", "tiktok", "shorts");
- `videoObjective`: o objetivo específico deste vídeo, em texto livre;
- `workflowContext`: contexto opcional adicional vindo do workflow.

Rafa é a segunda Skill da pipeline de vídeo a fazer fan-in de múltiplas etapas anteriores (depois de Diego, que faz fan-in de duas), aqui com **três** entradas simultâneas — roteiro, direção e plano de edição — porque a validação e o prompt final de renderização se beneficiam do contexto completo de toda a cadeia, não apenas do briefing agregado mais recente.

## Contrato de saída

Enquanto o vídeo esperado não existe ou não é válido, Rafa devolve `status: "needs_assisted_generation"` com `RafaAssistedGenerationOutput`:

- `mode: "developer_assisted"`;
- `instruction`: instrução textual para a IA desenvolvedora;
- `pendingVideos`: lista de `RafaAssistedVideoRequest` pendentes (nesta primeira versão sempre um único item — ver "Múltiplas variações futuras" abaixo);
- `resumeCommand`: o comando exato para retomar (`npm run zuno -- --continue <executionId>`).

Quando o vídeo é validado com sucesso, Rafa devolve `status: "completed"` com `RafaVideoRenderingOutput`:

- `generationSummary`, `finalPrompt`, `expectedRelativePath`;
- `specs`: especificações técnicas (`RafaVideoSpecs` — formato, largura, altura, resolução, proporção, duração, fps, codec de vídeo, codec de áudio);
- `requiredAssets`: herdado diretamente do plano de Diego;
- `renderingInstructions`: instruções finais de renderização, síntese própria de Rafa;
- `video`: o `RafaGeneratedVideo` registrado (id, índice, nome do arquivo, mimeType, extensão, specs, tamanho em bytes, major brand do MP4, caminhos);
- `generationMode: "developer_assisted" | "local_render"` (ver seção anterior);
- `executionDurationMs`, `warnings`, `observations`, `nextSteps`;
- `renderTimeMs`/`renderLogsSummary`: só preenchidos quando `generationMode === "local_render"` — tempo real de renderização e últimas linhas de log do FFmpeg.
- `visualAssets`: assets reais escolhidos ou criados para cada cena, com origem, licença, tags, proporção, score e breakdown;
- `visualAssetReportPath`: caminho relativo para `visual-assets/asset-report.json`, relatório local de assets resolvidos/pendentes.

Quando a solicitação é inválida ou a Valentina não encontra o cliente, Rafa devolve `status: "failed"`. Quando a Clara devolve contexto insuficiente (sem `IdentityContext` e sem `BrandContext`), Rafa devolve `status: "needs_more_context"`.

## Como Rafa usa o plano do Diego

Rafa consome exatamente o campo `rafaBriefing` que o próprio Diego já monta pensando nesta etapa (`DiegoRafaBriefing`), o mesmo padrão de "briefing autocontido para o próximo especialista" que toda a cadeia já usa. A `editingTimeline` de Diego entra integralmente no prompt final de renderização — Rafa nunca a redefine, apenas a serializa junto das especificações técnicas para a IA desenvolvedora seguir. `requiredAssets` de Diego é reaproveitado literalmente na saída de Rafa (não recriado). Por respeito ao isolamento entre Skills (ADR 0002), Rafa não importa nenhum tipo de Diego — define seus próprios tipos espelhados `RafaDiegoEditingPlanSummary`/`RafaEditingTimelineEntry`.

## Especificações técnicas (9:16, 4:5 ou 1:1 — conforme canal/formato)

`buildVideoSpecs` deixou de fixar 1080x1920: a resolução/proporção vem da mesma autoridade única que Sofia/Pedro/Bianca já usam para imagens (`resolveAspectRatio`/`resolutionForAspectRatio`, `src/shared/utils/aspect-ratio.ts`), a partir de `channel`/`format` — 9:16 para Reels/Stories/TikTok/Shorts, 4:5 para feed vertical, 1:1 para feed quadrado. `fps: 30` e `videoCodec: "H.264 (libx264)"` continuam fixos. `audioCodec: "AAC"` é o valor pedido no prompt técnico do modo assistido; no modo de renderização local, o `audioCodec`/`hasAudio` reais (que podem não ter trilha) vêm do `VideoRenderResult` do adaptador, não desta função. `durationSeconds` continua herdado diretamente de `diegoEditingPlan.totalDurationSeconds` — nunca inventada por Rafa.

## Como funciona o Developer Assisted Mode para vídeo

1. Rafa monta `finalPrompt` — um prompt técnico completo citando especificações, estratégia, roteiro, direção e plano de edição, com restrições negativas explícitas (não alterar timeline/cortes/legendas de Diego, não alterar enquadramento/composição/cor de Vanessa, não alterar texto/estrutura de Bruno, não publicar, não chamar API externa).
2. Monta o pedido de vídeo esperado (`RafaAssistedVideoRequest`) com `expectedRelativePath: "videos/final-video.mp4"` — que, resolvido pela `ArtifactDeliveryPort` (raiz `artifacts/`), corresponde exatamente ao caminho padrão pedido: `artifacts/<executionId>/videos/final-video.mp4`.
3. Chama `ArtifactDeliveryPort.readFile` para verificar se o arquivo já existe — nunca via `child_process`, nunca executando um comando externo.
4. Se o arquivo não existe: devolve `needs_assisted_generation` com o vídeo pendente.
5. Se o arquivo existe: valida como um MP4 real e plausível (ver próxima seção). Se inválido, continua pendente (com o motivo da rejeição nos `warnings`). Se válido, finaliza a execução e registra o artefato.

## Como ocorre a pausa

Igual ao Pedro: quando Rafa devolve `needs_assisted_generation`, Caio (que não conhece nem precisa conhecer o formato específico de Rafa — o mecanismo é inteiramente genérico) marca a etapa como `WAITING`, o workflow como `WAITING_ASSISTED_GENERATION`, registra `report.waitingForStepId` e emite `WorkflowPaused` com `reason: "assisted_generation"`. A CLI lê os campos genéricos (`pendingImages` para Pedro, `pendingVideos` para Rafa) sem importar o tipo de nenhuma das duas Skills, e imprime o caminho esperado, as especificações (resolução/duração/fps quando for vídeo) e o prompt completo para a IA desenvolvedora.

## Como ocorre a retomada

`npm run zuno -- --continue <executionId>` chama `Caio.resumeAssistedGeneration`, que apenas devolve a etapa parada para `PENDING` e deixa o workflow reexecutá-la — sem nenhuma lógica especial sobre o que está sendo esperado. Rafa é executado de novo do zero (`execute` → `runRendering` → `runAssistedGeneration`), verifica o arquivo outra vez e decide: se ainda não existe ou não é válido, pausa de novo com a mesma instrução (retomada sempre segura e idempotente); se existe e é válido, completa a execução.

## Como o vídeo é validado

`validateMp4Bytes` verifica, sem nenhuma dependência externa:

1. **Extensão**: o caminho relativo precisa terminar em `.mp4`.
2. **Tamanho mínimo**: rejeita arquivos com menos de 100KB — um limiar deliberadamente conservador para rejeitar placeholders triviais (arquivo vazio, arquivo de poucos bytes) sem depender de decodificar o vídeo.
3. **Assinatura de arquivo**: confere que os bytes 4-7 formam a caixa `ftyp`, presente em todo container ISO Base Media/MP4 real — o mesmo espírito da verificação de assinatura PNG que o Pedro já faz, adaptado ao formato de container de vídeo.
4. **Metadado básico quando possível**: extrai o *major brand* da caixa `ftyp` (bytes 8-11, ex.: `isom`, `mp42`) e o inclui no artefato registrado, como metadado informativo.

**Limitação explícita**: Rafa não faz parsing completo de metadados de vídeo — duração, resolução, fps e codecs reais do arquivo renderizado não são extraídos nem confirmados contra as especificações pedidas. Fazer isso exigiria um parser MP4 completo (percorrer a árvore de caixas `moov`/`mvhd`/`trak`), fora do escopo desta primeira versão. A duração usada no restante do fluxo (`specs.durationSeconds`) vem do plano de Diego, não de uma leitura real do arquivo — essa limitação está documentada tanto no código (`buildObservations`) quanto na saída (`observations`) de toda execução.

## Como o artefato de vídeo é registrado

Somente depois que `validateMp4Bytes` aprova o arquivo, Rafa monta um `SkillArtifact` com `type: "video"` (novo valor adicionado a `SKILL_ARTIFACT_TYPES`, ao lado de `"image"`/`"carousel"` que o Pedro já usa), `status: "ready"`, `file` (mimeType, extensão, tamanho, caminho local), `dimensions` (largura/altura/proporção das especificações, não do arquivo), `generation` (prompt, `provider: "developer-assisted"`, `model: "claude-code-developer-assisted"`, custo e uso zerados — nenhuma IA foi consultada para gerar frames) e `metadata` (clientId, canal, duração, major brand). O artefato só existe na resposta quando o status é `completed` — nunca antes, e nunca com dados fabricados.

## Múltiplas variações futuras

O pedido original exige "permitir múltiplas variações futuras". `RafaAssistedVideoRequest`/`pendingVideos` são, deliberadamente, uma lista — não um único objeto — desde a primeira versão, mesmo que hoje `buildAssistedVideoRequests` sempre devolva exatamente um item (`videos/final-video.mp4`, índice `0`). Isso permite que uma versão futura gere, por exemplo, `videos/variation-01.mp4`/`videos/variation-02.mp4` sem quebra de contrato — mas a lógica de aceitação de Rafa hoje (`finalizeRendering`) assume um único vídeo aceito; suportar múltiplas variações de verdade exigirá revisar essa lógica também, não é automático.

## Integração com Valentina e Clara

Rafa usa exclusivamente `ValentinaTenantPort.getClientContext`/`getTenant` (mesma lógica de resolução de cliente das demais Skills) e `ClaraKnowledgePort.requestContext`, com os mesmos três módulos que Pedro consulta (`BrandContext`, `IdentityContext`, `PublishingContext`) — Rafa está posicionado de forma análoga a Pedro na cadeia (a etapa que produz um artefato de mídia final), então reaproveita a mesma necessidade de contexto.

## Integração com Arthur, Caio e Helena

Arthur reconhece a capability `video_rendering` em cascata: sempre que `video_editing` é necessária (que por sua vez já é encadeada a partir de `video_direction`, encadeada a partir de `video_script`), Arthur automaticamente também requer `video_rendering`. A etapa "Renderização de vídeo" depende exclusivamente da etapa "Edição de vídeo" (`dependsOn: [videoEditingStepId]`) e recebe `joaoStrategy`, `brunoScript` (a partir de `vanessaBriefing`), `vanessaDirection` (a partir de `diegoBriefing`) e `diegoEditingPlan` (a partir de `rafaBriefing`) por `inputBinding`. Como Lucas ainda não sabe revisar vídeo, essa etapa **não** alimenta a Revisão nem a Aprovação — ela existe no plano de forma independente da pipeline de imagens, que continua funcionando exatamente como antes. Helena descobre o manifesto de Rafa, valida, carrega a Skill e a executa somente quando solicitada por Arthur (via Caio) — nenhuma mudança foi necessária em Caio: o mecanismo de pausa/retomada por geração assistida já era genérico o suficiente para qualquer Skill, não só o Pedro.

## Limitações desta etapa

Rafa é o quarto componente operacional da pipeline de vídeo nesta fase. Depois dele, Lucas já revisa o pacote de vídeo e Ana já aceita o artefato do Rafa dentro da mesma capability `social_publishing`, sempre em `local_ready`/`dry_run` no `LOCAL_PRODUCTION`, **em qualquer um dos dois modos de geração**. A pipeline, portanto, cobre João → Bruno → Vanessa → Diego → Rafa → Lucas e inclui Ana apenas quando o usuário pede publicação explicitamente. No modo assistido, Rafa ainda não faz parsing real de metadados complexos do arquivo renderizado (ver seção "Como o vídeo é validado"); no modo de renderização local, a resolução/fps/duração/codec reportados vêm do que o próprio adaptador mandou o FFmpeg produzir, não de um parser de metadados do arquivo final. Detalhes completos da renderização automática local (arquitetura, segurança, limitações) em `docs/video-rendering.md`.
