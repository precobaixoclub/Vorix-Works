import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, open, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoginDetection, RemoteLoginBrowser, RemoteLoginBrowserFactory, ViewerInput } from "../../application/meetings/recorder-provisioning.js";

type Locator = { first(): Locator; isVisible(options?: Record<string, unknown>): Promise<boolean>; waitFor(options?: Record<string, unknown>): Promise<void>; getAttribute(name: string): Promise<string | null> };
type Page = { goto(url: string, options?: Record<string, unknown>): Promise<unknown>; locator(selector: string): Locator };
type PersistentContext = { pages(): Page[]; newPage(): Promise<Page>; storageState(): Promise<unknown>; close(): Promise<void> };
type Chromium = { launchPersistentContext(userDataDir: string, options: Record<string, unknown>): Promise<PersistentContext> };

export type NativeChromeRemoteLoginOptions = {
  chromeExecutablePath?: string;
  xvfbPath?: string;
  ffmpegPath?: string;
  xdotoolPath?: string;
  screen?: { width: number; height: number };
  framesPerSecond?: number;
  jpegQuality?: number;
};

/** Teclas especiais do visualizador → nomes de tecla do X (xdotool). O resto chega como texto. */
const X_KEYS: Record<string, string> = {
  Enter: "Return", Tab: "Tab", Backspace: "BackSpace", Delete: "Delete", Escape: "Escape",
  ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Home: "Home", End: "End",
  Shift: "shift", Control: "ctrl", Alt: "alt", Meta: "super", PageUp: "Prior", PageDown: "Next", " ": "space",
};
const X_BUTTONS = { left: "1", middle: "2", right: "3" } as const;
const WHEEL_STEP_PX = 60;
const LOGIN_PAGE_TITLE = /(contas do google|google accounts|fazer login|sign in|verifica|verify|workspace)/i;

/**
 * Login self-service de uma conta de gravação num Google Chrome COMUM, sem automação.
 *
 * O Google recusa login em navegador controlado por automação ("Esse navegador ou app pode não ser
 * seguro"). Por isso, enquanto a pessoa entra na conta, o Chrome roda sozinho num display virtual —
 * sem Playwright, sem porta de depuração, sem nenhuma flag de automação ou disfarce. A tela sai por
 * captura do display (ffmpeg x11grab) e o mouse/teclado de quem está no visualizador entram como
 * entrada de sistema (xdotool), exatamente como numa área de trabalho remota.
 *
 * Quando a janela chega ao Google Meet, o Chrome é fechado normalmente (grava os cookies) e o
 * Playwright abre o MESMO perfil só para confirmar qual conta entrou e exportar o estado da sessão,
 * que vai direto para a cifragem. Senha e códigos nunca são lidos nem registrados; o gerenciador de
 * senhas do Chrome fica desligado por política da imagem e o perfil é apagado ao final.
 */
export class NativeChromeRemoteLoginBrowserFactory implements RemoteLoginBrowserFactory {
  constructor(private readonly options: NativeChromeRemoteLoginOptions = {}) {}

