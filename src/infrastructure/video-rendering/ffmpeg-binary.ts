import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { platform as osPlatform } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Resolve o caminho absoluto do binário do FFmpeg empacotado pelo `ffmpeg-static`, deliberadamente
 * SEM importar `ffmpeg-static` diretamente (`import ffmpegPath from "ffmpeg-static"`).
 *
 * Motivo: o próprio `ffmpeg-static/index.js` lê `process.env.FFMPEG_BIN` e, se definida, devolve
 * essa variável de ambiente como o caminho do binário — ou seja, importar o pacote normalmente
 * permitiria que qualquer variável de ambiente substituísse o binário real por um executável
 * arbitrário, exatamente o risco que este projeto decidiu não aceitar (nenhum comando/binário
 * pode vir de variável de ambiente). Em vez disso, localizamos apenas a pasta onde o pacote foi
 * instalado (via resolução de módulo do Node, que não é sensível a `FFMPEG_BIN`) e montamos o
 * nome do executável a partir de `os.platform()` real (não de `process.env.npm_config_platform`,
 * que o `ffmpeg-static/index.js` também usa e que também poderia ser adulterada).
 */
export function resolveFfmpegBinaryPath(): string {
  const packageJsonPath = require.resolve("ffmpeg-static/package.json");
  const packageDir = dirname(packageJsonPath);
  const executableName = osPlatform() === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const binaryPath = join(packageDir, executableName);

  if (!existsSync(binaryPath) || !statSync(binaryPath).isFile()) {
    throw new Error(
      `Binário do FFmpeg não encontrado em "${binaryPath}". Rode "npm install" para garantir que a dependência "ffmpeg-static" foi instalada corretamente para esta plataforma.`,
    );
  }

  return binaryPath;
}
