# Zuno Release Candidate 1.0

Relatório da fase de polimento do Zuno: uma auditoria completa do projeto seguida da implementação de todas as melhorias necessárias para elevar a qualidade da experiência de uso — sem criar Skills, módulos ou funcionalidades novas, e sem alterar responsabilidades de arquitetura.

## Arquitetura atual

O Zuno é organizado em Clean Architecture com isolamento rígido entre Skills (ADR 0002: nenhuma Skill importa outra Skill diretamente — apenas `./` do próprio diretório, `../../application`, `../../domain` e `../../shared`) e uma fase local-first sem servidor, banco de dados ou infraestrutura externa (ADR 0003, com a ressalva registrada nesta rodada de que a CLI deixou de ser apenas preparação).

O fluxo real de execução é: **CLI** (`src/interfaces/cli`, `npm run zuno -- "<comando>"`) → **Arthur** (interpreta o comando e monta um `ExecutionPlan` com `inputBindings` declarativos por etapa) → **Caio** (executor de workflows: valida o plano, verifica antecipadamente se toda capability exigida tem Skill pronta, resolve os `inputBindings` contra a saída real de cada etapa concluída, pausa em `human_gate`, retoma via `resume`/`hydrateExecution`) → **Helena** (descobre, valida e carrega Skills reais por manifesto, executa por capability) → as sete **Skills** reais. **Valentina** (clientes, planos, limites, integrações) e **Clara** (conhecimento de marca/público/produto/identidade/publicação) são consultadas por praticamente toda Skill. **Ícaro** centraliza toda comunicação com IA por trás de `IcaroBrainPort`/`AIProviderPort`; nesta fase o único provider configurado é o `DeterministicFakeIcaroProvider`, determinístico e local.

Nenhuma violação de responsabilidade foi encontrada entre Arthur, Helena, Caio, Clara, Valentina, Ícaro e as sete Skills durante a auditoria: nenhum import cruzado entre Skills, nenhuma Skill decide algo que pertence a outra. A única sobreposição encontrada foi de **linguagem**, não de responsabilidade — o bloco de qualidade do prompt de Pedro cita "grid consistente" e "alinhamentos precisos" como critério de execução visual (ele está apenas instruído a renderizar corretamente o que a Bianca já decidiu, e seu prompt reforça explicitamente em "RESTRIÇÕES NEGATIVAS" que não deve alterar paleta, grid, hierarquia, estilo ou posicionamento definidos pela Bianca). Essa sobreposição foi avaliada e deliberadamente **não alterada**: mudar código que já está correto violaria a regra desta rodada de não fazer mudanças por preferência pessoal.

## Componentes existentes

- **Orquestração**: Arthur (`application/orchestration`), Caio (`application/workflows`), Helena (`application/skills`).
- **Domínio de suporte**: Valentina (`application/tenancy`), Clara (`application/knowledge`), Ícaro (`application/ai`).
- **Skills**: João (`marketing_strategy`/`strategy`), Maria (`copywriting`), Sofia (`art_direction`), Bianca (`social_media_design`), Pedro (`image_generation`), Lucas (`quality_review`), Ana (`social_publishing`).
- **Interface**: CLI (`src/interfaces/cli`) — único ponto de entrada real hoje; API e painel web continuam como preparação futura.
- **Infraestrutura**: repositórios em memória e em JSON local para Valentina e Clara, `LocalArtifactDelivery` para artefatos de Pedro, `DeterministicFakeIcaroProvider`, `MetaInstagramSocialPublisherAdapter` (adaptador real, sem credenciais configuradas).
- **Utilitários compartilhados**: `src/shared/utils/skill-parsing.ts` (novo nesta rodada — ver "Arquivos criados").

## Melhorias realizadas

### 1. Padronização entre Skills

