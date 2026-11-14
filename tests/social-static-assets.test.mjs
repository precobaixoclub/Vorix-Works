import test from "node:test";
import assert from "node:assert/strict";
import { StaticAssetCache, staticAssetURL } from "../dist/infrastructure/social/gateway/static-asset-cache.js";

const route = (url, headers = {}, method = "GET") => {
  const calls = { fulfilled: undefined };
  return { calls, request: () => ({ url: () => url, method: () => method, allHeaders: async () => ({ cookie: "sessionid=secret", ":authority": "x", accept: "*/*", ...headers }) }), fulfill: async (value) => { calls.fulfilled = value; } };
};
const reply = (body, headers = {}, status = 200) => new Response(body, { status, headers: { "content-type": "application/javascript", "content-encoding": "br", ...headers } });

test("only the networks' public bundles are cached, never pages, APIs or photos", () => {
  assert.equal(staticAssetURL("https://static.cdninstagram.com/rsrc.php/v4/yX/r/abc.js"), true);
  assert.equal(staticAssetURL("https://static.xx.fbcdn.net/rsrc.php/v3/y1/l/0,cross/x.css"), true);
  assert.equal(staticAssetURL("https://sf16-website-login.neutral.ttwstatic.com/obj/a.js"), false, "TikTok login scripts always come from the browser");
  assert.equal(staticAssetURL("https://www.instagram.com/api/v1/accounts/current_user/"), false);
  assert.equal(staticAssetURL("https://scontent.cdninstagram.com/v/t51/photo.jpg"), false);
  assert.equal(staticAssetURL("https://static.cdninstagram.com/other/path.js"), false);
  assert.equal(staticAssetURL("http://static.cdninstagram.com/rsrc.php/v4/a.js"), false);
});

test("a bundle is downloaded once, without cookies, and replayed to every later login", async () => {
  const seen = [];
  const cache = new StaticAssetCache(1024, async (url, init) => { seen.push(init.headers); return reply("console.log(1)", { "cache-control": "public, max-age=31536000", "set-cookie": "x=1" }); });
  const url = "https://static.cdninstagram.com/rsrc.php/v4/yX/r/abc.js";
  const [a, b] = [route(url), route(url)];
  assert.equal(await cache.serve(a), true);
  assert.equal(await cache.serve(b), true);
  assert.equal(seen.length, 1, "second login reuses the copy");
  assert.equal(seen[0].cookie, undefined, "cookies never leave with the download");
  assert.equal(seen[0][":authority"], undefined);
  assert.equal(b.calls.fulfilled.body.toString(), "console.log(1)");
  assert.equal(b.calls.fulfilled.headers["content-encoding"], undefined, "body is already decoded");
  assert.equal(b.calls.fulfilled.headers["set-cookie"], undefined);
  assert.equal(cache.stats().entries, 1);
});

test("errors, private answers and other requests fall back to the browser; the cache stays within its size", async () => {
  let status = 404;
  const cache = new StaticAssetCache(20, async () => status === 0 ? Promise.reject(new Error("offline")) : reply("x".repeat(12), { "cache-control": status === 201 ? "private" : "public" }, status === 201 ? 200 : status));
  const url = (name) => `https://static.cdninstagram.com/rsrc.php/v4/${name}.js`;
  assert.equal(await cache.serve(route(url("a"))), false, "404 goes to the browser");
  status = 0; assert.equal(await cache.serve(route(url("b"))), false, "network failure goes to the browser");
  assert.equal(await cache.serve(route(url("c"), {}, "POST")), false);
  status = 201; assert.equal(await cache.serve(route(url("d"))), true, "private answer is served once but not kept");
  assert.equal(cache.stats().entries, 0);
  status = 200;
  await cache.serve(route(url("e"))); await cache.serve(route(url("f")));
  assert.deepEqual(cache.stats(), { entries: 1, bytes: 12 }, "oldest copy leaves when over the limit");
});
