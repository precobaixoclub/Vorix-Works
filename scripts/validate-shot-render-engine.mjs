// SHOT RENDER ENGINE — validação end-to-end usando o pipeline REAL de Bruno → Vanessa → Diego
// → Nora → Rafa (mas com um FakeVideoRenderingPort que captura o VideoRenderRequest em vez de
// executar FFmpeg). Depois, normalizamos o request com o mesmo normalizer que o adapter usa e
// contamos quantos Shots viraram clipes independentes, quantos assets distintos, transições, etc.

import { BrunoVideoScriptSkill } from "../dist/skills/bruno-video-script/index.js";
import { VanessaVideoDirectionSkill } from "../dist/skills/vanessa-video-direction/index.js";
import { DiegoVideoEditingSkill } from "../dist/skills/diego-video-editing/index.js";
import { RafaVideoRenderingSkill } from "../dist/skills/rafa-video-rendering/index.js";
import { normalizeShotTimelineForRender } from "../dist/infrastructure/video-rendering/shot-render-planner.js";
import { compileFfmpegArgsWithPlan } from "../dist/infrastructure/video-rendering/timeline-to-filter-compiler.js";
import { deriveCampaignCreativeDNA } from "../dist/shared/utils/creative-director-engine.js";

const EXEC = "exec-shot-render-validation";
const CLIENT_ID = "client-rumo";
const TENANT_ID = "tenant-rumo";

const claraContext = {
  records: [],
  modules: {
    BrandContext: [
      claraRecord("BrandContext", { clientId: CLIENT_ID, brandName: "Rumo ao Altar", promise: "Casamentos organizados.", toneOfVoice: "leve divertido persuasivo" }),
    ],
    AudienceContext: [claraRecord("AudienceContext", { clientId: CLIENT_ID, targetAudience: "Noivos e convidados" })],
    ContentContext: [],
    PublishingContext: [],
    IdentityContext: [],
  },
};

function claraRecord(module, payload) {
  return {
    id: `${module}-1`,
    module,
    clientId: payload.clientId,
    title: module,
    status: "active",
    currentVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    payload,
    versions: [],
    history: [],
    tags: [],
  };
}

class FakeValentina {
  async getClientContext() {
    return { clientId: CLIENT_ID, tenantId: TENANT_ID, plan: "standard", integrations: {}, brand: { brandName: "Rumo ao Altar" } };
  }
  async getTenant() {
    return { id: TENANT_ID, clientId: CLIENT_ID, name: "Rumo ao Altar", plan: "standard" };
  }
}
class FakeClara {
  async requestContext() {
    return claraContext;
  }
}

const joaoStrategy = {
  overallStrategy: "Consciência de site oficial de casamento",
  objective: "Seu casamento merece um site oficial.",
  targetAudience: "Noivos e convidados de casamento",
  channel: "instagram",
  format: "reels",
  toneOfVoice: "leve divertido persuasivo wedding",
  angle: "identificacao",
  centralPromise: "Seu casamento merece um site oficial.",
  valueProposition: "Tudo organizado em um único lugar para noivos e convidados.",
  keyMessages: ["RSVP organizado.", "Lista de presentes.", "Álbum colaborativo.", "Cronograma e informações."],
  recommendedCta: "Conheça o Rumo ao Altar",
};

const context = {
  executionId: EXEC,
  taskId: "task-render",
  correlationId: "corr",
  locale: "pt-BR",
  dryRun: false,
  requestedBy: "helena",
  orchestratedBy: "arthur",
};

