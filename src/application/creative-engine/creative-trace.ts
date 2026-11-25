import type { ClassifiedReference } from "./reference-roles.js";

/**
 * Rastreamento técnico auditável da geração — prova COMO as referências chegaram ao modelo, sem
 * expor credenciais nem imagens privadas: só identificadores, origem, papel, hash parcial, tamanho
 * em bytes e dimensões. URLs assinadas nunca entram no rastreamento.
 */

export type TracedReference = {
  id: string;
  source: ClassifiedReference["source"];
  role: ClassifiedReference["role"];
  /** Primeiros 16 hex do SHA-256 dos bytes enviados — confere com o arquivo sem revelá-lo. */
  sha256: string;
  bytes: number;
  width?: number;
  height?: number;
  productCode?: string;
  variantLabel?: string;
};

export type TraceOperation = {
  step: string;
  operation: "image_edit" | "image_generation" | "composite" | "render_text" | "quality_gate" | "ai_review";
  /** Ex.: "codex:gpt-image (ferramenta nativa)", "openai:/v1/images/edits", "local:sharp". */
  engine: string;
  model?: string;
  /** Ids (não URLs) das referências entregues nesta operação, na ordem. */
  inputs: string[];
  promptChars?: number;
  /** Hash parcial do prompt — permite provar que a instrução chegou intacta. */
  promptSha256?: string;
  durationMs?: number;
  costUsd?: number;
  outcome: "ok" | "rejected" | "failed";
  detail?: string;
};

export type CreativeTrace = {
  version: 1;
  mode: string;
  archetype: string;
  references: TracedReference[];
  excluded: Array<{ id: string; role: string; reason: string }>;
  operations: TraceOperation[];
};

const SIGNED_QUERY = /([?&](?:sig|signature|token|x-amz-[a-z-]+)=)[^&\s]+/gi;

/** Remove assinaturas/tokens de qualquer texto que vá para log ou rastreamento. */
export function redactSecrets(value: string): string {
  return value.replace(SIGNED_QUERY, "$1[redacted]");
}

export function createTrace(mode: string, archetype: string): CreativeTrace {
  return { version: 1, mode, archetype, references: [], excluded: [], operations: [] };
}
