import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { LocalArtifactDelivery } from "../../../../infrastructure/artifacts/index.js";
import { renderMockupPng } from "../../../../infrastructure/autonomous/html-mockup-renderer.js";
import { projectPaths } from "../../../../interfaces/cli/run-command.js";
import { readPendingVisualAssets } from "../blocker-classifier.js";
import type { ActionDefinition } from "../autonomous-types.js";
import type { ArtifactProvenance } from "../../../../shared/utils/artifact-provenance.js";

/** Migração "GPT como motor criativo único" (PR 3/9) — este mockup é, no próprio texto de
 * `limitations` acima, "placeholder visual esquemático... nunca uma interface real do produto".
 * `publishable: false` torna isso estrutural: nenhum consumidor downstream (Pedro em modo
 * assistido, quality gate, gate de aprovação) pode mais aceitá-lo como entrega final. */
const MOCKUP_PROVENANCE: ArtifactProvenance = {
  producer: "placeholder_mockup",
  publishable: false,
  reason: "Caixa de dispositivo HTML/CSS com o texto do prompt escrito na tela — nunca uma interface real, gerada só para destravar o pipeline autônomo.",
};

export const mockupGenerationAction: ActionDefinition = {
  id: "mockup_generation",
  name: "Mockup Generation",
  description: "Gera um mockup de tela (celular/notebook/genérico) via HTML + Chrome headless para os assets visuais pendentes marcados como mockup/graphic/screenshot — seleção de template determinística por palavra-chave, nunca por LLM.",
  resolves: ["mockup_missing"],
  prerequisites: ["Google Chrome ou Microsoft Edge instalado localmente"],
  expectedDurationMsRange: [500, 5000],
  sideEffects: ["Grava um arquivo PNG nos artefatos da execução"],
  limitations: ["O mockup gerado é um placeholder visual esquemático (texto do prompt sobre uma moldura de dispositivo), nunca uma interface real do produto — suficiente para destravar o pipeline, não para publicação."],
  maxAttempts: 2,
  backoffMs: 500,
  isApplicable: () => true,
  execute: async ({ executionId, report, dryRun }) => {
    const start = Date.now();
    try {
      const pending = readPendingVisualAssets(report);
      if (pending.length === 0) {
        return { actionId: "mockup_generation", ok: false, detail: "Nenhum asset visual pendente encontrado no relatório do workflow.", sideEffectsApplied: [], durationMs: Date.now() - start };
      }
      const asset = pending[0];
      const relativePath = typeof asset.expectedRelativePath === "string" ? asset.expectedRelativePath : "";
      const width = typeof asset.width === "number" ? asset.width : 1080;
      const height = typeof asset.height === "number" ? asset.height : 1920;
      const prompt = typeof asset.prompt === "string" ? asset.prompt : "";
      const tags = Array.isArray(asset.tags) ? asset.tags.map((tag) => String(tag)) : [];
      const requiredKind = typeof asset.requiredKind === "string" ? asset.requiredKind : undefined;

      if (!relativePath) {
        return { actionId: "mockup_generation", ok: false, detail: "Asset pendente sem `expectedRelativePath` — não é possível salvar o mockup.", sideEffectsApplied: [], durationMs: Date.now() - start };
      }

      if (dryRun) {
        const detail = `[dry-run] Geraria mockup HTML+Chrome para "${relativePath}" (${width}x${height}) — nenhum arquivo real foi gerado.`;
        return { actionId: "mockup_generation", ok: false, wouldSucceed: true, detail, sideEffectsApplied: [], durationMs: Date.now() - start };
      }

      const paths = projectPaths();
      const tempPngPath = join(paths.artifactsDir, executionId, ".autonomous-tmp", `mockup-${Date.now()}.png`);
      const renderResult = await renderMockupPng({ prompt, tags, requiredKind, width, height, outputAbsolutePath: tempPngPath });
      if (!renderResult.ok) {
        return { actionId: "mockup_generation", ok: false, detail: "Falha ao renderizar mockup via Chrome headless.", sideEffectsApplied: [], durationMs: Date.now() - start, error: renderResult.error };
      }

      const bytes = await readFile(tempPngPath);
      const artifactDelivery = new LocalArtifactDelivery({ rootDir: paths.artifactsDir });
      const written = await artifactDelivery.writeFile({ executionId, relativePath, content: bytes, mimeType: "image/png", provenance: MOCKUP_PROVENANCE });
      await rm(tempPngPath, { force: true }).catch(() => {});

      return {
        actionId: "mockup_generation",
        ok: true,
        detail: `Mockup (template "${renderResult.template}") gerado e salvo em "${written.relativePath}" (${written.sizeBytes} bytes).`,
        sideEffectsApplied: ["write_artifact_file"],
        durationMs: Date.now() - start,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { actionId: "mockup_generation", ok: false, detail: "Falha ao gerar mockup.", sideEffectsApplied: [], durationMs: Date.now() - start, error: message };
    }
  },
};
