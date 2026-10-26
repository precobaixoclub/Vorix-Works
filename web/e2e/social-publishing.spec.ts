import { expect, test, type Page, type Route } from "@playwright/test";
import { loginCookie, mockConversasBackend, WORKSPACE_ID } from "./fixtures/mock-backend";

/**
 * Vorix Marketing → Redes sociais, num Chromium real com a API mockada (providers oficiais
 * simulados — nenhuma rede real é chamada). Cobre integrações, composer multi-rede, calendário com
 * sucesso parcial e retry só do destino que falhou.
 */

const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const ok = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ ok: true, data }) });

function destination(network: "instagram" | "facebook" | "tiktok", state: string, actions: string[] = [], extra: Record<string, unknown> = {}) {
  return { id: `dest-${network}`, accountId: `acc-${network}`, network, username: "loja", format: network === "tiktok" ? "short_video" : "reel", formatLabel: network === "tiktok" ? "Vídeo curto" : "Reel", caption: "Lançamento da coleção", hashtags: ["verao"], media: [{ url: "https://cdn.example.test/v.mp4", kind: "video" }], audioMode: "EMBEDDED_AUDIO", scheduledAt: iso(-3_600_000), timezone: "America/Sao_Paulo", state, attemptCount: 1, actions, ...extra };
}

async function mockSocial(page: Page, state: { retried: boolean; created?: Record<string, unknown> }) {
  await page.route("**/v1/solutions", (route) => ok(route, { solutions: [{ key: "marketing", name: "Marketing", internal: false }] }));
  await page.route("**/v1/social/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/v1/social/settings") return ok(route, { timezone: "America/Sao_Paulo", networks: ["instagram", "facebook", "tiktok"].map((network) => ({ network, latePolicy: { toleranceMinutes: 30, whenLate: "ASK_CONFIRMATION" }, rateLimits: {} })) });
    if (path === "/v1/social/accounts") {
      return ok(route, {
        accounts: [
          { id: "acc-instagram", network: "instagram", username: "loja", displayName: "Loja", status: "HEALTHY", statusLabel: "Conectada", needsReconnect: false, waitingPublications: 0, lastSyncAt: iso(-600_000) },
          { id: "acc-facebook", network: "facebook", displayName: "Loja Página", status: "REAUTH_REQUIRED", statusLabel: "Reconexão necessária", needsReconnect: true, waitingPublications: 3, problem: "Sua conta do Facebook precisa ser reconectada." },
        ],
        networks: [
          { network: "instagram", canConnect: true },
          { network: "facebook", canConnect: true },
          { network: "tiktok", canConnect: false, message: "A publicação no TikTok ainda não está liberada para a sua conta." },
        ],
      });
    }
    if (path === "/v1/social/composer") {
      const formats = [
        { format: "reel", label: "Reel", features: ["caption", "hashtags", "embeddedAudio"], maxItems: 1, kinds: ["video"], maxCaptionLength: 2200 },
        { format: "feed_image", label: "Imagem no feed", features: ["caption", "hashtags"], maxItems: 1, kinds: ["image"], maxCaptionLength: 2200 },
      ];
      return ok(route, {
        accounts: [
          { accountId: "acc-instagram", network: "instagram", username: "loja", publishable: true, formats, musicSearch: false },
          { accountId: "acc-facebook", network: "facebook", displayName: "Loja Página", publishable: true, formats, musicSearch: false },
          { accountId: "acc-tiktok", network: "tiktok", username: "loja", publishable: true, formats: [{ format: "short_video", label: "Vídeo curto", features: ["caption", "hashtags"], maxItems: 1, kinds: ["video"], maxCaptionLength: 2200 }], musicSearch: false },
        ],
      });
    }
    if (path === "/v1/social/posts/validate") {
      const body = request.postDataJSON() as { destinations: { accountId: string; format: string }[] };
      return ok(route, { destinations: body.destinations.map((item) => ({ accountId: item.accountId, network: item.accountId.replace("acc-", ""), format: item.format, issues: [], warnings: [] })) });
    }
    if (path === "/v1/social/posts" && request.method() === "POST") {
      state.created = request.postDataJSON();
      return ok(route, { id: "post-1", state: "SCHEDULED", createdAt: iso(0), requiresApproval: false, destinations: [], history: [] }, 201);
    }
    const partial = { id: "post-1", state: state.retried ? "PUBLISHED" : "PARTIAL_SUCCESS", scheduledAt: iso(-3_600_000), timezone: "America/Sao_Paulo", createdAt: iso(-7_200_000), requiresApproval: false,
      destinations: [
        destination("instagram", "PUBLISHED", [], { publishedAt: iso(-3_500_000), externalUrl: "https://www.instagram.com/p/abc/" }),
        destination("facebook", "PUBLISHED", [], { publishedAt: iso(-3_500_000) }),
        state.retried ? destination("tiktok", "PUBLISHED", [], { publishedAt: iso(0) }) : destination("tiktok", "FAILED", ["retry"], { problem: "O TikTok rejeitou esta mídia. Revise o formato e tente novamente." }),
      ],
      history: [{ at: iso(-7_200_000), kind: "created", label: "Publicação criada" }, { at: iso(-3_500_000), kind: "published", label: "Publicada", network: "instagram" }] };
    if (path === "/v1/social/posts") return ok(route, { posts: [partial] });
    if (path === "/v1/social/posts/post-1") return ok(route, partial);
    if (path === "/v1/social/destinations/dest-tiktok/retry") {
      state.retried = true;
      return ok(route, { ...partial, state: "PUBLISHING" });
    }
    return ok(route, {});
  });
}

