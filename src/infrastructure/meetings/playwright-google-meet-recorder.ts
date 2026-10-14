import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, open, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecorderCaptureResult, RecorderRuntimePort } from "../../application/meetings/meeting-recorder.js";
import { RecorderFailure } from "../../application/meetings/meeting-recorder.js";

type BrowserLike = { newContext(options: Record<string, unknown>): Promise<ContextLike>; close(): Promise<void>; isConnected(): boolean };
type ContextLike = { newPage(): Promise<PageLike>; close(): Promise<void> };
type LocatorLike = { count(): Promise<number>; first(): LocatorLike; click(options?: Record<string, unknown>): Promise<void>; isVisible(options?: Record<string, unknown>): Promise<boolean> };
type PageLike = {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  url(): string;
  isClosed(): boolean;
  locator(selector: string): LocatorLike;
  getByRole(role: string, options: Record<string, unknown>): LocatorLike;
  getByText(text: RegExp): LocatorLike;
};

export type GoogleMeetRecorderOptions = {
  chromiumExecutablePath?: string;
  ffmpegPath?: string;
  xvfbPath?: string;
  pactlPath?: string;
  viewport?: { width: number; height: number };
  frameRate?: number;
  endGraceMs?: number;
  pollMs?: number;
};

export type BotSessionHealth = { ok: boolean; reason?: "redirect_login" | "challenge" | "meet_unavailable"; details: Record<string, unknown> };

export class GoogleMeetBotHealthChecker {
  constructor(private readonly chromiumExecutablePath?: string) {}

