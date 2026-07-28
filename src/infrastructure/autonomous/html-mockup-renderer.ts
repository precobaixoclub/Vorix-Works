import { spawn } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

/**
 * Gerador de mockup via HTML + Chrome headless — técnica validada manualmente em sessões
 * anteriores (`chrome.exe --headless --disable-gpu --screenshot=<path> --window-size=W,H
 * <file-url>`). Seleção de template é por palavra-chave em `prompt`/`tags` (determinística, nunca
 * um LLM) — exatamente o mesmo espírito de `inferDeviceFromText` já usado pela Footage
 * Acquisition. Isolado em `src/infrastructure/autonomous/` pelo mesmo motivo do gerador de
 * narração: ferramenta de fallback do Engine, nunca o caminho oficial de nenhuma Skill.
 */

export type MockupTemplateId = "phone-screen" | "notebook-screen" | "generic-graphic";

export type MockupRenderInput = {
  prompt: string;
  tags: string[];
  requiredKind?: string;
  width: number;
  height: number;
  outputAbsolutePath: string;
  /** Injetável para testes/ambientes sem Chrome instalado; default detecta caminhos comuns do Windows. */
  chromeExecutablePath?: string;
};

export type MockupRenderResult = { ok: true; template: MockupTemplateId } | { ok: false; error: string };

const KNOWN_CHROME_PATHS = [
  process.env.ZUNO_CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter((path): path is string => Boolean(path));

export function selectMockupTemplate(input: { prompt: string; tags: string[]; requiredKind?: string }): MockupTemplateId {
  const haystack = `${input.prompt} ${input.tags.join(" ")} ${input.requiredKind ?? ""}`.toLowerCase();
  if (/notebook|laptop|desktop|computador|dashboard/.test(haystack)) return "notebook-screen";
  if (/celular|smartphone|phone|app|tela do (aplicativo|app)|mobile/.test(haystack)) return "phone-screen";
  return "generic-graphic";
}

function buildMockupHtml(template: MockupTemplateId, input: { prompt: string; width: number; height: number }): string {
  const frame = template === "phone-screen"
    ? { deviceWidth: "62%", deviceHeight: "78%", radius: "36px" }
    : template === "notebook-screen"
      ? { deviceWidth: "82%", deviceHeight: "58%", radius: "10px" }
      : { deviceWidth: "88%", deviceHeight: "88%", radius: "18px" };

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${input.width}px;height:${input.height}px;background:#0d0d12;font-family:Arial,Helvetica,sans-serif;}
    .stage{width:100%;height:100%;display:flex;align-items:center;justify-content:center;}
    .device{width:${frame.deviceWidth};height:${frame.deviceHeight};border-radius:${frame.radius};background:linear-gradient(160deg,#1c1c24,#2a2a35);border:2px solid #3d3d4a;box-shadow:0 20px 60px rgba(0,0,0,0.6);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;}
    .label{color:#d8b26a;font-size:22px;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px;}
    .prompt{color:#f4f0e8;font-size:20px;line-height:1.4;text-align:center;max-width:90%;}
  </style></head><body>
    <div class="stage"><div class="device"><div class="label">Mockup — ${template}</div><div class="prompt">${escapeHtml(input.prompt)}</div></div></div>
  </body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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

export async function renderMockupPng(input: MockupRenderInput): Promise<MockupRenderResult> {
  const template = selectMockupTemplate(input);
  const chromePath = await findChromeExecutable(input.chromeExecutablePath);
  if (!chromePath) {
    return { ok: false, error: "Nenhum executável Chrome/Edge encontrado nos caminhos conhecidos (defina ZUNO_CHROME_PATH para apontar um)." };
  }

  const workDir = join(tmpdir(), `zuno-mockup-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const htmlPath = join(workDir, "mockup.html");

  try {
    await writeFile(htmlPath, buildMockupHtml(template, input), "utf8");
    await mkdir(dirname(input.outputAbsolutePath), { recursive: true });

    const fileUrl = pathToFileURL(htmlPath).toString();
    return await new Promise<MockupRenderResult>((resolvePromise) => {
      const child = spawn(chromePath, [
        "--headless",
        "--disable-gpu",
        `--screenshot=${input.outputAbsolutePath}`,
        `--window-size=${input.width},${input.height}`,
        "--hide-scrollbars",
        fileUrl,
      ]);
      let stderr = "";
      child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", (error) => resolvePromise({ ok: false, error: error.message }));
      child.on("close", (code) => {
        if (code === 0) resolvePromise({ ok: true, template });
        else resolvePromise({ ok: false, error: stderr.trim() || `chrome headless saiu com código ${code}` });
      });
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
