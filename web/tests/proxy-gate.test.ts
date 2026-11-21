import { describe, expect, it } from "vitest";
import { config } from "../proxy";

// O matcher do proxy é a regex de caminho que decide ONDE o gate roda. Rotas de SEO servidas pelo
// Next (robots.txt/sitemap.xml) precisam ficar FORA, senão o gate as manda para /login.
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe("proxy matcher", () => {
  it("permite a assinatura pública do TikTok e mantém o gate nos demais caminhos", () => {
    for (const signature of ["tiktokivf7sejlxrTAtBwlHjPxbb3pctonJMBF.txt", "tiktokmfzCQL44MQEzjMYPD7291ptrWEFFSnoT.txt"]) {
      expect(matcher.test(`/${signature}`)).toBe(false);
      expect(matcher.test(`/workspaces/${signature}`)).toBe(true);
      expect(matcher.test(`/${signature}/private`)).toBe(true);
    }
    expect(matcher.test("/tiktok/callback")).toBe(true);
  });

  it("não intercepta robots.txt e sitemap.xml (SEO)", () => {
    expect(matcher.test("/robots.txt")).toBe(false);
    expect(matcher.test("/sitemap.xml")).toBe(false);
  });

  it("continua rodando nas rotas de app/públicas que dependem do gate", () => {
    expect(matcher.test("/workspaces/abc")).toBe(true);
    expect(matcher.test("/login")).toBe(true);
    expect(matcher.test("/precos")).toBe(true);
  });

  it("segue ignorando os assets internos", () => {
    expect(matcher.test("/_next/static/chunk.js")).toBe(false);
    expect(matcher.test("/icon.svg")).toBe(false);
  });
});
