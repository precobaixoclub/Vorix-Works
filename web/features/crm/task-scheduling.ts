/** Jornada Comercial Fase 3 — atalhos de data ("Quick date", item 13 do pedido) e a regra de qual
 * negócio associar a uma tarefa nova (item 9). Compartilhado por `QuickCreateTaskModal` e
 * `RescheduleTaskPopover`, nunca reimplementado por tela (item 28: nenhuma lógica duplicada). */

export type QuickDueShortcut = "today" | "tomorrow" | "in2days" | "nextweek";

export const QUICK_DUE_SHORTCUTS: ReadonlyArray<{ id: QuickDueShortcut; label: string; days: number }> = [
  { id: "today", label: "Hoje", days: 0 },
  { id: "tomorrow", label: "Amanhã", days: 1 },
  { id: "in2days", label: "+2 dias", days: 2 },
  { id: "nextweek", label: "Próxima semana", days: 7 },
];

const DEFAULT_QUICK_TIME = "09:00";

/** Valor local do input, preservando a hora digitada (09:00 quando vazio).
 * Os formulários convertem para ISO no envio; a API persiste um instante em timestamptz.
 * O fuso continua sendo o do navegador, sem configuração nova de workspace. */
export function quickDueDate(shortcut: QuickDueShortcut, currentValue: string, now: Date = new Date()): string {
  const config = QUICK_DUE_SHORTCUTS.find((item) => item.id === shortcut);
  const days = config?.days ?? 0;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const time = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(currentValue) ? currentValue.slice(11, 16) : DEFAULT_QUICK_TIME;
  return `${formatLocalDate(target)}T${time}`;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Converte um `dueAt` já salvo para o valor que `<input type="datetime-local">` espera —
 * aceita tanto o formato local já usado pelo app quanto qualquer string parseável por `Date`. */
export function toDatetimeLocalValue(dueAt: string | undefined): string {
  if (!dueAt) return "";
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return "";
  return `${formatLocalDate(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export type TaskDealChoice =
  | { mode: "none" }
  | { mode: "auto"; dealId: string }
  | { mode: "choose"; options: ReadonlyArray<{ id: string; title: string }> };

/** Item 9 do pedido — nunca escolhe um negócio errado em silêncio: com exatamente 1 negócio
 * aberto, usa ele automaticamente (item 7: "não perguntar de novo"); com mais de 1, força uma
 * escolha explícita (ou "Sem negócio"); sem nenhum, a tarefa fica vinculada só ao Contact (item 8). */
export function resolveTaskDealChoice(openDeals: ReadonlyArray<{ id: string; title: string }>): TaskDealChoice {
  if (openDeals.length === 0) return { mode: "none" };
  if (openDeals.length === 1) return { mode: "auto", dealId: openDeals[0].id };
  return { mode: "choose", options: openDeals };
}
