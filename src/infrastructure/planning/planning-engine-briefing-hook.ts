import type { BriefingPlanningHook } from "../../application/briefing/briefing-use-cases.js";
import type { PreparedCommand } from "../../domain/briefing/briefing.model.js";
import { createPlanningFromPreparedCommand, supersedePlanningForPreparedCommand, type PlanningEngineDeps } from "../../application/planning/planning-engine.js";

/**
 * Único ponto de composição entre Briefing e Planning — implementa a interface estreita que
 * `briefing-use-cases.ts` declara (`BriefingPlanningHook`) chamando o Planning Engine de verdade.
 * Vive em `infrastructure/` (não em `application/briefing/`) de propósito: é fiação de DI, não
 * lógica de domínio de nenhum dos dois lados.
 */
export class PlanningEngineBriefingHook implements BriefingPlanningHook {
  constructor(private readonly deps: PlanningEngineDeps) {}

  async createFromPreparedCommand(preparedCommand: PreparedCommand): Promise<void> {
    await createPlanningFromPreparedCommand(this.deps, preparedCommand);
  }

  async supersedeForPreparedCommand(preparedCommandId: string): Promise<void> {
    await supersedePlanningForPreparedCommand(this.deps, preparedCommandId);
  }
}
