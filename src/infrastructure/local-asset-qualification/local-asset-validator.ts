import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaCatalogPort, MediaAssetIngestionSource, MediaAssetRecord } from "../../application/ports/media-catalog.port.js";
import type { MediaShotDeviceType } from "../../application/ports/media-catalog.port.js";
import { analyzeVisualCandidate } from "../footage-acquisition/visual-candidate-validator.js";
import { simulatePreComposition } from "../footage-acquisition/pre-composition-simulator.js";
import { computeFileHash } from "../media-catalog/media-hash.js";
import { readRasterDimensions, readVideoMetadata } from "../visual-assets/visual-asset-metadata.js";
import { inferCapabilities } from "../../shared/utils/local-asset-qualification/capability-inference.js";
import { LOCAL_ASSET_VALIDATOR_VERSION } from "../../shared/utils/local-asset-qualification/validator-version.js";
import { createValidationProbeVideo, frameScreenCaptureForValidation } from "./screen-framing.js";

/**
 * LOCAL OFFICIAL ASSET QUALIFICATION (seções 1, 2, 3, 4) — entrada oficial para validar um asset
 * LOCAL já catalogado (Company Intelligence, Campaign Intelligence, Product Screen Catalog,
 * biblioteca local) com o MESMO `analyzeVisualCandidate`/`simulatePreComposition` que o
 * Intent-Based Footage Acquisition já usa para candidatos do Pexels — nenhuma lógica de
 * confiança/threshold/estado é reimplementada aqui, só chamada. A única peça nova de verdade é o
 * enquadramento geométrico (`screen-framing.ts`) para capturas de tela de página inteira, que o
 * validador nunca poderia avaliar sem algum fundo ao redor para contrastar (ver aquele arquivo).
 */

const IMAGE_TYPES = new Set(["photo", "screenshot", "mockup", "logo", "graphic"]);

export type ValidateLocalAssetInput = {
  assetId?: string;
  filePath?: string;
  campaignId?: string;
  clientId?: string;
  device?: MediaShotDeviceType;
  screenVisibleRequired?: boolean;
  interactionRequired?: boolean;
  ingestionSource?: MediaAssetIngestionSource;
  sourceFile?: string;
  sourceTimestampSeconds?: number;
  force?: boolean;
};

export type ValidateLocalAssetOutcome = {
  assetId: string;
  skipped: boolean;
  skipReason?: string;
  stage?: string;
  screenVisible?: boolean;
  compositingReady?: boolean;
  approvalStatus?: string;
  capabilities?: string[];
  error?: string;
};

/** Quando o chamador não informa `ingestionSource` explicitamente, infere a partir do caminho do arquivo — as mesmas pastas permanentes que Company/Campaign Intelligence já usam para gravar suas capturas (nunca um palpite sobre o CONTEÚDO, só sobre a origem física conhecida). */
export function inferIngestionSourceFromPath(absolutePath: string): "company_intelligence" | "campaign_intelligence" | undefined {
  const normalized = absolutePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/company-screenshots/")) return "company_intelligence";
  if (normalized.includes("/campaign-uploads/") || normalized.includes("/campaign-frames/")) return "campaign_intelligence";
  return undefined;
}

function resolveIngestionSource(record: MediaAssetRecord, input: ValidateLocalAssetInput): MediaAssetIngestionSource | undefined {
  return record.ingestionSource ?? input.ingestionSource ?? inferIngestionSourceFromPath(record.absolutePath);
}

function resolveDefaultOptions(record: MediaAssetRecord, input: ValidateLocalAssetInput): { device: MediaShotDeviceType; screenVisibleRequired: boolean; interactionRequired: boolean } {
  const ingestionSource = resolveIngestionSource(record, input);
  const looksLikeProductCapture = record.type === "screenshot" || record.type === "mockup"
    || (record.capabilities ?? []).includes("product_screen")
    || Boolean(ingestionSource && ["company_intelligence", "campaign_intelligence", "product_screen_catalog"].includes(ingestionSource));

  return {
    device: input.device ?? (looksLikeProductCapture ? "phone" : "none"),
    screenVisibleRequired: input.screenVisibleRequired ?? looksLikeProductCapture,
    interactionRequired: input.interactionRequired ?? false,
  };
}

