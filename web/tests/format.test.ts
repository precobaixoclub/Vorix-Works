import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatRelativeTime } from "../lib/format";

describe("formatDate", () => {
  it("formata uma data ISO válida", () => {
    expect(formatDate("2026-03-05T00:00:00.000Z")).toMatch(/2026/);
  });

  it("devolve travessão para undefined", () => {
    expect(formatDate(undefined)).toBe("—");
  });

  it("devolve travessão para uma string inválida", () => {
    expect(formatDate("não é uma data")).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("formata data e hora juntas", () => {
    const result = formatDateTime("2026-03-05T14:30:00.000Z");
    expect(result).toMatch(/2026/);
    expect(result).not.toBe("—");
  });

  it("devolve travessão para undefined", () => {
    expect(formatDateTime(undefined)).toBe("—");
  });
});

describe("formatRelativeTime", () => {
  it("formata um instante recente em minutos", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(fiveMinutesAgo)).toMatch(/minuto/);
  });

  it("devolve travessão para undefined", () => {
    expect(formatRelativeTime(undefined)).toBe("—");
  });
});