  async check(storageStateJson: string): Promise<BotSessionHealth> {
    const playwrightModule = "playwright-core";
    const playwright = await import(playwrightModule) as unknown as { chromium: { launch(options: Record<string, unknown>): Promise<BrowserLike> } };
    let browser: BrowserLike | undefined;
    let context: ContextLike | undefined;
    try {
      browser = await playwright.chromium.launch({ headless: true, ...(this.chromiumExecutablePath ? { executablePath: this.chromiumExecutablePath } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      context = await browser.newContext({ storageState: JSON.parse(storageStateJson), locale: "pt-BR" });
      const page = await context.newPage();
      await page.goto("https://meet.google.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (/accounts\.google\.com|signin/i.test(page.url())) return { ok: false, reason: "redirect_login", details: { finalHost: safeHost(page.url()) } };
      if (/challenge/i.test(page.url()) || await firstVisible([page.getByText(/verify it.s you|confirme que e voce/i)], 1_000)) {
        return { ok: false, reason: "challenge", details: { finalHost: safeHost(page.url()) } };
      }
      const ready = await firstVisible([
        page.getByRole("button", { name: /new meeting|nova reuniao/i }),
        page.locator('input[placeholder*="code"]'),
        page.locator('a[href*="accounts.google.com/SignOutOptions"]'),
      ], 2_000);
      return ready
        ? { ok: true, details: { finalHost: safeHost(page.url()), checkedAt: new Date().toISOString() } }
        : { ok: false, reason: "meet_unavailable", details: { finalHost: safeHost(page.url()) } };
    } catch (error) {
      return { ok: false, reason: "meet_unavailable", details: { error: error instanceof Error ? error.message.slice(0, 500) : String(error) } };
    } finally {
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    }
  }
}

export class PlaywrightGoogleMeetRecorder implements RecorderRuntimePort {
  private readonly options: Required<Omit<GoogleMeetRecorderOptions, "chromiumExecutablePath">> & Pick<GoogleMeetRecorderOptions, "chromiumExecutablePath">;

  constructor(options: GoogleMeetRecorderOptions = {}) {
    this.options = {
      ...(options.chromiumExecutablePath ? { chromiumExecutablePath: options.chromiumExecutablePath } : {}),
      ffmpegPath: options.ffmpegPath ?? "ffmpeg",
      xvfbPath: options.xvfbPath ?? "Xvfb",
      pactlPath: options.pactlPath ?? "pactl",
      viewport: options.viewport ?? { width: 1280, height: 720 },
      frameRate: options.frameRate ?? 25,
      endGraceMs: options.endGraceMs ?? 12_000,
      pollMs: options.pollMs ?? 1_000,
    };
  }

  async capture(input: Parameters<RecorderRuntimePort["capture"]>[0]): Promise<RecorderCaptureResult> {
    if (process.platform !== "linux") throw new RecorderFailure("RECORDER_PLATFORM_UNSUPPORTED", "O recorder real requer o container Linux dedicado.");
    const startedCpu = process.cpuUsage();
    const startedAt = Date.now();
    const tempDir = await mkdtemp(join(tmpdir(), `vorix-recorder-${safe(input.recordingId)}-`));
    const outputPath = join(tempDir, "capture.mp4");
    const allocation = await allocateDisplay(input.recordingId);
    const display = `:${allocation.number}`;
    const audioSink = `vorix_${safe(input.recordingId)}`;
    let xvfb: ChildProcessWithoutNullStreams | undefined;
    let ffmpeg: ChildProcessWithoutNullStreams | undefined;
    let browser: BrowserLike | undefined;
    let context: ContextLike | undefined;
    let pulseModule: string | undefined;
    let ffmpegExitCode: number | undefined;
    let browserExitReason: string | undefined;
    let stderr = "";

    try {
      xvfb = spawn(this.options.xvfbPath, [display, "-screen", "0", `${this.options.viewport.width}x${this.options.viewport.height}x24`, "-nolisten", "tcp", "-ac"], { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
      await waitForProcessStart(xvfb, "Xvfb");
      pulseModule = (await command(this.options.pactlPath, ["load-module", "module-null-sink", `sink_name=${audioSink}`, `sink_properties=device.description=${audioSink}`], 15_000)).stdout.trim();

      const playwrightModule = "playwright-core";
      const playwright = await import(playwrightModule) as unknown as { chromium: { launch(options: Record<string, unknown>): Promise<BrowserLike> } };
      browser = await playwright.chromium.launch({
        headless: false,
        ...(this.options.chromiumExecutablePath ? { executablePath: this.options.chromiumExecutablePath } : {}),
        env: { ...process.env, DISPLAY: display, PULSE_SINK: audioSink },
        args: [
          "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--autoplay-policy=no-user-gesture-required",
          "--use-fake-ui-for-media-stream", `--window-size=${this.options.viewport.width},${this.options.viewport.height}`,
        ],
      });
      const browserPid = Number((browser as unknown as { process?: () => { pid?: number } }).process?.()?.pid) || undefined;
      context = await browser.newContext({ storageState: JSON.parse(input.storageStateJson), viewport: this.options.viewport, locale: "pt-BR", permissions: [] });
      const page = await context.newPage();
      await input.onProcesses({ browserPid, display, audioSink, tempDir });
      await page.goto(input.meetingUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await this.assertAuthenticated(page);
      await this.disableOutgoingMedia(page);

      const joinButton = await firstVisible([
        page.getByRole("button", { name: /join now|ask to join|participar agora|pedir para participar/i }),
        page.locator('[data-mdc-dialog-action="accept"]'),
        page.locator('button[jsname="Qx7uuf"]'),
      ]);
      if (!joinButton) throw new RecorderFailure("MEET_NOT_FOUND", "A tela de entrada do Google Meet nao foi reconhecida.");
      const admissionStartedAt = Date.now();
      await joinButton.click({ timeout: 10_000 });
      await input.onState("waiting_admission", new Date().toISOString());
      const joinedAt = await this.waitForAdmission(page, browser, input.shouldStop, input.admissionTimeoutMs);
      await input.onState("recording", joinedAt);

      ffmpeg = spawn(this.options.ffmpegPath, [
        "-hide_banner", "-loglevel", "warning", "-y",
        "-f", "x11grab", "-draw_mouse", "0", "-framerate", String(this.options.frameRate),
        "-video_size", `${this.options.viewport.width}x${this.options.viewport.height}`, "-i", `${display}.0`,
        "-f", "pulse", "-i", `${audioSink}.monitor`,
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", outputPath,
      ], { env: { ...process.env, DISPLAY: display, PULSE_SINK: audioSink }, stdio: ["pipe", "pipe", "pipe"] });
      ffmpeg.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-20_000); });
      ffmpeg.once("close", (code) => { ffmpegExitCode = code ?? -1; });
      await waitForProcessStart(ffmpeg, "ffmpeg");
      await input.onProcesses({ browserPid, ffmpegPid: ffmpeg.pid, display, audioSink, tempDir });

      const joinedMs = Date.parse(joinedAt);
      const maxEnd = joinedMs + input.maxDurationMinutes * 60_000;
      let stopReason: RecorderCaptureResult["stopReason"] = "meeting_ended";
      let missingControlsSince: number | undefined;
      while (true) {
        if (ffmpegExitCode !== undefined) throw new RecorderFailure("CAPTURE_FAILED", `ffmpeg terminou inesperadamente com codigo ${ffmpegExitCode}: ${stderr.slice(-1000)}`);
        if (!browser.isConnected() || page.isClosed()) {
          browserExitReason = "browser_disconnected";
          throw new RecorderFailure("BROWSER_FAILED", "Chromium encerrou durante a gravacao.");
        }
        if (await input.shouldStop()) { stopReason = "manual"; break; }
        if (Date.now() >= maxEnd) { stopReason = "max_duration"; break; }
        const stillInCall = await this.isInCall(page);
        const ended = await this.hasEndedSignal(page);
        if (ended) break;
        if (!stillInCall) missingControlsSince ??= Date.now();
        else missingControlsSince = undefined;
        if (missingControlsSince && Date.now() - missingControlsSince >= this.options.endGraceMs) break;
        await delay(this.options.pollMs);
      }

      ffmpegExitCode = await stopFfmpeg(ffmpeg);
      if (ffmpegExitCode !== 0) throw new RecorderFailure("CAPTURE_FAILED", `ffmpeg terminou com codigo ${ffmpegExitCode}: ${stderr.slice(-1000)}`);
      const file = await stat(outputPath).catch(() => undefined);
      if (!file?.size) throw new RecorderFailure("CAPTURE_FAILED", "ffmpeg nao produziu um arquivo de gravacao.");
      const cpu = process.cpuUsage(startedCpu);
      return {
        filePath: outputPath,
        stopReason,
        actualJoinedAt: joinedAt,
        admissionWaitSeconds: (joinedMs - admissionStartedAt) / 1000,
        ffmpegExitCode,
        ...(browserExitReason ? { browserExitReason } : {}),
        metrics: {
          elapsed_seconds: (Date.now() - startedAt) / 1000,
          worker_cpu_user_seconds: cpu.user / 1_000_000,
          worker_cpu_system_seconds: cpu.system / 1_000_000,
          worker_rss_bytes: process.memoryUsage().rss,
          temp_bytes: file.size,
        },
      };
    } finally {
      if (ffmpeg && ffmpegExitCode === undefined) {
        const processToStop = ffmpeg;
        await stopFfmpeg(processToStop).catch(() => kill(processToStop));
      }
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
      if (xvfb) kill(xvfb);
      if (pulseModule) await command(this.options.pactlPath, ["unload-module", pulseModule], 10_000).catch(() => undefined);
      await unlink(allocation.lockPath).catch(() => undefined);
      // O arquivo final fica disponivel ao orquestrador ate upload/validacao. Em falha, a pasta e removida.
      if (!await stat(outputPath).catch(() => undefined)) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async assertAuthenticated(page: PageLike): Promise<void> {
    if (/accounts\.google\.com|signin|challenge/i.test(page.url())) throw new RecorderFailure("BOT_SESSION_INVALID", "Google redirecionou o bot para login/challenge.", true);
    const login = await firstVisible([
      page.getByText(/sign in|fazer login|verify it.s you|confirme que e voce/i),
      page.locator('input[type="email"]'),
    ], 1_500);
    if (login) throw new RecorderFailure("BOT_SESSION_INVALID", "A sessao Google expirou ou exige challenge.", true);
  }

  private async disableOutgoingMedia(page: PageLike): Promise<void> {
    const candidates = [
      page.getByRole("button", { name: /turn off microphone|desativar microfone/i }),
      page.getByRole("button", { name: /turn off camera|desativar camera/i }),
      page.locator('[data-tooltip*="microphone"][aria-pressed="true"]'),
      page.locator('[data-tooltip*="camera"][aria-pressed="true"]'),
    ];
    for (const locator of candidates) {
      if (await locator.first().isVisible({ timeout: 700 }).catch(() => false)) await locator.first().click().catch(() => undefined);
    }
  }

  private async waitForAdmission(page: PageLike, browser: BrowserLike, shouldStop: () => Promise<boolean>, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await shouldStop()) throw new RecorderFailure("CANCELLED", "Gravacao cancelada antes da admissao.");
      if (!browser.isConnected() || page.isClosed()) throw new RecorderFailure("BROWSER_FAILED", "Chromium encerrou enquanto aguardava admissao.");
      await this.assertAuthenticated(page);
      if (await this.isInCall(page)) return new Date().toISOString();
      if (await this.hasEndedSignal(page)) throw new RecorderFailure("MEET_NOT_FOUND", "A reuniao foi encerrada ou nao esta disponivel.");
      await delay(this.options.pollMs);
    }
    throw new RecorderFailure("ADMISSION_TIMEOUT", "O host nao admitiu o bot dentro da janela configurada.");
  }

  private async isInCall(page: PageLike): Promise<boolean> {
    if (!/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(page.url())) return false;
    return Boolean(await firstVisible([
      page.getByRole("button", { name: /leave call|sair da chamada/i }),
      page.locator('[data-tooltip*="Leave call"]'),
      page.locator('[jsname="CQylAd"]'),
      page.locator('[data-is-muted]'),
    ], 500));
  }

  private async hasEndedSignal(page: PageLike): Promise<boolean> {
    if (!/meet\.google\.com/i.test(page.url())) return true;
    return Boolean(await firstVisible([
      page.getByText(/you left the meeting|call ended|reuniao encerrada|voce saiu da reuniao/i),
      page.getByRole("button", { name: /return to home screen|voltar para a tela inicial/i }),
    ], 400));
  }
}

async function firstVisible(locators: LocatorLike[], timeout = 2_000): Promise<LocatorLike | undefined> {
  for (const locator of locators) {
    const first = locator.first();
    if (await first.isVisible({ timeout }).catch(() => false)) return first;
  }
  return undefined;
}

async function allocateDisplay(recordingId: string): Promise<{ number: number; lockPath: string }> {
  const root = join(tmpdir(), "vorix-recorder-displays");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const seed = [...recordingId].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0);
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
  throw new RecorderFailure("RECORDER_CAPACITY_EXHAUSTED", "Nenhum display virtual isolado esta disponivel.");
}

function command(commandName: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${commandName} timeout`)); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${commandName} terminou com ${code}: ${stderr.slice(-500)}`)); });
  });
}

function waitForProcessStart(child: ChildProcessWithoutNullStreams, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 500);
    child.once("error", (error) => { clearTimeout(timer); reject(new Error(`${name} nao iniciou: ${error.message}`)); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`${name} encerrou ao iniciar (codigo ${code}).`)); });
  });
}

async function stopFfmpeg(child: ChildProcessWithoutNullStreams): Promise<number> {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve) => {
    const finish = (code: number | null) => resolve(code ?? -1);
    child.once("close", finish);
    child.stdin.write("q\n");
    const term = setTimeout(() => child.kill("SIGTERM"), 8_000);
    const hard = setTimeout(() => child.kill("SIGKILL"), 12_000);
    child.once("close", () => { clearTimeout(term); clearTimeout(hard); });
  });
}

function kill(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
const safeHost = (value: string) => { try { return new URL(value).hostname; } catch { return "invalid"; } };