- Extraídos os utilitários `latest()`, `extractJson()`, `normalizeStringArray()` e `normalize()` — antes duplicados quase verbatim em Maria, Sofia, Lucas, João, Bianca e Ana — para `src/shared/utils/skill-parsing.ts`. Remoção pura de duplicação, sem mudança de comportamento; Pedro manteve seu próprio `normalize` porque é genuinamente diferente (casamento de palavra-chave de papel/role, não normalização de texto livre).
- **Bug real corrigido em Lucas**: `sofiaDirection`, `biancaDesign` e `pedroImages` eram exigidos incondicionalmente na validação de entrada, mesmo quando o plano de Arthur nunca incluiu essas etapas (campanhas somente texto). Isso derrubava toda revisão de campanha sem componente visual com `INVALID_REQUEST`. Agora esses três campos são opcionais, exigidos apenas quando pelo menos um deles está presente (`hasVisualComponent`), e as validações internas (`evaluateVisual`, `evaluateImages`, comparações de `evaluateCoherence`, agregação de riscos) pulam silenciosamente o que não se aplica, em vez de reprovar.
- **Bug real corrigido em Ana**: `buildDrafts` acessava `input.sofiaDirection.visualConcept` sem guarda — mesma classe de bug do Lucas, ficaria latente até a primeira campanha somente texto com publicação chegar a essa etapa. Corrigido para `input.sofiaDirection?.visualConcept`.
- Ana ganhou `error.code: "CLIENT_NOT_FOUND"` dedicado (antes caía em `PUBLISHING_BLOCKED` genérico, inconsistente com as outras seis Skills), a ação de log `"Error"`, o evento `SocialPublishingContextLoaded` (para parear com `PublishingRulesConsulted`, no mesmo padrão `...Consultado`/`...ContextLoaded` das outras Skills), e log `PublicationFailed` por canal dentro do catch de `executePublication` (antes, uma exceção por canal só refletia no resultado agregado, sem deixar rastro em log).
- Todas as sete Skills agora seguem exatamente o mesmo padrão de tratamento de erro em `execute()`: validação de entrada inválida gera log `ValidationFailed` + evento `XFailed(reason: "INVALID_REQUEST")` antes de retornar; o corpo principal roda dentro de um try/catch de última instância que loga `"Error"` e emite `XFailed(reason: "UNEXPECTED_ERROR")` em vez de deixar uma exceção não tratada propagar até o catch genérico de Helena (`SKILL_EXECUTION_FAILED`), que perderia a identidade da Skill de origem.
- Corrigido texto do manifesto de Maria (`"Executar outra Skill diretamente."` → `"Chamar outra Skill diretamente."`, para bater com as outras seis) e atualizadas as descrições de saída em `joao`/`maria`/`pedro` (`.manifest.ts` e `skill.manifest.json`) para citar os campos e comportamentos que passaram a existir nesta e na rodada anterior.

### 2. Experiência do usuário — HTML de entrega do Pedro

O HTML segue sempre a mesma ordem: Preview (com zoom/lightbox) → Ações → Legenda → Hashtags → CTA → Resumo técnico da execução (com tempo, provider/modelo, tokens e custo estimado) → Relatório das Skills utilizadas → Gerar novamente → Publicar.

- **Preview com zoom e navegação**: cada imagem abre um overlay em tela cheia com zoom por clique, fecha com Esc ou clique fora; botões "Anterior"/"Próxima" aparecem apenas quando há mais de uma imagem (carrossel). JavaScript inline auto-contido, sem dependência nova.
- **Resumo de execução ampliado**: tempo de execução, provider e modelo usados, tokens consumidos e custo estimado — dados que já existiam na saída de Pedro mas nunca haviam sido passados para o HTML.
- **Gerar novamente**: mostra e copia o comando `npm run zuno -- "<originalRequest>" --client-id <clientId>`.
- **Publicar**: mostra e copia `npm run zuno -- --approve <executionId>`, mas somente quando o plano do Caio inclui uma etapa de `social_publishing` (`workflowContext.publishingEnabled`, um booleano genérico injetado por Caio — Pedro nunca sabe o que é "Ana" ou "publicação social", apenas lê esse flag).
- Decisão de produto validada com o usuário: como não há servidor nesta fase e criar um seria funcionalidade nova, "Gerar novamente" e "Publicar" viram botões que copiam o comando exato da CLI, com o comando também visível como texto — o HTML continua estático.

### 3. Qualidade visual (fronteira Sofia → Bianca → Pedro)

Revisão confirmou que Pedro não toma nenhuma decisão de layout: seu prompt final instrui explicitamente "siga exatamente o briefing de design da Bianca" e lista em restrições negativas a proibição de alterar paleta, grid, hierarquia, estilo ou posicionamento. Nenhuma mudança de código foi feita aqui — ver nota em "Arquitetura atual".

### 4. Consistência entre cenários

