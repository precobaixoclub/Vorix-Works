import type { PlanningRuntimeHook } from "../../application/planning/planning-engine.js";
import type { Planning } from "../../domain/planning/planning.model.js";
import { ensureRuntimeForPlanning, supersedeRuntimeForPlanning, type RuntimeEngineDeps } from "../../application/runtime/runtime-engine.js";

/**
 * Único ponto de composição entre Planning e Runtime — implementa a interface estreita que
 * `planning-engine.ts` declara (`PlanningRuntimeHook`) chamando o Runtime Engine de verdade. Vive
 * em `infrastructure/` (não em `application/planning/`) de propósito: é fiação de DI, não lógica
 * de domínio de nenhum dos dois lados. Mesmo padrão de `PlanningEngineBriefingHook` (Sprint 09).
 */
export class RuntimeEnginePlanningHook implements PlanningRuntimeHook {
  constructor(private readonly deps: RuntimeEngineDeps) {}

  async ensureForPlanning(planning: Planning): Promise<void> {
    await ensureRuntimeForPlanning(this.deps, planning);
  }

  async supersedeForPlanning(planningId: string): Promise<void> {
    await supersedeRuntimeForPlanning(this.deps, planningId);
  }
}
