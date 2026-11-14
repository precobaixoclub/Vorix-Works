import test from "node:test";
import assert from "node:assert/strict";
import { BrowserSocialDriver, publicationResponseProof } from "../dist/infrastructure/social/gateway/browser-driver.js";
import { SocialBrowserPool, desktopUserAgent, parseGatewayProxy } from "../dist/infrastructure/social/gateway/browser-pool.js";

test("browser pool: libera Chromium ocioso, preserva contextos ativos e relança sem compartilhar cookies", async () => {
  const pool = new SocialBrowserPool({ maxContexts: 1, idleTimeoutMs: 30 });
  try {
    const first = await pool.open();
    await first.context.addCookies([{ name: "private", value: "not-shared", domain: "example.test", path: "/" }]);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(pool.stats().browserRunning, true, "nunca encerra um login ativo");
    await first.close();
    for (let i = 0; i < 100 && pool.stats().browserRunning; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(pool.stats().browserRunning, false);
    const second = await pool.open();
    assert.equal(pool.stats().browserRunning, true);
    assert.equal((await second.context.cookies()).length, 0);
    await second.close();
  } finally { await pool.shutdown(); }
});

test("browser pool: não se anuncia como automação (o reCAPTCHA da Meta repete o desafio para sempre)", async () => {
  const pool = new SocialBrowserPool({ maxContexts: 1 });
  try {
    const lease = await pool.open();
    const page = await lease.context.newPage();
    const env = await page.evaluate(() => ({ webdriver: navigator.webdriver, ua: navigator.userAgent, lang: navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }));
    assert.equal(env.webdriver, false);
    assert.doesNotMatch(env.ua, /Headless/i);
    assert.equal(env.lang, "pt-BR");
    assert.equal(env.tz, "America/Sao_Paulo");
    await lease.close();
  } finally { await pool.shutdown(); }
});
test("browser pool: user agent de desktop e proxy opcional sem credencial na URL", () => {
  assert.equal(desktopUserAgent("156.0.8078.79"), "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36");
  assert.equal(parseGatewayProxy(""), undefined);
  assert.equal(parseGatewayProxy(undefined), undefined);
  assert.deepEqual(parseGatewayProxy("http://us%40er:p%3Ass@br.proxy.test:8080"), { server: "http://br.proxy.test:8080", username: "us@er", password: "p:ss" });
  assert.throws(() => parseGatewayProxy("ftp://x.test:21"), /http, https or socks5/);
});

// Real Chromium with local deterministic DOM fixtures. These are browser integration tests,
// deliberately NOT live Instagram/Facebook/TikTok validation.
test("positive creation receipts are distinct from upload/container/request IDs", () => {
  assert.equal(publicationResponseProof("instagram", { status: "ok", upload_id: "upload-123" }, "reel"), undefined);
  assert.equal(publicationResponseProof("instagram", { status: "fail", media: { pk: "123" } }, "reel"), undefined);
  assert.equal(publicationResponseProof("instagram", { status: "ok", media: { pk: "123", code: "real-code" } }, "reel").externalPostId, "123");
  assert.equal(publicationResponseProof("tiktok", { status_code: 0, data: { publish_id: "not-a-post" } }, "short_video"), undefined);
  assert.equal(publicationResponseProof("facebook", { data: { story_create: { story: { id: "456", url: "https://evil.test/" } } } }, "feed_text").externalUrl, undefined);
});
test("browser pool: isolated contexts, bounded admission, release and shutdown", async () => {
  const pool = new SocialBrowserPool({ maxContexts: 1, queueTimeoutMs: 30 });
  try {
    const one = await pool.open();
    await one.context.addCookies([{ name: "private", value: "tenant-a", domain: "example.test", path: "/" }]);
    await assert.rejects(() => pool.open(), /BUSY/);
    await one.close();
    const two = await pool.open();
    assert.equal((await two.context.cookies()).length, 0);
    await two.close();
  } finally { await pool.shutdown(); }
  await assert.rejects(() => pool.open(), /BUSY/);
});

test("browser engine: organic Facebook text, caption, explicit publish confirmation and permalink", async () => {
  const pool = new SocialBrowserPool(); const lease = await pool.open();
  try {
    const page = await lease.context.newPage();
    await page.setContent(`<button onclick="document.querySelector('[contenteditable]').hidden=false;document.querySelector('#publish').hidden=false">What's on your mind?</button>
      <div role="textbox" contenteditable="true" hidden></div>
      <button id="publish" hidden onclick="document.querySelector('#confirmation').hidden=false">Post</button>
      <div id="confirmation" hidden>Your post has been published<a href="https://www.facebook.com/posts/456/">View post</a></div>`);
    const driver = new BrowserSocialDriver("facebook", page, lease.context, []);
    await driver.prepare({ format: "feed_text", caption: "Organic text #test", media: [] });
    assert.equal(await page.getByRole("textbox").textContent(), "Organic text #test");
    assert.equal(await page.locator("#confirmation").isVisible(), false, "prepare never submits");
    const result = await driver.submit("feed_text");
    assert.equal(result.ok, true); assert.equal(result.externalPostId, "456");
  } finally { await lease.close(); await pool.shutdown(); }
});

test("browser engine: CAPTCHA/MFA pauses; capability detection removes unavailable controls", async () => {
  const pool = new SocialBrowserPool(); const lease = await pool.open();
  try {
    const page = await lease.context.newPage(); const driver = new BrowserSocialDriver("instagram", page, lease.context, []);
    await page.setContent('<main><input autocomplete="one-time-code"><p>Security check</p></main>');
    assert.equal(await driver.securityState(), "CHECKPOINT_REQUIRED");
    await assert.rejects(() => driver.identity(), /CHECKPOINT_REQUIRED/);
    await page.setContent('<main><button>Create</button></main>');
    const capabilities = await driver.detectCapabilities();
    assert.ok(!capabilities.disabledFormats.includes("feed_image"));
    assert.ok(capabilities.disabledFormats.includes("story_image"));
    assert.ok(capabilities.disabledFormats.includes("feed_video"));
    assert.ok(capabilities.disabledFeatures.includes("nativeMusic"));
    assert.ok(capabilities.disabledFeatures.includes("musicSegment"));
  } finally { await lease.close(); await pool.shutdown(); }
});

test("browser engine: uploads selected media into the native file input before final submission", async () => {
  const pool = new SocialBrowserPool(); const lease = await pool.open();
  try {
    const page = await lease.context.newPage(); const driver = new BrowserSocialDriver("instagram", page, lease.context, []);
    await page.setContent('<main><button>Create</button><input type="file" accept="image/png"><div contenteditable="true" role="textbox"></div><button>Share</button></main>');
    // Only media transport is a fixture. Chromium's FileList/upload and editor interactions run.
    driver.download = async () => ({ name: "sample.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64") });
    await driver.prepare({ format: "feed_image", caption: "Uploaded caption", media: [{ kind: "image", url: "https://media.example.test/sample.png" }] });
    const selected = await page.locator('input[type="file"]').evaluate(input => ({ name: input.files[0].name, type: input.files[0].type, size: input.files[0].size }));
    assert.equal(selected.name, "sample.png"); assert.equal(selected.type, "image/png"); assert.ok(selected.size > 0);
    assert.equal(await page.getByRole("textbox").textContent(), "Uploaded caption");
  } finally { await lease.close(); await pool.shutdown(); }
});

