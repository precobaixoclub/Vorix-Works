import { expect, test, type Page, type Route } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";
import { TINY_JPEG_BASE64 } from "./fixtures/media-fixtures";
import { readFileSync } from "node:fs";

const IMAGE = `https://studio-fixture.test/uploads/assets/tenant-qa/${WORKSPACE_ID}/autopilot/${"original-".repeat(25)}.jpg?exp=9999999999&sig=preview`;
const ART = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><defs><radialGradient id="g"><stop stop-color="#6c33ac"/><stop offset="1" stop-color="#101019"/></radialGradient></defs><rect width="1080" height="1350" fill="#101019"/><circle cx="900" cy="150" r="470" fill="url(#g)"/><rect width="14" height="1350" fill="#9e3dff"/><text x="90" y="160" fill="#a47aff" font-size="27" font-family="Arial" letter-spacing="7">ATENDIMENTO COM CONTEXTO</text><g fill="white" font-family="Arial" font-size="112" font-weight="bold"><text x="85" y="390">A conversa</text><text x="85" y="520">acabou.</text><text x="85" y="685">O contexto</text><text x="85" y="815">precisa ficar.</text></g><rect x="90" y="880" width="550" height="9" rx="4" fill="#9e3dff"/><text x="90" y="1220" fill="white" font-size="28" font-family="Arial" letter-spacing="3">VORIX WORKS</text></svg>`;
const TITLE = "A conversa acabou. O contexto precisa ficar.";
const CAPTION = `${TITLE}\n\nConsulte o que já foi dito antes de responder. #Vorix`;
type Calls = { posts: Record<string, unknown>[]; uploads: number; fail?: boolean; failTarget?: string; resultState?: string; failedHistory?: boolean; creatorBlocked?: boolean; publicCreator?: boolean; durationLimit?: number };
const VIDEO_URL = "https://studio-fixture.test/tiktok-two-seconds.mp4";
const VIDEO = readFileSync("e2e/fixtures/tiktok-two-seconds.mp4");
const ok = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ ok: true, data }) });

