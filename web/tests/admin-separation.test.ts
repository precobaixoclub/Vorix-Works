import { describe, expect, it } from "vitest";
import { ADMIN_NAV_GROUPS, ADMIN_SETTINGS_ITEMS, activeAdminItem } from "@/components/admin/admin-navigation";
import { MARKETING_BACKSTAGE_NAV, backstageItemsFor, canUseBackstage, isPlatformOnlyPath } from "@/components/workspace-navigation";

describe("Fase 11 — operação técnica do cliente × ferramentas internas da plataforma", () => {
  it("cliente (owner/admin) vê as ferramentas do próprio workspace, sem a operação da plataforma", () => {
    expect(backstageItemsFor(false).map((item) => item.href)).toEqual(["/planning", "/runtime", "/execution", "/publications", "/providers", "/governance"]);
    expect(backstageItemsFor(true)).toEqual(MARKETING_BACKSTAGE_NAV);
  });
  it("a rota de operação da plataforma é reconhecida (inclusive subcaminhos), as demais não", () => {
    expect(isPlatformOnlyPath("/workspaces/ws/operations", "/workspaces/ws")).toBe(true);
    expect(isPlatformOnlyPath("/workspaces/ws/operations/filas", "/workspaces/ws")).toBe(true);
    expect(isPlatformOnlyPath("/workspaces/ws/operationsx", "/workspaces/ws")).toBe(false);
    expect(isPlatformOnlyPath("/workspaces/ws/planning", "/workspaces/ws")).toBe(false);
  });
  it("papéis: só owner/admin entram no bastidor (regra existente preservada)", () => {
    expect(canUseBackstage("owner")).toBe(true);
    expect(canUseBackstage("admin")).toBe(true);
    expect(canUseBackstage("editor")).toBe(false);
    expect(canUseBackstage(undefined)).toBe(false);
  });
});

describe("Fase 11 — menu da Administração da Vorix", () => {
  const items = ADMIN_NAV_GROUPS.flatMap((group) => group.items);

  it("todas as telas existentes continuam acessíveis, sem duplicar e sem categoria vazia", () => {
    for (const setting of ADMIN_SETTINGS_ITEMS) expect(items.map((item) => item.href), setting.route).toContain(setting.route);
    expect(items.map((item) => item.href)).toEqual(expect.arrayContaining(["/admin", "/admin/growth", "/admin/tenants", "/admin/configuracoes"]));
    expect(new Set(items.map((item) => item.href)).size).toBe(items.length);
    expect(ADMIN_NAV_GROUPS.every((group) => group.items.length > 0)).toBe(true);
  });

  it("item ativo pela rota mais específica (detalhe do cliente, rota antiga do Site)", () => {
    expect(activeAdminItem("/admin")).toBe("/admin");
    expect(activeAdminItem("/admin/tenants/t-1")).toBe("/admin/tenants");
    expect(activeAdminItem("/admin/settings")).toBe("/admin/settings");
    expect(activeAdminItem("/admin/site-commerce")).toBe("/admin/site");
    expect(activeAdminItem("/admin/configuracoes")).toBe("/admin/configuracoes");
    expect(activeAdminItem("/workspaces")).toBeUndefined();
  });
});
