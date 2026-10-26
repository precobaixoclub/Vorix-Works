import type { BrowserContext, Locator, Page } from "playwright-core";
import { z } from "zod";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { SocialHealthResult, SocialPublishResult } from "../../../application/social/social-publishing-provider.port.js";
import type { SocialFeature, SocialMediaItem, SocialMusicSelection, SocialMusicTrack, SocialNetwork, SocialPostFormat } from "../../../domain/social/social-publishing.model.js";
import { unofficialCapabilities } from "../unofficial-social-providers.js";
import { GatewayError } from "./protocol.js";

const HOME: Record<SocialNetwork, string> = { instagram: "https://www.instagram.com/", facebook: "https://www.facebook.com/", tiktok: "https://www.tiktok.com/" };
const LOGIN: Record<SocialNetwork, string> = { instagram: "https://www.instagram.com/accounts/login/", facebook: "https://www.facebook.com/login/", tiktok: "https://www.tiktok.com/login" };
const DOMAINS: Record<SocialNetwork, readonly string[]> = {
  instagram: ["instagram.com", "cdninstagram.com", "fbcdn.net", "facebook.com", "fbsbx.com"],
  facebook: ["facebook.com", "fbcdn.net", "fbsbx.com", "messenger.com"],
  tiktok: ["tiktok.com", "tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "tiktokv.us", "byteoversea.com", "ibytedtos.com", "ibyteimg.com", "muscdn.com", "ttwstatic.com", "tiktokstatic.com", "byteimg.com", "bytedance.com", "captcha-delivery.com"],
};
export function allowedBrowserURL(network: SocialNetwork, raw: string): boolean {
  try { const url = new URL(raw); return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && DOMAINS[network].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)); } catch { return false; }
}
export type BrowserIdentity = { externalAccountId: string; username?: string; displayName?: string };
export type BrowserPublishInput = { format: SocialPostFormat; caption: string; media: readonly SocialMediaItem[]; music?: SocialMusicSelection };

