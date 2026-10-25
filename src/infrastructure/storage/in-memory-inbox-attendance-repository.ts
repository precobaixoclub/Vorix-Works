import type {
  ChangeAttendanceResponsibleInput,
  CloseInboxAttendanceInput,
  InboxAttendanceRepositoryPort,
  InboxAttendanceWithAssignments,
  OpenInboxAttendanceInput,
} from "../../application/ports/inbox-attendance-repository.port.js";
import type { InboxAttendance, InboxAttendanceAssignment, InboxAttendanceCsatStatus } from "../../domain/inbox/attendance.model.js";
import { secondsBetween } from "../../domain/inbox/attendance.model.js";

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryInboxAttendanceRepository implements InboxAttendanceRepositoryPort {
  private readonly attendances = new Map<string, InboxAttendance>();
  private readonly assignments: InboxAttendanceAssignment[] = [];

  async openIfNone(input: OpenInboxAttendanceInput): Promise<{ attendance: InboxAttendance; created: boolean }> {
    const existing = await this.getOpenByConversation(input.conversationId);
    if (existing) return { attendance: existing, created: false };
    const number = Math.max(0, ...[...this.attendances.values()].filter((row) => row.workspaceId === input.workspaceId).map((row) => row.number)) + 1;
    const now = new Date().toISOString();
    const attendance: InboxAttendance = { ...input, id: newId("attn"), number, status: "open", reopenedCount: 0, createdAt: now, updatedAt: now };
    this.attendances.set(attendance.id, attendance);
    return { attendance, created: true };
  }

  async getById(id: string): Promise<InboxAttendance | undefined> {
    return this.attendances.get(id);
  }

  async getOpenByConversation(conversationId: string): Promise<InboxAttendance | undefined> {
    return [...this.attendances.values()].find((row) => row.conversationId === conversationId && row.status === "open");
  }

  async getLatestByConversation(conversationId: string): Promise<InboxAttendance | undefined> {
    return [...this.attendances.values()].filter((row) => row.conversationId === conversationId).sort((a, b) => b.number - a.number)[0];
  }

  async listByConversation(conversationId: string): Promise<InboxAttendanceWithAssignments[]> {
    return [...this.attendances.values()]
      .filter((row) => row.conversationId === conversationId)
      .sort((a, b) => b.number - a.number)
      .map((row) => ({ ...row, assignments: this.assignments.filter((assignment) => assignment.attendanceId === row.id) }));
  }

  async close(id: string, input: CloseInboxAttendanceInput): Promise<InboxAttendance | undefined> {
    const current = this.attendances.get(id);
    if (!current || current.status !== "open") return undefined;
    const closed: InboxAttendance = { ...current, ...input, status: "closed", resolutionSeconds: secondsBetween(current.openedAt, input.closedAt), updatedAt: new Date().toISOString() };
    this.attendances.set(id, closed);
    this.endActive(id, input.closedAt, "attendance_closed");
    return closed;
  }

  async reopen(id: string, at: string): Promise<InboxAttendance | undefined> {
    const current = this.attendances.get(id);
    if (!current || current.status !== "closed") return undefined;
    const reopened: InboxAttendance = {
      ...current,
      status: "open",
      closedAt: undefined, closedBy: undefined, closureTypeId: undefined, closureSubtypeId: undefined,
      closureTypeName: undefined, closureSubtypeName: undefined, closureNote: undefined, resolutionSeconds: undefined,
      reopenedCount: current.reopenedCount + 1, lastReopenedAt: at, updatedAt: new Date().toISOString(),
    };
    this.attendances.set(id, reopened);
    return reopened;
  }

  async setCsat(id: string, input: { status: InboxAttendanceCsatStatus; waivedBy?: string; sentAt?: string }): Promise<void> {
    const current = this.attendances.get(id);
    if (current) this.attendances.set(id, { ...current, csatStatus: input.status, csatWaivedBy: input.waivedBy, csatSentAt: input.sentAt, csatScore: undefined, csatAnsweredAt: undefined });
  }

  async recordCsatAnswer(id: string, input: { score: number; answeredAt: string }): Promise<void> {
    const current = this.attendances.get(id);
    if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) throw new Error("INBOX_CSAT_SCORE_INVALID");
    if (current?.status === "closed" && current.csatStatus === "sent" && current.csatScore === undefined && current.csatSentAt && current.csatSentAt <= input.answeredAt) this.attendances.set(id, { ...current, csatScore: input.score, csatAnsweredAt: input.answeredAt });
  }

  async changeResponsible(input: ChangeAttendanceResponsibleInput): Promise<{ changed: boolean; ended?: InboxAttendanceAssignment; started?: InboxAttendanceAssignment }> {
    const attendance = this.attendances.get(input.attendanceId);
    if (!attendance || attendance.status !== "open") return { changed: false };
    const current = this.assignments.find((row) => row.attendanceId === input.attendanceId && !row.endedAt);
    if (current?.userId === input.toUserId) return { changed: false };
    const ended = current ? this.endActive(input.attendanceId, input.at, input.toUserId ? input.endReason : "unassigned", input.toUserId) : undefined;
    let started: InboxAttendanceAssignment | undefined;
    if (input.toUserId) {
      started = {
        id: newId("attnasg"), tenantId: attendance.tenantId, workspaceId: attendance.workspaceId, attendanceId: attendance.id, conversationId: attendance.conversationId,
        userId: input.toUserId, teamId: input.teamId ?? attendance.teamId, source: input.source, assignedBy: input.assignedBy, startedAt: input.at, createdAt: new Date().toISOString(),
      };
      this.assignments.push(started);
      if (!attendance.initialAssigneeUserId) this.attendances.set(attendance.id, { ...attendance, initialAssigneeUserId: input.toUserId });
    }
    return { changed: true, ended, started };
  }

  async recordFirstResponse(input: { attendanceId: string; userId: string; messageId: string; at: string }): Promise<{ attendance: boolean; assignment: boolean }> {
    const attendance = this.attendances.get(input.attendanceId);
    let attendanceFirst = false;
    if (attendance?.status === "open" && attendance.openedAt <= input.at && !attendance.firstResponseAt) {
      this.attendances.set(attendance.id, { ...attendance, firstResponseAt: input.at, firstResponseBy: input.userId });
      attendanceFirst = true;
    }
    const index = this.assignments.findIndex((row) => row.attendanceId === input.attendanceId && row.userId === input.userId && !row.endedAt && !row.firstResponseAt && row.startedAt <= input.at);
    if (index >= 0) {
      const row = this.assignments[index]!;
      this.assignments[index] = { ...row, firstResponseAt: input.at, firstResponseMessageId: input.messageId, firstResponseSeconds: secondsBetween(row.startedAt, input.at) };
    }
    return { attendance: attendanceFirst, assignment: index >= 0 };
  }

  private endActive(attendanceId: string, at: string, endReason: InboxAttendanceAssignment["endReason"], transferredToUserId?: string): InboxAttendanceAssignment | undefined {
    const index = this.assignments.findIndex((row) => row.attendanceId === attendanceId && !row.endedAt);
    if (index < 0) return undefined;
    const row = this.assignments[index]!;
    const ended = { ...row, endedAt: at, endReason, transferredToUserId, holdingSeconds: secondsBetween(row.startedAt, at) };
    this.assignments[index] = ended;
    return ended;
  }
}
