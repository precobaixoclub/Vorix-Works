import { describe, expect, it } from "vitest";
import { hasLink, hrefFor, splitLinks } from "@/lib/linkify";

const links = (text: string) => splitLinks(text).filter((part) => part.kind === "link").map((part) => part.kind === "link" ? [part.text, part.href] : []);

describe("splitLinks — links clicáveis em texto livre", () => {
  it("encontra http(s), www. e e-mail, preservando o texto em volta", () => {
    const parts = splitLinks("Veja https://vorixworks.com/precos e www.exemplo.com.br ou fale com ana@empresa.com.br!");
    expect(parts.map((part) => part.text).join("")).toBe("Veja https://vorixworks.com/precos e www.exemplo.com.br ou fale com ana@empresa.com.br!");
    expect(links("Veja https://vorixworks.com/precos e www.exemplo.com.br ou fale com ana@empresa.com.br!")).toEqual([
      ["https://vorixworks.com/precos", "https://vorixworks.com/precos"],
      ["www.exemplo.com.br", "https://www.exemplo.com.br/"],
      ["ana@empresa.com.br", "mailto:ana@empresa.com.br"],
    ]);
  });

  it("não engole a pontuação final nem o parêntese de fechamento", () => {
    expect(links("Acesse https://a.com/x.")).toEqual([["https://a.com/x", "https://a.com/x"]]);
    expect(links("(link: https://a.com/p?q=1)")).toEqual([["https://a.com/p?q=1", "https://a.com/p?q=1"]]);
    expect(links("https://pt.wikipedia.org/wiki/Teste_(desambiguação)")[0]?.[0]).toBe("https://pt.wikipedia.org/wiki/Teste_(desambiguação)");
  });

  it("mantém quebras de linha, query e âncora", () => {
    const parts = splitLinks("Linha 1\nhttps://loja.com/produto?id=7&cor=azul#fotos\nLinha 3");
    expect(parts).toHaveLength(3);
    expect(parts[1]).toMatchObject({ kind: "link", text: "https://loja.com/produto?id=7&cor=azul#fotos" });
  });

  it("nunca gera endereço inseguro", () => {
    expect(hrefFor("javascript:alert(1)")).toBeUndefined();
    expect(links("javascript:alert(1) data:text/html,oi")).toEqual([]);
    expect(hasLink("texto sem link nenhum")).toBe(false);
    expect(hasLink("")).toBe(false);
    expect(hasLink(undefined)).toBe(false);
  });
});
