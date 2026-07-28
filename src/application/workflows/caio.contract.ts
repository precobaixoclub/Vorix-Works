import type { WorkflowExecutionReport, WorkflowExecutionRequest, WorkflowHumanApprovalInput } from "./caio.types.js";

export type CaioWorkflowExecutorPort = {
  execute(request: WorkflowExecutionRequest): Promise<WorkflowExecutionReport>;
  getExecution(executionId: string): WorkflowExecutionReport | undefined;
  cancel(executionId: string, reason?: string): Promise<WorkflowExecutionReport>;
  /**
   * Registra um `WorkflowExecutionReport` obtido anteriormente (ex.: persistido em disco por um
   * chamador como a CLI) de volta na memória do Caio, para que `resume`/`getExecution`/`cancel`
   * funcionem mesmo quando a aprovação humana chega numa invocação de processo separada da que
   * criou o workflow. Não reexecuta nada — apenas reidrata o estado já conhecido.
   */
  hydrateExecution(report: WorkflowExecutionReport): void;
  /**
   * Aplica uma música local (já validada pelo chamador — existência, extensão, path traversal,
   * URL) à etapa de renderização de vídeo de uma execução já criada, para o caso de `--music` ser
   * informado apenas num `--continue` posterior (não no `run` inicial, quando Arthur já a
   * embutiria diretamente no plano). Só tem efeito enquanto a etapa `video_rendering` ainda não
   * tiver sido concluída; `applied: false` explica por que não (sem etapa de vídeo no plano, ou
   * etapa já concluída) sem lançar erro — quem chamar decide como avisar o usuário.
   */
  applyLocalMusicAsset(executionId: string, musicTrackPath: string): { applied: boolean; reason?: string };
  /**
   * Retoma um workflow parado num `human_gate` depois que a aprovação humana foi decidida.
   * `approval.confirmed === false` reprova e encerra o workflow como falho; `true` marca a
   * etapa de aprovação como concluída e continua a execução das etapas seguintes do plano.
   */
  resume(executionId: string, approval: WorkflowHumanApprovalInput): Promise<WorkflowExecutionReport>;
  /**
   * Retoma um workflow parado em `WAITING_ASSISTED_GENERATION` (uma Skill, como o Pedro em modo
   * "developer_assisted", devolveu `needs_assisted_generation`). Diferente de `resume`, não recebe
   * nenhuma decisão — apenas reexecuta a mesma etapa, que deve verificar se o artefato esperado já
   * existe. Se ainda não existir, o workflow pausa novamente da mesma forma (retomada idempotente).
   */
  resumeAssistedGeneration(executionId: string): Promise<WorkflowExecutionReport>;
  /**
   * Retoma um workflow parado em `WAITING_DEVELOPER_AI` (uma Skill dependente de `IcaroBrainPort`
   * devolveu `needs_developer_ai` porque o `DeveloperAssistedIcaroProvider` ainda não encontrou a
   * resposta da IA desenvolvedora em disco). Mecanicamente idêntico a `resumeAssistedGeneration`
   * (nenhuma decisão a aplicar, apenas reexecuta a mesma etapa) — mantido como método próprio, em
   * vez de reaproveitar `resumeAssistedGeneration`, para que o estado de espera fique explícito e
   * distinguível na CLI e no relatório (não há artefato binário envolvido aqui, só texto).
   */
  resumeDeveloperAI(executionId: string): Promise<WorkflowExecutionReport>;
};