- **Checagem prévia de capabilities em Caio**: antes de executar qualquer etapa, `findMissingCapabilities(plan)` verifica com Helena se toda capability do plano tem Skill pronta. Se faltar alguma, o workflow falha imediatamente (`FAILED`) com uma mensagem consolidada listando todas as capabilities faltantes, sem executar nenhuma etapa e sem gastar chamadas de IA em etapas que rodariam antes do ponto de falha.
- **Aliases de canal/palavra-chave mais robustos em Arthur**: `stories` ganhou o singular `story`; a etapa de carrossel ganhou os plurais/variações `carrosseis`, `carousels`, `slide` (antes só reconhecia `carrossel`, `carousel`, `slides`). Isso elimina variação de resultado dependendo de como a pessoa escreve o comando para a mesma intenção.
- Os nove cenários citados no pedido (post único, carrossel, campanha, anúncio, stories, institucional, venda, educativo, lançamento) foram executados manualmente pela CLI após as correções — resultado na seção "Validações executadas".

### 5. Performance

- `ClaraKnowledgeCenter.list()`/`.search()` clonavam duas vezes (uma no repositório em memória, outra no próprio `ClaraKnowledgeCenter`); removido o `.map(clone)` redundante.
- Substituído o round-trip manual `JSON.parse(JSON.stringify(...))` por `structuredClone()` nativo (mais rápido, disponível desde Node 20) em cinco pontos: `valentina-tenant-manager.ts`, `clara-knowledge-center.ts`, `valentina-plan-catalog.ts`, `in-memory-clara-knowledge-repository.ts`, `in-memory-valentina-tenant-repository.ts`. Troca mecânica, mesmo comportamento observável.
- Nenhuma mudança estrutural foi feita em `versions[]`/`history[]` da Valentina (paginação/poda) — mudaria o contrato de auditoria observável, fora do escopo seguro desta rodada; registrado como recomendação para v2.0.

### 6. Arquitetura

Confirmado, sem exceções: nenhum componente assume a responsabilidade de outro entre Arthur, Helena, Caio, Clara, Valentina, Ícaro e as sete Skills. Ver detalhamento em "Arquitetura atual".

### 7. Segurança

- **Path traversal**: `local-json-clara-knowledge-repository.ts` e `local-json-valentina-tenant-repository.ts` agora validam o `filePath` recebido no construtor (`sanitizeFilePath`), rejeitando caminho vazio/só espaços e caminhos contendo o caractere nulo (`\0`) — mesma disciplina que `local-artifact-delivery.ts` já aplicava.
- **Token exposto em texto puro no histórico**: cada `connectIntegration` da Valentina gravava o `tokenReference` não só no estado atual, mas também, em texto puro, em `history[]` e `versions[]`, que nunca são podados. Agora `tokenReference` é mascarado (`••••` + últimos 4 caracteres) especificamente dentro dos snapshots gravados em `history[]`/`versions[]`, via `maskTokenReferencesDeep`; o valor real permanece íntegro no estado atual (`integrations`), único lugar de onde precisa ser lido operacionalmente.
- Validação de entrada e isolamento entre Skills já eram consistentes antes desta rodada (confirmado pela auditoria); nenhuma mudança foi necessária.

### 8. Documentação

Onze arquivos atualizados para refletir o estado atual exatamente: `README.md` (CLI real, encadeamento automático, `resume`), `src/interfaces/README.md` e `src/interfaces/cli/README.md` (CLI deixou de ser "futuro"; checagem prévia de capabilities documentada), `docs/joao-marketing-strategy.md` (encadeamento automático via `inputBindings`, novos campos do `mariaBriefing`), `docs/caio-workflow-executor.md` (checagem prévia de capabilities, `inputBindings`/`resolveStepInput`, `resume`/`hydrateExecution`, `publishingEnabled`), `docs/arthur-orchestrator.md` (`inputBindings` por etapa, aliases mais robustos, Skills reais vs. futuras), `docs/maria-copywriting.md` (`forbiddenTerms`/`mandatoryWords`/`preferredHashtags`, `MISSING_MANDATORY_WORD`), `docs/pedro-image-generation.md` (ordem final do HTML, zoom/navegação, resumo com tempo/consumo, comandos), `docs/lucas-quality-review.md` (campos visuais opcionais, comportamento em campanhas somente texto), `docs/organic-cycle-e2e.md` (reescrito por completo — descrevia um encadeamento manual já substituído desde a rodada anterior por Arthur/Caio/Helena reais, mas o documento nunca havia sido atualizado), `docs/adr/0003-local-first-no-infrastructure.md` (nota registrando que a CLI deixou de ser só preparação). Nenhum documento estava inteiramente obsoleto a ponto de ser removido.

