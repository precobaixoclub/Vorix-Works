import { expect, test } from "@playwright/test";

const proposal = {
  number: "PROP-2026-0042", version: 1, title: "Proposta de implantação e acompanhamento da operação comercial",
  customerName: "Ana Souza", customerCompany: "Empresa ABC", issuerName: "Preço Baixo Club",
  introduction: "Preparamos esta proposta para organizar o atendimento e acompanhar suas oportunidades.",
  items: [
    { name: "Implantação e configuração do atendimento", description: "Configuração, treinamento e acompanhamento da equipe comercial.", quantity: 2, unitPriceCents: 125000, subtotalCents: 250000 },
    { name: "Acompanhamento mensal", description: "Suporte à equipe e melhoria contínua da operação.", quantity: 1, unitPriceCents: 49900, subtotalCents: 49900, billingType: "monthly" },
  ],
  subtotalCents: 299900, discountCents: 5000, totalCents: 294900, currency: "BRL", validUntil: "2027-12-31",
  conditions: "Pagamento em duas parcelas.\nImplantação em até dez dias úteis.", terms: "O escopo contratado está descrito nos itens acima.",
  status: "sent", superseded: false,
  declineReasons: ["Preço", "Preço", " Preço ", "Condição", "Condição", "Prazo", "PRAZO", "Concorrente", "Concorrente", "Não tenho interesse", "Não tenho interesse", "Outro", "Outro"],
};

for (const width of [320, 390, 768, 1440]) {
  test(`proposta e recusa sem repetições ou cortes em ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    let status = "sent";
    let rejection: unknown;
    let attempts = 0;
    await page.route("**/v1/public/proposals/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/engagement")) return route.fulfill({ status: 204 });
      if (path.endsWith("/reject")) {
        attempts++;
        rejection = route.request().postDataJSON();
        if (attempts === 1) return route.fulfill({ status: 503, json: { ok: false, error: { code: "UNAVAILABLE", message: "Tente novamente.", recoverable: true } } });
        status = "rejected";
      }
      await route.fulfill({ json: { ok: true, data: { ...proposal, status } } });
    });
    await page.goto("/p/responsive-qa");
    await expect(page.getByRole("heading", { name: proposal.title, exact: true })).toBeVisible();
    await expect(page.getByText("Para Ana Souza · Empresa ABC", { exact: true })).toHaveCount(1);
    await expect(page.getByText(/Válida até/)).toHaveCount(1);
    await expect(page.getByText(/Válida até/)).toContainText("31 de dez. de 2027");
    const summary = page.getByRole("complementary", { name: "Resumo da proposta", exact: true });
    await expect(summary.getByText("Total", { exact: true })).toHaveCount(1);
    await expect(page.getByText(/R\$\s*2\.949,00/, { exact: true })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const accept = page.getByRole("button", { name: "Aceitar proposta", exact: true });
    if (width <= 640) {
      await expect(accept).toBeInViewport();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect(accept).toBeInViewport();
    }
    await page.screenshot({ path: info.outputPath(`proposal-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Recusar proposta", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Recusar proposta", exact: true });
    await expect(modal).toBeVisible();
    for (const reason of ["Preço", "Condição", "Prazo", "Concorrente", "Não tenho interesse", "Outro"]) {
      const button = modal.getByRole("button", { name: reason, exact: true });
      await expect(button).toHaveCount(1);
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await modal.getByRole("button", { name: "Prazo", exact: true }).click();
    await expect(modal.getByRole("button", { name: "Prazo", exact: true })).toHaveAttribute("aria-pressed", "true");
    await modal.getByLabel("Comentário (opcional)").fill("Precisamos ajustar a data.");
    await page.screenshot({ path: info.outputPath(`rejection-${width}.png`), fullPage: true });
    expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await modal.getByRole("button", { name: "Confirmar recusa", exact: true }).click();
    await expect(modal.getByRole("alert")).toHaveText("Tente novamente.");
    await expect(modal.getByLabel("Comentário (opcional)")).toHaveValue("Precisamos ajustar a data.");
    await modal.getByRole("button", { name: "Confirmar recusa", exact: true }).click();
    await expect(modal).toBeHidden();
    expect(rejection).toEqual({ reason: "Prazo", comment: "Precisamos ajustar a data." });
    await expect(page.getByText(/Você recusou esta proposta/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Aceitar proposta", exact: true })).toHaveCount(0);
  });
}

test("sem desconto mostra apenas o total, omite telefone como nome e imprime sem botões", async ({ page }, info) => {
  await page.route("**/v1/public/proposals/**", route => route.fulfill({ json: { ok: true, data: { ...proposal, customerName: "+118644193411194", customerCompany: undefined, discountCents: 0, totalCents: 299900 } } }));
  await page.goto("/p/print-qa");
  await expect(page.getByRole("heading", { name: proposal.title, exact: true })).toBeVisible();
  await expect(page.getByText(/118644193411194/)).toHaveCount(0);
  await expect(page.getByRole("complementary").getByText("Subtotal", { exact: true })).toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Aceitar proposta", exact: true })).toHaveCount(0);
  await page.pdf({ path: info.outputPath("proposal-print.pdf"), format: "A4", printBackground: true });
});
