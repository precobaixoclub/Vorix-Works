import type {
  CalendarEventRepositoryPort,
  CreateCalendarEventInput,
  ListCalendarEventsFilter,
  UpdateCalendarEventInput,
} from "../../application/ports/calendar-event-repository.port.js";
import type { CalendarEvent } from "../../domain/calendar/calendar.model.js";

const idGenerator = () => `calevt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryCalendarEventRepository implements CalendarEventRepositoryPort {
  private readonly rows = new Map<string, CalendarEvent>();

  async list(filter: ListCalendarEventsFilter): Promise<CalendarEvent[]> {
    const statusCategory = filter.statusCategory ?? "pending";
    return [...this.rows.values()]
      .filter((row) => row.tenantId === filter.tenantId && row.workspaceId === filter.workspaceId)
      .filter((row) => row.startAt < filter.to && row.endAt > filter.from)
      .filter((row) => !filter.ownerUserIds || filter.ownerUserIds.includes(row.ownerUserId))
      .filter((row) => {
        if (statusCategory === "all") return true;
        if (statusCategory === "pending") return row.status === "confirmed";
        if (statusCategory === "cancelled") return row.status === "cancelled";
        return row.status === "done";
      })
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  async getById(id: string): Promise<CalendarEvent | undefined> {
    return this.rows.get(id);
  }

  async create(input: CreateCalendarEventInput): Promise<CalendarEvent> {
    const now = new Date().toISOString();
    const event: CalendarEvent = {
      id: idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      title: input.title,
      description: input.description,
      location: input.location,
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      allDay: input.allDay ?? false,
      attendees: input.attendees ?? [],
      status: "confirmed",
      source: input.source ?? "system",
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(event.id, event);
    return event;
  }

  async update(id: string, input: UpdateCalendarEventInput): Promise<CalendarEvent> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`CALENDAR_EVENT_NOT_FOUND: evento "${id}" não existe.`);
    const updated: CalendarEvent = {
      ...existing,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
      ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.allDay !== undefined ? { allDay: input.allDay } : {}),
      ...(input.attendees !== undefined ? { attendees: input.attendees } : {}),
      ...(input.relatedEntityType !== undefined ? { relatedEntityType: input.relatedEntityType } : {}),
      ...(input.relatedEntityId !== undefined ? { relatedEntityId: input.relatedEntityId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.syncState !== undefined ? { syncState: input.syncState } : {}),
      ...(input.lastSyncError !== undefined ? { lastSyncError: input.lastSyncError ?? undefined } : {}),
      ...(input.lastGoogleSyncAt !== undefined ? { lastGoogleSyncAt: input.lastGoogleSyncAt } : {}),
      ...(input.googleAccountId !== undefined ? { googleAccountId: input.googleAccountId ?? undefined } : {}),
      ...(input.googleCalendarId !== undefined ? { googleCalendarId: input.googleCalendarId ?? undefined } : {}),
      ...(input.googleEventId !== undefined ? { googleEventId: input.googleEventId ?? undefined } : {}),
      ...(input.googleEtag !== undefined ? { googleEtag: input.googleEtag ?? undefined } : {}),
      ...(input.googleUpdatedAt !== undefined ? { googleUpdatedAt: input.googleUpdatedAt ?? undefined } : {}),
      ...(input.htmlLink !== undefined ? { htmlLink: input.htmlLink ?? undefined } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(id, updated);
    return updated;
  }

  async findByGoogleEventId(googleAccountId: string, googleEventId: string): Promise<CalendarEvent | undefined> {
    return [...this.rows.values()].find((row) => row.googleAccountId === googleAccountId && row.googleEventId === googleEventId);
  }

  async listPendingPush(input: { tenantId: string; workspaceId: string; ownerUserId: string; lookbackFrom: string; limit: number }): Promise<CalendarEvent[]> {
    return [...this.rows.values()]
      .filter((row) => row.tenantId === input.tenantId && row.workspaceId === input.workspaceId && row.ownerUserId === input.ownerUserId)
      .filter((row) => row.source === "system" && row.status !== "cancelled" && row.syncState !== "ok" && row.createdAt >= input.lookbackFrom)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, input.limit);
  }
}
