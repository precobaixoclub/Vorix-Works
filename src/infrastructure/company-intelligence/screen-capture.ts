import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Captura de tela real (seção 4) — mesma técnica validada na sprint do Autonomous Execution
 * Engine (`chrome.exe --headless --screenshot=<path>`), mas apontada para uma URL `https://`
 * real em vez de um `file://` de HTML gerado localmente. Reimplementa a pequena detecção de
 * executável em vez de importar de `html-mockup-renderer.ts` para manter os dois módulos
 * desacoplados (nenhum dos dois precisa saber que o outro existe).
 */

export type ScreenCaptureInput = {
  url: string;
  outputAbsolutePath: string;
  width: number;
  height: number;
  fullPage?: boolean;
  chromeExecutablePath?: string;
};

export type ScreenCaptureResult = { ok: true } | { ok: false; error: string };

const KNOWN_CHROME_PATHS = [
  process.env.ZUNO_CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter((path): path is string => Boolean(path));

const CAPTURE_TIMEOUT_MS = 20_000;

async function findChromeExecutable(preferred?: string): Promise<string | undefined> {
  const candidates = preferred ? [preferred, ...KNOWN_CHROME_PATHS] : KNOWN_CHROME_PATHS;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

export async function captureScreen(input: ScreenCaptureInput): Promise<ScreenCaptureResult> {
  const chromePath = await findChromeExecutable(input.chromeExecutablePath);
  if (!chromePath) {
    return { ok: false, error: "Nenhum executável Chrome/Edge encontrado nos caminhos conhecidos (defina ZUNO_CHROME_PATH para apontar um)." };
  }

  await mkdir(dirname(input.outputAbsolutePath), { recursive: true });

  const args = [
    "--headless",
    "--disable-gpu",
    `--screenshot=${input.outputAbsolutePath}`,
    `--window-size=${input.width},${input.height}`,
    "--hide-scrollbars",
    "--virtual-time-budget=6000",
  ];
  if (input.fullPage) args.push("--full-page-screenshot");
  args.push(input.url);

  return new Promise<ScreenCaptureResult>((resolvePromise) => {
    const child = spawn(chromePath, args);
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      resolvePromise({ ok: false, error: `captura excedeu ${CAPTURE_TIMEOUT_MS}ms para ${input.url}` });
    }, CAPTURE_TIMEOUT_MS);

    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolvePromise({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise({ ok: true });
      else resolvePromise({ ok: false, error: stderr.trim() || `chrome headless saiu com código ${code} para ${input.url}` });
    });
  });
}
