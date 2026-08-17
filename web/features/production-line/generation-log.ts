import type { ProductionChannel, ProductionFormat } from "./types";

/**
 * Índice local (por workspace, mesmo padrão de `storage.ts`) ligando um `executionRunId` de volta
 * à ideia do tanque que o originou — o backend não guarda essa relação (o tanque é um conceito
 * 100% local, nunca enviado como identificador, só como conteúdo). Sem isto, a tela de Revisão não
 * teria como mostrar título/descrição da peça nem devolver a ideia certa ao tanque após uma
 * rejeição. Guarda uma CÓPIA dos dados no momento da geração (não só o id) — funciona mesmo que a
 * ideia original já tenha sido removida do tanque.
 */
export type GenerationRecord = {
  executionRunId: string;
  ideaId: string;
  name: string;
  objective: string;
  ideaText: string;
  format: Exclude<ProductionFormat, "video">;
  channel: ProductionChannel;
  targetAudience?: string;
  createdAt: string;
};

function storageKey(workspaceId: string): string {
  return `vorix.production-line.generations.${workspaceId}`;
}

function readAll(workspaceId: string): Record<string, GenerationRecord> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(storageKey(workspaceId));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, GenerationRecord>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(workspaceId: string, records: Record<string, GenerationRecord>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(records));
}

export function recordGeneration(workspaceId: string, record: GenerationRecord): void {
  const all = readAll(workspaceId);
  all[record.executionRunId] = record;
  writeAll(workspaceId, all);
}

export function getGenerationRecord(workspaceId: string, executionRunId: string): GenerationRecord | undefined {
  return readAll(workspaceId)[executionRunId];
}

export function removeGenerationRecord(workspaceId: string, executionRunId: string): void {
  const all = readAll(workspaceId);
  delete all[executionRunId];
  writeAll(workspaceId, all);
}
