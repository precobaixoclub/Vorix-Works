/**
 * Utilitário puro e sem estado, reaproveitado por toda Skill que dependa de `IcaroBrainPort` para
 * tratar o sinal de "IA desenvolvedora ainda não respondeu" (`DeveloperAssistancePendingError`) da
 * mesma forma. `src/shared` não é uma Skill — importar daqui não viola o isolamento entre Skills
 * (ADR 0002), que só proíbe uma Skill importar de outra.
 */
import {
  DeveloperAssistancePendingError,
  type DeveloperAssistancePendingOutput,
} from "../../application/ai/developer-assistance.types.js";
import type { SkillResponse } from "../../domain/skills/skill.contract.js";

export function isDeveloperAssistancePending(error: unknown): error is DeveloperAssistancePendingError {
  return error instanceof DeveloperAssistancePendingError;
}

/**
 * Constrói a `SkillResponse` de pausa (`status: "needs_developer_ai"`) a partir do erro lançado
 * pelo `DeveloperAssistedIcaroProvider`. Cada Skill chama isto no início do seu `catch (error)`,
 * antes do tratamento existente de falha de IA (que continua válido para erros reais do Ícaro).
 */
export function buildDeveloperAiPendingResponse(
  skillId: string,
  taskId: string,
  error: DeveloperAssistancePendingError,
): SkillResponse<DeveloperAssistancePendingOutput> {
  const pkg = error.workPackage;
  return {
    skillId,
    taskId,
    status: "needs_developer_ai",
    output: {
      mode: "developer_ai",
      instruction: pkg.instruction,
      specialistId: pkg.specialistId,
      taskType: pkg.taskType,
      workPackagePath: pkg.workPackagePath,
      expectedResponsePath: pkg.expectedResponsePath,
      resumeCommand: pkg.resumeCommand,
      validationErrors: pkg.validationErrors,
    },
    artifacts: [],
    warnings: pkg.validationErrors ?? [],
  };
}
