import type {
  InboxAssignmentEndReason,
  InboxAssignmentSource,
  InboxAttendance,
  InboxAttendanceAssignment,
  InboxAttendanceCsatStatus,
  InboxAttendanceOpenReason,
  InboxDistributionRule,
} from "../../domain/inbox/attendance.model.js";

/** Ciclo de atendimento (Conversas). Ver `db/migrations/0172_inbox_attendance_cycles.sql`. */

export type OpenInboxAttendanceInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  contactId?: string;
  connectionId: string;
  teamId?: string;
  openedAt: string;
  openedBy: string;
  openReason: InboxAttendanceOpenReason;
  distributionRule?: InboxDistributionRule;
};

export type CloseInboxAttendanceInput = {
  closedAt: string;
  closedBy: string;
  closureTypeId?: string;
  closureSubtypeId?: string;
  closureTypeName?: string;
  closureSubtypeName?: string;
  closureNote?: string;
};

export type ChangeAttendanceResponsibleInput = {
  attendanceId: string;
  /** `undefined` = o atendimento fica sem responsável (só encerra o ciclo atual). */
  toUserId?: string;
  teamId?: string;
  at: string;
  source: InboxAssignmentSource;
  assignedBy: string;
  /** Motivo gravado no ciclo que termina, quando há um. */
  endReason: InboxAssignmentEndReason;
};

export type InboxAttendanceWithAssignments = InboxAttendance & { assignments: InboxAttendanceAssignment[] };

export type InboxAttendanceRepositoryPort = {
  /** Abre um atendimento se a conversa não tiver nenhum aberto — atômico (índice parcial único):
   * duas mensagens simultâneas nunca abrem dois. `created: false` devolve o que já estava aberto. */
  openIfNone(input: OpenInboxAttendanceInput): Promise<{ attendance: InboxAttendance; created: boolean }>;
  getById(id: string): Promise<InboxAttendance | undefined>;
  getOpenByConversation(conversationId: string): Promise<InboxAttendance | undefined>;
  getLatestByConversation(conversationId: string): Promise<InboxAttendance | undefined>;
  /** Mais recente primeiro, com os ciclos de responsabilidade em ordem cronológica. */
  listByConversation(conversationId: string): Promise<InboxAttendanceWithAssignments[]>;
  /** Fecha (CAS em `status = 'open'`) e encerra o ciclo de responsabilidade ativo, na mesma
   * transação. `undefined` = já estava fechado (outra requisição ganhou). */
  close(id: string, input: CloseInboxAttendanceInput): Promise<InboxAttendance | undefined>;
  /** Reabre o MESMO atendimento (ação manual "Reabrir"); a finalização anterior continua no evento. */
  reopen(id: string, at: string): Promise<InboxAttendance | undefined>;
  setCsat(id: string, input: { status: InboxAttendanceCsatStatus; waivedBy?: string; sentAt?: string }): Promise<void>;
  recordCsatAnswer(id: string, input: { score: number; answeredAt: string }): Promise<void>;
  /** Encerra o ciclo do responsável atual e abre o do novo, numa transação com lock no
   * atendimento. No-op (`changed: false`) quando o responsável já é `toUserId`. */
  changeResponsible(input: ChangeAttendanceResponsibleInput): Promise<{ changed: boolean; ended?: InboxAttendanceAssignment; started?: InboxAttendanceAssignment }>;
  /** Primeira resposta humana: do atendimento (qualquer pessoa) e do ciclo ATIVO, se for de `userId`. */
  recordFirstResponse(input: { attendanceId: string; userId: string; messageId: string; at: string }): Promise<{ attendance: boolean; assignment: boolean }>;
};
