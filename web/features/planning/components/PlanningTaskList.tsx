import { Card } from "@/components/Card";
import type { ExecutionCapability, ExecutionTask, PlanningArtifact, PlanningArtifactType, TaskType } from "../types";

const TASK_TYPE_LABEL: Record<TaskType, string> = {
  research: "Pesquisa",
  campaign_structure: "Estrutura da campanha",
  copy_generation: "Geração de copy",
  visual_generation: "Geração visual",
  approval: "Aprovação",
  publication: "Publicação",
  content_brief: "Briefing da peça",
  quality_review: "Revisão de qualidade",
};

const CAPABILITY_LABEL: Record<ExecutionCapability, string> = {
  editorial_research: "Pesquisa editorial",
  strategic_planning: "Planejamento estratégico",
  copywriting: "Redação Publicitária",
  visual_design: "Design visual",
  human_review: "Revisão humana",
  distribution: "Distribuição",
  content_brief: "Briefing da peça",
};

const ARTIFACT_TYPE_LABEL: Record<PlanningArtifactType, string> = {
  text: "Texto",
  image: "Imagem",
  video: "Vídeo",
  carousel: "Carrossel",
  document: "Documento",
};

/** Lista só-leitura das tarefas de um plano, com o artefato esperado de cada uma — nenhum botão de
 * ação (nem "Gerar", nem "Executar"): tudo aqui descreve o que ESTÁ planejado, nunca o que rodou. */
export function PlanningTaskList({ tasks, artifacts }: { tasks: readonly ExecutionTask[]; artifacts: readonly PlanningArtifact[] }) {
  const artifactByTaskId = new Map(artifacts.map((artifact) => [artifact.executionTaskId, artifact]));
  const ordered = [...tasks].sort((a, b) => a.sequenceHint - b.sequenceHint);

  return (
    <div className="flex flex-col gap-3">
      {ordered.map((task) => {
        const artifact = artifactByTaskId.get(task.id);
        return (
          <Card key={task.id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">{task.name}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{task.description}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-ink-muted">{TASK_TYPE_LABEL[task.type]}</span>
                <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-ink-muted">{CAPABILITY_LABEL[task.capability]}</span>
              </div>
            </div>
            {artifact ? (
              <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-2">
                <p className="text-xs font-medium text-ink-muted">
                  Artefato esperado — {ARTIFACT_TYPE_LABEL[artifact.contract.expectedType]}
                </p>
                <p className="mt-0.5 text-xs text-ink-faint">{artifact.contract.description}</p>
                {artifact.contract.expectedFields.length > 0 ? (
                  <p className="mt-1 text-[11px] text-ink-faint">Campos: {artifact.contract.expectedFields.join(", ")}</p>
                ) : null}
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
