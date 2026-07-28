# Caio, o Executor de Workflows

Caio é o executor de workflows do Zuno. Ele não cria estratégia, não cria conteúdo, não cria imagens, não publica, não chama IA e não conversa com provedores externos. Caio recebe um `ExecutionPlan` criado por Arthur e executa as etapas na ordem definida.

## Relação com Arthur

Arthur cria o plano. Caio não altera esse plano. Caio valida se o plano pode ser executado, cria um relatório de execução e percorre as etapas em ordem. O plano original permanece como `planSnapshot` no relatório.

Caio também valida que o plano possui contexto de cliente. Quando Valentina está disponível, Caio carrega `TenantClientContext` antes de iniciar a execução, grava `clientId` e `tenantId` no relatório e repassa esse contexto para Helena executar as Skills.

## Relação com Helena

Caio não conhece Skills concretas. Quando uma etapa exige uma `skillCapability`, Caio solicita à Helena a execução dessa capability. Helena localiza a Skill no Registry e executa. Caio recebe o retorno e decide se continua, pausa ou falha.

## Etapas humanas

Quando Caio encontra uma etapa `human_gate`, ele para imediatamente. A execução recebe estado `WAITING_HUMAN_APPROVAL`, a etapa recebe estado `WAITING`, logs são registrados e o evento `WorkflowPaused` é emitido. Etapas posteriores não são executadas.

## Checagem prévia de capabilities

Antes de executar qualquer etapa, `execute()` chama `findMissingCapabilities(plan)`, que pergunta a Helena (`findSkillByCapability`) por toda `skillCapability` distinta presente no plano. Se qualquer capability não tiver Skill pronta (por exemplo `campaign_management`, `metrics_analysis`, `optimization` ou `video_creation`, reservadas por Arthur para Skills que ainda não existem), o workflow inteiro falha imediatamente com estado `FAILED` e uma mensagem consolidada listando todas as capabilities faltantes — sem executar nenhuma etapa e sem gastar nenhuma chamada de Ícaro em etapas que rodariam antes da capability faltante. Isso é o que garante que um comando inexecutável falhe de forma rápida e clara, em vez de descobrir o problema no meio do workflow. Um plano de carrossel nunca cai nesse caso: `image_generation` (já implementada) é a única capability envolvida, independentemente de quantas imagens forem pedidas.

## Encadeamento automático entre etapas (`inputBindings`)

Cada etapa do `ExecutionPlan` pode declarar `inputBindings`: uma mini-linguagem declarativa (`targetField`, `fromStepId`, `sourcePath`, `pick`) que descreve de onde vem cada campo da entrada da etapa. Antes de chamar Helena, Caio resolve esses bindings contra a saída real das etapas já concluídas através de `resolveStepInput(step, report)` — substituindo o campo inteiro (`targetField: null`), um campo nomeado, um caminho aninhado (`sourcePath`) ou apenas um subconjunto de campos (`pick`), inclusive com setters aninhados. Um binding cuja etapa de origem ainda não concluiu é simplesmente ignorado, sem falhar o workflow. Isso é o que permite que a saída de João vire a entrada de Maria e Sofia, a saída de Sofia vire a entrada de Bianca, e assim por diante, sem que nenhuma Skill conheça a outra.

Além dos bindings declarados no plano, `withUpstreamSkillsReport` injeta em todo `workflowContext` de cada etapa dois metadados genéricos, sem que Caio nem a Skill precisem conhecer o formato de saída umas das outras:

- `upstreamSkillsReport`: resumo das Skills já concluídas (usado por Pedro para montar a seção "Relatório das Skills utilizadas" no HTML de entrega);
- `publishingEnabled`: `true` quando o plano inclui uma etapa de `social_publishing` (usado por Pedro para decidir se mostra o comando de "Publicar" no HTML de entrega).

## Falhas

Se Helena devolver falha, ou se a etapa de Skill não possuir capability, Caio marca a etapa como `FAILED`, marca o workflow como `FAILED`, registra logs, emite eventos e não executa nenhuma etapa posterior.

## Pausa por geração assistida (`needs_assisted_generation`)

Quando uma Skill devolve `status: "needs_assisted_generation"` — hoje o Pedro, quando a imagem esperada ainda não existe em disco (ver `docs/pedro-image-generation.md`), e o Rafa, quando o vídeo final esperado ainda não existe em disco (ver `docs/rafa-video-rendering.md`), ambos em Developer Assisted Mode — Caio trata isso como uma pausa, não uma falha: a etapa recebe estado `WAITING`, o workflow recebe estado `WAITING_ASSISTED_GENERATION`, `report.waitingForStepId` aponta para a etapa parada, logs (`StepWaitingAssistedGeneration`) são registrados e o evento `WorkflowPaused` é emitido com `reason: "assisted_generation"`. Etapas posteriores não são executadas até a retomada. Isso é genérico o suficiente para qualquer Skill futura que precise de intervenção externa assistida antes de completar — Caio não sabe (nem precisa saber) que é uma imagem ou um vídeo.

## Aprovação humana entre processos (`resume` e `hydrateExecution`)

Quando o workflow pausa em `WAITING_HUMAN_APPROVAL`, ele fica retido em memória no `CaioWorkflowExecutor` (via `executions.set`). `Caio.resume(executionId, approval)` retoma a execução: se `approval.confirmed` for `false`, o workflow falha com `HUMAN_APPROVAL_REJECTED`; se for `true`, a decisão humana vira a "saída" da etapa `human_gate` (resolvível pelos mesmos `inputBindings` genéricos usados para saída de Skill — por exemplo, a etapa de publicação lê `humanApproval` dali) e Caio continua executando as etapas seguintes.

`Caio.resumeAssistedGeneration(executionId)` retoma um workflow parado em `WAITING_ASSISTED_GENERATION`: diferente de `resume`, não recebe nenhuma decisão — apenas volta a etapa parada para `PENDING` e deixa `runSteps` reexecutá-la. A própria Skill decide se agora pode completar (o artefato esperado já existe) ou se deve pausar de novo com a mesma mensagem — retomada sempre segura e idempotente, sem lógica especial em Caio sobre o que está sendo esperado.

Como um processo de CLI termina entre a criação do workflow e a retomada, `getExecution(executionId)` e `hydrateExecution(report)` existem para persistir e recarregar o `WorkflowExecutionReport` fora do processo original — é isso que permite `npm run zuno -- --approve <executionId>` e `npm run zuno -- --continue <executionId>` funcionarem numa invocação separada da que criou o workflow.

## Estados

O workflow pode estar em `CREATED`, `RUNNING`, `WAITING_HUMAN_APPROVAL`, `WAITING_ASSISTED_GENERATION`, `COMPLETED`, `FAILED` ou `CANCELLED`. Cada etapa pode estar em `PENDING`, `RUNNING`, `WAITING`, `COMPLETED`, `FAILED` ou `SKIPPED`.

## Eventos

Caio emite eventos de execução e de etapa, como `ExecutionStarted`, `StepStarted`, `SkillStarted`, `SkillFinished`, `SkillFailed`, `StepFinished`, `StepFailed`, `WorkflowPaused`, `WorkflowResumed` e `ExecutionFinished`. O Event Bus completo ainda não existe; os eventos seguem a porta `ZunoEventRecorderPort`.