async function setup(page: Page, calls: Calls) {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await loginCookie(page.context());
  await page.context().addCookies([{ name: "zuno_csrf_token", value: "studio-test-csrf", url: "http://localhost:3001" }]);
  await mockConversasBackend(page);
  await page.route("https://studio-fixture.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: ART }));
  await page.route(VIDEO_URL, route => route.fulfill({ contentType: "video/mp4", body: VIDEO }));
  await page.route("**/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/v1/solutions") return ok(route, { solutions: [{ key: "marketing", name: "Marketing", internal: false }] });
    if (path === "/v1/tiktok/creator-info") {
      if (calls.creatorBlocked) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "spam_risk_too_many_posts", message: "Esta conta atingiu o limite de publicações. Tente mais tarde." } }) });
      return ok(route, { credentialReferenceId: "credential-tiktok", creatorNickname: "Vorix Works ao vivo", creatorUsername: "vorixworks", privacyLevelOptions: calls.publicCreator ? ["PUBLIC_TO_EVERYONE", "SELF_ONLY"] : ["FOLLOWER_OF_CREATOR", "SELF_ONLY"], commentDisabled: true, duetDisabled: true, stitchDisabled: true, maxVideoPostDurationSec: calls.durationLimit ?? 60, sandbox: !calls.publicCreator });
    }
    if (path.includes("/publication-providers/") && path.endsWith("/oauth/status")) {
      const network = path.split("/")[3];
      const accounts = network === "meta" ? ["instagram", "facebook"] : network === "tiktok" ? ["tiktok"] : [];
      return ok(route, { configured: true, connected: accounts.length > 0, accounts: accounts.map(providerId => ({ providerId, credentialReferenceId: `credential-${providerId}`, status: "active", displayName: providerId === "instagram" ? "@vorixworks_oficial" : "Vorix Works", scopes: [] })), telemetry: {} });
    }
    if (path === "/v1/social/posts") return ok(route, { posts: [{ id: "post-original", state: "PUBLISHED", createdAt: "2026-11-19T14:41:00Z", requiresApproval: false, destinations: ["instagram", "facebook"].map(network => ({ id: `dest-${network}`, network, state: "PUBLISHED", format: "feed_image", caption: CAPTION, media: [{ kind: "image", url: IMAGE }], publishedAt: "2026-11-19T14:41:00Z" })), history: [] }] });
    if (path === "/v1/publication-media/upload") { calls.uploads++; const video = request.postDataBuffer()?.includes(Buffer.from("video/mp4")); return ok(route, { url: video ? VIDEO_URL : IMAGE + `&upload=${calls.uploads}`, sizeBytes: 1024, contentType: video ? "video/mp4" : "image/jpeg" }); }
    if (path === "/v1/publications/new-post") return ok(route, { failures: [{ code: "url_ownership_unverified", message: "Please review our URL ownership verification rules" }], attempts: [] });
    if (["/v1/instagram/posts", "/v1/tiktok/posts", "/v1/youtube/posts"].includes(path)) {
      if (request.method() === "GET") return ok(route, calls.failedHistory && path === "/v1/tiktok/posts" ? [{ publicationId: "new-post", state: "failed", description: CAPTION, media: { imageUrls: [IMAGE] }, createdAt: new Date().toISOString() }] : []);
      calls.posts.push(request.postDataJSON());
      if (calls.fail || (calls.failTarget && request.postDataJSON().target === calls.failTarget)) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "REJECTED", message: "Não foi possível publicar. Revise sua conta.", recoverable: true } }) });
      return ok(route, { publicationId: "new-post", state: calls.resultState || (request.postDataJSON().scheduledAt ? "approved" : "published"), scheduledAt: request.postDataJSON().scheduledAt });
    }
    return route.fallback();
  });
  await page.goto(`/workspaces/${WORKSPACE_ID}/publish`);
  await expect(page.getByRole("heading", { name: "Vamos publicar?", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Selecionar Instagram" })).toBeEnabled();
}

async function useLibrary(page: Page) {
  await page.getByRole("button", { name: "Escolher da biblioteca" }).click();
  const dialog = page.getByRole("dialog", { name: "Escolha seu conteúdo" });
  await dialog.getByRole("textbox", { name: "Buscar na biblioteca" }).fill("contexto");
  await expect(dialog.getByRole("button", { name: /Usar conteúdo/ })).toHaveCount(1);
  await dialog.getByRole("button", { name: /Usar conteúdo/ }).click();
  await expect(page.getByLabel("A legenda que acompanha")).toHaveValue(CAPTION);
}

test("biblioteca visual, prévia e layout sem sobreposição nem URLs expostas", async ({ page }, testInfo) => {
  await setup(page, { posts: [], uploads: 0 });
  await useLibrary(page);
  await page.getByRole("checkbox", { name: "Selecionar Instagram" }).click();
  await page.getByRole("checkbox", { name: "Selecionar Facebook" }).click();
  await expect(page.getByRole("button", { name: "Publicar agora", exact: true }).last()).toBeEnabled();
  await expect(page.getByRole("button", { name: "Publicar agora", exact: true }).last()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator("main").last().innerText()).not.toContain("https://studio-fixture.test");
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    const editor = await page.getByRole("region", { name: "O que vamos compartilhar?" }).boundingBox();
    const preview = await page.getByRole("region", { name: "Prévia da publicação" }).boundingBox();
    expect(editor!.x + editor!.width).toBeLessThanOrEqual(preview!.x);
    await expect(page.getByAltText("Prévia da imagem 1")).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath("publish-studio.png") });
  await page.getByRole("heading", { name: "O momento certo" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("publish-schedule.png") });
});

