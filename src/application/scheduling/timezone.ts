export type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

export function assertIanaTimezone(timezone: string): void {
  if (!isValidIanaTimezone(timezone)) throw new Error(`SCHEDULE_TIMEZONE_INVALID: timezone "${timezone}" não é um identificador IANA válido.`);
}

export function isValidIanaTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date("2026-01-01T00:00:00.000Z"));
    return true;
  } catch {
    return false;
  }
}

export function parseLocalDateTime(value: string): LocalDateTimeParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) throw new Error("SCHEDULE_DATETIME_INVALID: use ISO local datetime, por exemplo 2026-07-30T09:00:00.");
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? "0").padEnd(3, "0")),
  };
}

export function formatLocalDateTime(parts: LocalDateTimeParts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function zonedTimeToUtc(localDateTime: string, timezone: string): string {
  assertIanaTimezone(timezone);
  const parts = parseLocalDateTime(localDateTime);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond);
  let utc = localAsUtc - offsetMs(timezone, new Date(localAsUtc));
  const recalculated = localAsUtc - offsetMs(timezone, new Date(utc));
  if (recalculated !== utc) utc = recalculated;
  if (!Number.isFinite(utc)) throw new Error("SCHEDULE_DATETIME_INVALID: datetime inválido.");
  return new Date(utc).toISOString();
}

export function utcToZonedParts(utcIso: string, timezone: string): LocalDateTimeParts {
  assertIanaTimezone(timezone);
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) throw new Error("SCHEDULE_DATETIME_INVALID: UTC inválido.");
  return partsFor(timezone, date);
}

export function addDays(parts: LocalDateTimeParts, days: number): LocalDateTimeParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second, parts.millisecond));
  return fromUtcDateFields(date);
}

export function addMonths(parts: LocalDateTimeParts, months: number, preferredDay = parts.day): LocalDateTimeParts {
  const first = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1, parts.hour, parts.minute, parts.second, parts.millisecond));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(preferredDay, lastDay);
  return {
    year: first.getUTCFullYear(),
    month: first.getUTCMonth() + 1,
    day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: parts.millisecond,
  };
}

export function dayOfWeek(parts: LocalDateTimeParts): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function offsetMs(timezone: string, date: Date): number {
  const parts = partsFor(timezone, date);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond);
  return asUtc - date.getTime();
}

function partsFor(timezone: string, date: Date): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const mapped = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: Number(mapped.year),
    month: Number(mapped.month),
    day: Number(mapped.day),
    hour: Number(mapped.hour),
    minute: Number(mapped.minute),
    second: Number(mapped.second),
    millisecond: date.getUTCMilliseconds(),
  };
}

function fromUtcDateFields(date: Date): LocalDateTimeParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}
