import { describe, expect, it } from "vitest";
import { centsFromCurrencyInput, currencyInputFromCents, maskCurrencyInput } from "@/features/crm/presentation";

describe("máscara de moeda", () => {
  it("digitação entra pela direita (estilo caixa)", () => {
    expect(maskCurrencyInput("1")).toBe("0,01");
    expect(maskCurrencyInput("1234")).toBe("12,34");
    expect(maskCurrencyInput("123456789")).toBe("1.234.567,89");
    expect(maskCurrencyInput("")).toBe("");
    expect(maskCurrencyInput("abc")).toBe("");
  });

  it("colar um valor formatado mantém o valor", () => {
    expect(maskCurrencyInput("R$ 1.500,00")).toBe("1.500,00");
    expect(maskCurrencyInput("0001")).toBe("0,01");
  });

  it("ida e volta centavos → texto → centavos nunca multiplica por 100 (bug antigo)", () => {
    for (const cents of [1, 99, 100, 1_234, 950_000, 123_456_789]) {
      expect(centsFromCurrencyInput(currencyInputFromCents(cents))).toBe(cents);
      expect(centsFromCurrencyInput(maskCurrencyInput(currencyInputFromCents(cents)))).toBe(cents);
    }
  });

  it("aceita formatos antigos com ponto decimal e inteiros", () => {
    expect(centsFromCurrencyInput("1234.56")).toBe(123_456);
    expect(centsFromCurrencyInput("12,5")).toBe(1_250);
    expect(centsFromCurrencyInput("1.500")).toBe(150_000);
    expect(centsFromCurrencyInput("")).toBe(0);
  });

  it("vazio continua vazio ao formatar", () => {
    expect(currencyInputFromCents(undefined)).toBe("");
    expect(currencyInputFromCents(0)).toBe("");
  });
});
