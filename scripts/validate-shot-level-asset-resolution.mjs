// SHOT-LEVEL ASSET RESOLUTION — validação end-to-end. Roda a pipeline REAL de Bruno → Vanessa
// → Diego → Rafa, injetando o VisualAssetResolver LOCAL (biblioteca real em assets/visual/library)
// e capturando o VideoRenderRequest gerado por Rafa. Depois inspeciona:
//   - quantos Shots receberam assetId próprio (vs. fallback do asset da cena)
//   - quantos assets distintos foram usados
//   - quantos foram reutilizados e por qual motivo (continuity vs. shot_reuse)
//   - quantos tipos de mídia (video/photo/mockup/etc.)
//   - se houve pausa assistida (pending)

import { resolve as pathResolve } from "node:path";
import { BrunoVideoScriptSkill } from "../dist/skills/bruno-video-script/index.js";
import { VanessaVideoDirectionSkill } from "../dist/skills/vanessa-video-direction/index.js";
import { DiegoVideoEditingSkill } from "../dist/skills/diego-video-editing/index.js";
import { RafaVideoRenderingSkill } from "../dist/skills/rafa-video-rendering/index.js";
import { LocalVisualAssetLibrary, VisualAssetResolver } from "../dist/infrastructure/visual-assets/index.js";
import { normalizeShotTimelineForRender } from "../dist/infrastructure/video-rendering/shot-render-planner.js";

const EXEC = "exec-shot-asset-validation";
const CLIENT_ID = "client-rumo";
const TENANT_ID = "tenant-rumo";

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
    return {
      records: [],
      modules: {
        BrandContext: [claraRecord("BrandContext", { clientId: CLIENT_ID, brandName: "Rumo ao Altar", promise: "Casamentos organizados.", toneOfVoice: "leve divertido persuasivo" })],
        AudienceContext: [claraRecord("AudienceContext", { clientId: CLIENT_ID, targetAudience: "Noivos e convidados" })],
        ContentContext: [],
        PublishingContext: [],
        IdentityContext: [],
      },
    };
  }
}

class FakeArtifactDelivery {
  constructor() { this.files = new Map(); }
  key(e, r) { return `${e}:${r}`; }
  async writeFile(input) {
    const bytes = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : Buffer.from(input.content);
    this.files.set(this.key(input.executionId, input.relativePath), new Uint8Array(bytes));
    return { absolutePath: `/fake/${input.executionId}/${input.relativePath}`, relativePath: input.relativePath, sizeBytes: bytes.byteLength, mimeType: input.mimeType };
  }
  async createZip() { throw new Error("nu"); }
  async readFile(input) {
    const data = this.files.get(this.key(input.executionId, input.relativePath));
    if (!data) return undefined;
    return { absolutePath: `/fake/${input.executionId}/${input.relativePath}`, relativePath: input.relativePath, sizeBytes: data.byteLength, data };
  }
}