### 9. Testes

28 testes novos (214 → 242), cobrindo exatamente os gaps encontrados pela auditoria — detalhados em "Novos testes".

## Arquivos alterados

**Skills:**
`src/skills/lucas-quality-review/lucas-quality-review.skill.ts`, `lucas-quality-review.types.ts`, `lucas-log.contract.ts`
`src/skills/ana-social-publishing/ana-social-publishing.skill.ts`, `ana-social-publishing.types.ts`, `ana-log.contract.ts`
`src/skills/pedro-image-generation/pedro-image-generation.skill.ts`, `pedro-log.contract.ts`, `pedro.manifest.ts`, `skill.manifest.json`
`src/skills/maria-copywriting/maria-copywriting.skill.ts`, `maria-log.contract.ts`, `maria.manifest.ts`, `skill.manifest.json`
`src/skills/sofia-art-direction/sofia-art-direction.skill.ts`, `sofia-log.contract.ts`
`src/skills/bianca-social-media-design/bianca-social-media-design.skill.ts`, `bianca-log.contract.ts`
`src/skills/joao-marketing-strategy/joao-marketing-strategy.skill.ts`, `joao-log.contract.ts`, `joao.manifest.ts`, `skill.manifest.json`

**Orquestração:**
`src/application/workflows/caio.executor.ts`
`src/application/orchestration/arthur.orchestrator.ts`
`src/application/events/zuno-event.contract.ts`

**Conhecimento e clientes:**
`src/application/knowledge/clara-knowledge-center.ts`
`src/application/tenancy/valentina-tenant-manager.ts`
`src/application/tenancy/valentina-plan-catalog.ts`

**Infraestrutura:**
`src/infrastructure/storage/local-json-clara-knowledge-repository.ts`
`src/infrastructure/storage/local-json-valentina-tenant-repository.ts`
`src/infrastructure/storage/in-memory-clara-knowledge-repository.ts`
`src/infrastructure/storage/in-memory-valentina-tenant-repository.ts`

**Testes:**
`tests/lucas-quality-review.test.mjs`, `tests/ana-social-publishing.test.mjs`, `tests/pedro-image-generation.test.mjs`, `tests/maria-copywriting.test.mjs`, `tests/sofia-art-direction.test.mjs`, `tests/bianca-social-media-design.test.mjs`, `tests/joao-marketing-strategy.test.mjs`, `tests/caio.workflow-executor.test.mjs`, `tests/valentina-tenant-manager.test.mjs`, `tests/clara-knowledge-center.test.mjs`, `tests/cli.smoke.test.mjs`, `tests/organic-cycle.e2e.test.mjs`

**Documentação:**
`README.md`, `src/interfaces/README.md`, `src/interfaces/cli/README.md`, `docs/joao-marketing-strategy.md`, `docs/caio-workflow-executor.md`, `docs/arthur-orchestrator.md`, `docs/maria-copywriting.md`, `docs/pedro-image-generation.md`, `docs/lucas-quality-review.md`, `docs/organic-cycle-e2e.md` (reescrito), `docs/adr/0003-local-first-no-infrastructure.md`

## Arquivos criados

- `src/shared/utils/skill-parsing.ts` — utilitários `latest()`, `extractJson()`, `normalizeStringArray()`, `normalize()`, extraídos de seis Skills que os duplicavam quase verbatim.
- `docs/zuno-release-candidate-1.0-report.md` — este relatório.

## Novos testes

