import type { MeetingPlanEventKind, MeetingPlanSubscription } from "../../domain/meetings/meeting-plans.model.js";

export type MeetingPlanEvent = {
  id: string;
  tenantId: string;
  kind: MeetingPlanEventKind;
  planCode: string;
  status: string;
  details: Record<string, unknown>;
  actorUserId?: string;
  occurredAt: string;
};

/** Gravação candidata a aviso de exclusão (15/3 dias antes). */
export type RetentionNoticeCandidate = {
  recordingId: string;
  tenantId: string;
  workspaceId: string;
  meetingId: string;
  meetingTitle: string;
  ownerUserId?: string;
  recordedAt: string;
  retentionDays: number;
  exportUntil?: string;
  sentNotices: number[];
};

/** Arquivo de gravação de um tenant cuja janela de exportação terminou. */
export type WindowClosedRecording = { recordingId: string; tenantId: string; workspaceId: string; meetingId: string; storageKey: string; bytes: number };

/**
 * Persistência dos planos de gravação do Meetings (`db/migrations/0198_meeting_plans.sql`).
 * Toda leitura/escrita é por `tenantId` — um tenant nunca vê nem altera o plano de outro.
 */
export type MeetingPlanRepositoryPort = {
  get(tenantId: string): Promise<MeetingPlanSubscription | undefined>;
  /** Grava o estado novo. `expectedUpdatedAt` = concorrência otimista: `false` quando outra
   * escrita chegou antes (o chamador relê e tenta de novo). Sem ele, só cria (nunca sobrescreve). */
  save(next: MeetingPlanSubscription, expectedUpdatedAt: string | undefined): Promise<boolean>;
  appendEvents(events: readonly MeetingPlanEvent[]): Promise<void>;
  listEvents(tenantId: string, limit: number): Promise<MeetingPlanEvent[]>;
  /** Assinaturas vivas com algo vencido até `now` (fim do teste/ciclo, carência de pagamento). */
  listDue(now: Date, limit: number): Promise<MeetingPlanSubscription[]>;
  /** Assinaturas encerradas cuja janela de exportação acabou e ainda não foi fechada. */
  listExportWindowDue(now: Date, limit: number): Promise<MeetingPlanSubscription[]>;
  /** Segundos gravados (gravação + upload) no intervalo `[from, to)` — status disponível ou já
   * removido por retenção (o tempo foi consumido); gravações com falha não contam. */
  usedSeconds(tenantId: string, from: string, to: string): Promise<number>;
  /** Gravações disponíveis de tenants COM plano, que serão removidas em até `horizonDays`. */
  listRetentionNoticeCandidates(input: { now: Date; horizonDays: number; defaultRetentionDays: number; limit: number }): Promise<RetentionNoticeCandidate[]>;
  /** Registra o aviso; `false` se já tinha sido enviado (idempotente). */
  markRetentionNotice(input: { recordingId: string; tenantId: string; daysBefore: number }): Promise<boolean>;
  listRecordingsOfTenant(tenantId: string, limit: number): Promise<WindowClosedRecording[]>;
};
