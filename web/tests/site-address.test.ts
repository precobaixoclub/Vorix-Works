import { describe, expect, it } from "vitest";
import { cleanHostname, domainRecords, pointRecordType, siteSlugProblem, toSiteSlug } from "@/features/sites/site-address";

describe("endereço do site", () => {
  it("transforma o texto digitado num endereço válido", () => {
    expect(toSiteSlug("  Loja da Ana! ")).toBe("loja-da-ana");
    expect(toSiteSlug("Café & Pão--Quente")).toBe("cafe-pao-quente");
    expect(siteSlugProblem("ab")).toMatch(/pelo menos 3/);
    expect(siteSlugProblem("www")).toMatch(/reservado/);
    expect(siteSlugProblem("Loja")).toMatch(/sem acento/);
    expect(siteSlugProblem("bambilu-kids")).toBeUndefined();
  });

  it("limpa o domínio colado com https, caminho e porta", () => {
    expect(cleanHostname("https://WWW.Loja.com.br/produtos?x=1")).toBe("www.loja.com.br");
  });

  it("monta os nomes dos registros DNS relativos ao domínio registrado", () => {
    expect(domainRecords("www.loja.com.br")).toEqual({ zone: "loja.com.br", apex: false, txtName: "_vorix-site.www", txtFullName: "_vorix-site.www.loja.com.br", pointName: "www" });
    expect(domainRecords("loja.com.br")).toMatchObject({ zone: "loja.com.br", apex: true, txtName: "_vorix-site", pointName: "@" });
    expect(domainRecords("shop.minhaloja.com")).toMatchObject({ zone: "minhaloja.com", txtName: "_vorix-site.shop", pointName: "shop" });
    expect(pointRecordType("143.198.47.74")).toBe("A");
    expect(pointRecordType("sites.vorixworks.com")).toBe("CNAME");
  });
});
