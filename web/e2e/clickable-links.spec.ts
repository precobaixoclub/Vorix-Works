import { expect, test } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

/** Links clicáveis em texto livre: mensagens e notas da conversa (API simulada, nada é enviado). */
test.describe("links clicáveis", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("mensagem e nota interna da conversa mostram links clicáveis e seguros; texto comum continua texto", async ({ page }) => {
    await loginCookie(page.context());
    await mockConversasBackend(page);
    const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    await page.route(/\/v1\/inbox\/conversations\/conv-text\/messages(?:\?|$)/, (route) => route.fulfill({ json: { ok: true, data: { messages: [
      { id: "l1", conversationId: "conv-text", direction: "inbound", type: "text", status: "read", body: "Vi este modelo em https://loja.exemplo.com.br/produto?id=7. Tem em azul?", sentByAi: false, sentByAutomation: false, reactions: [], createdAt: at(10) },
      { id: "l2", conversationId: "conv-text", direction: "outbound", type: "text", status: "delivered", body: "Tem sim! Catálogo: www.vorixworks.com e dúvidas em atendimento@exemplo.com", sentByAi: false, sentByAutomation: false, reactions: [], createdAt: at(5) },
      { id: "l3", conversationId: "conv-text", direction: "inbound", type: "text", status: "read", body: "javascript:alert(1) não é link", sentByAi: false, sentByAutomation: false, reactions: [], createdAt: at(2) },
    ] } } }));
    await page.route(/\/v1\/inbox\/conversations\/conv-text\/events(?:\?|$)/, (route) => route.fulfill({ json: { ok: true, data: { events: [
      { id: "e1", conversationId: "conv-text", type: "note_added", performedBy: "user-qa", metadata: { text: "Proposta enviada: https://app.exemplo.com/p/abc" }, createdAt: at(4) },
    ] } } }));

    await page.goto(`/workspaces/${WORKSPACE_ID}/conversas?conversation=conv-text`);
    const product = page.getByRole("link", { name: "https://loja.exemplo.com.br/produto?id=7" });
    await expect(product).toHaveAttribute("href", "https://loja.exemplo.com.br/produto?id=7");
    await expect(product).toHaveAttribute("target", "_blank");
    await expect(product).toHaveAttribute("rel", /noopener/);
    await expect(page.getByRole("link", { name: "www.vorixworks.com" })).toHaveAttribute("href", "https://www.vorixworks.com/");
    await expect(page.getByRole("link", { name: "atendimento@exemplo.com" })).toHaveAttribute("href", "mailto:atendimento@exemplo.com");
    await expect(page.getByRole("link", { name: "https://app.exemplo.com/p/abc" })).toHaveAttribute("href", "https://app.exemplo.com/p/abc");
    // O ponto final fica fora do link e o texto em volta continua igual.
    await expect(page.getByText("Vi este modelo em https://loja.exemplo.com.br/produto?id=7. Tem em azul?")).toBeVisible();
    await expect(page.getByRole("link", { name: /javascript/ })).toHaveCount(0);

    // Clicar abre em nova aba sem tirar a pessoa da conversa.
    const popup = page.waitForEvent("popup");
    await page.route("https://loja.exemplo.com.br/**", (route) => route.fulfill({ body: "ok" }));
    await product.click();
    await (await popup).close();
    await expect(page).toHaveURL(/conversation=conv-text/);
  });
});