  async open(input: { sessionId: string; loginHint: string }): Promise<RemoteLoginBrowser> {
    const screen = this.options.screen ?? { width: 1024, height: 720 };
    const chromePath = this.options.chromeExecutablePath ?? "google-chrome-stable";
    const xdotoolPath = this.options.xdotoolPath ?? "xdotool";
    const profileDir = await mkdtemp(join(tmpdir(), "vorix-recorder-login-"));
    let allocation: { number: number; lockPath: string } | undefined;
    let xvfb: ChildProcess | undefined;
    let ffmpeg: ChildProcess | undefined;
    let chrome: ChildProcess | undefined;
    let automated: PersistentContext | undefined;
    let closed = false;
    const listeners: ((frame: { jpeg: Buffer; width: number; height: number }) => void)[] = [];
    let lastFrame: { jpeg: Buffer; width: number; height: number } | undefined;

    const cleanup = async () => {
      closed = true;
      await automated?.close().catch(() => undefined);
      automated = undefined;
      await stopGroup(chrome);
      await stopGroup(ffmpeg, 1_000);
      if (xvfb && xvfb.exitCode === null) xvfb.kill("SIGKILL");
      if (allocation) await unlink(allocation.lockPath).catch(() => undefined);
      await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    };

    try {
      if (process.platform !== "linux") throw new Error("Login com Chrome nativo exige Linux (Xvfb).");
      allocation = await allocateDisplay(input.sessionId);
      const display = `:${allocation.number}`;
      const env = { ...process.env, DISPLAY: display };
      xvfb = spawn(this.options.xvfbPath ?? "Xvfb", [display, "-screen", "0", `${screen.width}x${screen.height}x24`, "-nolisten", "tcp"], { stdio: "ignore" });
      await waitForStart(xvfb);

      const hint = input.loginHint ? `&Email=${encodeURIComponent(input.loginHint)}` : "";
      const loginUrl = `https://accounts.google.com/ServiceLogin?hl=pt-BR&continue=${encodeURIComponent("https://meet.google.com/")}${hint}`;
      const launchChrome = () => spawn(chromePath, [
        `--user-data-dir=${profileDir}`,
        // Mesmo cofre de cookies que o Playwright usa depois (chave "basic" do Linux, sem chaveiro).
        "--password-store=basic",
        "--no-first-run", "--no-default-browser-check", "--lang=pt-BR",
        // Container sem namespaces de usuário: o sandbox do Chrome não sobe (mesma flag de antes).
        "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
        "--window-position=0,0", `--window-size=${screen.width},${screen.height}`, "--kiosk",
        loginUrl,
      ], { env, stdio: "ignore", detached: true });
      chrome = launchChrome();

      // Tela: captura do display inteiro em JPEG; quadros idênticos não são reenviados.
      const quality = Math.max(2, Math.min(31, Math.round(31 - ((this.options.jpegQuality ?? 60) / 100) * 29)));
      ffmpeg = spawn(this.options.ffmpegPath ?? "ffmpeg", [
        "-loglevel", "error", "-f", "x11grab", "-draw_mouse", "1", "-framerate", String(this.options.framesPerSecond ?? 6),
        "-video_size", `${screen.width}x${screen.height}`, "-i", display,
        "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", String(quality), "-",
      ], { stdio: ["ignore", "pipe", "ignore"], detached: true });
      let pending = Buffer.alloc(0);
      ffmpeg.stdout?.on("data", (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        for (;;) {
          const start = pending.indexOf(JPEG_START);
          if (start < 0) { pending = Buffer.alloc(0); return; }
          const end = pending.indexOf(JPEG_END, start + 2);
          if (end < 0) { if (start > 0) pending = pending.subarray(start); return; }
          const jpeg = Buffer.from(pending.subarray(start, end + 2));
          pending = pending.subarray(end + 2);
          if (lastFrame && lastFrame.jpeg.equals(jpeg)) continue;
          const frame = { jpeg, width: screen.width, height: screen.height };
          lastFrame = frame;
          for (const listener of listeners) listener(frame);
        }
      });

      // Entrada: um comando por vez, na ordem em que chegou (apertar/soltar nunca se invertem).
      // UTF-8: sem isso o xdotool recusa acentos e "ç" (o container roda na localidade C).
      const xdoEnv = { ...env, LC_ALL: "C.UTF-8" };
      let queue: Promise<unknown> = Promise.resolve();
      const xdo = (args: string[], stdin?: string) => {
        queue = queue.then(() => run(xdotoolPath, args, xdoEnv, stdin)).catch(() => undefined);
        return queue;
      };
      let wheelX = 0;
      let wheelY = 0;
      let retryHandoffAt = 0;

      const windowTitles = async (): Promise<string[]> => {
        const ids = (await run(xdotoolPath, ["search", "--onlyvisible", "--class", "google-chrome"], xdoEnv).catch(() => "")).split(/\s+/).filter(Boolean).slice(0, 8);
        const names = await Promise.all(ids.map((id) => run(xdotoolPath, ["getwindowname", id], xdoEnv).catch(() => "")));
        return names.map((name) => name.trim()).filter(Boolean);
      };

      /** Fecha o Chrome comum e abre o mesmo perfil no Playwright para conferir a conta. */
      const handoff = async (): Promise<LoginDetection> => {
        await stopGroup(chrome, 10_000);
        chrome = undefined;
        const playwrightModule = "playwright-core";
        const { chromium } = await import(playwrightModule) as unknown as { chromium: Chromium };
        automated = await chromium.launchPersistentContext(profileDir, {
          headless: false,
          executablePath: chromePath,
          env,
          viewport: null,
          locale: "pt-BR",
          acceptDownloads: false,
          args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--window-position=0,0", `--window-size=${screen.width},${screen.height}`, "--no-first-run", "--no-default-browser-check"],
        });
        const page = automated.pages()[0] ?? await automated.newPage();
        await page.goto("https://meet.google.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
        const account = page.locator('a[href*="accounts.google.com/SignOutOptions"]').first();
        const visible = await account.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
        if (!visible) {
          // Ainda não entrou de fato: volta para o Chrome comum na tela de login.
          await automated.close().catch(() => undefined);
          automated = undefined;
          if (!closed) chrome = launchChrome();
          retryHandoffAt = Date.now() + 20_000;
          return { loggedIn: false };
        }
        const label = (await account.getAttribute("aria-label").catch(() => null)) ?? "";
        const email = /[^\s()<>]+@[^\s()<>]+\.[^\s()<>]+/.exec(label)?.[0];
        return { loggedIn: true, ...(email ? { email } : {}) };
      };

      return {
        onFrame(listener) { listeners.push(listener); if (lastFrame) listener(lastFrame); },
        async dispatch(event: ViewerInput) {
          if (closed || automated) return;
          if (event.t === "mouse") {
            const x = String(clamp(event.x, 0, screen.width - 1));
            const y = String(clamp(event.y, 0, screen.height - 1));
            if (event.a === "move") await xdo(["mousemove", x, y]);
            else await xdo(["mousemove", x, y, event.a === "down" ? "mousedown" : "mouseup", X_BUTTONS[event.b ?? "left"]]);
          } else if (event.t === "wheel") {
            wheelY += event.dy;
            wheelX += event.dx ?? 0;
            const clicks: string[] = [];
            while (Math.abs(wheelY) >= WHEEL_STEP_PX && clicks.length < 10) { clicks.push(wheelY > 0 ? "5" : "4"); wheelY -= Math.sign(wheelY) * WHEEL_STEP_PX; }
            while (Math.abs(wheelX) >= WHEEL_STEP_PX && clicks.length < 10) { clicks.push(wheelX > 0 ? "7" : "6"); wheelX -= Math.sign(wheelX) * WHEEL_STEP_PX; }
            if (clicks.length === 0) return;
            await xdo(["mousemove", String(clamp(event.x, 0, screen.width - 1)), String(clamp(event.y, 0, screen.height - 1)), ...clicks.flatMap((button) => ["click", button])]);
          } else if (event.t === "key") {
            const key = X_KEYS[event.key];
            if (!key) return;
            await xdo([event.a === "down" ? "keydown" : "keyup", key]);
          } else if (event.v) {
            // Texto pela entrada padrão: nunca aparece na linha de comando de um processo.
            await xdo(["type", "--delay", "8", "--file", "-"], event.v);
          }
        },
        async detect(): Promise<LoginDetection> {
          if (closed) return { loggedIn: false };
          if (automated) return { loggedIn: false };
          if (Date.now() < retryHandoffAt) return { loggedIn: false };
          const titles = await windowTitles();
          const onMeet = titles.some((title) => /meet/i.test(title) && !LOGIN_PAGE_TITLE.test(title));
          if (!onMeet) return { loggedIn: false, ...(titles.some((title) => /verifica|verify|2-step|duas etapas/i.test(title)) ? { challenge: true } : {}) };
          return await handoff();
        },
        async storageState() {
          if (!automated) throw new Error("Sessão ainda não confirmada.");
          return JSON.stringify(await automated.storageState());
        },
        async close() {
          lastFrame = undefined;
          listeners.length = 0;
          await cleanup();
        },
      };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
}

const JPEG_START = Buffer.from([0xff, 0xd8]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));

/** Encerra o processo e tudo o que ele abriu (grupo próprio): pede com SIGTERM, força depois. */
async function stopGroup(child: ChildProcess | undefined, graceMs = 5_000): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try { process.kill(-pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, graceMs))]);
  try { process.kill(-pid, "SIGKILL"); } catch { /* grupo já encerrado */ }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdout?.on("data", (chunk: Buffer) => { if (output.length < 4_096) output += chunk.toString("utf8"); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new Error(`${command} saiu com ${code}`)); });
    if (stdin !== undefined) child.stdin?.end(stdin);
  });
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

function waitForStart(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 500);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Xvfb encerrou ao iniciar (codigo ${code}).`)); });
  });
}
