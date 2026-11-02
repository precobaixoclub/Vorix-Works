import { test, expect } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";
import { TINY_JPEG_BASE64 } from "./fixtures/media-fixtures";

test("envia foto da variação mesmo sem capa e mostra descrição completa com aviso de link", async ({ page }) => {
  await loginCookie(page.context());
  await mockConversasBackend(page);
  const description = "Informações técnicas\n" + "Vidro âmbar, potência 4 W.\n".repeat(45) + "FIM SEM CORTE";
  const writes: unknown[] = [];
  await page.route("**/v1/inbox/conversations/*/products**", async route => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 202, json: { ok: true, data: { id: "sent-product", type: "image", status: "queued" } } });
    }
    return route.fulfill({ json: { ok: true, data: [{ id: "lamp", name: "Lâmpada vintage", description, priceCents: 9500, currency: "BRL", hasDetailsLink: true, requiresVariant: true, variants: [{ id: "amber", label: "Âmbar", priceCents: 9500, imageUrl: `data:image/jpeg;base64,${TINY_JPEG_BASE64}` }] }] } });
  });
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await page.getByText("Carla Mendes", { exact: true }).first().click();
  await page.getByRole("button", { name: "Produtos", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Produtos", exact: true });
  await modal.getByRole("button", { name: /Lâmpada vintage/ }).click();
  await expect(modal.getByText(description, { exact: true })).toHaveText(description);
  await expect(modal.getByText("O link com os detalhes completos e as fotos vai junto.")).toBeVisible();
  await expect(modal.getByLabel("Enviar com a foto")).toBeDisabled();
  await modal.getByRole("button", { name: "Âmbar", exact: true }).click();
  await expect(modal.getByLabel("Enviar com a foto")).toBeChecked();
  await expect(modal.getByLabel("Enviar com a foto")).toBeEnabled();
  await modal.getByRole("button", { name: "Enviar ao cliente" }).click();
  await expect(modal).toBeHidden();
  expect(writes).toEqual([{ workspaceId: WORKSPACE_ID, productId: "lamp", variantId: "amber", withImage: true }]);
});
