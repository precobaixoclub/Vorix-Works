import type { TaskType } from "../../domain/planning/planning.model.js";

/**
 * Template de tradução fechado — Sprint 10 (decisões obrigatórias 21/22). Decide QUAIS portas se
 * conectam (topologia), nunca QUAIS TIPOS uma porta aceita ou produz — isso vem sempre de
 * `TaskInputContract`/`TaskOutputContract` no `ExecutionTask` de origem, a fonte de verdade real.
 * Um binding proposto aqui que não corresponda a uma `PlanningEdge` de verdade no `ExecutionGraph`
 * de origem é rejeitado pela validação (`binding_not_backed_by_planning_edge`) — o template nunca
 * pode, sozinho, inventar uma dependência que o Planning não declarou.
 */
export type TranslationBindingSpec = {
  fromTaskType: TaskType;
  fromOutputPort: string;
  toTaskType: TaskType;
  toInputPort: string;
};

export const TRANSLATOR_VERSION = 1;
export const TRANSLATOR_STRATEGY = "deterministic-port-binding-v1";
export const RUNTIME_SCHEMA_VERSION = 1;

/** Mesmo padrão `Partial<Record<...>>` de `PLANNING_TEMPLATES_BY_PREPARED_COMMAND_TYPE`.
 * `content_request-visual-only-v1` acrescentado depois (caminho reduzido, sem publicação — ver
 * `arthur-planner.ts`). */
export const TRANSLATION_TEMPLATES_BY_PLANNING_TEMPLATE: Partial<Record<string, readonly TranslationBindingSpec[]>> = {
  "campaign_creation-standard-pipeline-v1": [
    { fromTaskType: "research", fromOutputPort: "context", toTaskType: "campaign_structure", toInputPort: "context" },
    { fromTaskType: "campaign_structure", fromOutputPort: "structure", toTaskType: "copy_generation", toInputPort: "structure" },
    { fromTaskType: "campaign_structure", fromOutputPort: "structure", toTaskType: "visual_generation", toInputPort: "structure" },
    { fromTaskType: "copy_generation", fromOutputPort: "copy", toTaskType: "approval", toInputPort: "copy" },
    { fromTaskType: "visual_generation", fromOutputPort: "visual", toTaskType: "approval", toInputPort: "visual" },
    { fromTaskType: "approval", fromOutputPort: "decision", toTaskType: "publication", toInputPort: "decision" },
  ],
  "content_request-visual-only-v1": [
    { fromTaskType: "content_brief", fromOutputPort: "structure", toTaskType: "visual_generation", toInputPort: "structure" },
    { fromTaskType: "visual_generation", fromOutputPort: "visual", toTaskType: "approval", toInputPort: "visual" },
  ],
};

export function getTranslationTemplate(planningTemplate: string): readonly TranslationBindingSpec[] | undefined {
  return TRANSLATION_TEMPLATES_BY_PLANNING_TEMPLATE[planningTemplate];
}