function fakeMp4(size = 200 * 1024) {
  const buffer = Buffer.alloc(size, 0);
  buffer.writeUInt32BE(size, 0);
  buffer.write("ftyp", 4, "ascii");
  buffer.write("isom", 8, "ascii");
  return new Uint8Array(buffer);
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

  // Rafa REAL com resolver LOCAL apontando para assets/visual/library (biblioteca real do Rumo).
  const artifactDelivery = new FakeArtifactDelivery();
  const visualAssetResolver = new VisualAssetResolver({
    providers: [new LocalVisualAssetLibrary({ rootDir: pathResolve("assets/visual/library") })],
    artifactsRootDir: pathResolve("artifacts"),
  });

  let capturedRequest = null;
  let capturedPending = null;
  class CapturingRenderPort {
    async resolveAssets(input) {
      return {
        resolutions: input.candidates.map((c) => ({ id: c.id, kind: c.kind, resolved: true, absolutePath: c.path, sizeBytes: 100 })),
      };
    }
    async render(req) {
      capturedRequest = req;
      await artifactDelivery.writeFile({ executionId: req.executionId, relativePath: req.outputRelativePath, content: fakeMp4(), mimeType: "video/mp4" });
      return {
        absolutePath: `/fake/${req.executionId}/${req.outputRelativePath}`,
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
    videoRendering: new CapturingRenderPort(),
    artifactDelivery,
    visualAssetResolver,
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

  if (rafaResponse.status === "needs_assisted_generation") {
    capturedPending = rafaResponse.output?.pendingVisualAssets ?? [];
  }

  if (!capturedRequest && !capturedPending) {
    console.log("Rafa status:", rafaResponse.status);
    console.log("Error:", JSON.stringify(rafaResponse.error ?? {}, null, 2));
    console.log("Warnings:", JSON.stringify(rafaResponse.warnings ?? [], null, 2));
    return;
  }

  console.log("=== SHOT-LEVEL ASSET RESOLUTION — VALIDAÇÃO END-TO-END ===");
  console.log('Prompt: "Todo casamento merece um lugar oficial." — https://rumoaoaltar.com.br');
  console.log("Rafa status:", rafaResponse.status);
  console.log("");

  if (capturedPending && capturedPending.length > 0) {
    console.log("=== DEVELOPER ASSISTED MODE ===");
    console.log("Assets pendentes:", capturedPending.length);
    for (const p of capturedPending.slice(0, 5)) {
      console.log(`  - ${p.expectedRelativePath}: ${p.sceneName}`);
    }
    return;
  }

  const req = capturedRequest;
  const shotsInReq = req.scenes.flatMap((s) => s.shotTimeline ?? []);
  const shotsWithAsset = shotsInReq.filter((s) => Boolean(s.assetId));
  const shotsWithMetadata = shotsInReq.filter((s) => Boolean(s.assetMetadata));

  // Diversidade
  const distinctAssetIds = new Set(shotsWithAsset.map((s) => s.assetId));
  // Contagem por arquivo físico (não por ID do VideoRenderAsset — dois shots que reutilizam o
  // mesmo arquivo físico têm IDs distintos mas mesmo absolutePath).
  const assetIdToAbsolutePath = new Map(req.assets.map((a) => [a.id, a.absolutePath]));
  const perAbsolutePathCount = new Map();
  for (const s of shotsWithAsset) {
    const path = assetIdToAbsolutePath.get(s.assetId);
    if (!path) continue;
    perAbsolutePathCount.set(path, (perAbsolutePathCount.get(path) ?? 0) + 1);
  }
  const distinctFiles = perAbsolutePathCount.size;
  const repeatedFiles = [...perAbsolutePathCount.entries()].filter(([, c]) => c > 1);

  // Tipos de mídia
  const mediaCounts = {};
  for (const s of shotsWithMetadata) {
    const t = s.assetMetadata.assetType;
    mediaCounts[t] = (mediaCounts[t] ?? 0) + 1;
  }

  // Reusos com motivos
  const reuses = shotsWithMetadata.filter((s) => s.assetMetadata.reusedFromShotId);

  // Normaliza para ver os clipes finais
  const plan = normalizeShotTimelineForRender(req);
  const clipsWithImage = plan.clips.filter((c) => c.background.type === "image");
  const clipsWithProcedural = plan.clips.filter((c) => c.background.type !== "image");

  console.log("=== PIPELINE ===");
  console.log("Bruno cenas:", brunoScript.scenes.length);
  console.log("Bruno shots totais:", brunoScript.scenes.reduce((t, s) => t + (s.shots?.length ?? 0), 0));
  console.log("Diego shots totais:", diegoPlan.editingTimeline?.reduce((t, e) => t + (e.shotTimeline?.length ?? 0), 0));
  console.log("");
  console.log("=== VideoRenderRequest ===");
  console.log("Cenas no request:", req.scenes.length);
  console.log("Shots no request:", shotsInReq.length);
  console.log("Shots com assetId por Shot:", shotsWithAsset.length);
  console.log("Shots com assetMetadata:", shotsWithMetadata.length);
  console.log("");
  console.log("=== NORMALIZAÇÃO (o que o compilador FFmpeg vai renderizar) ===");
  console.log("Clipes:", plan.clips.length);
  console.log("Clipes com background image (asset real):", clipsWithImage.length);
  console.log("Clipes com background procedural:", clipsWithProcedural.length);
  console.log("");
  console.log("=== DIVERSIDADE ===");
  console.log("Ids de VideoRenderAsset distintos:", distinctAssetIds.size);
  console.log("Arquivos físicos distintos:", distinctFiles);
  console.log("Arquivos físicos reutilizados (count > 1):", repeatedFiles.length);
  for (const [path, count] of repeatedFiles.slice(0, 5)) {
    const shortName = path.split(/[\\/]/).pop();
    console.log(`  - ${shortName}: usado ${count}x`);
  }
  console.log("Reusos marcados (reusedFromShotId):", reuses.length);
  for (const s of reuses.slice(0, 5)) {
    console.log(`  - ${s.shotId} <- ${s.assetMetadata.reusedFromShotId}  (${s.assetMetadata.selectionReason})`);
  }
  console.log("");
  console.log("=== TIPOS DE MÍDIA ===");
  console.log(JSON.stringify(mediaCounts, null, 2));
  console.log("");
  console.log("=== DETALHE POR SHOT ===");
  for (const s of shotsInReq) {
    const m = s.assetMetadata;
    console.log(
      `  ${s.shotId} [${s.purpose}]  asset=${s.assetId ?? "(nenhum)"}  type=${m?.assetType ?? "?"}  source=${m?.source ?? "?"}  score=${m?.score ?? "?"}  reason=${m?.selectionReason ?? "?"}`,
    );
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
