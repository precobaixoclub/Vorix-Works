import { describe, expect, it } from "vitest";
import { formatDate } from "../lib/format";

describe("datas de validade", () => {
  it("preserva o dia da proposta em fusos diferentes", () => {
    const original = process.env.TZ;
    try {
      for (const timezone of ["America/Sao_Paulo", "America/Los_Angeles", "Asia/Tokyo"]) {
        process.env.TZ = timezone;
        expect(formatDate("2027-12-31")).toBe("31 de dez. de 2027");
        expect(formatDate("2027-01-01")).toBe("01 de jan. de 2027");
      }
    } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
  });

  it("continua tratando horários com timezone como instantes e aceita ausência de data", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/Sao_Paulo";
      expect(formatDate("2027-12-31T00:00:00Z")).toBe("30 de dez. de 2027");
      expect(formatDate(undefined)).toBe("—");
      expect(formatDate("invalid")).toBe("—");
    } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
  });
});
