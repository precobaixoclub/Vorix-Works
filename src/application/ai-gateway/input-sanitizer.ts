/**
 * `AiInputSanitizer` — Sprint 08 (Fase 10). Aplicado OBRIGATORIAMENTE dentro do
 * `AiGateway.execute()` — nunca opcional, nunca responsabilidade só do chamador (mesmo que o
 * chamador já tenha tentado montar um `input` limpo, o Gateway nunca confia nisso sozinho).
 *
 * NUNCA trunca (decisão obrigatória): se o input excede o limite, a chamada é REJEITADA
 * (`oversized`), nunca cortada — truncar um JSON ou um prompt no meio pode mudar seu significado
 * de forma silenciosa e perigosa (ex.: cortar uma frase de negação no meio). Quem chama o Gateway
 * decide o que fazer com a rejeição (nesta sprint: cair no fallback determinístico).
 */

const SENSITIVE_KEY_PATTERN = /password|passwordhash|token|secret|apikey|api_key|storageref|storage_ref|auditlog|audit_log|authorization|headers|refreshtoken|refresh_token/i;

export type AiSanitizationSuccess = {
  ok: true;
  sanitized: Record<string, unknown>;
  removedFields: readonly string[];
  alerts: readonly string[];
  estimatedSize: number;
};

export type AiSanitizationFailure = {
  ok: false;
  reason: "oversized" | "empty_after_sanitization";
  message: string;
};

export type AiSanitizationResult = AiSanitizationSuccess | AiSanitizationFailure;

export function sanitizeAiInput(params: {
  input: Readonly<Record<string, unknown>>;
  expectedTenantId: string;
  expectedWorkspaceId: string;
  maxInputChars: number;
}): AiSanitizationResult {
  const removedFields: string[] = [];
  const alerts: string[] = [];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params.input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      removedFields.push(key);
      continue;
    }
    if (key === "workspaceId" && value !== params.expectedWorkspaceId) {
      removedFields.push(key);
      alerts.push(`cross_workspace_value_removed:${key}`);
      continue;
    }
    if (key === "tenantId" && value !== params.expectedTenantId) {
      removedFields.push(key);
      alerts.push(`cross_tenant_value_removed:${key}`);
      continue;
    }
    sanitized[key] = value;
  }

  const estimatedSize = JSON.stringify(sanitized).length;
  if (estimatedSize > params.maxInputChars) {
    return { ok: false, reason: "oversized", message: `Input sanitizado tem ${estimatedSize} caracteres, acima do limite de ${params.maxInputChars}.` };
  }

  if (Object.keys(sanitized).length === 0) {
    return { ok: false, reason: "empty_after_sanitization", message: "Nada restou do input depois da sanitização (tudo era sensível ou de outro tenant/workspace)." };
  }

  return { ok: true, sanitized, removedFields, alerts, estimatedSize };
}
