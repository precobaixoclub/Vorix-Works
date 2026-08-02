import type { PreparedCommand } from "../../domain/briefing/briefing.model.js";
import type { ValidationIssue, ValidationReport } from "../../domain/planning/planning.model.js";
import { PLANNING_TEMPLATES_BY_PREPARED_COMMAND_TYPE } from "./templates.js";

/**
 * `ValidationReport` — Sprint 09 (decisão obrigatória: roda ANTES do Planning Engine tentar
 * montar qualquer coisa). Função pura, sem I/O. Só `error` bloqueia a montagem do grafo
 * (`valid: false`) — `warning` fica registrado mas nunca impede o Planning de ficar `ready`.
 */
export function validatePreparedCommandForPlanning(preparedCommand: PreparedCommand, now: () => Date = () => new Date()): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (preparedCommand.status !== "prepared") {
    issues.push({
      code: "prepared_command_not_active",
      message: `PreparedCommand "${preparedCommand.id}" está com status "${preparedCommand.status}" — só um PreparedCommand "prepared" pode virar um Planning.`,
      severity: "error",
    });
  }

  if (!PLANNING_TEMPLATES_BY_PREPARED_COMMAND_TYPE[preparedCommand.type]) {
    issues.push({
      code: "no_planning_template_for_type",
      message: `Nenhum template de planejamento registrado para PreparedCommand.type="${preparedCommand.type}" — só "campaign_creation" tem template nesta sprint.`,
      severity: "error",
    });
  }

  if (!preparedCommand.validatedInputs.channel) {
    issues.push({
      code: "missing_channel_hint",
      message: 'Nenhum "channel" em validatedInputs — o formato do artefato visual será um palpite (imagem), não uma decisão informada.',
      field: "channel",
      severity: "warning",
    });
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
    validatedAt: now().toISOString(),
  };
}
