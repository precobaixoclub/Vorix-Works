function offsetMinutes(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - instant) / 60_000);
}

/** Meia-noite local (no fuso) de y-m-d, em UTC ISO. Duas passadas cobrem a troca de horário de verão. */
export function localMidnightUtc(year: number, month: number, day: number, timeZone: string): string {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetMinutes(guess, timeZone) * 60_000;
  const second = guess - offsetMinutes(first, timeZone) * 60_000;
  // A DST jump at midnight has no 00:00. Choose the first valid instant on that local day.
  const instant = offsetMinutes(second, timeZone) !== offsetMinutes(first, timeZone) ? Math.max(first, second) : second;
  return new Date(instant).toISOString();
}

export function localDate(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

export function localDateIso(instant: Date, timeZone: string): string {
  const {year, month, day} = localDate(instant, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