test.beforeEach(async ({ context, page }) => {
  await loginCookie(context);
  await mockConversasBackend(page);
});

test("Integrações: rede conectada, reconexão necessária com publicações aguardando e rede ainda não liberada", async ({ page }) => {
  await mockSocial(page, { retried: false });
  await page.goto(`/workspaces/${WORKSPACE_ID}/social/integrations`);
  const instagram = page.getByTestId("social-card-instagram");
  await expect(instagram.getByText("Conectado", { exact: true })).toBeVisible();
  await expect(instagram.getByText("@loja")).toBeVisible();
  await expect(instagram.getByRole("button", { name: "Testar conexão" })).toBeVisible();
  const facebook = page.getByTestId("social-card-facebook");
  await expect(facebook.getByText("Sua conta precisa ser reconectada.")).toBeVisible();
  await expect(facebook.getByText("3 publicações aguardando reconexão")).toBeVisible();
  await expect(facebook.getByRole("button", { name: "Reconectar Facebook" })).toBeVisible();
  const tiktok = page.getByTestId("social-card-tiktok");
  await expect(tiktok.getByText("ainda não está liberada")).toBeVisible();
  await expect(tiktok.getByRole("button", { name: /Conectar TikTok/ })).toHaveCount(0);
  // Nada técnico na tela.
  await expect(page.getByText(/token|OAuth|Graph|meta_official|provider/i)).toHaveCount(0);
});

test("Composer: três redes, personalização por rede, prévia e agendamento", async ({ page }) => {
  const state: { retried: boolean; created?: Record<string, unknown> } = { retried: false };
  await mockSocial(page, state);
  await page.goto(`/workspaces/${WORKSPACE_ID}/social/compose?media=${encodeURIComponent("https://cdn.example.test/v.mp4")}&caption=${encodeURIComponent("Lançamento da coleção")}&source=run-7`);
  await expect(page.getByLabel("Legenda")).toHaveValue("Lançamento da coleção");
  await page.getByRole("checkbox", { name: "Instagram @loja" }).click();
  await page.getByRole("checkbox", { name: "Facebook Loja Página" }).click();
  await page.getByRole("checkbox", { name: "TikTok @loja" }).click();
  await expect(page.getByTestId("social-destination-instagram")).toBeVisible();
  await page.getByRole("switch", { name: "Personalizar para TikTok" }).click();
  await page.getByLabel("Legenda do TikTok").fill("Corre que é lançamento!");
  await expect(page.getByTestId("social-preview")).toBeVisible();
  await page.getByRole("radio", { name: "Agendar" }).click();
  await page.getByRole("button", { name: "Agendar publicação" }).click();
  await expect(page).toHaveURL(/social\/calendar\?post=post-1/);
  const created = state.created as { destinations: { accountId: string; format: string; caption?: string }[]; when: { mode: string; timezone: string }; source: { executionRunId: string } };
  expect(created.destinations).toHaveLength(3);
  expect(created.destinations.find((item) => item.accountId === "acc-tiktok")).toMatchObject({ format: "short_video", caption: "Corre que é lançamento!" });
  expect(created.destinations.find((item) => item.accountId === "acc-instagram")).toEqual({ accountId: "acc-instagram", format: "reel" });
  expect(created.when).toMatchObject({ mode: "schedule", timezone: "America/Sao_Paulo" });
  expect(created.source).toEqual({ executionRunId: "run-7" });
});

test("Calendário: sucesso parcial, status por rede e retry só no TikTok", async ({ page }) => {
  const state = { retried: false };
  await mockSocial(page, state);
  await page.goto(`/workspaces/${WORKSPACE_ID}/social/calendar?post=post-1`);
  const destinations = page.getByTestId("social-destinations");
  await expect(destinations.getByText("Instagram — Publicado")).toBeVisible();
  await expect(destinations.getByText("Facebook — Publicado")).toBeVisible();
  await expect(destinations.getByText("TikTok — Falhou")).toBeVisible();
  await expect(destinations.getByText("O TikTok rejeitou esta mídia")).toBeVisible();
  await expect(page.getByRole("button", { name: /Tentar novamente no (Instagram|Facebook)/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Tentar novamente no TikTok" }).click();
  expect(state.retried).toBe(true);
  await page.reload();
  await expect(page.getByTestId("social-destinations").getByText("TikTok — Publicado")).toBeVisible();
  await page.getByRole("button", { name: "Histórico" }).click();
  await expect(page.getByTestId("social-history").getByText("Publicação criada")).toBeVisible();
});
