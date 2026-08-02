import type { BriefingAmbiguityStatus, BriefingFieldValue, BriefingSource } from "../../domain/briefing/briefing.model.js";

export type AppendBriefingFieldValueInput = {
  briefingId: string;
  fieldKey: string;
  value: string;
  normalizedValue: string;
  source: BriefingSource;
  confidence: number;
  questionId?: string;
  conversationEventId?: string;
  assetId?: string;
  confirmedByUser: boolean;
  supersedesValueId?: string;
  ambiguityStatus: BriefingAmbiguityStatus;
  /** Só presentes quando `source === "ai_extraction"` (Sprint 08). */
  aiExecutionId?: string;
  rationaleCode?: string;
  evidence?: string;
};

/**
 * Append-only — nunca um método `update`. `append` calcula a `revision` internamente
 * (MAX(revision) para o `fieldKey` + 1, dentro do próprio adapter) — quem chama nunca informa a
 * revisão. Concorrência: duas chamadas `append` para o MESMO `fieldKey` "ao mesmo tempo" nunca
 * perdem dado (ambas viram linhas — a seleção do valor ATUAL, feita por
 * `listCurrentByBriefing`, é sempre `revision DESC, created_at DESC, id DESC`, nunca timestamp
 * isolado).
 */
export type BriefingFieldValueRepositoryPort = {
  append(input: AppendBriefingFieldValueInput): Promise<BriefingFieldValue>;
  /** Um valor por `fieldKey` — o mais atual (`revision DESC, created_at DESC, id DESC`). */
  listCurrentByBriefing(briefingId: string): Promise<BriefingFieldValue[]>;
  /** Histórico completo, todas as revisões — auditoria/reconstrução. */
  listAllByBriefing(briefingId: string): Promise<BriefingFieldValue[]>;
};
