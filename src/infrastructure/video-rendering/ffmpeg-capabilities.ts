import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { FontFilePaths } from "./timeline-to-filter-compiler.js";

const execFileAsync = promisify(execFile);

/**
 * Verifica, uma única vez por processo, se o binário resolvido do FFmpeg suporta o filtro
 * `gradients` (nem toda build inclui `libavfilter` com esse filtro). Usa `execFile` (nunca
 * `exec`/shell) só para ler `-filters`, sem processar nenhuma entrada externa.
 */
export async function probeSupportsGradients(binaryPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ["-hide_banner", "-filters"], { timeout: 10_000 });
    return /\bgradients\b/.test(stdout);
  } catch {
    return false;
  }
}

const REGULAR_FONT_CANDIDATES = [
  "C:/Windows/Fonts/georgia.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
  "/System/Library/Fonts/Supplemental/Georgia.ttf",
];

const BOLD_FONT_CANDIDATES = [
  "C:/Windows/Fonts/georgiab.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
];

/** Resolve fontes reais no disco para o `drawtext` do FFmpeg — nunca uma fonte por nome via fontconfig (nem todo build do FFmpeg tem fontconfig habilitado, ex. builds oficiais para Windows). */
export function resolveFontPaths(): FontFilePaths {
  const regular = REGULAR_FONT_CANDIDATES.find((candidate) => existsSync(candidate));
  const bold = BOLD_FONT_CANDIDATES.find((candidate) => existsSync(candidate));

  if (!regular || !bold) {
    throw new Error(
      "Nenhuma fonte TrueType compatível foi encontrada no sistema para o FFmpeg desenhar texto (drawtext). " +
        `Candidatas verificadas: ${[...REGULAR_FONT_CANDIDATES, ...BOLD_FONT_CANDIDATES].join(", ")}.`,
    );
  }

  return { regular, bold };
}
