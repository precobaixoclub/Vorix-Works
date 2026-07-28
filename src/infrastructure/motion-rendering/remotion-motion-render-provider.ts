// RemotionMotionRenderProvider — o ÚNICO arquivo do projeto que importa pacotes do Remotion.
// Implementa `MotionRenderProvider` (application/ports/motion-render-provider.port.ts); nenhuma
// outra classe do domínio, shared/utils ou Skill sabe que Remotion existe (ADR 0002, mesmo
// espírito do isolamento já usado para FFmpeg em `infrastructure/video-rendering/`).
//
// A composição React real (`remotion/Root.jsx`, `remotion/MotionSceneRenderer.jsx`) fica em
// arquivos `.jsx` deliberadamente FORA do `include` do `tsconfig.json` principal
// (`src/**/*.ts`, que nunca casa com `.jsx`) — o build principal (`tsc -p tsconfig.json`)
// continua 100% livre de JSX/React. Esses arquivos só são lidos em tempo de execução pelo
// `@remotion/bundler`, nunca pelo `tsc`.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import {
  MOTION_RENDER_RESOLUTIONS,
  type MotionRenderProgress,
  type MotionRenderProvider,
  type MotionRenderProviderCapabilities,
  type MotionRenderProviderOutput,
  type MotionRenderRequest,
} from "../../application/ports/motion-render-provider.port.js";
import { resolveSceneAnimationParameters } from "../../shared/utils/motion-rendering/motion-animation-parameters.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REMOTION_ENTRY_POINT = join(__dirname, "remotion", "Root.jsx");

export type RemotionMotionRenderProviderOptions = {
  /** Injeta um bundle já pronto (usado nos testes/reuso entre chamadas); por padrão, empacota sob demanda. */
  bundleLocation?: string;
};

/**
 * Empacota a composição Remotion uma única vez por processo e reaproveita o resultado entre
 * chamadas de `render()` — bundlar de novo a cada variante custaria segundos sem necessidade,
 * já que a composição em si nunca muda entre variantes de um mesmo Motion Plan (só `inputProps`).
 */
let cachedBundleLocation: Promise<string> | undefined;

async function getBundleLocation(): Promise<string> {
  if (!cachedBundleLocation) {
    cachedBundleLocation = bundle({ entryPoint: REMOTION_ENTRY_POINT });
  }
  return cachedBundleLocation;
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Chromium headless recusa `file://` dentro de uma página servida por `http://localhost` (mesmo
 * com `disableWebSecurity`, é uma restrição de esquema, não de CORS) — a forma robusta e
 * documentada de usar imagens locais arbitrárias no Remotion é embuti-las como data URI. Isso
 * acontece aqui, no adapter (Node, acesso a disco real), nunca na composição `.jsx`.
 */
function toImageDataUri(absolutePath: string): string {
  const mimeType = IMAGE_MIME_BY_EXTENSION[extname(absolutePath).toLowerCase()] ?? "image/png";
  const base64 = readFileSync(absolutePath).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

let browserEnsured: Promise<void> | undefined;

async function ensureBrowserOnce(): Promise<void> {
  if (!browserEnsured) {
    browserEnsured = ensureBrowser().then(() => undefined);
  }
  return browserEnsured;
}

export class RemotionMotionRenderProvider implements MotionRenderProvider {
  readonly id = "remotion";

  private readonly bundleLocationOverride?: string;

  constructor(options: RemotionMotionRenderProviderOptions = {}) {
    this.bundleLocationOverride = options.bundleLocation;
  }

  capabilities(): MotionRenderProviderCapabilities {
    return {
      id: this.id,
      supportedResolutions: [...MOTION_RENDER_RESOLUTIONS],
      supportsAudio: true,
    };
  }

  async render(request: MotionRenderRequest, onProgress?: (progress: MotionRenderProgress) => void): Promise<MotionRenderProviderOutput> {
    const startedAt = Date.now();
    const emit = (stage: MotionRenderProgress["stage"], percent: number, message?: string) => {
      onProgress?.({ jobId: request.jobId, variantId: request.instructions.variantId, stage, percent, message });
    };

    emit("bundling", 0, "Preparando motor de renderização (Chromium).");
    await ensureBrowserOnce();

    emit("bundling", 20, "Empacotando composição Remotion.");
    const bundleLocation = this.bundleLocationOverride ?? (await getBundleLocation());

    // A composição Remotion (MotionSceneRenderer.jsx) nunca conhece o vocabulário semântico do
    // Motion Plan (nomes de preset como "ken_burns_pan") — só números já resolvidos. A tradução
    // acontece aqui, em TypeScript puro e testável (`motion-animation-parameters.ts`), antes de
    // qualquer coisa cruzar a fronteira para o Remotion.
    const renderableInstructions = {
      ...request.instructions,
      scenes: request.instructions.scenes.map((scene) => ({
        ...scene,
        imageAbsolutePath: toImageDataUri(scene.imageAbsolutePath),
        resolvedAnimation: resolveSceneAnimationParameters(scene, request.instructions.fps, { width: request.instructions.width, height: request.instructions.height }),
      })),
    };

    // As imagens do Motion Plan vivem fora da pasta empacotada pelo Remotion (são assets reais do
    // Zuno, em qualquer caminho local) — carregadas via `file://` na composição. Chromium bloqueia
    // acesso a `file://` arbitrário por padrão; `disableWebSecurity` é a opção documentada do
    // próprio Remotion para este cenário exato (nunca usada para navegar página externa nenhuma —
    // o Chromium headless aqui só abre o bundle local do Remotion).
    const chromiumOptions = { disableWebSecurity: true };

    emit("bundling", 40, "Selecionando composição e calculando metadados do Motion Plan.");
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "motion-plan",
      inputProps: { instructions: renderableInstructions },
      chromiumOptions,
    });

    emit("rendering", 45, "Renderizando frames.");
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: request.outputAbsolutePath,
      inputProps: { instructions: renderableInstructions },
      chromiumOptions,
      onProgress: ({ progress }) => {
        emit("rendering", 45 + Math.round(progress * 50), undefined);
      },
    });

    emit("encoding", 98, "Finalizando arquivo de saída.");

    if (!existsSync(request.outputAbsolutePath)) {
      throw new Error(`RemotionMotionRenderProvider: renderMedia terminou sem erro, mas "${request.outputAbsolutePath}" não foi criado.`);
    }

    const sizeBytes = statSync(request.outputAbsolutePath).size;
    const renderTimeMs = Date.now() - startedAt;

    emit("completed", 100, "Renderização concluída.");

    return {
      absolutePath: request.outputAbsolutePath,
      sizeBytes,
      durationSeconds: composition.durationInFrames / composition.fps,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      videoCodec: "h264",
      audioCodec: undefined,
      renderTimeMs,
      warnings: [],
    };
  }
}

export function createRemotionMotionRenderProvider(options: RemotionMotionRenderProviderOptions = {}): RemotionMotionRenderProvider {
  return new RemotionMotionRenderProvider(options);
}
