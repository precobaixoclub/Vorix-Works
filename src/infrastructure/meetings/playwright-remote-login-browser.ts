import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, open, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoginDetection, RemoteLoginBrowser, RemoteLoginBrowserFactory, ViewerInput } from "../../application/meetings/recorder-provisioning.js";

type CdpSession = { send(method: string, params?: Record<string, unknown>): Promise<unknown>; on(event: string, listener: (payload: Record<string, unknown>) => void): void; detach(): Promise<void> };
type Locator = { first(): Locator; isVisible(options?: Record<string, unknown>): Promise<boolean>; getAttribute(name: string): Promise<string | null> };
type Page = {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  url(): string;
  isClosed(): boolean;
  bringToFront(): Promise<void>;
  locator(selector: string): Locator;
  mouse: { move(x: number, y: number): Promise<void>; down(options?: Record<string, unknown>): Promise<void>; up(options?: Record<string, unknown>): Promise<void>; wheel(dx: number, dy: number): Promise<void> };
  keyboard: { down(key: string): Promise<void>; up(key: string): Promise<void>; insertText(text: string): Promise<void> };
};
type Context = { newPage(): Promise<Page>; newCDPSession(page: Page): Promise<CdpSession>; storageState(): Promise<unknown>; close(): Promise<void>; on(event: "page", listener: (page: Page) => void): void };
type Browser = { newContext(options: Record<string, unknown>): Promise<Context>; close(): Promise<void> };

export type RemoteLoginBrowserOptions = {
  chromiumExecutablePath?: string;
  xvfbPath?: string;
  viewport?: { width: number; height: number };
  jpegQuality?: number;
};

/** Teclas especiais repassadas por nome; o resto chega como texto (`insertText`). */
const ALLOWED_KEYS = new Set(["Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Shift", "Control", "Alt", "Meta", "PageUp", "PageDown", " "]);

/**
 * Chromium TEMPORÁRIO, com display virtual e perfil próprios, para o login self-service de uma
 * conta de gravação. A tela sai por `Page.startScreencast` (CDP); a entrada do cliente volta por
 * mouse/teclado do Playwright. Nada do que é digitado é lido ou registrado aqui.
 */
export class PlaywrightRemoteLoginBrowserFactory implements RemoteLoginBrowserFactory {
  constructor(private readonly options: RemoteLoginBrowserOptions = {}) {}