export class BrowserSocialDriver {
  constructor(readonly network: SocialNetwork, readonly page: Page, private readonly context: BrowserContext, private readonly mediaOrigins: readonly string[]) {}
  async guardNetwork(): Promise<void> {
    await this.context.route("**/*", async route => {
      const request = route.request();
      const challengeFrame = !(request.isNavigationRequest() && request.frame() === this.page.mainFrame()) && allowedChallengeURL(request.url());
      if (allowedBrowserURL(this.network, request.url()) || challengeFrame) await route.continue(); else await route.abort();
    });
    await this.context.routeWebSocket(/.*/, socket => { socket.close(); });
    this.context.on("page", popup => { void popup.close().catch(() => undefined); });
    this.page.on("dialog", dialog => { void dialog.dismiss(); });
  }
  async login(): Promise<void> { await this.page.goto(LOGIN[this.network], { waitUntil: "domcontentloaded" }); }
  async home(): Promise<void> { await this.page.goto(HOME[this.network], { waitUntil: "domcontentloaded" }); }
  private async button(pattern: RegExp): Promise<Locator | undefined> {
    const locator = this.page.getByRole("button", { name: pattern }).or(this.page.getByRole("link", { name: pattern })).or(this.page.getByRole("menuitem", { name: pattern })).first();
    return await locator.isVisible().catch(() => false) ? locator : undefined;
  }
  async securityState(): Promise<"AUTH_REQUIRED" | "CHECKPOINT_REQUIRED" | undefined> {
    const url = new URL(this.page.url());
    if (/checkpoint|challenge|two_factor|two_step|captcha|verify/i.test(url.pathname)) return "CHECKPOINT_REQUIRED";
    if (await this.page.locator('input[autocomplete="one-time-code"], input[name="verificationCode"], input[name="approvals_code"], iframe[src*="captcha"], [id*="captcha" i]').first().isVisible().catch(() => false)) return "CHECKPOINT_REQUIRED";
    if (await this.page.getByText(/confirm your identity|security check|enter (the )?(security|verification) code|confirme sua identidade|verificação de segurança/i).first().isVisible().catch(() => false)) return "CHECKPOINT_REQUIRED";
    if (/\/accounts\/login|\/login\/?$/.test(url.pathname) || await this.page.locator('input[type="password"]').first().isVisible().catch(() => false)) return "AUTH_REQUIRED";
    return undefined;
  }
  async identity(): Promise<BrowserIdentity> {
    const state = await this.securityState();
    if (state) throw new GatewayError(state);
    // Read the currently authenticated identity, never a user-supplied profile URL.
    if (this.network === "instagram") {
      const response = await this.context.request.get("https://www.instagram.com/api/v1/accounts/current_user/?edit=true", { headers: { "x-ig-app-id": "936619743392459", "x-csrftoken": (await this.context.cookies()).find(c => c.name === "csrftoken")?.value ?? "" }, timeout: 20_000 });
      if (response.status() === 401 || response.status() === 403) throw new GatewayError("AUTH_REQUIRED");
      const body = await response.json().catch(() => ({}));
      if (body.message === "challenge_required" || body.checkpoint_url) throw new GatewayError("CHECKPOINT_REQUIRED");
      const user = body.user;
      if (!response.ok() || !user?.pk || !user?.username) throw new GatewayError("AUTH_REQUIRED");
      return { externalAccountId: String(user.pk), username: String(user.username), displayName: typeof user.full_name === "string" ? user.full_name : undefined };
    }
    if (this.network === "facebook") {
      const cookies = (await this.context.cookies()).filter(c => /(^|\.)facebook\.com$/.test(c.domain.replace(/^\./, "")));
      const id = cookies.find(c => c.name === "i_user")?.value ?? cookies.find(c => c.name === "c_user")?.value;
      const accountMenu = await this.button(/^(your profile|account|seu perfil|conta)$/i);
      if (!id || !/^\d+$/.test(id) || !accountMenu) throw new GatewayError("AUTH_REQUIRED");
      return { externalAccountId: id };
    }
    const profile = this.page.locator('a[data-e2e="profile-icon"], a[data-e2e="nav-profile"], [data-e2e="profile-icon"] a').first();
    const href = await profile.getAttribute("href").catch(() => undefined);
    const username = href?.match(/\/@([^/?]+)/)?.[1];
    if (!username) throw new GatewayError("AUTH_REQUIRED");
    // secUid is stable across username changes and belongs to the authenticated profile link.
    await this.page.goto(new URL(href!, HOME.tiktok).href, { waitUntil: "domcontentloaded" });
    await this.page.locator('[data-e2e="user-title"]').waitFor({ state: "visible" });
    const identity = await this.page.evaluate<{ id?: string; secUid?: string; uniqueId?: string }>(`(() => {
      const el = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (!el) return {};
      try { return JSON.parse(el.textContent).__DEFAULT_SCOPE__['webapp.user-detail'].userInfo.user; } catch { return {}; }
    })()`);
    if (!identity?.id || identity.uniqueId !== username) throw new GatewayError("AUTH_REQUIRED");
    return { externalAccountId: identity.id, username };
  }
  async health(): Promise<SocialHealthResult> {
    const identity = await this.identity();
    const detection = await this.detectCapabilities();
    return { healthy: true, ...identity, ...detection };
  }
  async detectCapabilities(): Promise<{ disabledFormats: SocialPostFormat[]; disabledFeatures: SocialFeature[]; metadata: Record<string, unknown> }> {
    const supported = new Set<SocialPostFormat>();
    if (this.network === "instagram") {
      if (await this.button(/^(create|new post|criar|nova publicação)$/i)) { supported.add("feed_image"); supported.add("carousel"); supported.add("reel"); }
      if (await this.button(/^(create story|add to story|criar story|adicionar ao story)$/i)) { supported.add("story_image"); supported.add("story_video"); }
      // Instagram's web flow normally converts videos into reels; never advertise a separate feed video without a control.
      if (await this.button(/^(video post|vídeo no feed)$/i)) supported.add("feed_video");
    } else if (this.network === "facebook") {
      if (await this.page.getByText(/what.s on your mind|no que você está pensando/i).first().isVisible().catch(() => false)) { supported.add("feed_text"); supported.add("feed_image"); supported.add("feed_video"); supported.add("carousel"); }
      if (await this.button(/^(create story|criar story)$/i)) { supported.add("story_image"); supported.add("story_video"); }
      if (await this.button(/^(create reel|criar reel)$/i)) supported.add("reel");
    } else {
      await this.page.goto("https://www.tiktok.com/tiktokstudio/upload", { waitUntil: "domcontentloaded" });
      const state = await this.securityState(); if (state) throw new GatewayError(state);
      if (await this.page.locator('input[type="file"][accept*="video"], input[type="file"][accept="*"]').count()) supported.add("short_video");
      if (await this.page.locator('input[type="file"][accept*="image"]').count()) supported.add("photo_post");
    }
    // Music is available only when a native picker is present in the account's web composer.
    const music = !!await this.button(/^(add music|add sound|sounds|adicionar música|adicionar som|sons)$/i);
    const segment = music && await this.page.locator('input[type="range"][aria-label*="start" i]').isVisible().catch(() => false);
    return { disabledFormats: unofficialCapabilities(this.network).formats.map(f => f.format).filter(f => !supported.has(f)), disabledFeatures: [...(!music ? ["nativeMusic" as const] : []), ...(!segment ? ["musicSegment" as const] : [])], metadata: { nativeMusicSearch: music, nativeMusicSelection: music, nativeMusicSegment: segment } };
  }
  private async clickRequired(pattern: RegExp): Promise<void> { const target = await this.button(pattern); if (!target) throw new GatewayError("UNSUPPORTED"); await target.click(); }
  async openComposer(format: SocialPostFormat): Promise<void> {
    if (this.network === "instagram") {
      await this.clickRequired(format.startsWith("story") ? /^(create story|add to story|criar story|adicionar ao story)$/i : /^(create|new post|criar|nova publicação)$/i);
      const post = await this.button(/^(post|publicação)$/i); if (post) await post.click();
    } else if (this.network === "facebook") {
      if (format.startsWith("story")) { await this.page.goto("https://www.facebook.com/stories/create", { waitUntil: "domcontentloaded" }); }
      else if (format === "reel") { await this.page.goto("https://www.facebook.com/reels/create", { waitUntil: "domcontentloaded" }); }
      else await this.page.getByText(/what.s on your mind|no que você está pensando/i).first().click();
    } else await this.page.goto("https://www.tiktok.com/tiktokstudio/upload", { waitUntil: "domcontentloaded" });
    const state = await this.securityState(); if (state) throw new GatewayError(state);
  }
  private async download(item: SocialMediaItem): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
    const url = new URL(item.url);
    if (url.protocol !== "https:" || url.username || url.password || !this.mediaOrigins.includes(url.origin)) throw new GatewayError("UNSUPPORTED");
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(a => privateAddress(a.address))) throw new GatewayError("UNSUPPORTED");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(90_000) });
    const max = item.kind === "video" ? 256 * 1024 * 1024 : 20 * 1024 * 1024;
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > max) throw new GatewayError("NETWORK_ERROR");
    const reader = response.body.getReader(); let total = 0; const chunks: Buffer[] = [];
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; total += chunk.value.length; if (total > max) { await reader.cancel(); throw new GatewayError("UNSUPPORTED"); } chunks.push(Buffer.from(chunk.value)); }
    const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!(item.kind === "video" ? /^video\/(mp4|quicktime|webm)$/ : /^image\/(jpeg|png|webp)$/).test(mimeType)) throw new GatewayError("UNSUPPORTED");
    return { name: `media.${mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : item.kind === "video" ? "mp4" : "jpg"}`, mimeType, buffer: Buffer.concat(chunks) };
  }
  async prepare(input: BrowserPublishInput): Promise<void> {
    await this.openComposer(input.format);
    if (input.media.length) {
      const files = [];
      // Sequential downloads bound memory and network concurrency per account.
      for (const item of input.media) files.push(await this.download(item));
      const upload = this.page.locator('input[type="file"]').first();
      await upload.setInputFiles(files);
    }
    // Instagram's crop/filter steps, Facebook reel steps. Never click the final action here.
    for (let step = 0; step < 4; step++) {
      if (input.media.length && this.network !== "tiktok") await this.page.getByRole("button", { name: /^(next|avançar|próximo|share|post|publish|compartilhar|publicar)$/i }).or(this.page.getByRole("textbox")).first().waitFor({ state: "visible", timeout: 30_000 });
      const next = await this.button(/^(next|avançar|próximo)$/i); if (!next) break; await next.click();
    }
    const editor = this.page.locator('[contenteditable="true"][role="textbox"], textarea[aria-label*="caption" i], textarea[placeholder*="caption" i], [data-e2e="caption-container"] [contenteditable="true"], div[aria-label*="Write a caption" i], div[aria-label*="Escreva uma legenda" i]').first();
    if (input.caption && !input.format.startsWith("story")) { await editor.waitFor({ state: "visible" }); await editor.fill(input.caption); }
    if (input.music) await this.selectMusic(input.music);
    const state = await this.securityState(); if (state) throw new GatewayError(state);
  }
  private async musicPicker(): Promise<void> { await this.clickRequired(/^(add music|add sound|sounds|adicionar música|adicionar som|sons)$/i); }
  async music(query: string, limit: number): Promise<SocialMusicTrack[]> {
    await this.musicPicker();
    const search = this.page.getByRole("searchbox").or(this.page.getByPlaceholder(/search music|search sounds|pesquisar música|buscar música/i)).first();
    await search.fill(query);
    await search.press("Enter");
    const rows = this.page.locator('[data-music-id], [data-sound-id], a[href*="/music/"]');
    await rows.first().waitFor({ state: "visible" });
    const tracks: SocialMusicTrack[] = [];
    for (const row of (await rows.all()).slice(0, Math.min(limit, 20))) {
      const id = await row.getAttribute("data-music-id") ?? await row.getAttribute("data-sound-id") ?? (await row.getAttribute("href"))?.match(/-(\d+)\/?/)?.[1];
      const title = (await row.locator('[data-e2e="music-title"], [data-testid="music-title"]').first().textContent().catch(() => undefined)) ?? await row.getAttribute("aria-label");
      if (!id || !title) continue;
      const artist = await row.locator('[data-e2e="music-author"], [data-testid="music-artist"]').first().textContent().catch(() => undefined);
      const cover = await row.locator("img").first().getAttribute("src").catch(() => undefined);
      const audio = await row.locator("audio").first().getAttribute("src").catch(() => undefined);
      const safeURL = (url: string | null | undefined) => url && allowedBrowserURL(this.network, url) ? url : undefined;
      tracks.push({ musicId: id, title: title.slice(0, 300), artist: artist?.slice(0, 300), coverUrl: safeURL(cover), previewUrl: safeURL(audio), available: true, supportsSegment: await this.page.locator('input[type="range"][aria-label*="start" i]').isVisible().catch(() => false) });
    }
    return tracks;
  }
  private async selectMusic(selection: SocialMusicSelection): Promise<void> {
    const tracks = await this.music(selection.title, 20);
    if (!tracks.some(track => track.musicId === selection.musicId)) throw new GatewayError("MUSIC_UNAVAILABLE");
    // Filter by actual attribute value, never interpolate an untrusted selector or script.
    const candidates = this.page.locator('[data-music-id], [data-sound-id], a[href*="/music/"]');
    let chosen: Locator | undefined;
    for (const row of await candidates.all()) { if (await row.getAttribute("data-music-id") === selection.musicId || await row.getAttribute("data-sound-id") === selection.musicId || (await row.getAttribute("href"))?.match(/-(\d+)\/?/)?.[1] === selection.musicId) { chosen = row; break; } }
    if (!chosen) throw new GatewayError("MUSIC_UNAVAILABLE");
    await chosen.click();
    if (selection.segmentStartSec !== undefined) {
      const start = this.page.locator('input[type="range"][aria-label*="start" i]');
      if (!await start.isVisible()) throw new GatewayError("UNSUPPORTED");
      await start.fill(String(selection.segmentStartSec));
    }
    if (selection.segmentDurationSec !== undefined) {
      const duration = this.page.locator('input[type="range"][aria-label*="duration" i]');
      if (!await duration.isVisible()) throw new GatewayError("UNSUPPORTED");
      await duration.fill(String(selection.segmentDurationSec));
    }
    const use = await this.button(/^(use|done|apply|usar|concluir|aplicar)$/i); if (use) await use.click();
  }
  /** Caller MUST persist the unknown receipt before invoking this irreversible step. */
  async submit(format: SocialPostFormat): Promise<SocialPublishResult> {
    const proof = this.page.waitForResponse(async response => {
      const url = new URL(response.url());
      const matches = response.request().method() === "POST" && response.ok() && allowedBrowserURL(this.network, url.href) && (this.network === "instagram" && /^\/api\/v1\/media\/configure(?:_sidecar|_to_clips|_to_story)?\/$/.test(url.pathname) || this.network === "facebook" && url.pathname === "/api/graphql/");
      return matches && !!publicationResponseProof(this.network, await response.json().catch(() => undefined), format);
    }, { timeout: 60_000 }).then(async response => {
      const result = publicationResponseProof(this.network, await response.json(), format);
      if (!result) throw new Error("NO_PUBLICATION_PROOF");
      return result;
    });
    // Attach a rejection handler immediately: clicking can fail before the proof is awaited.
    void proof.catch(() => undefined);
    await this.clickRequired(format.startsWith("story") ? /^(share to story|share|compartilhar no story|compartilhar)$/i : /^(share|post|publish|compartilhar|publicar)$/i);
    const permalink = this.confirmedPermalink();
    try { return await Promise.any([proof, permalink]); }
    catch { return { ok: "unknown", detail: "Aguardando confirmação da publicação na rede." }; }
  }
  private async confirmedPermalink(): Promise<Extract<SocialPublishResult, { ok: true }>> {
    const confirmation = this.page.getByText(/your (post|reel|story|video) (has been|is) (shared|published|posted)|seu (post|reel|story|vídeo) foi (compartilhado|publicado)|publicação compartilhada/i).first();
    await confirmation.waitFor({ state: "visible", timeout: 60_000 });
    const link = this.page.locator(this.network === "instagram" ? 'a[href*="/p/"],a[href*="/reel/"]' : this.network === "tiktok" ? 'a[href*="/video/"]' : 'a[href*="/posts/"],a[href*="/reel/"],a[href*="story_fbid="]').filter({ hasText: /view|see|ver|visualizar/i }).first();
    const href = await link.getAttribute("href").catch(() => undefined);
    const url = href ? new URL(href, HOME[this.network]).href : undefined;
    const id = url?.match(/\/(?:p|reel|video|posts)\/([\w-]+)/)?.[1] ?? (url ? new URL(url).searchParams.get("story_fbid") : undefined);
    if (!url || !id || !allowedBrowserURL(this.network, url)) throw new Error("NO_PUBLICATION_PROOF");
    return { ok: true, externalPostId: id, externalUrl: url, publishedAt: new Date().toISOString() };
  }
}