- **Lucas**: revisão de campanha somente texto completando com sucesso e score 100 sem penalizar itens visuais; testes dedicados para os issue codes `NO_RISKS_DOCUMENTED`, `IMAGE_COUNT_MISMATCH`, `ASPECT_RATIO_MISMATCH`, `FORMAT_MISMATCH`, `CHANNEL_MISMATCH`; teste do prompt de IA com bloco de padrão de qualidade/restrições negativas.
- **Ana**: `overallStatus: "partially_published"`; log `PublicationFailed` por canal quando o publisher lança exceção (`PUBLISH_EXCEPTION`); `overallStatus: "failed"` quando todos os canais falham.
- **Maria**: validação de entrada inválida (`INVALID_BRIEFING` + `ValidationFailed` + `CopyGenerationFailed`); logs esperados em execução completa; eventos esperados em execução completa; isolamento ("não chama outra Skill diretamente") — nenhum desses existia antes, Maria era a única Skill sem eles.
- **Sofia, Bianca, João, Pedro**: teste de validação de entrada inválida estendido para também afirmar o log `ValidationFailed` e o evento de falha correspondente.
- **Caio**: falha imediata e consolidada quando o plano exige capability sem Skill pronta (nenhuma etapa executada, nenhuma chamada a Helena); consolidação de múltiplas capabilities faltantes numa única mensagem; injeção de `publishingEnabled: true`/`false` no `workflowContext` de cada etapa conforme o plano incluir ou não `social_publishing`.
- **Pedro**: zoom/lightbox presente sem botões de navegação para uma única imagem; botões "Anterior"/"Próxima" presentes para carrossel; tempo de execução, provider/modelo, tokens e custo no resumo técnico; comando de "Gerar novamente" sempre presente; comando de "Publicar" aparecendo/desaparecendo conforme `publishingEnabled`; validação de entrada inválida.
- **Valentina**: `tokenReference` mascarado em `versions`/`history`, íntegro no estado atual; `LocalJsonValentinaTenantRepository` rejeita caminho vazio ou com caractere inválido.
- **Clara**: `LocalJsonClaraKnowledgeRepository` rejeita caminho vazio ou com caractere inválido.
- **CLI**: comando que exige capability sem Skill implementada falha imediatamente com mensagem consolidada, sem aparecer em `--list` como aguardando aprovação.

## Validações executadas

- `npm run typecheck` — sem erros.
- `npm test` — 242/242 testes passando (0 falhas), depois de cada bloco de mudança e novamente ao final.
- `npm run architecture:check` — build completo + descoberta real das sete Skills em `dist/skills`, cada capability resolvendo para a Skill correta.
- Os nove cenários pedidos, rodados manualmente pela CLI local após todas as correções:

| Cenário | Comando (resumo) | Resultado |
|---|---|---|
| Post único | "crie um post único para o Rumo ao Altar no Instagram" | `WAITING_HUMAN_APPROVAL` — todas as 6 etapas de conteúdo completas |
| Carrossel | "crie um carrossel de lançamento do Rumo ao Altar" | `FAILED` imediato — `carousel_creation` sem Skill, mensagem consolidada, nenhuma etapa executada |
| Campanha | "crie uma campanha de marketing para o Rumo ao Altar" | `FAILED` imediato — `campaign_management` sem Skill |
| Anúncio | "crie um anuncio de venda para o Rumo ao Altar" | `FAILED` imediato — `campaign_management` sem Skill (anúncio pago é gestão de campanha, por desenho) |
| Stories | "crie um story institucional para o Rumo ao Altar" | `WAITING_HUMAN_APPROVAL` — confirma a correção do alias singular `story` |
| Institucional | "crie uma publicação institucional apresentando o Rumo ao Altar" | `WAITING_HUMAN_APPROVAL` |
| Venda | "crie uma publicação de venda para o pacote all-inclusive" | `WAITING_HUMAN_APPROVAL` |
| Educativo | "crie um post educativo sobre presentes via pix" | `WAITING_HUMAN_APPROVAL` (sem etapa de publicação — nenhum canal social foi mencionado no comando) |
| Lançamento | "crie uma publicação de lançamento do Rumo ao Altar no Instagram" | `WAITING_HUMAN_APPROVAL` → aprovado → `COMPLETED`, HTML final conferido com todas as seções (lightbox, resumo técnico, relatório de Skills, comandos de regenerar/publicar) |

Os três cenários que falham (carrossel, campanha, anúncio) falham pelo mesmo motivo documentado — capability sem Skill implementada — e falham **imediatamente**, com a mesma mensagem consolidada, sem executar nenhuma etapa nem gastar chamada de IA. Os seis cenários restantes completam com o mesmo nível de qualidade e as mesmas seções no HTML de entrega.

## Cobertura atual

242 testes automatizados, 0 falhas, distribuídos por componente:

| Componente | Testes |
|---|---|
| Ana (publicação social) | 33 |
| Lucas (revisão de qualidade) | 29 |
| Pedro (geração de imagens) | 29 |
| Bianca (design para redes sociais) | 20 |
| João (estratégia de marketing) | 18 |
| Sofia (direção de arte) | 18 |
| Caio (executor de workflows) | 17 |
| Maria (copywriting) | 15 |
| Valentina (gerente de clientes) | 12 |
| Skills discovery (Helena/manifestos) | 13 |
| Ícaro (cérebro de IA) | 8 |
| Clara (centro de conhecimento) | 8 |
| Meta/Instagram (adaptador social) | 8 |
| Helena (gerente de Skills) | 5 |
| Arthur (orquestrador) | 4 |
| CLI (smoke tests) | 4 |
| Ciclo orgânico (e2e completo) | 1 |

