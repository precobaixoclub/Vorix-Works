import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { GatewayError } from "./protocol.js";

/** Bounded FIFO admission. A browser is shared; contexts and cookies are never shared. */
export class SocialBrowserPool {
  private browser?: Browser;
  private launching?: Promise<Browser>;
  private active = 0;
  private closed = false;
  private readonly waiters: { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }[] = [];
  constructor(private readonly options: { maxContexts?: number; executablePath?: string; queueTimeoutMs?: number } = {}) {}
  private async acquire(): Promise<void> {
    if (this.closed) throw new GatewayError("BUSY");
    if (this.active < (this.options.maxContexts ?? 2)) { this.active++; return; }
    if (this.waiters.length >= 16) throw new GatewayError("BUSY");
    await new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject, timer: setTimeout(() => { const i = this.waiters.indexOf(waiter); if (i >= 0) this.waiters.splice(i, 1); reject(new GatewayError("BUSY")); }, this.options.queueTimeoutMs ?? 30_000) };
      this.waiters.push(waiter);
    });
  }
  private release(): void { const next = this.waiters.shift(); if (next) { clearTimeout(next.timer); next.resolve(); } else this.active--; }
  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.launching) this.launching = chromium.launch({ headless: true, executablePath: this.options.executablePath, args: ["--disable-dev-shm-usage", "--disable-breakpad", "--disable-crash-reporter"], chromiumSandbox: process.env.SOCIAL_GATEWAY_CHROMIUM_SANDBOX !== "false" }).then(browser => { this.browser = browser; return browser; }).finally(() => { this.launching = undefined; });
    return this.launching;
  }
  async open(cookies?: Parameters<BrowserContext["addCookies"]>[0]): Promise<{ context: BrowserContext; close: () => Promise<void> }> {
    await this.acquire();
    let context: BrowserContext | undefined;
    try {
      context = await (await this.getBrowser()).newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US", acceptDownloads: false, serviceWorkers: "block" });
      context.setDefaultTimeout(12_000);
      context.setDefaultNavigationTimeout(40_000);
      if (cookies) await context.addCookies(cookies);
      let released = false;
      const close = async () => { if (released) return; released = true; await context!.close().catch(() => undefined); this.release(); };
      return { context, close };
    } catch { await context?.close().catch(() => undefined); this.release(); throw new GatewayError("TEMPORARY_PLATFORM_ERROR"); }
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(new GatewayError("BUSY")); }
    await this.browser?.close();
  }
  async checkReadiness(): Promise<void> { const lease = await this.open(); try { await lease.context.newPage(); } finally { await lease.close(); } }
}

export class GatewayMutex {
  private readonly tails = new Map<string, Promise<void>>();
  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>(resolve => { release = resolve; });
    this.tails.set(key, tail);
    try { await previous; return await task(); }
    finally { release(); if (this.tails.get(key) === tail) this.tails.delete(key); }
  }
}
