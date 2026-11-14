import type { Route } from "playwright-core";

/**
 * The networks' static bundles (JavaScript, CSS, fonts, icon sprites): public files, versioned by
 * their URL and identical for everyone. Only these are cached; pages, APIs, profile photos and
 * anything tied to an account always go through the browser (and the owner's home connection).
 */
const META_STATIC = /^static\.(cdninstagram\.com|[a-z0-9-]+\.fbcdn\.net)$/;
const TIKTOK_STATIC = /(^|\.)(ttwstatic\.com|tiktokstatic\.com)$/;
export function staticAssetURL(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    return META_STATIC.test(url.hostname) ? url.pathname.startsWith("/rsrc.php/") : TIKTOK_STATIC.test(url.hostname);
  } catch { return false; }
}

type Asset = { status: number; headers: Record<string, string>; body: Buffer };
type Fetcher = (url: string, init: { headers: Record<string, string>; redirect: "manual"; signal: AbortSignal }) => Promise<Response>;

/** Request headers worth forwarding: never cookies or connection-level ones. */
const DROP_REQUEST = new Set(["cookie", "host", "connection", "content-length", "proxy-authorization", "authorization"]);
/** Response headers the browser must not see on a replayed body (it is already decoded). */
const DROP_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie", "alt-svc", "keep-alive"]);
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

/**
 * Intercepting requests (needed to keep the login browser on the network's own domains) turns off
 * Chromium's HTTP cache, so every screen used to download the same megabytes again through the
 * owner's home tunnel. This keeps one in-memory copy per static file for all logins and posts, and
 * fetches a missing one straight from the server: no cookies, no account data. Bounded by bytes
 * (least recently used goes first); a failure just falls back to the normal browser request.
 */
export class StaticAssetCache {
  private readonly entries = new Map<string, Asset>();
  private readonly loading = new Map<string, Promise<Asset | undefined>>();
  private bytes = 0;
  constructor(private readonly maxBytes = 64 * 1024 * 1024, private readonly fetcher: Fetcher = (url, init) => fetch(url, init)) {}
  stats() { return { entries: this.entries.size, bytes: this.bytes }; }

  /** Serves the request from the cache (or the server's own download). false = let the browser fetch it. */
  async serve(route: Route): Promise<boolean> {
    const request = route.request();
    if (request.method() !== "GET" || !staticAssetURL(request.url())) return false;
    const headers = Object.fromEntries(Object.entries(await request.allHeaders()).filter(([name]) => !name.startsWith(":") && !DROP_REQUEST.has(name.toLowerCase())));
    // A CORS load (crossorigin script) must get the answer made for its origin.
    const key = `${request.url()}\n${headers.origin ?? ""}`;
    let asset = this.entries.get(key);
    if (asset) { this.entries.delete(key); this.entries.set(key, asset); }
    else {
      let pending = this.loading.get(key);
      if (!pending) { pending = this.load(key, request.url(), headers).finally(() => this.loading.delete(key)); this.loading.set(key, pending); }
      asset = await pending;
    }
    if (!asset) return false;
    await route.fulfill({ status: asset.status, headers: asset.headers, body: asset.body });
    return true;
  }

  private async load(key: string, url: string, headers: Record<string, string>): Promise<Asset | undefined> {
    try {
      const response = await this.fetcher(url, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
      if (response.status !== 200) { await response.body?.cancel().catch(() => undefined); return undefined; }
      const body = Buffer.from(await response.arrayBuffer());
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, name) => { if (!DROP_RESPONSE.has(name.toLowerCase())) responseHeaders[name] = value; });
      const asset = { status: 200, headers: responseHeaders, body };
      const cacheControl = response.headers.get("cache-control") ?? "", vary = response.headers.get("vary") ?? "";
      if (!/no-store|private/i.test(cacheControl) && !/\*|cookie/i.test(vary) && body.length <= MAX_ASSET_BYTES) this.remember(key, asset);
      return asset;
    } catch { return undefined; }
  }

  private remember(key: string, asset: Asset): void {
    const old = this.entries.get(key);
    if (old) { this.bytes -= old.body.length; this.entries.delete(key); }
    this.entries.set(key, asset); this.bytes += asset.body.length;
    for (const [oldest, entry] of this.entries) { if (this.bytes <= this.maxBytes) break; this.entries.delete(oldest); this.bytes -= entry.body.length; }
  }
}
