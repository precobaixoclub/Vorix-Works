import type { CalendarEvent } from "../types";

const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function buildMonthCells(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index));
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const TYPE_DOT: Record<string, string> = { campaign: "bg-accent", post: "bg-status-active" };

export function MonthGrid({ year, month, events }: { year: number; month: number; events: CalendarEvent[] }) {
  const cells = buildMonthCells(year, month);
  const today = new Date();

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
      <div className="grid grid-cols-7 border-b border-border text-center text-xs font-medium text-ink-muted">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-2 uppercase">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date) => {
          const isCurrentMonth = date.getMonth() === month;
          const isToday = sameDay(date, today);
          const dayEvents = events.filter((event) => sameDay(new Date(event.date), date));
          return (
            <div
              key={date.toISOString()}
              className={`min-h-24 border-b border-r border-border p-1.5 last:border-r-0 ${isCurrentMonth ? "" : "bg-surface-sunken/50"}`}
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                  isToday ? "bg-accent text-white" : isCurrentMonth ? "text-ink" : "text-ink-faint"
                }`}
              >
                {date.getDate()}
              </span>
              <div className="mt-1 flex flex-col gap-1">
                {dayEvents.slice(0, 3).map((event) => (
                  <span key={event.id} className="flex items-center gap-1 truncate rounded bg-surface-sunken px-1 py-0.5 text-[10px] text-ink">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_DOT[event.type] ?? "bg-ink-faint"}`} />
                    {event.title}
                  </span>
                ))}
                {dayEvents.length > 3 ? <span className="text-[10px] text-ink-faint">+{dayEvents.length - 3}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