## Desempenho estimado

Sem instrumentação de carga formal nesta fase (fora de escopo razoável para esta rodada — ver "Pendências restantes"). Com base nas otimizações aplicadas e nos tempos observados rodando a suíte e a CLI localmente:

- Remoção do clone duplicado em `ClaraKnowledgeCenter.list()`/`.search()`: elimina uma travessia completa e uma serialização/desserialização redundante por chamada, proporcional ao tamanho da base de conhecimento do cliente.
- `structuredClone()` no lugar de `JSON.parse(JSON.stringify(...))` em cinco pontos de clonagem: `structuredClone` é nativo do V8/Node e evita o custo de duas passagens de serialização de texto; o ganho é mais perceptível quanto maior o histórico (`versions`/`history`) do tenant, já que cada clonagem de `TenantRecord` carrega esse histórico inteiro.
- A suíte completa de 242 testes roda em pouco mais de 1,4s localmente; uma execução completa da CLI (Arthur → Caio → Helena → 6-8 Skills, incluindo geração de imagem fake) leva algumas centenas de milissegundos por etapa, majoritariamente dominado pelo `DeterministicFakeIcaroProvider` (que já simula latência) — não há gargalo identificado fora do que é inerente a chamadas de IA reais que substituirão o fake no futuro.

## Pendências restantes

- Nenhum teste de carga/performance formal foi criado nesta rodada (registrado como fora de escopo razoável).
- `versions[]`/`history[]` da Valentina continuam sem paginação ou poda — crescem indefinidamente por tenant.
- A checagem prévia de capabilities do Caio verifica apenas se existe *alguma* Skill registrada para a capability, não se essa Skill está de fato habilitada/saudável em tempo de execução (isso já era tratado por Helena separadamente e não fazia parte do escopo desta rodada).

## Riscos conhecidos

- O provider de IA em uso (`DeterministicFakeIcaroProvider`) é inteiramente determinístico e local — nenhum risco de custo ou disponibilidade externa hoje, mas também nenhuma validação real de qualidade de geração de texto/imagem por um modelo real.
- `MetaInstagramSocialPublisherAdapter` existe como adaptador real, mas sem credenciais configuradas; qualquer publicação real na Meta continua bloqueada até essa configuração existir.
- Comandos que tocam capabilities sem Skill (`carousel_creation`, `campaign_management`, `metrics_analysis`, `optimization`, `video_creation`) falham de forma limpa e imediata, mas continuam **indisponíveis** — isso é uma limitação de escopo conhecida, não um bug.

## Limitações atuais

- Sem servidor, painel web ou API real — único ponto de entrada é a CLI local.
- Sem persistência em banco de dados — Valentina e Clara persistem em JSON local (`.zuno-data/`) ou em memória.
- "Gerar novamente" e "Publicar" no HTML de entrega são comandos para copiar e colar na CLI, não ações ao vivo — decisão deliberada para não introduzir servidor nesta fase.
- Cinco capabilities reservadas por Arthur (`carousel_creation`, `campaign_management`, `metrics_analysis`, `optimization`, `video_creation`) não têm Skill implementada.

## Itens recomendados para versão 2.0

- Paginação ou poda de `versions[]`/`history[]` da Valentina, hoje ilimitados por tenant.
- Skills reais para `carousel_creation`, `campaign_management`, `metrics_analysis`, `optimization` e `video_creation` — as capabilities já são reservadas e roteadas por Arthur/Caio, faltando apenas a implementação.
- Provider real de IA por trás de `IcaroBrainPort`/`AIProviderPort`, no lugar do `DeterministicFakeIcaroProvider`.
- Credenciais reais e ativação de `MetaInstagramSocialPublisherAdapter` para publicação de verdade.
- Servidor/API local para transformar "Gerar novamente" e "Publicar" em ações ao vivo no HTML, em vez de comandos para copiar.
- Testes de carga/performance formais, especialmente para o crescimento de `versions[]`/`history[]` da Valentina e para o volume de conhecimento por cliente na Clara.
