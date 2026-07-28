import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";

/**
 * Extensões aceitas para uma música local fornecida manualmente (ex.: `--music`). Mesma allowlist
 * de `AUDIO_EXTENSIONS` em `src/infrastructure/video-rendering/asset-resolver.ts` — mantida aqui,
 * duplicada deliberadamente (não importada de `src/infrastructure/`), porque este validador roda
 * na camada de interface (CLI), antes mesmo de um workflow existir, e `src/shared/utils/` nunca
 * importa `src/infrastructure/` (ADR 0002 permite `shared/utils` ser importado por várias Skills,
 * não o contrário). O resolver de assets em `src/infrastructure/video-rendering/asset-resolver.ts`
 * continua sendo a validação final e autoritativa antes da renderização real.
 */
export const LOCAL_MUSIC_FILE_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac"];

export type LocalMusicValidationResult =
  | { ok: true; absolutePath: string }
  | { ok: false; error: string };

const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * Valida um caminho de música local informado pelo usuário (ex.: via `--music`) antes de qualquer
 * workflow ser criado — dá um erro claro e imediato em vez de deixar a falha aparecer só quando
 * Rafa tentar renderizar. Verifica, nesta ordem: (1) não vazio; (2) não é uma URL (`file://`,
 * `http://` etc. — nunca baixamos música da internet); (3) não contém segmento de path traversal
 * (".."); (4) extensão permitida; (5) o arquivo existe de verdade e é um arquivo regular.
 */
export function validateLocalMusicPath(rawPath: string, cwd: string): LocalMusicValidationResult {
  const trimmed = rawPath?.trim();
  if (!trimmed) {
    return { ok: false, error: "Caminho de música vazio. Informe um arquivo local, ex.: --music \"assets/audio/music/minha-musica.mp3\"." };
  }

  if (URL_SCHEME_PATTERN.test(trimmed)) {
    return { ok: false, error: `--music não aceita URL: "${trimmed}". Informe o caminho de um arquivo local no disco.` };
  }

  if (trimmed.includes("..")) {
    return { ok: false, error: `--music não aceita caminho com "..": "${trimmed}".` };
  }

  const absolutePath = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);

  const extension = extname(absolutePath).toLowerCase();
  if (!LOCAL_MUSIC_FILE_EXTENSIONS.includes(extension)) {
    return {
      ok: false,
      error: `Extensão de música não permitida: "${extension || "(sem extensão)"}". Formatos aceitos: ${LOCAL_MUSIC_FILE_EXTENSIONS.join(", ")}.`,
    };
  }

  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    return { ok: false, error: `Arquivo de música não encontrado: "${absolutePath}".` };
  }

  return { ok: true, absolutePath };
}
