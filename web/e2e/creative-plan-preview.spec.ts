import { expect, test } from "@playwright/test";
import { OWNER_PERMISSIONS } from "./fixtures/access-fixture";
import { loginCookie, mockConversasBackend, TENANT_ID, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Motor criativo — prévia "Como a arte será produzida" no Bolsão (API simulada; nada é gerado nem
 * publicado). A pessoa vê o tipo de peça, o material principal, o papel de cada arquivo, o que fica
 * de fora e o que falta antes de gerar.
 */
const now = new Date().toISOString();
const IDEAS = [
  { id: "i-cmkv", externalId: "CMKV-001", title: "Nova estampa Be Yourself", category: "Vitrine", commercialObjective: "", targetAudience: "", concept: "", keyMessage: "Be Yourself, do seu jeito", format: "single_image", approach: "", visualDirection: "", narrativeStructure: "", caption: "", cta: "", priority: "normal", status: "available", statusChangedAt: now, referenceImages: ["https://cdn.example.test/produto.png", "https://cdn.example.test/site.png"] },
  { id: "i-vorix", externalId: "VWX-001", title: "O histórico continua", category: "Conversas", commercialObjective: "", targetAudience: "", concept: "", keyMessage: "O atendimento muda de pessoa. O histórico continua.", format: "single_image", approach: "", visualDirection: "", narrativeStructure: "", caption: "", cta: "", priority: "normal", status: "available", statusChangedAt: now },
];
const PLANS: Record<string, unknown> = {
  "i-cmkv": {
    businessKind: "physical_products", mode: "physical_product", modeLabel: "Produto físico", modeReasons: ["A pauta tem a fotografia de um produto selecionada — a peça anuncia esse produto e preserva a foto original."], feature: null, blocked: false, guidance: [], autoSelected: [],
    references: [
      { id: "produto:000048:Azul-Marinho", role: "product_photo", roleLabel: "Fotografia do produto", roleReason: "", source: "catalog", productCode: "000048", variantLabel: "Azul-Marinho", url: "https://cdn.example.test/produto.png", principal: true, used: true },
      { id: "site", role: "site_capture", roleLabel: "Captura de site", roleReason: "", source: "brand_library", name: "Home da loja", url: "https://cdn.example.test/site.png", principal: false, used: false, excludedReason: "Captura de tela/site não substitui a fotografia original do produto." },
    ],
    screens: [{ index: 1, headline: "Be Yourself, do seu jeito", archetype: "product_studio", compositionLabel: "Produto em destaque (estúdio)", operation: "deterministic_composite", intent: "A peça original recortada, grande e centralizada.", fidelity: [], avoid: [] }],
  },
  "i-vorix": {
    businessKind: "software", mode: "software", modeLabel: "Software e aplicativos", modeReasons: ["A pauta divulga a funcionalidade \"Histórico e continuidade do atendimento\"."], feature: { key: "continuidade_atendimento", label: "Histórico e continuidade do atendimento" }, blocked: true,
    guidance: [{ code: "SOFTWARE_CAPTURE_MISSING", blocking: true, message: "Para demonstrar \"Histórico e continuidade do atendimento\" é preciso uma captura real da tela." }], autoSelected: [], references: [],
    screens: [{ index: 1, headline: "O atendimento muda de pessoa.", archetype: "ui_focus", compositionLabel: "Foco na funcionalidade", operation: "deterministic_composite", intent: "Janela com a captura real e um cartão ampliado.", fidelity: [], avoid: [] }],
  },
};

test.describe("Bolsão — como a arte será produzida", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("mostra o tipo de peça, o material principal, o que fica de fora e o que falta — sem gerar nada", async ({ page }) => {
    const writes: string[] = [];
    await loginCookie(page.context());
    await mockConversasBackend(page);
    await page.route("https://cdn.example.test/**", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89+P/fwAJiAPmBTOYqwAAAABJRU5ErkJggg==", "base64") }));
    await page.route("**/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const ok = (data: unknown) => route.fulfill({ json: { ok: true, data } });
      if (!["GET", "HEAD"].includes(request.method()) && !url.pathname.startsWith("/v1/auth/") && !url.pathname.endsWith("/stream-token")) writes.push(`${request.method()} ${url.pathname}`);
      if (url.pathname === "/v1/auth/me") return ok({ user: { id: "user-qa", email: "qa@vorix.dev", name: "QA", isPlatformAdmin: false }, tenantId: TENANT_ID, role: "owner", permissions: OWNER_PERMISSIONS, teams: [], isAccountOwner: true });
      if (url.pathname === "/v1/solutions") return ok({ solutions: ["conversations", "marketing"].map((key) => ({ key, name: key, internal: false })) });
      if (url.pathname === "/v1/editorial-ideas") return ok(IDEAS);
      const plan = /^\/v1\/editorial-ideas\/([^/]+)\/creative-plan$/.exec(url.pathname);
      if (plan) {
        expect(url.searchParams.get("workspaceId")).toBe(WORKSPACE_ID);
        return ok(PLANS[plan[1]]);
      }
      return route.fallback();
    });

    await page.goto(`/workspaces/${WORKSPACE_ID}/ideias`);
    await page.getByText("Nova estampa Be Yourself").first().click();
    const panel = page.getByTestId("creative-plan");
    await expect(panel.getByTestId("creative-plan-mode")).toHaveText("Produto físico");
    await expect(panel).toContainText("Material principal: Fotografia do produto · modelo 000048 · Azul-Marinho");
    await expect(panel).toContainText("Vai para a arte");
    await expect(panel).toContainText("Captura de tela/site não substitui a fotografia original do produto.");
    await expect(panel).toContainText("Produto em destaque (estúdio)");
    await page.keyboard.press("Escape");

    await page.getByText("O histórico continua").first().click();
    await expect(page.getByTestId("creative-plan-mode")).toHaveText("Software e aplicativos · Histórico e continuidade do atendimento");
    await expect(page.getByTestId("creative-plan-guidance")).toContainText("Antes de gerar:");
    await expect(page.getByTestId("creative-plan-guidance")).toContainText("captura real da tela");
    expect(writes).toEqual([]);
  });
});