export async function validateLocalAsset(catalog: MediaCatalogPort, input: ValidateLocalAssetInput): Promise<ValidateLocalAssetOutcome> {
  let record: MediaAssetRecord | undefined;
  if (input.assetId) {
    record = await catalog.get(input.assetId);
  }
  if (!record && input.filePath) {
    const assets = await catalog.list();
    record = assets.find((asset) => asset.absolutePath === input.filePath || asset.relativePath === input.filePath);
    if (!record) {
      await catalog.scan();
      const rescanned = await catalog.list();
      record = rescanned.find((asset) => asset.absolutePath === input.filePath || asset.relativePath === input.filePath);
    }
  }
  if (!record) {
    throw new Error(`Asset não encontrado (assetId="${input.assetId ?? ""}", filePath="${input.filePath ?? ""}"). Rode --media-scan primeiro se o arquivo é novo.`);
  }

  const currentHash = await computeFileHash(record.absolutePath).catch(() => record!.hash);
  if (!input.force && record.validationDate && record.hash === currentHash) {
    return { assetId: record.assetId, skipped: true, skipReason: "Já validado e o arquivo não mudou (hash idêntico) — use force para revalidar." };
  }

  const options = resolveDefaultOptions(record, input);
  const workDir = await mkdtemp(join(tmpdir(), "zuno-local-asset-validation-"));

  try {
    let analysisPath = record.absolutePath;
    let durationSeconds: number;
    let width: number;
    let height: number;

    if (record.type === "video") {
      const metadata = await readVideoMetadata(record.absolutePath).catch(() => undefined);
      if (!metadata) return { assetId: record.assetId, skipped: false, error: "Não foi possível ler metadados do vídeo." };
      durationSeconds = metadata.durationSeconds;
      width = metadata.width;
      height = metadata.height;
    } else if (IMAGE_TYPES.has(record.type)) {
      const dimensions = await readRasterDimensions(record.absolutePath).catch(() => undefined);
      if (!dimensions) return { assetId: record.assetId, skipped: false, error: "Não foi possível ler dimensões da imagem (formato não suportado)." };

      let imageForProbe = record.absolutePath;
      if (options.screenVisibleRequired && record.type !== "mockup") {
        const framed = await frameScreenCaptureForValidation({ absoluteImagePath: record.absolutePath, outputDir: workDir, device: options.device });
        if (framed) imageForProbe = framed.framedImagePath;
      }

      const probe = await createValidationProbeVideo({ absoluteImagePath: imageForProbe, outputDir: workDir });
      if (!probe) return { assetId: record.assetId, skipped: false, error: "Falha ao gerar vídeo-sonda para validação (ffmpeg)." };

      analysisPath = probe.probeVideoPath;
      durationSeconds = probe.durationSeconds;
      width = dimensions.width;
      height = dimensions.height;
    } else {
      return { assetId: record.assetId, skipped: false, error: `Tipo de asset "${record.type}" não é validável visualmente (não é imagem nem vídeo).` };
    }

    const analysis = await analyzeVisualCandidate(analysisPath, durationSeconds, width, height, {
      device: options.device,
      screenVisibleRequired: options.screenVisibleRequired,
      interactionRequired: options.interactionRequired,
    });

    if (!analysis) {
      return { assetId: record.assetId, skipped: false, error: "Validador não conseguiu extrair frames (arquivo corrompido ou formato não suportado)." };
    }

    const precomposition = await simulatePreComposition({
      analysis,
      width,
      height,
      absolutePath: analysisPath,
      assetId: record.assetId,
      artifactsDir: workDir,
    });

    const ingestionSource = resolveIngestionSource(record, input);
    const capabilities = Array.from(new Set([
      ...(record.capabilities ?? []),
      ...inferCapabilities({ ingestionSource, tags: record.tags, type: record.type }),
    ]));

    const approvalStatus = analysis.stage === "rejected" ? "rejected" : "needs_review";

    const updatedRecord: MediaAssetRecord = {
      ...record,
      campaign: record.campaign ?? input.campaignId,
      client: record.client ?? input.clientId,
      screenVisible: analysis.screenVisible,
      screenArea: analysis.screenArea,
      deviceOrientation: analysis.deviceOrientation,
      deviceType: options.device,
      interactionPossible: precomposition.verdict === "SIM",
      compositingReady: precomposition.finalStage === "compositing_ready",
      humanInteractionScore: analysis.humanInteractionScore,
      visualValidationStage: precomposition.finalStage,
      deviceConfidence: analysis.deviceConfidence,
      screenConfidence: analysis.screenConfidence,
      humanPresenceScore: analysis.humanPresenceScore,
      persistenceRatio: analysis.persistenceRatio,
      occlusionRisk: analysis.occlusionRisk,
      reviewArtifacts: precomposition.artifacts,
      capabilities,
      ingestionSource,
      sourceFile: record.sourceFile ?? input.sourceFile,
      sourceTimestampSeconds: record.sourceTimestampSeconds ?? input.sourceTimestampSeconds,
      validationDate: new Date().toISOString(),
      validatorVersion: LOCAL_ASSET_VALIDATOR_VERSION,
      approvalStatus,
      notes: [...(record.notes ?? []), `Local Official Asset Qualification: ${precomposition.justification}`],
    };

    await catalog.indexAcquiredAsset(updatedRecord);

    return {
      assetId: record.assetId,
      skipped: false,
      stage: precomposition.finalStage,
      screenVisible: analysis.screenVisible,
      compositingReady: updatedRecord.compositingReady,
      approvalStatus,
      capabilities,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
