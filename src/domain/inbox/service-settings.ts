/**
 * Regras de atendimento por WORKSPACE (Conversas): horário de atendimento + mensagem de ausência,
 * motivos de encerramento e pesquisa de satisfação (CSAT 1–5). Puro: sem I/O.
 */

export const SERVICE_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type ServiceWeekday = (typeof SERVICE_WEEKDAYS)[number];

/** "HH:MM" 24h. Um dia sem intervalos = fechado. */
export type ServiceInterval = { start: string; end: string };
export type ServiceWeeklySchedule = Record<ServiceWeekday, ServiceInterval[]>;

/** Opção do menu de triagem; a posição (1, 2, 3…) é o número que o cliente digita. */
export type TriageOption = { id: string; label: string; teamId?: string; tagId?: string; reply?: string };

export type InboxServiceSettings = {
  tenantId: string;
  workspaceId: string;
  timezone: string;
  businessHours: ServiceWeeklySchedule;
  awayEnabled: boolean;
  awayMessage: string;
  closingReasons: string[];
  requireClosingReason: boolean;
  csatEnabled: boolean;
  csatMessage: string;
  csatThanksMessage: string;
  triageEnabled: boolean;
  triageGreeting: string;
  triageOptions: TriageOption[];
  triageFallbackMessage: string;
  updatedAt?: string;
};

const WEEKDAY_HOURS: ServiceInterval[] = [{ start: "08:00", end: "18:00" }];

export function defaultInboxServiceSettings(tenantId: string, workspaceId: string): InboxServiceSettings {
  return {
    tenantId,
    workspaceId,
    timezone: "America/Sao_Paulo",
    businessHours: { mon: WEEKDAY_HOURS, tue: WEEKDAY_HOURS, wed: WEEKDAY_HOURS, thu: WEEKDAY_HOURS, fri: WEEKDAY_HOURS, sat: [], sun: [] },
    awayEnabled: false,
    awayMessage: "Olá! Recebemos sua mensagem. Nosso horário de atendimento é de segunda a sexta, das 8h às 18h. Responderemos assim que possível.",
    closingReasons: ["Dúvida respondida", "Venda realizada", "Sem interesse", "Suporte resolvido", "Sem resposta do cliente"],
    requireClosingReason: false,
    csatEnabled: false,
    csatMessage: "Seu atendimento foi finalizado. Como você avalia o atendimento que recebeu? Responda com uma nota de 1 (ruim) a 5 (excelente).",
    csatThanksMessage: "Obrigado pela sua avaliação!",
    triageEnabled: false,
    triageGreeting: "Olá! Para te atender mais rápido, escolha uma opção:",
    triageOptions: [],
    triageFallbackMessage: "Tudo bem! Vamos te encaminhar para um atendente.",
  };
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Valida e normaliza o horário (lança `INBOX_SERVICE_SETTINGS_INVALID`). Intervalos ordenados, sem sobreposição. */
export function normalizeWeeklySchedule(input: Partial<Record<string, unknown>>): ServiceWeeklySchedule {
  const schedule = {} as ServiceWeeklySchedule;
  for (const day of SERVICE_WEEKDAYS) {
    const raw = input[day];
    const intervals = Array.isArray(raw) ? raw : [];
    if (intervals.length > 4) throw new Error("INBOX_SERVICE_SETTINGS_INVALID: no máximo 4 intervalos por dia.");
    const parsed = intervals.map((interval) => {
      const { start, end } = (interval ?? {}) as { start?: unknown; end?: unknown };
      if (typeof start !== "string" || typeof end !== "string" || !TIME_PATTERN.test(start) || !TIME_PATTERN.test(end) || toMinutes(end) <= toMinutes(start)) {
        throw new Error("INBOX_SERVICE_SETTINGS_INVALID: cada intervalo precisa de início e fim (HH:MM), com o fim depois do início.");
      }
      return { start, end };
    }).sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let index = 1; index < parsed.length; index += 1) {
      if (toMinutes(parsed[index].start) < toMinutes(parsed[index - 1].end)) throw new Error("INBOX_SERVICE_SETTINGS_INVALID: os intervalos de um dia não podem se sobrepor.");
    }
    schedule[day] = parsed;
  }
  return schedule;
}

/** Dia da semana e minuto do dia NO FUSO do workspace. */
function localWeekdayAndMinute(at: Date, timezone: string): { day: ServiceWeekday; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const weekday = (parts.find((part) => part.type === "weekday")?.value ?? "Mon").slice(0, 3).toLowerCase() as ServiceWeekday;
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return { day: weekday, minute: hour * 60 + minute };
}

export function isWithinBusinessHours(settings: Pick<InboxServiceSettings, "timezone" | "businessHours">, at: Date): boolean {
  const { day, minute } = localWeekdayAndMinute(at, settings.timezone);
  return (settings.businessHours[day] ?? []).some((interval) => minute >= toMinutes(interval.start) && minute < toMinutes(interval.end));
}

const KEYCAP_DIGITS: Record<string, string> = { "1️⃣": "1", "2️⃣": "2", "3️⃣": "3", "4️⃣": "4", "5️⃣": "5" };

/** Nota 1–5 na resposta do cliente ("5", "nota 4", "4 estrelas", "5️⃣", "⭐⭐⭐"). `undefined` = não é uma nota. */
export function parseCsatScore(body: string | undefined): number | undefined {
  if (!body) return undefined;
  let text = body.trim().toLowerCase();
  for (const [emoji, digit] of Object.entries(KEYCAP_DIGITS)) text = text.split(emoji).join(digit);
  const stars = text.match(/⭐|★/g)?.length ?? 0;
  if (stars >= 1 && stars <= 5 && text.replace(/⭐|★|\s|️/g, "") === "") return stars;
  const match = /^(?:nota\s*)?([1-5])(?:\s*(?:estrelas?|de\s*5|\/\s*5))?[\s.!]*$/.exec(text);
  return match ? Number(match[1]) : undefined;
}

/** Texto do menu enviado ao cliente. */
export function triageMenuText(greeting: string, options: readonly TriageOption[]): string {
  return `${greeting}\n\n${options.map((option, index) => `*${index + 1}* - ${option.label}`).join("\n")}\n\nResponda com o número da opção.`;
}

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const KEYCAPS: Record<string, string> = { "1️⃣": "1", "2️⃣": "2", "3️⃣": "3", "4️⃣": "4", "5️⃣": "5", "6️⃣": "6", "7️⃣": "7", "8️⃣": "8", "9️⃣": "9" };

/** Opção escolhida pelo cliente: o número ("2", "opção 2", "2️⃣") ou o nome ("suporte"). `undefined` = não entendeu. */
export function matchTriageOption(body: string | undefined, options: readonly TriageOption[]): TriageOption | undefined {
  if (!body || !options.length) return undefined;
  let text = body.trim();
  for (const [emoji, digit] of Object.entries(KEYCAPS)) text = text.split(emoji).join(digit);
  const numeric = /^(?:op[cç][aã]o\s*)?(\d{1,2})[\s.)!-]*$/i.exec(text);
  if (numeric) return options[Number(numeric[1]) - 1];
  const folded = fold(text);
  if (folded.length < 3) return undefined;
  const hits = options.filter((option) => {
    const label = fold(option.label);
    return label.length > 0 && (folded === label || ` ${folded} `.includes(` ${label} `));
  });
  return hits.length === 1 ? hits[0] : undefined;
}