const externalId = z.union([z.string().min(1).max(200), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String);
/** Positive creation receipts only: an upload/container/task ID never establishes publication. */
export function publicationResponseProof(network: SocialNetwork, body: unknown, format: SocialPostFormat): Extract<SocialPublishResult, { ok: true }> | undefined {
  if (network === "instagram") {
    const parsed = z.object({ status: z.literal("ok"), media: z.object({ pk: externalId, code: z.string().regex(/^[\w-]+$/).optional() }) }).safeParse(body);
    if (!parsed.success) return undefined;
    return { ok: true, externalPostId: parsed.data.media.pk, publishedAt: new Date().toISOString(), ...(parsed.data.media.code && !format.startsWith("story") ? { externalUrl: `https://www.instagram.com/${format === "reel" ? "reel" : "p"}/${parsed.data.media.code}/` } : {}) };
  }
  if (network === "facebook") {
    const parsed = z.object({ data: z.object({ story_create: z.object({ story: z.object({ id: externalId, url: z.string().url().optional() }) }) }) }).safeParse(body);
    if (!parsed.success) return undefined;
    const story = parsed.data.data.story_create.story;
    return { ok: true, externalPostId: story.id, publishedAt: new Date().toISOString(), ...(story.url && allowedBrowserURL(network, story.url) ? { externalUrl: story.url } : {}) };
  }
  return undefined;
}

/** Challenge resources are displayed for the human; they cannot become arbitrary top-level navigation. */
export function allowedChallengeURL(raw: string): boolean {
  try {
    const url = new URL(raw); if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return false;
    return ["hcaptcha.com", "arkoselabs.com"].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) || url.hostname === "challenges.cloudflare.com" || ["www.google.com", "www.gstatic.com", "www.recaptcha.net"].includes(url.hostname) && url.pathname.startsWith("/recaptcha/");
  } catch { return false; }
}

export function privateAddress(address: string): boolean {
  if (isIP(address) === 4) { const [a, b] = address.split(".").map(Number); return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a >= 224; }
  const ip = address.toLowerCase();
  return ip === "::" || ip === "::1" || /^(fc|fd|fe[89ab])/.test(ip) || ip.startsWith("::ffff:") || !ip.startsWith("2") && !ip.startsWith("3");
}
