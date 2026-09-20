import { describe, expect, it } from "vitest";
import { quickDueDate, resolveTaskDealChoice, toDatetimeLocalValue } from "../features/crm/task-scheduling";

const FIXED_NOW = new Date(2026, 8, 20, 10, 30); // 2026-09-20 10:30 local

describe("quickDueDate", () => {
  it("hoje mantém o dia atual com horário default quando o campo está vazio", () => {
    expect(quickDueDate("today", "", FIXED_NOW)).toBe("2026-09-20T09:00");
  });

  it("amanhã soma 1 dia", () => {
    expect(quickDueDate("tomorrow", "", FIXED_NOW)).toBe("2026-09-21T09:00");
  });

  it("+2 dias soma 2 dias", () => {
    expect(quickDueDate("in2days", "", FIXED_NOW)).toBe("2026-09-22T09:00");
  });

  it("próxima semana soma 7 dias", () => {
    expect(quickDueDate("nextweek", "", FIXED_NOW)).toBe("2026-09-27T09:00");
  });

  it("preserva a hora já digitada em vez de sobrescrever com o default", () => {
    expect(quickDueDate("tomorrow", "2026-09-20T14:00", FIXED_NOW)).toBe("2026-09-21T14:00");
  });

  it("mês/dia viram zero-padded corretamente (virada de mês)", () => {
    const endOfMonth = new Date(2026, 0, 30, 8, 0); // 2026-01-30
    expect(quickDueDate("in2days", "", endOfMonth)).toBe("2026-02-01T09:00");
  });
});

describe("toDatetimeLocalValue", () => {
  it("undefined vira string vazia", () => {
    expect(toDatetimeLocalValue(undefined)).toBe("");
  });

  it("já no formato local, só corta o excesso", () => {
    expect(toDatetimeLocalValue("2026-09-21T14:00:00.000Z".slice(0, 16))).toBe("2026-09-21T14:00");
  });

  it("string inválida vira string vazia", () => {
    expect(toDatetimeLocalValue("não é uma data")).toBe("");
    expect(toDatetimeLocalValue("2026-99-99T14:00")).toBe("");
  });

  it("restaura a hora local após a API devolver o instante em UTC", () => {
    const localValue = "2026-09-21T14:00";
    expect(toDatetimeLocalValue(new Date(localValue).toISOString())).toBe(localValue);
  });

  it("interpreta o offset em vez de cortar o horário da string", () => {
    const dueAt = "2026-09-21T14:00:00+09:00";
    const local = new Date(dueAt);
    const expected = `2026-09-21T${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
    expect(toDatetimeLocalValue(dueAt)).toBe(expected);
  });
});

describe("resolveTaskDealChoice", () => {
  it("sem negócios abertos: mode none", () => {
    expect(resolveTaskDealChoice([])).toEqual({ mode: "none" });
  });

  it("um negócio aberto: mode auto, preenchido automaticamente", () => {
    const deals = [{ id: "d1", title: "Plano Premium" }];
    expect(resolveTaskDealChoice(deals)).toEqual({ mode: "auto", dealId: "d1" });
  });

  it("múltiplos negócios abertos: mode choose, nunca escolhe sozinho", () => {
    const deals = [{ id: "d1", title: "Plano Premium" }, { id: "d2", title: "Consultoria" }];
    expect(resolveTaskDealChoice(deals)).toEqual({ mode: "choose", options: deals });
  });
});
