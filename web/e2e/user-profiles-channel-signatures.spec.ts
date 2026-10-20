import { expect, test } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";
import { TINY_JPEG_BASE64 } from "./fixtures/media-fixtures";

test.beforeEach(async ({ context, page }) => {
  await loginCookie(context);
  await mockConversasBackend(page);
});

test("usuários: cadastra nome, e-mail e foto e permite editar o perfil", async ({ page }) => {
  const members: Record<string, unknown>[] = [];
  let saved: Record<string, unknown> | undefined;
  await page.route("**/v1/tenant-members**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: unknown = [];
    if (path.endsWith("/profile")) {
      saved = request.postDataJSON();
      members[0] = { ...members[0], ...saved };
      data = members[0];
    } else if (path === "/v1/tenant-members" && request.method() === "POST") {
      saved = request.postDataJSON();
      members.push({ ...saved, password: undefined, id: "member-new", userId: "user-new", tenantId: "tenant-qa" });
      data = members[0];
    } else if (path === "/v1/tenant-members") data = members;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings/users`);
  await page.getByRole("button", { name: "Cadastrar usuário", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill("Maria Silva");
  await dialog.getByLabel("E-mail", { exact: true }).fill("maria@empresa.com");
  await dialog.getByLabel("Senha inicial").fill("Senha-inicial-123");
  await dialog.getByLabel("Foto", { exact: true }).setInputFiles({ name: "maria.jpg", mimeType: "image/jpeg", buffer: Buffer.from(TINY_JPEG_BASE64, "base64") });
  await expect(dialog.getByRole("button", { name: "Remover foto" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cadastrar usuário", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Maria Silva", { exact: true })).toBeVisible();
  await expect(page.getByText("maria@empresa.com", { exact: true })).toBeVisible();
  expect(saved?.avatarUrl).toContain("data:image/jpeg;base64,");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await dialog.getByLabel("Nome", { exact: true }).fill("Maria Oliveira");
  await dialog.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Maria Oliveira", { exact: true })).toBeVisible();
});

test("canais: identificação ao cliente começa desligada e salva ao habilitar", async ({ page }) => {
  let enabled = false;
  await page.route("**/v1/inbox/connections**", async (route) => {
    if (route.request().method() === "PATCH") enabled = route.request().postDataJSON().sendAgentName;
    const connection = { id: "conn-1", displayName: "WhatsApp QA", phoneNumber: "+5511999990000", status: "connected", connectionHealth: "healthy", sendAgentName: enabled };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: route.request().method() === "GET" ? { connections: [connection] } : connection }) });
  });
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await page.getByRole("button", { name: "Canais", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Enviar nome do atendente ao cliente" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(enabled).toBe(true);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(enabled).toBe(false);
});

test("conversa: autor aparece internamente mesmo com assinatura externa desligada", async ({ page }) => {
  await page.route("**/v1/inbox/conversations/conv-media/messages?**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { messages: [{ id: "msg-author", direction: "outbound", type: "text", status: "sent", body: "Olá, cliente!", sentByUserId: "user-maria", senderDisplayName: "Maria Silva", sentByAi: false, sentByAutomation: false, reactions: [], createdAt: new Date().toISOString() }] } }) });
  });
  await page.goto(`/workspaces/${WORKSPACE_ID}/conversas`);
  await page.getByText("Carla Mendes").click();
  await expect(page.getByText("Maria Silva", { exact: true })).toBeVisible();
  await expect(page.getByText("Olá, cliente!", { exact: true })).toBeVisible();
});
