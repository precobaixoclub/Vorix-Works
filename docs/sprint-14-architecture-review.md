# Sprint 14 — Revisão Arquitetural Antes de Código

Esta revisão cobre a Fase 1 do Prompt 14. Nenhuma implementação funcional deve começar antes da
aprovação explícita desta revisão.

## Estado Atual

Fluxo atual:

`Conversation -> Briefing -> PreparedCommand -> Planning -> Runtime -> Execution -> Handler Resolver -> Skill Handler -> Skills reais -> ExecutionArtifacts`

A Sprint 13 concluiu a execução real controlada para:

- `editorial_research -> editorial_planning`
- `strategic_planning -> marketing_strategy`
- `copywriting -> copywriting`
- `visual_design -> art_direction -> social_media_design -> image_generation`
- `distribution -> social_publishing` com `publishMode: "dry_run"`

O `Execution Engine` continua semanticamente igual: resolve handler, executa tentativa, valida saída
contra portas Runtime, persiste artefatos, eventos, traces e conclui o DAG. A publicação real segue
bloqueada por decisão arquitetural.

## ExecutionTaskHandlerPort

Contrato atual:

- `canHandle(capability, taskType)`
- `validateAvailability(capability, taskType)`
- `execute({ task, inputs, context, attempt })`

Gaps para hardening:

- Não há validação formal de input antes do handler.
- Não há timeout por handler no descriptor.
- Não há `SideEffectGuard` antes da chamada ao handler.
- `execute` recebe inputs já resolvidos, mas não recebe metadata de contrato, policy de ambiente ou
  trace/correlation explícitos.
- Handlers reais ainda montam inputs por funções internas; isso é transformação explícita, mas ainda
  não é governado por registry formal de contratos.

## ExecutionArtifact

Campos atuais cobrem:

- `artifactType`
- `schemaId`
- `schemaVersion`
- `producerTaskRunId`
- `executionRunId`
- `tenantId`
- `workspaceId`
- `handlerId`
- `provider`
- `parentArtifactIds`
- `checksum`
- `createdAt`

Gaps:

- `schemaId` ainda é derivado de `taskRun.type + outputPort`, não de contrato formal versionado.
- Não há limite formal de tamanho, profundidade, strings, arrays ou número de artefatos.
- Integridade valida checksum ao resolver bindings, mas não há camada explícita de imutabilidade além
  da ausência de método de update.
- Lineage é persistido, mas ainda não valida se todos os pais pertencem ao mesmo run/tenant/workspace
  no momento de criação.
- Não há `traceId`, `correlationId` ou `causationId`.

## ExecutionTrace

Trace atual registra:

- handler escolhido;
- capability;
- provider;
- início/fim/duração;
- retry attempt;
- warnings;
- success.

Gaps:

- Não há `traceId`, `correlationId` ou `causationId`.
- Não há diferenciação entre duração do resolver, guard, validação de contrato e chamada externa.
- Não há métrica agregada persistida/consultável.
- Warnings são strings livres; precisam de código fechado ou limite de tamanho.
- Falhas por timeout tardio não são tratadas; o handler é aguardado até resolver/rejeitar.

## HandlerRetryPolicy

Estado atual:

- Descriptor pode declarar `supportsRetry`, `maxAttempts`, `backoffStrategy`.
- Engine aplica `maxAttempts`; `backoffStrategy` ainda não materializa atraso nem scheduling.
- Retry continua síncrono e imediato, coerente com engine sem filas.

Gaps:

- Não há timeout por handler para classificar `timeout` de forma central.
- Não há circuit breaker por handler/provider/capability.
- Não há distinção operacional entre falha transitória externa e falha transitória local.
- `backoffStrategy` ainda é metadata, não comportamento observável.

## SideEffectPolicy

Valores atuais:

- `none`
- `external_read`
- `external_write`
- `publication`

Gaps frente à Sprint 14:

- Falta `publication_preview`.
- Não existe `SideEffectGuard` central antes do handler.
- Policies são declaradas no descriptor, mas não são validadas contra modo, ambiente, tenant,
  workspace, provider e feature flags.
- `distribution` está modelado como `external_read`, embora semanticamente seja melhor
  `publication_preview` quando chama Ana sem publicar.
- `external_write` de visual precisa ficar bem definido: escrever somente `ExecutionArtifact` é
  aceitável; escrever arquivo/storage externo deve exigir policy explícita.

## Handlers Reais

Handlers atuais ficam em infraestrutura e não importam domínio Execution diretamente.

Pontos positivos:

