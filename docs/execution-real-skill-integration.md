# Execution Real Skill Integration — Sprint 12

Sprint 12 adiciona execução híbrida controlada: `Execution` continua independente e resolve handlers por
registro centralizado. Só `src/infrastructure/execution` pode adaptar Helena/Skills reais.

## Revisão Arquitetural

Conceitos reutilizáveis:

- `RuntimePlan`, `RuntimeTask`, `RuntimeBinding` e `RuntimeArtifact` permanecem como contrato validado de execução.
- `ExecutionRun`, `ExecutionTaskRun`, `ExecutionArtifact`, `ExecutionAttempt`, `ExecutionEvent` e `ExecutionGate` permanecem como histórico operacional independente.
- `SkillCapability` é reutilizada apenas por mapping explícito e versionado, nunca como vocabulário interno de `Execution`.

Conceitos isolados:

- `ExecutionPlan` legado, `WorkflowExecutionReport`, Caio e workflows antigos continuam fora do caminho novo.
- Helena e Skills reais ficam atrás de `SkillExecutionTaskHandler`, em infraestrutura.
- AI Gateway, SDKs externos, publicação, filas e workers continuam fora desta sprint.

Diferenças principais:

- Runtime descreve expectativa imutável validada: tasks, contratos, portas e bindings.
- Execution registra tentativa real ou dry run: estados, resolução de handler, artefatos produzidos, gates e falhas.
- Skill executa uma capability concreta, mas nunca substitui o aggregate `Execution`.

Riscos de conectar direto ao legado:

- Acoplamento com estados e relatórios antigos que não preservam contratos de portas.
- Duplicação com Caio e ambiguidade de orquestração.
- Atalhos por tipo de artefato em vez de bindings explícitos.
- Risco de publicação ou IA fora de feature flags.

## Handler Registry e Resolver

- `ExecutionHandlerRegistry` registra descriptors com `handler`, `provider`, `version`, prioridade, feature flags, modos e política de fallback.
- `ExecutionHandlerResolver` centraliza a seleção por `ExecutionCapability`, `TaskType`, `ExecutionMode` e flags.
- `Execution` nunca recebe uma Skill diretamente; recebe sempre um `ExecutionTaskHandlerPort`.
- Não há seleção manual de handler por API.

## Capability Mapping

Mapping versionado v1:

- `editorial_research` -> `editorial_planning`
- `strategic_planning` -> `marketing_strategy`
- `copywriting` -> `copywriting`
- `visual_design` -> `image_generation`
- `human_review` -> `quality_review`
- `distribution` -> `social_publishing`

Capability sem mapping falha fechada. Não há fallback implícito.

## Modos e Feature Flags

`ExecutionMode`:

- `dry_run`: usa apenas handlers determinísticos, não chama Helena, IA, rede ou publicação.
- `real`: usa resolver, adapter de Skill e feature flags.

Flags:

- `REAL_EXECUTION_ENABLED=false`: criação solicitada como real vira `dry_run`.
- `REAL_EXECUTION_ENABLED=true` e `REAL_EXECUTION_RESEARCH_ENABLED=true`: somente `editorial_research` pode usar handler real.
- Demais capabilities usam fallback determinístico explícito.

## Fallback

Política v1:

- `editorial_research`: `fail_closed`.
- Demais capabilities: `deterministic_fallback`.

Se research real não tiver handler habilitado ou Skill pronta, o start falha em pré-condição antes de iniciar tasks.

## Skill Handler Adapter

`SkillExecutionTaskHandler`:

- Resolve a Skill via Helena usando mapping `ExecutionCapability -> SkillCapability`.
- Monta `HelenaSkillExecutionRequest` com `requestedBy: "execution"`.
- Chama Helena apenas em `mode: "real"`.
- Converte `SkillResponse` em output de `ExecutionTaskHandlerPort`.
- Preserva warnings no payload estruturado.
- Classifica falhas em `configuration`, `authentication`, `timeout`, `provider_unavailable`, `rate_limited`, `invalid_input`, `invalid_output`, `policy_violation` e `internal`.

Retry segue permitido apenas para `timeout`, `provider_unavailable` e `rate_limited`.

## Auditoria

Cada task executada registra `HandlerResolutionEvent` com:

- capability;
- handler;
- provider;
- versão;
- feature flags;
- executionMode;
- mapping aplicado;
- fallback policy;
- timestamp.

Eventos de resolução não persistem payload do usuário.

## Segurança

Guarda arquitetural:

- `src/domain/execution` e `src/application/execution` não importam Helena, Skills, AI Gateway, SDKs externos ou publicação.
- Repositórios de execution não chamam rede, IA, Skills ou publicação.
- O único ponto autorizado a importar Helena é `src/infrastructure/execution`.

## Evidência Esperada

Fluxo real controlado:

`Runtime validated -> ExecutionRun(real) -> ExecutionCapability -> HandlerResolver -> SkillExecutionTaskHandler -> Helena -> Skill Research -> ExecutionArtifact -> waiting_for_approval/completed`

Fluxo dry run:

`ExecutionRun(dry_run) -> HandlerResolver -> DeterministicExecutionTaskHandler -> ExecutionArtifact -> nenhuma Skill chamada`

Sprint 13 não foi iniciada.