async function run() {
  const bruno = new BrunoVideoScriptSkill({ valentina: new FakeValentina(), clara: new FakeClara() });
  const brunoResponse = await bruno.execute({
    skillId: "bruno-video-script",
    input: {
      clientId: CLIENT_ID,
      originalRequest: "Todo casamento merece um lugar oficial. Produto: https://rumoaoaltar.com.br",
      joaoStrategy,
      channel: "instagram",
      format: "reels",
      videoObjective: "Convencer noivos a criarem um site oficial do casamento",
      desiredDurationSeconds: 30,
    },
    context,
  });
  const brunoScript = brunoResponse.output;

  const vanessa = new VanessaVideoDirectionSkill({ valentina: new FakeValentina(), clara: new FakeClara() });
  const vanessaResponse = await vanessa.execute({
    skillId: "vanessa-video-direction",
    input: {
      clientId: CLIENT_ID,
      originalRequest: "Todo casamento merece um lugar oficial.",
      joaoStrategy,
      brunoScript: brunoScript.vanessaBriefing,
      channel: "instagram",
      format: "reels",
      videoObjective: "Convencer noivos a criarem um site oficial do casamento",
    },
    context,
  });
  const vanessaDirection = vanessaResponse.output;

  const diego = new DiegoVideoEditingSkill({ valentina: new FakeValentina(), clara: new FakeClara() });
  const diegoResponse = await diego.execute({
    skillId: "diego-video-editing",
    input: {
      clientId: CLIENT_ID,
      originalRequest: "Todo casamento merece um lugar oficial.",
      joaoStrategy,
      brunoScript: brunoScript.vanessaBriefing,
      vanessaDirection: vanessaDirection.diegoBriefing,
      channel: "instagram",
      format: "reels",
      videoObjective: "Convencer noivos a criarem um site oficial do casamento",
    },
    context,
  });
  const diegoPlan = diegoResponse.output;

  // Capture VideoRenderRequest via FakeVideoRenderingPort. Sem asset real, o request usa
  // fundos procedurais. O foco desta validação é a ESTRUTURA do request (quantos shots,
  // transições, etc.), não a renderização real.
  let capturedRequest = null;

  // ArtifactDelivery fake — Rafa lê o arquivo após render.
  class FakeArtifactDelivery {
    constructor() {
      this.files = new Map();
    }
    key(executionId, relativePath) {
      return `${executionId}:${relativePath}`;
    }
    async writeFile(input) {
      const bytes = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : Buffer.from(input.content);
      this.files.set(this.key(input.executionId, input.relativePath), new Uint8Array(bytes));
      return {
        absolutePath: `/fake/artifacts/${input.executionId}/${input.relativePath}`,
        relativePath: input.relativePath,
        sizeBytes: bytes.byteLength,
        mimeType: input.mimeType,
      };
    }
    async createZip() {
      throw new Error("não usado");
    }
    async readFile(input) {
      const data = this.files.get(this.key(input.executionId, input.relativePath));
      if (!data) return undefined;
      return {
        absolutePath: `/fake/artifacts/${input.executionId}/${input.relativePath}`,
        relativePath: input.relativePath,
        sizeBytes: data.byteLength,
        data,
      };
    }
  }
  const artifactDelivery = new FakeArtifactDelivery();

  function fakeMp4(size = 200 * 1024) {
    const buffer = Buffer.alloc(size, 0);
    buffer.writeUInt32BE(size, 0);
    buffer.write("ftyp", 4, "ascii");
    buffer.write("isom", 8, "ascii");
    return new Uint8Array(buffer);
  }

  class FakeRenderPort {
    async resolveAssets(input) {
      return {
        resolutions: input.candidates.map((c) => ({
          id: c.id,
          kind: c.kind,
          resolved: true,
          absolutePath: c.path,
          sizeBytes: 100,
        })),
      };
    }
    async render(req) {
      capturedRequest = req;
      // Simula um arquivo MP4 sendo escrito para que Rafa consiga validá-lo depois.
      await artifactDelivery.writeFile({
        executionId: req.executionId,
        relativePath: req.outputRelativePath,
        content: fakeMp4(),
        mimeType: "video/mp4",
      });
      return {
        absolutePath: `/fake/artifacts/${req.executionId}/${req.outputRelativePath}`,
        relativePath: req.outputRelativePath,
        sizeBytes: 200 * 1024,
        durationSeconds: req.totalDurationSeconds,
        width: req.width,
        height: req.height,
        aspectRatio: `${req.width}:${req.height}`,
        fps: req.fps,
        videoCodec: "H.264 (libx264)",
        audioCodec: undefined,
        hasAudio: false,
        renderTimeMs: 100,
        logsSummary: [],
        warnings: [],
      };
    }
  }

  const rafa = new RafaVideoRenderingSkill({
    valentina: new FakeValentina(),
    clara: new FakeClara(),
    videoRendering: new FakeRenderPort(),
    artifactDelivery,
  });
  const rafaResponse = await rafa.execute({
    skillId: "rafa-video-rendering",
    input: {
      clientId: CLIENT_ID,
      originalRequest: "Todo casamento merece um lugar oficial.",
      joaoStrategy,
      brunoScript: brunoScript.vanessaBriefing,
      vanessaDirection: vanessaDirection.diegoBriefing,
      diegoEditingPlan: diegoPlan.rafaBriefing,
      channel: "instagram",
      format: "reels",
      videoObjective: "Convencer noivos a criarem um site oficial do casamento",
    },
    context,
  });

  if (!capturedRequest) {
    console.log("Rafa status:", rafaResponse.status);
    console.log("Rafa output:", JSON.stringify(rafaResponse.output ?? {}, null, 2).substring(0, 500));
    console.log("Rafa error:", JSON.stringify(rafaResponse.error ?? {}, null, 2));
    console.log("Rafa warnings:", JSON.stringify(rafaResponse.warnings ?? [], null, 2));
    throw new Error("FakeRenderPort não capturou o VideoRenderRequest.");
  }

  // Analisa o request capturado.
  const scenesWithShots = capturedRequest.scenes.filter((s) => Array.isArray(s.shotTimeline) && s.shotTimeline.length > 0);
  const totalShotsInRequest = scenesWithShots.reduce((total, s) => total + s.shotTimeline.length, 0);

  // Normaliza para ver quantos clipes o renderer efetivamente vai criar.
  const plan = normalizeShotTimelineForRender(capturedRequest);

  // Compila os args FFmpeg para verificar ausência de -shortest e presença de apad.
  const compiled = compileFfmpegArgsWithPlan({
    request: capturedRequest,
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/final.mp4",
    fonts: { regular: "regular.ttf", bold: "bold.ttf" },
    supportsGradients: true,
  });
  const hasShortest = compiled.args.includes("-shortest");
  const filterComplex = compiled.args[compiled.args.indexOf("-filter_complex") + 1] ?? "";
  const xfadeCount = (filterComplex.match(/xfade=transition=/g) ?? []).length;
  const drawtextCount = (filterComplex.match(/drawtext=/g) ?? []).length;

  // Diversidade de assets (background por Shot/cena).
  const backgroundAssetIds = plan.clips
    .map((c) => (c.background.type === "image" ? c.background.assetId : `procedural:${c.background.type}`))
    .filter(Boolean);
  const distinctBackgrounds = new Set(backgroundAssetIds);

  // Distinct motions.
  const distinctMotionActions = new Set(plan.clips.map((c) => c.motionAction).filter(Boolean));

  console.log("=== SHOT RENDER ENGINE — VALIDAÇÃO END-TO-END ===");
  console.log('Prompt: "Todo casamento merece um lugar oficial." — https://rumoaoaltar.com.br');
  console.log("");
  console.log("=== PIPELINE ===");
  console.log("Bruno cenas:", brunoScript.scenes?.length ?? "?");
  console.log("Bruno shots totais:", brunoScript.scenes?.reduce((t, s) => t + (s.shots?.length ?? 0), 0) ?? "?");
  console.log("Diego timeline entries:", diegoPlan.editingTimeline?.length ?? "?");
  console.log("Diego shots totais (via shotTimeline):", diegoPlan.editingTimeline?.reduce((t, e) => t + (e.shotTimeline?.length ?? 0), 0) ?? "?");
  console.log("");
  console.log("=== VideoRenderRequest ===");
  console.log("Cenas no request:", capturedRequest.scenes.length);
  console.log("Cenas com shotTimeline:", scenesWithShots.length);
  console.log("Shots totais no request:", totalShotsInRequest);
  console.log("Duração total planejada:", capturedRequest.totalDurationSeconds, "s");
  console.log("");
  console.log("=== NORMALIZAÇÃO (o que o compilador FFmpeg vai renderizar) ===");
  console.log("Clipes efetivos:", plan.clips.length);
  console.log("Origem 'shot':", plan.clips.filter((c) => c.origin === "shot").length);
  console.log("Origem 'scene_fallback':", plan.clips.filter((c) => c.origin === "scene_fallback").length);
  console.log("Duração planejada (soma dos clipes):", plan.plannedDurationSeconds, "s");
  console.log("Cenas em fallback:", plan.fallbackSceneOrders);
  console.log("Warnings:", plan.warnings.length);
  if (plan.warnings.length > 0) plan.warnings.slice(0, 5).forEach((w) => console.log("  -", w));
  console.log("");
  console.log("=== FFmpeg output ===");
  console.log("`-shortest` presente?", hasShortest, "(esperado: false)");
  console.log("xfade transitions no filter graph:", xfadeCount);
  console.log("drawtext filters (textos):", drawtextCount);
  console.log("");
  console.log("=== DIVERSIDADE ===");
  console.log("Backgrounds distintos:", distinctBackgrounds.size);
  console.log("MotionActions distintos:", distinctMotionActions.size);
  console.log("MotionActions encontrados:", [...distinctMotionActions]);
  console.log("");
  console.log("=== DETALHE DOS CLIPES ===");
  for (const clip of plan.clips) {
    console.log(
      `  clip #${clip.order} ${clip.clipId} [${clip.origin}] ${clip.purpose}  ${clip.durationSeconds}s  motion=${clip.motionAction ?? "-"} → ${clip.transitionToNext ?? "cut"}  bg=${clip.background.type === "image" ? clip.background.assetId : clip.background.type}`,
    );
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