- `SingleSkillExecutionTaskHandler` centraliza chamadas reais para uma Skill.
- `VisualPipelineExecutionTaskHandler` encapsula Sofia -> Bianca -> Pedro sem alterar o engine.
- Todos chamam Helena com `requestedBy: "execution"`.
- Distribution força `publishMode: "dry_run"`.

Gaps:

- Validação de output usa apenas required fields por contrato leve.
- Inputs ainda têm fallbacks de string e default; isso pode mascarar Runtime incompleto.
- Falhas de Skill são classificadas por inspeção textual de mensagem.
- Não há validação formal dos artefatos retornados pela Skill.
- Não há bloqueio central de side effects antes da chamada real.
- Não há `executionTimeoutMs`.

## Contratos Atuais Por Capability

Contrato leve atual:

| Capability | TaskType | Skill(s) | OutputPort | ArtifactType | Schema |
| --- | --- | --- | --- | --- | --- |
| `editorial_research` | `research` | `editorial_planning` | `context` | `document` | `research.context@1` |
| `strategic_planning` | `campaign_structure` | `marketing_strategy` | `structure` | `document` | `campaign_structure.structure@1` |
| `copywriting` | `copy_generation` | `copywriting` | `copy` | `text` | `copy_generation.copy@1` |
| `visual_design` | `visual_generation` | `art_direction`, `social_media_design`, `image_generation` | `visual` | `carousel` | `visual_generation.visual@1` |
| `distribution` | `publication` | `social_publishing` | `manifest` | `document` | `publication.manifest@1` |

Contratos ainda implícitos:

- Inputs esperados por Eduardo, João, Maria, Sofia, Bianca, Pedro e Ana não possuem schema formal
  em Execution.
- O relacionamento RuntimeTask contract -> Execution contract -> Skill contract é apenas implícito.
- Cardinalidade é herdada dos bindings Runtime, mas não é validada pelo contrato real da capability.
- `artifactType` do visual pode variar no Runtime (`image`, `video`, `carousel`), enquanto o contrato
  Sprint 13 usa `carousel` como padrão.
- Payloads de Skill ainda são `Record<string, unknown>` no adapter.

## Helena e Skills Reais

Pontos reutilizáveis:

- Helena já descobre, valida, carrega e executa Skills registradas.
- Helena bloqueia callers não permitidos e agora aceita `execution` como origem explícita.
- Skills já possuem manifests e tipos TypeScript próprios.
- Zod já existe no projeto e é usado no AI Gateway para validação estrutural forte.

Riscos:

- Manifests de Skills não declaram schema formal de input/output compatível com Execution.
- Algumas Skills usam Ícaro ou portas externas internamente; isso precisa ser declarado como side
  effect indireto do handler, mesmo sem Execution importar AI Gateway.
- Ana possui caminho de publicação real se receber `publish_now` ou `schedule`; Sprint 14 precisa
  bloquear isso server-side, não apenas por convenção do input builder.
- Pedro pode materializar artefatos fora das tabelas de execução dependendo das dependências.

## Storage

Pontos atuais:

- `execution_runs`, `execution_task_runs`, `execution_attempts`, `execution_artifacts`,
  `execution_events`, `execution_gates`, `execution_handler_resolution_events` e `execution_traces`
  estão modelados.
- Postgres e memória suportam append de events, traces, resolutions e artifacts.

Gaps:

- Mudanças de estado não estão encapsuladas em uma unidade transacional única no nível application.
- `createArtifacts`, `finishAttempt`, `replaceTaskRunState` e `appendEvent` acontecem em chamadas
  separadas; falha intermediária pode deixar estado parcialmente consistente.
- Não há tabela/porta para métricas agregadas ou circuit breaker.
- Não há colunas de correlation/causation/trace nos principais registros Execution.
- Não há constraint explícita para bloquear mutation de artifact porque não existe update; ainda
  falta teste/garantia documental de imutabilidade.

## API

API atual de Execution expõe runs, tasks, events, start, cancel e decisão de gate. O detalhe do run
inclui handler resolution e traces.

Gaps:

- Não há `GET /v1/execution/contracts`.
- Não há `GET /v1/execution/health`.
- Não há `GET /v1/execution/metrics`.
- Não há `GET /v1/execution-runs/:id/traces` dedicado.
- Health atual da aplicação não distingue liveness/readiness operacional de Execution.
- API não expõe side effect policy, circuit breaker state, timeout nem contract metadata.

## Frontend

Pontos atuais:

- Tela de ExecutionRun mostra estado, tasks, artifacts, events, gates, handler resolution, trace e
  indicador `Real Skill` / `Deterministic Handler`.
- Lineage aparece por artifact.