  async open(input: { sessionId: string; loginHint: string }): Promise<RemoteLoginBrowser> {
    const viewport = this.options.viewport ?? { width: 1024, height: 720 };
    const profileDir = await mkdtemp(join(tmpdir(), "vorix-recorder-login-"));
    let allocation: { number: number; lockPath: string } | undefined;
    let xvfb: ChildProcessWithoutNullStreams | undefined;
    let browser: Browser | undefined;
    const cleanup = async () => {
      await browser?.close().catch(() => undefined);
      if (xvfb && xvfb.exitCode === null) xvfb.kill("SIGKILL");
      if (allocation) await unlink(allocation.lockPath).catch(() => undefined);
      await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    };
    try {
      allocation = process.platform === "linux" ? await allocateDisplay(input.sessionId) : undefined;
      if (allocation) {
        xvfb = spawn(this.options.xvfbPath ?? "Xvfb", [`:${allocation.number}`, "-screen", "0", `${viewport.width}x${viewport.height}x24`, "-nolisten", "tcp"], { stdio: ["pipe", "pipe", "pipe"] });
        await waitForStart(xvfb);
      }
      const playwrightModule = "playwright-core";
      const playwright = await import(playwrightModule) as unknown as { chromium: { launch(options: Record<string, unknown>): Promise<Browser> } };
      // Headed num display virtual (como um navegador normal) — sem flags de automação que façam o
      // Google tratar o login como inseguro, e sem nenhum desvio de verificação.
      browser = await playwright.chromium.launch({
        headless: !allocation,
        ...(this.options.chromiumExecutablePath ? { executablePath: this.options.chromiumExecutablePath } : {}),
        env: { ...process.env, ...(allocation ? { DISPLAY: `:${allocation.number}` } : {}) },
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", `--window-size=${viewport.width},${viewport.height}`, "--no-first-run", "--no-default-browser-check"],
      });
      const context = await browser.newContext({ viewport, locale: "pt-BR", acceptDownloads: false });
      let page = await context.newPage();
      let cdp: CdpSession | undefined;
      const listeners: ((frame: { jpeg: Buffer; width: number; height: number }) => void)[] = [];
      let lastFrame: { jpeg: Buffer; width: number; height: number } | undefined;
      const quality = this.options.jpegQuality ?? 60;

      const stream = async (target: Page) => {
        await cdp?.send("Page.stopScreencast").catch(() => undefined);
        await cdp?.detach().catch(() => undefined);
        cdp = await context.newCDPSession(target);
        const session = cdp;
        session.on("Page.screencastFrame", (payload) => {
          const sessionId = payload.sessionId as number;
          void session.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
          const metadata = (payload.metadata ?? {}) as { deviceWidth?: number; deviceHeight?: number };
          const frame = { jpeg: Buffer.from(String(payload.data ?? ""), "base64"), width: metadata.deviceWidth ?? viewport.width, height: metadata.deviceHeight ?? viewport.height };
          lastFrame = frame;
          for (const listener of listeners) listener(frame);
        });
        await session.send("Page.startScreencast", { format: "jpeg", quality, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
      };
      // Popups do Google (raros no login) passam a ser a página transmitida.
      context.on("page", (next) => {
        page = next;
        void next.bringToFront().catch(() => undefined).then(() => stream(next)).catch(() => undefined);
      });
      await stream(page);
      const hint = input.loginHint ? `&Email=${encodeURIComponent(input.loginHint)}` : "";
      await page.goto(`https://accounts.google.com/ServiceLogin?hl=pt-BR&continue=${encodeURIComponent("https://meet.google.com/")}${hint}`, { waitUntil: "domcontentloaded", timeout: 45_000 });

      return {
        onFrame(listener) { listeners.push(listener); if (lastFrame) listener(lastFrame); },
        async dispatch(event: ViewerInput) {
          if (page.isClosed()) return;
          if (event.t === "mouse") {
            await page.mouse.move(event.x, event.y);
            if (event.a === "down") await page.mouse.down({ button: event.b ?? "left" });
            if (event.a === "up") await page.mouse.up({ button: event.b ?? "left" });
          } else if (event.t === "wheel") {
            await page.mouse.move(event.x, event.y);
            await page.mouse.wheel(event.dx ?? 0, event.dy);
          } else if (event.t === "key") {
            if (!ALLOWED_KEYS.has(event.key)) return;
            if (event.a === "down") await page.keyboard.down(event.key);
            else await page.keyboard.up(event.key);
          } else {
            await page.keyboard.insertText(event.v);
          }
        },
        async detect(): Promise<LoginDetection> {
          if (page.isClosed()) return { loggedIn: false };
          const url = page.url();
          if (/accounts\.google\.com\/.*challenge/i.test(url)) return { loggedIn: false, challenge: true };
          if (!/^https:\/\/meet\.google\.com\//i.test(url)) return { loggedIn: false };
          const account = page.locator('a[href*="accounts.google.com/SignOutOptions"]').first();
          if (!(await account.isVisible({ timeout: 1_000 }).catch(() => false))) return { loggedIn: false };
          const label = (await account.getAttribute("aria-label").catch(() => null)) ?? "";
          const email = /[^\s()<>]+@[^\s()<>]+\.[^\s()<>]+/.exec(label)?.[0];
          return { loggedIn: true, ...(email ? { email } : {}) };
        },
        async storageState() {
          return JSON.stringify(await context.storageState());
        },
        async close() {
          lastFrame = undefined;
          listeners.length = 0;
          await cdp?.send("Page.stopScreencast").catch(() => undefined);
          await context.close().catch(() => undefined);
          await cleanup();
        },
      };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
}

async function allocateDisplay(seedText: string): Promise<{ number: number; lockPath: string }> {
  // Mesmo diretório de locks do recorder: gravação e login nunca disputam o mesmo display.
  const root = join(tmpdir(), "vorix-recorder-displays");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const seed = [...seedText].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0);
  for (let offset = 0; offset < 500; offset += 1) {
    const number = 100 + ((seed + offset) % 500);
    const lockPath = join(root, `${number}.lock`);
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.close();
      return { number, lockPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Nenhum display virtual livre para o login.");
}

function waitForStart(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 500);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Xvfb encerrou ao iniciar (codigo ${code}).`)); });
  });
}