test("browser engine: native music search, selection and segment controls preserve identifiers", async () => {
  const pool = new SocialBrowserPool(); const lease = await pool.open();
  try {
    const page = await lease.context.newPage(); const driver = new BrowserSocialDriver("instagram", page, lease.context, []);
    await page.setContent(`<main>
      <button>Add music</button><input role="searchbox">
      <button data-music-id="song-17"><span data-testid="music-title">Sample</span><span data-testid="music-artist">Artist</span><img src="https://www.instagram.com/cover.jpg"><audio src="https://www.instagram.com/preview.mp3"></audio></button>
      <input type="range" min="0" max="60" aria-label="Start"><input type="range" min="1" max="60" aria-label="Duration"><button>Done</button>
    </main>`);
    const tracks = await driver.music("Sample", 10);
    assert.equal(tracks[0].musicId, "song-17"); assert.equal(tracks[0].artist, "Artist"); assert.equal(tracks[0].supportsSegment, true);
    // selectMusic is private in TypeScript; exercise the real composer path through prepare.
    await page.evaluate(`document.querySelector('main').insertAdjacentHTML('afterbegin', '<button>Create</button><div contenteditable="true" role="textbox"></div>')`);
    await driver.prepare({ format: "reel", caption: "With music", media: [], music: { musicId: "song-17", title: "Sample", segmentStartSec: 12, segmentDurationSec: 15 } });
    assert.equal(await page.locator('[aria-label="Start"]').inputValue(), "12");
    assert.equal(await page.locator('[aria-label="Duration"]').inputValue(), "15");
  } finally { await lease.close(); await pool.shutdown(); }
});

test("with a proxy configured and unreachable, the pool refuses instead of leaving from the server's own address", async () => {
  const { SocialBrowserPool, proxyReachable } = await import("../dist/infrastructure/social/gateway/browser-pool.js");
  const net = await import("node:net");
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  assert.equal(await proxyReachable(`socks5://127.0.0.1:${port}`), true);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await proxyReachable(`socks5://127.0.0.1:${port}`, 500), false);
  const pool = new SocialBrowserPool({ proxy: { server: `socks5://127.0.0.1:${port}` } });
  await assert.rejects(pool.open(), (error) => error.code === "NETWORK_ERROR");
  await pool.close?.();
});