test("upload, remoção e confirmação enviam a mídia e a conta escolhidas", async ({ page }) => {
  const calls: Calls = { posts: [], uploads: 0 };
  await setup(page, calls);
  await page.getByRole("checkbox", { name: "Selecionar Instagram" }).click();
  await page.locator('input[type="file"][aria-label="Adicionar imagens"]').setInputFiles([{ name: "original.jpg", mimeType: "image/jpeg", buffer: Buffer.from(TINY_JPEG_BASE64, "base64") }]);
  await expect(page.getByAltText("Imagem 1 da publicação")).toBeVisible();
  await page.getByRole("button", { name: "Remover imagem 1" }).click();
  await expect(page.getByAltText("Imagem 1 da publicação")).toHaveCount(0);
  await useLibrary(page);
  await page.getByRole("button", { name: "Publicar agora", exact: true }).last().click();
  await expect(page.getByRole("alertdialog")).toContainText("@vorixworks_oficial");
  expect(calls.posts).toHaveLength(0);
  await page.getByRole("button", { name: "Continuar editando" }).click();
  expect(calls.posts).toHaveLength(0);
  await page.getByRole("button", { name: "Publicar agora", exact: true }).last().click();
  await page.getByRole("button", { name: "Confirmar publicação" }).click();
  await expect.poll(() => calls.posts.length).toBe(1);
  expect(calls.posts[0]).toMatchObject({ workspaceId: WORKSPACE_ID, target: "instagram", caption: CAPTION, imageUrls: [IMAGE], credentialReferenceId: "credential-instagram", placement: "feed" });
});

test("agendamento usa o fuso escolhido e exige uma data no futuro", async ({ page }) => {
  const calls: Calls = { posts: [], uploads: 0 };
  await setup(page, calls);
  await useLibrary(page);
  await page.getByRole("checkbox", { name: "Selecionar Facebook" }).click();
  await page.getByRole("button", { name: /^Agendar Escolha/ }).click();
  await page.getByLabel("Data e horário").fill("2020-11-22T12:30");
  await expect(page.getByRole("button", { name: "Agendar publicação", exact: true })).toBeDisabled();
  await page.getByLabel("Data e horário").fill("2031-11-22T12:30");
  await page.getByRole("button", { name: "Agendar publicação", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect.poll(() => calls.posts.length).toBe(1);
  expect(calls.posts[0]).toMatchObject({ scheduledAt: "2031-11-22T15:30:00.000Z", timezone: "America/Sao_Paulo", target: "facebook" });
  await expect(page.locator('#publish-feedback[data-tone="success"]')).toContainText("Agendado.");
});

test("TikTok exige privacidade explícita e mantém conteúdo quando o envio falha", async ({ page }) => {
  const calls: Calls = { posts: [], uploads: 0, fail: true };
  await setup(page, calls);
  await useLibrary(page);
  await page.getByRole("checkbox", { name: "Selecionar TikTok" }).click();
  await expect(page.getByRole("button", { name: "Publicar agora", exact: true }).last()).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Permitir comentários" })).not.toBeChecked();
  await page.getByRole("combobox", { name: "Quem pode ver?" }).click();
  await page.getByRole("option", { name: "Só eu", exact: true }).click();
  await page.getByRole("checkbox", { name: /Ao publicar, concordo/ }).check();
  await page.getByRole("button", { name: "Publicar agora", exact: true }).last().click();
  await page.getByRole("button", { name: "Confirmar publicação" }).click();
  await expect(page.locator('[role="alert"][data-tone="error"]')).toContainText("Revise sua conta");
  await expect(page.locator("#publish-feedback")).toBeInViewport();
  await expect(page.getByLabel("A legenda que acompanha")).toHaveValue(CAPTION);
  expect(calls.posts[0]).toMatchObject({ privacyLevel: "SELF_ONLY", disableComment: true, disableDuet: true, disableStitch: true });
});

test("TikTok usa permissões atuais, esconde Duet/Stitch em fotos e exige declaração comercial", async ({ page }, testInfo) => {
  const calls: Calls = { posts: [], uploads: 0 };
  await setup(page, calls);
  await useLibrary(page);
  await page.getByRole("checkbox", { name: "Selecionar TikTok" }).click();
  await expect(page.getByText("Publicando como")).toContainText("Vorix Works ao vivo");
  await expect(page.getByRole("switch", { name: /Permitir comentários/ })).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Permitir Duet" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Permitir Stitch" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Quem pode ver?" }).click();
  await expect(page.getByRole("option", { name: "Todos", exact: true })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Seguidores", exact: true })).toBeDisabled();
  await page.getByRole("option", { name: "Só eu", exact: true }).click();
  await page.getByRole("switch", { name: "Este conteúdo promove uma marca, produto ou serviço" }).check();
  await page.getByRole("checkbox", { name: /Ao publicar, concordo/ }).check();
  await expect(page.getByRole("button", { name: "Publicar agora", exact: true }).last()).toBeDisabled();
  await page.getByRole("checkbox", { name: /Sua marca/ }).check();
  await expect(page.getByRole("checkbox", { name: /Ao publicar, concordo/ })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Parceria com outra marca/ })).toBeDisabled();
  await expect(page.getByText("Sua publicação será identificada como “Conteúdo promocional”.")).toBeVisible();
  await page.getByRole("checkbox", { name: /Ao publicar, concordo/ }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("tiktok-review-ready.png"), fullPage: true });
  await page.getByRole("button", { name: "Publicar agora", exact: true }).last().click();
  expect(calls.posts).toHaveLength(0);
  await page.getByRole("button", { name: "Confirmar publicação" }).click();
  await expect.poll(() => calls.posts.length).toBe(1);
  expect(calls.posts[0]).toMatchObject({ privacyLevel: "SELF_ONLY", musicUsageAccepted: true, commercialContent: true, brandOrganic: true, brandContent: false, disableComment: true });
});

