// Storefront photos broke in production: images counted against the per-IP request budget (all
// visitors shared the proxy IP) and cached pages outlived their 1h image signatures.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { configureObjectUrlSigning, resetObjectUrlSigning, signObjectKey, verifyObjectSignature, OBJECT_URL_TTL, OBJECT_URL_MAX_TTL_SECONDS } from "../dist/shared/utils/object-url-signing.js";

const BASE = "http://127.0.0.1:9/uploads", KEY = randomBytes(32), DAY = 86_400;
let app, rootDir, clock = Date.UTC(2026, 10, 11, 4, 59, 22);
const key = "assets/tenant-shop/workspace-shop/products/photo.png";
const pathOf = (url) => { const parsed = new URL(url); return `${parsed.pathname}${parsed.search}`; };

before(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "vorix-storefront-images-"));
  await mkdir(join(rootDir, "assets/tenant-shop/workspace-shop/products"), { recursive: true });
  await writeFile(join(rootDir, key), "PNG");
  app = await buildApp({ config: loadApiConfig({ AUTH_MODE: "noop", OPERATIONAL_RATE_LIMIT_DEFAULT: "20", OBJECT_STORAGE_ENABLED: "true", OBJECT_STORAGE_DRIVER: "local", OBJECT_STORAGE_LOCAL_DIR: rootDir, OBJECT_STORAGE_PUBLIC_BASE_URL: BASE }) });
  configureObjectUrlSigning({ publicBaseUrl: BASE, signingKey: KEY, now: () => clock });
});
after(async () => { await app?.close(); resetObjectUrlSigning(); if (rootDir) await rm(rootDir, { recursive: true, force: true }); });

test("a storefront page full of photos never hits the request budget; other routes still do", async () => {
  const url = pathOf(signObjectKey(key, OBJECT_URL_TTL.publicSite));
  for (let i = 0; i < 150; i++) {
    const response = await app.inject({ method: "GET", url: `${url}${i % 3 ? "" : "&w=160"}` });
    assert.equal(response.statusCode, 200, `photo ${i}`);
    assert.equal(response.headers["x-ratelimit-limit"], undefined);
  }
  let limited = 0;
  for (let i = 0; i < 25; i++) if ((await app.inject({ method: "GET", url: "/v1/workspaces" })).statusCode === 429) limited++;
  assert.ok(limited > 0, "regular routes keep their limit");
});

test("visitors behind the proxy get their own budget (client IP from the proxy hop)", async () => {
  const seen = [];
  const probe = await buildApp({ config: loadApiConfig({ AUTH_MODE: "noop" }) });
  probe.get("/probe-ip", async (request) => ({ ip: request.ip }));
  try {
    for (const forwarded of ["203.0.113.7", "198.51.100.9"]) seen.push((await probe.inject({ method: "GET", url: "/probe-ip", headers: { "x-forwarded-for": forwarded }, remoteAddress: "172.18.0.5" })).json().ip);
    // A client-supplied left-most entry cannot impersonate someone else: only the proxy's hop counts.
    seen.push((await probe.inject({ method: "GET", url: "/probe-ip", headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.7" }, remoteAddress: "172.18.0.5" })).json().ip);
  } finally { await probe.close(); }
  assert.deepEqual(seen, ["203.0.113.7", "198.51.100.9", "203.0.113.7"]);
});

test("storefront signatures outlive cached pages, stay stable all day and are accepted", () => {
  const first = new URL(signObjectKey(key, OBJECT_URL_TTL.publicSite));
  const exp = Number(first.searchParams.get("exp")), now = Math.floor(clock / 1000);
  assert.equal(exp % DAY, 0, "day aligned");
  assert.ok(exp - now >= 5 * DAY && exp - now <= OBJECT_URL_MAX_TTL_SECONDS, "valid 5-6 days, within the verifier cap");
  assert.equal(verifyObjectSignature(key, String(exp), first.searchParams.get("sig")), "VALID");
  const original = clock;
  clock += 6 * 60 * 60;
  assert.equal(new URL(signObjectKey(key, OBJECT_URL_TTL.publicSite)).toString(), first.toString(), "same URL hours later");
  clock = original + 2 * DAY; // the oldest stale page Next may serve (expireTime)
  assert.equal(verifyObjectSignature(key, String(exp), first.searchParams.get("sig")), "VALID");
  clock = original;
  const short = new URL(signObjectKey(key, OBJECT_URL_TTL.preview));
  assert.ok(Number(short.searchParams.get("exp")) - now <= 60 * 60 + 15 * 60, "short links keep the 15-minute bucket");
});

test("browsers reuse a signed photo while its signature lives, up to a day", async () => {
  const long = await app.inject({ method: "GET", url: pathOf(signObjectKey(key, OBJECT_URL_TTL.publicSite)) });
  assert.equal(long.headers["cache-control"], `private, max-age=${DAY}`);
  const short = await app.inject({ method: "GET", url: pathOf(signObjectKey(key, 600)) });
  const maxAge = Number(/max-age=(\d+)/.exec(short.headers["cache-control"])[1]);
  assert.match(short.headers["cache-control"], /^private, /);
  assert.ok(maxAge > 0 && maxAge <= 900, `short signature caches only while valid (${maxAge}s)`);
});