Gaps:

- Não há tela operacional de readiness/health para Execution.
- Não há visualização de contratos por capability.
- Não há métricas agregadas, falhas por categoria, circuit breaker ou timeouts.
- Side effect bloqueado ainda não tem tratamento visual específico.
- Não há inspeção dedicada de trace por endpoint.

## Guards Arquiteturais

Pontos atuais:

- `check-execution-isolation` garante que domínio/aplicação Execution não importem Caio, Helena,
  Skills, AI, rede ou publicação fora dos adaptadores de infraestrutura.
- `architecture:check` executa guards de AI, Planning, Runtime e Execution.

Gaps:

- Guard não valida side effect policy declarada por handler.
- Guard não valida ausência de publicação real em `distribution` além das coberturas de teste.
- Guard não valida que contracts formais existem para todas as capabilities reais.
- Guard não valida que handlers reais possuem timeout, retry policy e side effect policy.

## Observabilidade Ausente

Ainda não há métricas agregadas para:

- runs criados/concluídos/falhos;
- duração por run/task/capability/handler;
- sucesso/falha por handler;
- retries;
- gates pendentes;
- artifacts produzidos;
- `invalid_output`;
- `provider_unavailable`;
- `rate_limited`;
- `side_effect_blocked`.

Execution events e traces são bons insumos, mas ainda não existe provider/porta de métricas
operacional para consulta server-side.

## Riscos Antes de Publicação

1. **Contratos fracos:** required fields não impedem payload malformado, excessivo ou semanticamente
   incompatível.
2. **Side effects por convenção:** `publishMode: "dry_run"` é construído no handler, mas falta guarda
   central para impedir publication antes da Skill.
3. **Sem timeout central:** handler lento bloqueia a execução e pode concluir tarde sem mecanismo de
   ignorar resultado.
4. **Sem circuit breaker:** provider instável pode ser chamado repetidamente até exaurir retries por
   execução.
5. **Atomicidade parcial:** falha entre artifact/event/task status pode deixar auditoria inconsistente.
6. **Traceability incompleta:** falta correlation/causation/trace ponta a ponta.
7. **Classificação textual de erro:** erros reais de provider/Skill precisam ser normalizados por
   categorias fechadas.
8. **Ambiente pouco explícito:** regras de development/test/staging/production ainda não existem no
   servidor.
9. **Payload limits ausentes:** payload grande pode impactar memória, banco e UI.
10. **Frontend sem visão operacional:** operadores não conseguem ver readiness, circuit breaker,
    side effect blocked ou métricas agregadas.

## Estratégia Recomendada Após Aprovação

Sequência recomendada para reduzir risco:

1. Criar schemas Zod formais e versionados para inputs/outputs por capability.
2. Criar `ExecutionContractRegistry` usando Zod como mecanismo único.
3. Inserir validação de compatibilidade Runtime -> Execution -> Skill antes da task.
4. Evoluir `SideEffectPolicy` com `publication_preview`.
5. Criar `ExecutionEnvironmentPolicy` server-side e `SideEffectGuard`.
6. Adicionar correlation/causation/trace aos modelos e migrations.
7. Adicionar `executionTimeoutMs` em descriptors e wrapper central de timeout no engine.
8. Criar circuit breaker por handler/provider/capability, com estado isolado.
9. Criar métricas agregadas derivadas de events/traces/failures sem payload.
10. Endurecer persistência para atomicidade de tentativa, trace, artifact, task e evento.
11. Expandir endpoints de contratos, health/readiness, metrics e traces.
12. Expandir frontend operacional.
13. Adicionar failure injection para timeout, provider down, rate limit, invalid output, side effect
    blocked e partial artifact.

## Pontos Que Precisam de Aprovação

Antes de código, recomendo aprovar explicitamente:

1. Usar Zod como mecanismo único de schema formal da Sprint 14.
2. Modelar `distribution` como `publication_preview`, mantendo `publication` proibido.
3. Permitir `external_write` apenas quando o output final permanecer em `ExecutionArtifact`; qualquer
   escrita externa real deve ser bloqueada nesta sprint.
4. Implementar circuit breaker em memória primeiro, com porta de domínio/application e persistência
   opcional posterior.
5. Implementar métricas agregadas derivadas de `ExecutionRepository` em vez de nova tabela inicial,
   salvo se persistência histórica agregada for exigida.
6. Manter execução sem filas/workers; timeouts e retries continuam síncronos nesta sprint.

Sem essas decisões, a implementação pode endurecer pontos corretos, mas ainda deixar ambiguidades
em side effects, contratos e semântica operacional.
