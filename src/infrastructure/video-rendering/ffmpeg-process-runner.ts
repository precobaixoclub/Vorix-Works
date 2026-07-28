import { spawn } from "node:child_process";

const MAX_LOG_LINES = 40;
const MAX_LOG_LINE_LENGTH = 500;
const DEFAULT_TIMEOUT_MS = 120_000;

export type RunFfmpegOptions = {
  binaryPath: string;
  args: string[];
  timeoutMs?: number;
};

export type RunFfmpegResult = {
  exitCode: number;
  durationMs: number;
  /** Últimas linhas de stderr (onde o FFmpeg grava progresso/erros), truncadas para não estourar o relatório. */
  logsSummary: string[];
};

export class FfmpegExecutionError extends Error {
  readonly exitCode: number | null;
  readonly logsSummary: string[];

  constructor(message: string, exitCode: number | null, logsSummary: string[]) {
    super(message);
    this.name = "FfmpegExecutionError";
    this.exitCode = exitCode;
    this.logsSummary = logsSummary;
  }
}

/**
 * Executa o FFmpeg de forma segura: `spawn` (nunca `exec`/`execSync`), sempre com `shell: false`
 * (padrão do Node, reforçado explicitamente abaixo) e argumentos em um array — nunca uma string
 * de comando concatenada, o que eliminaria qualquer risco de injeção de shell mesmo que um valor
 * malicioso chegasse a um argumento (o pior caso vira "um argumento de texto estranho para o
 * FFmpeg", nunca "um comando extra executado pelo shell"). O caminho do binário é sempre o
 * resolvido por `resolveFfmpegBinaryPath` (nunca uma variável de ambiente ou entrada do usuário).
 */
export function runFfmpeg(options: RunFfmpegOptions): Promise<RunFfmpegResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolvePromise, rejectPromise) => {
    const startedAt = Date.now();
    const stderrLines: string[] = [];
    let stderrTail = "";
    let settled = false;

    const child = spawn(options.binaryPath, options.args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill("SIGKILL");
      settle(() => rejectPromise(new FfmpegExecutionError(
        `Renderização cancelada: o FFmpeg não terminou em ${timeoutMs}ms.`,
        null,
        truncateLogs(stderrLines),
      )));
    }, timeoutMs);

    function settle(action: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    }

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail += chunk.toString("utf8");
      const parts = stderrTail.split("\n");
      stderrTail = parts.pop() ?? "";
      for (const line of parts) {
        stderrLines.push(line.slice(0, MAX_LOG_LINE_LENGTH));
      }
    });

    child.on("error", (error) => {
      settle(() => rejectPromise(new FfmpegExecutionError(
        `Falha ao iniciar o processo do FFmpeg: ${error.message}`,
        null,
        truncateLogs(stderrLines),
      )));
    });

    child.on("close", (exitCode) => {
      if (stderrTail) stderrLines.push(stderrTail.slice(0, MAX_LOG_LINE_LENGTH));
      const durationMs = Date.now() - startedAt;
      const logsSummary = truncateLogs(stderrLines);

      if (exitCode !== 0) {
        settle(() => rejectPromise(new FfmpegExecutionError(
          `FFmpeg terminou com código de saída ${exitCode}.`,
          exitCode,
          logsSummary,
        )));
        return;
      }

      settle(() => resolvePromise({ exitCode: 0, durationMs, logsSummary }));
    });
  });
}

function truncateLogs(lines: string[]): string[] {
  return lines.slice(-MAX_LOG_LINES);
}
