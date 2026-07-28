import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Gerador de narração via Windows SAPI (`System.Speech`, PowerShell) — técnica validada
 * manualmente em sessões anteriores (voz `Microsoft Maria Desktop` para pt-BR feminino,
 * `Rate=2` atinge a duração alvo; `Rate=-1` fica lento demais e estoura a duração planejada).
 * Isolado em `src/infrastructure/autonomous/` (fora de `src/infrastructure/audio/`) porque é uma
 * ferramenta de FALLBACK específica do Autonomous Execution Engine, nunca o caminho oficial de
 * geração de narração de nenhuma Skill — Nora continua sem saber que isto existe.
 *
 * Só funciona em Windows (SAPI é uma API do Windows); em qualquer outro SO, `synthesizeNarrationWav`
 * devolve `{ ok: false }` de forma honesta, sem tentar nada.
 */

export type SapiNarrationInput = {
  text: string;
  outputAbsolutePath: string;
  genderPreference: "female" | "male" | "neutral";
  language: string;
  /** Escala SAPI: -10 (muito lento) a 10 (muito rápido). Default 2 — validado empiricamente para bater a duração planejada de narrações de anúncio de ~30s. */
  rate?: number;
};

export type SapiNarrationResult = { ok: true } | { ok: false; error: string };

const KNOWN_PT_BR_FEMALE_VOICE = "Microsoft Maria Desktop";

function pickVoiceName(input: SapiNarrationInput): string | undefined {
  if (input.language.toLowerCase().startsWith("pt") && input.genderPreference !== "male") return KNOWN_PT_BR_FEMALE_VOICE;
  return undefined;
}

function escapePowerShellPath(path: string): string {
  return path.replace(/'/g, "''");
}

export async function synthesizeNarrationWav(input: SapiNarrationInput): Promise<SapiNarrationResult> {
  if (process.platform !== "win32") {
    return { ok: false, error: "Windows SAPI só está disponível em Windows; nenhuma tentativa foi feita neste sistema operacional." };
  }

  const workDir = join(tmpdir(), `zuno-sapi-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const textPath = join(workDir, "text.txt");
  const scriptPath = join(workDir, "synthesize.ps1");

  try {
    await writeFile(textPath, input.text, "utf8");
    await mkdir(dirname(input.outputAbsolutePath), { recursive: true });

    const voiceName = pickVoiceName(input);
    const rate = input.rate ?? 2;
    const scriptLines = [
      "Add-Type -AssemblyName System.Speech",
      "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
      voiceName ? `try { $synth.SelectVoice('${escapePowerShellPath(voiceName)}') } catch { }` : "",
      `$synth.Rate = ${rate}`,
      `$text = Get-Content -Raw -Encoding UTF8 -Path '${escapePowerShellPath(textPath)}'`,
      `$synth.SetOutputToWaveFile('${escapePowerShellPath(input.outputAbsolutePath)}')`,
      "$synth.Speak($text)",
      "$synth.Dispose()",
    ].filter((line) => line.length > 0);
    await writeFile(scriptPath, scriptLines.join("\r\n"), "utf8");

    return await new Promise<SapiNarrationResult>((resolvePromise) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath]);
      let stderr = "";
      child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", (error) => resolvePromise({ ok: false, error: error.message }));
      child.on("close", (code) => {
        if (code === 0) resolvePromise({ ok: true });
        else resolvePromise({ ok: false, error: stderr.trim() || `powershell.exe saiu com código ${code}` });
      });
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
