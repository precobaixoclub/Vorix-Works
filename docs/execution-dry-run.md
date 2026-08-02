# Execution Engine Dry Run — Sprint 11

O domínio `Execution` transforma um `RuntimePlan` validado em `ExecutionRun`, `ExecutionTaskRun`,
`ExecutionAttempt`, `ExecutionArtifact`, `ExecutionEvent` e `ExecutionGate`. Nesta sprint todo run
é obrigatoriamente `dry_run`.

## Fronteiras

- `RuntimePlan` continua sendo expectativa validada: tasks, portas, bindings e artefatos esperados.
- `ExecutionRun` é a execução dry run persistida: estados, tentativas, eventos, gates e artefatos produzidos.
- `ExecutionArtifact` representa resultado produzido por uma `ExecutionTaskRun` e é resolvido sempre por `RuntimeBinding`, `runtimeTaskId` e portas explícitas.
- Nenhum código de `src/domain/execution`, `src/application/execution` ou adapters de execution importa Caio, Helena, Skills, AI Gateway, SDKs externos, rede ou publicação.

## Pré-condições

Antes de criar ou iniciar um run, o engine valida:

- `RuntimePlan.status === "validated"` e não superseded;
- Planning de origem existe, não está superseded e pertence ao mesmo Tenant/Workspace;
- `sourceGraphFingerprint` ainda corresponde ao grafo do Planning persistido;
- `runtimeFingerprint` ainda corresponde ao conteúdo Runtime persistido;
- RuntimeTasks, RuntimeArtifacts e portas obrigatórias continuam presentes e conectadas.

Falha em pré-condição impede criação parcial de execução.

## Engine

O `ExecutionEngine` calcula readiness pelo DAG de `RuntimeBinding`, nunca por `sequenceHint`. A execução
interna pode ser sequencial, mas preserva a semântica de paralelismo potencial: branches independentes
ficam prontos quando suas dependências e artefatos existem.

## Handlers

Handlers desta sprint são determinísticos e idempotentes:

- `DeterministicExecutionTaskHandler`;
- `FakeExecutionTaskHandler`;
- `FailingExecutionTaskHandler`.

Eles produzem payloads sintéticos válidos apenas para `dry_run`.

## Human Gate

A task `approval` cria um `ExecutionGate` aberto e pausa o run em `waiting_for_approval`. A decisão vem
somente da API explícita.

Política v1: `rejected` falha o run inteiro. Não há interpretação por LLM e não há publicação marcada
como real ou executada.

## Retry e Cancelamento

Retry é centralizado e permitido apenas para falhas transitórias. Human gate, falha de validação,
schema mismatch, policy violation e handler não idempotente sem chave não são repetidos automaticamente.

Cancelamento é idempotente, bloqueia novas tasks, marca tasks `blocked`/`ready` como `cancelled` e não
reverte artefatos já produzidos. Não há compensação nesta sprint.

## Observabilidade

Eventos fechados persistidos:

`run_created`, `run_started`, `task_ready`, `task_started`, `task_completed`, `task_failed`,
`artifact_produced`, `gate_created`, `gate_resolved`, `retry_scheduled`, `run_completed`,
`run_failed`, `run_cancelled`.

Eventos não carregam payload sensível.