test("TikTok bloqueia postagem quando a consulta da conta retorna limite e permite atualizar", async ({ page }) => {
  const calls: Calls = { posts: [], uploads: 0, creatorBlocked: true };
  await setup(page, calls);
  await useLibrary(page);
  await page.getByRole("checkbox", { name: "Selecionar TikTok" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "atingiu o limite" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Quem pode ver?" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Publicar agora", exact: true }).last()).toBeDisabled();
  expect(calls.posts).toHaveLength(0);
  calls.creatorBlocked = false;
  await page.getByRole("button", { name: "Atualizar permissões" }).click();
  await expect(page.getByRole("combobox", { name: "Quem pode ver?" })).toBeEnabled();
});

test("TikTok parceria paga muda a declaração e não permite privacidade Só eu", async ({ page }) => {
  await setup(page, { posts: [], uploads: 0, publicCreator: true });
  await useLibrary(page);
  await page.getByRole("checkbox", { name: "Selecionar TikTok" }).click();
  await page.getByRole("switch", { name: "Este conteúdo promove uma marca, produto ou serviço" }).check();
  await page.getByRole("checkbox", { name: /Parceria com outra marca/ }).check();
  await expect(page.getByRole("link", { name: "Política de Conteúdo de Marca" })).toHaveAttribute("href", "https://www.tiktok.com/legal/page/global/bc-policy/en");
  await expect(page.getByText("Sua publicação será identificada como “Parceria paga”.")).toBeVisible();
  await page.getByRole("combobox", { name: "Quem pode ver?" }).click();
  await expect(page.getByRole("option", { name: "Só eu", exact: true })).toBeDisabled();
  await page.getByRole("option", { name: "Todos", exact: true }).click();
  await page.getByRole("checkbox", { name: /Ao publicar, concordo/ }).check();
  await expect(page.getByRole("button", { name: "Publicar agora", exact: true }).last()).toBeEnabled();
});

test("TikTok verifica duração real do vídeo e bloqueia interações desativadas pela conta", async ({ page }) => {
  const calls: Calls = { posts: [], uploads: 0, durationLimit: 1 };
  await setup(page, calls);
  await page.getByRole("checkbox", { name: "Selecionar TikTok" }).click();
  await page.getByRole("button", { name: "Vídeo", exact: true }).click();
  await page.locator('input[type="file"][aria-label="Adicionar vídeo"]').setInputFiles({ name: "video.mp4", mimeType: "video/mp4", buffer: VIDEO });
  await page.getByLabel("A legenda que acompanha").fill("Vídeo original de demonstração");
  await page.getByRole("combobox", { name: "Quem pode ver?" }).click();
  await page.getByRole("option", { name: "Só eu", exact: true }).click();
  await page.getByRole("checkbox", { name: /Ao publicar, concordo/ }).check();
  await expect(page.getByText("Limite desta conta:")).toContainText("Seu vídeo: 2 segundos");
  await expect(page.getByRole("switch", { name: /Permitir Duet/ })).toBeDisabled();
  await expect(page.getByRole("switch", { name: /Permitir Stitch/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Publicar agora", exact: true }).last()).toBeDisabled();
  expect(calls.posts).toHaveLength(0);
});

test("celular abre a prévia sem perder mídia ou legenda", async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 1024, "Prévia lateral no desktop");
  await setup(page, { posts: [], uploads: 0 });
  await useLibrary(page);
  await page.getByRole("button", { name: "Prévia", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Prévia da publicação", exact: true });
  await expect(dialog.getByAltText("Prévia da imagem 1")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("publish-preview-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("A legenda que acompanha")).toHaveValue(CAPTION);
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("sucesso parcial mantém a legenda e as imagens para revisar os destinos com erro", async ({ page }) => {
  const calls: Calls = { posts: [], uploads: 0, failTarget: "facebook" };
  await setup(page, calls);
  await useLibrary(page);
  await page.getByRole("checkbox", { name: "Selecionar Instagram" }).click();
  await page.getByRole("checkbox", { name: "Selecionar Facebook" }).click();
  await page.getByRole("button", { name: "Publicar agora", exact: true }).last().click();
  await page.getByRole("button", { name: "Confirmar publicação" }).click();
  await expect(page.locator('[data-tone="warning"]')).toContainText("Facebook Feed: Não foi possível publicar");
  await expect(page.locator("#publish-feedback")).toBeInViewport();
  await expect(page.getByLabel("A legenda que acompanha")).toHaveValue(CAPTION);
  await expect(page.getByAltText("Imagem 1 da publicação")).toBeVisible();
  expect(calls.posts).toHaveLength(2);
});

test("HTTP 200 com publicação falhada exibe o motivo real e preserva o conteúdo", async ({ page }) => {
  const calls: Calls = { posts: [], uploads: 0, resultState: "failed" };
  await setup(page, calls);
  await useLibrary(page);
  await page.getByRole("checkbox", { name: "Selecionar TikTok" }).click();
  await page.getByRole("combobox", { name: "Quem pode ver?" }).click();
  await page.getByRole("option", { name: "Só eu", exact: true }).click();
  await page.getByRole("checkbox", { name: /Ao publicar, concordo/ }).check();
  await page.getByRole("button", { name: "Publicar agora", exact: true }).last().click();
  await page.getByRole("button", { name: "Confirmar publicação" }).click();
  await expect(page.locator('#publish-feedback[data-tone="error"]')).toContainText("O domínio dos arquivos ainda não está validado no TikTok");
  await expect(page.locator("#publish-feedback")).toBeInViewport();
  await expect(page.getByLabel("A legenda que acompanha")).toHaveValue(CAPTION);
  await expect(page.getByAltText("Imagem 1 da publicação")).toBeVisible();
  await expect(page.locator('[data-tone="success"]')).toHaveCount(0);
});

test("envio pendente mostra processamento sem afirmar que publicou", async ({ page }) => {
  await setup(page, { posts: [], uploads: 0, resultState: "publishing" });
  await useLibrary(page);
  await page.getByRole("checkbox", { name: "Selecionar Instagram" }).click();
  await page.getByRole("button", { name: "Publicar agora", exact: true }).last().click();
  await page.getByRole("button", { name: "Confirmar publicação" }).click();
  await expect(page.locator('#publish-feedback[data-tone="warning"]')).toContainText("Em processamento");
  await expect(page.locator('[data-tone="success"]')).toHaveCount(0);
});

test("motivo de uma publicação já falhada pode ser consultado sem reenviar", async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1024, "Histórico lateral no desktop");
  const calls: Calls = { posts: [], uploads: 0, failedHistory: true };
  await setup(page, calls);
  await page.getByRole("button", { name: "Ver motivo", exact: true }).click();
  await expect(page.locator('#publish-feedback[data-tone="error"]')).toContainText("O domínio dos arquivos ainda não está validado no TikTok");
  expect(calls.posts).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("publication-failure-reason.png") });
});
