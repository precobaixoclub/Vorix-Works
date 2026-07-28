import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { LocalArtifactDelivery } from "../../../../infrastructure/artifacts/index.js";
import { synthesizeNarrationWav } from "../../../../infrastructure/autonomous/windows-sapi-narration.js";
import { projectPaths } from "../../../../interfaces/cli/run-command.js";
import { readPendingNarrations } from "../blocker-classifier.js";
import type { ActionDefinition } from "../autonomous-types.js";

/**
 * Só resolve pausas de narração que chegam como `WAITING_ASSISTED_GENERATION` — Nora pedindo o
 * áudio pela primeira vez, ou pedindo de novo porque a validação anterior falhou (ela mesma
 * reemite `pendingNarrations`, então isso já cai em `narration_invalid` naturalmente). Nunca
 * corrige um defeito de áudio detectado post-hoc pela Lucas depois do render — Caio não tem uma
 * etapa de "rewind", então esse caso é uma limitação real e documentada (`audio_missing`
 * permanece, por isso, inalcançável pelo classificador nesta implementação).
 */
export const narrationRegenerationAction: ActionDefinition = {
  id: "narration_regeneration",
  name: "Narration Regeneration",
  description: "Sintetiza a narração pendente via Windows SAPI (voz Microsoft Maria Desktop para pt-BR) e salva no caminho esperado para que Nora valide e o workflow prossiga sozinho — nunca reescreve o roteiro, só gera o áudio a partir do texto já aprovado pela IA desenvolvedora.",
  resolves: ["narration_invalid", "audio_missing"],
  prerequisites: ["Windows (SAPI só existe no Windows)", "Roteiro de narração já definido (narrationScript/segments)"],
  expectedDurationMsRange: [1000, 15000],
  sideEffects: ["Grava o arquivo de narração (`audio/narration.wav`) nos artefatos da execução"],
  limitations: [
    "Só resolve pausas WAITING_ASSISTED_GENERATION — nunca um defeito de áudio detectado post-hoc pela Lucas depois da renderização (sem etapa de rewind no Caio).",
    "Voz sintética robótica (SAPI), nunca uma voz humana real — suficiente para destravar o pipeline automaticamente, mas o resultado nunca é publicável como está.",
  ],
  maxAttempts: 2,
  backoffMs: 1000,
  isApplicable: () => process.platform === "win32",
  execute: async ({ executionId, report, dryRun, attemptNumber }) => {
    const start = Date.now();
    try {
      const { narrations, narrationScript } = readPendingNarrations(report);
      if (narrations.length === 0) {
        return { actionId: "narration_regeneration", ok: false, detail: "Nenhuma narração pendente encontrada no relatório do workflow.", sideEffectsApplied: [], durationMs: Date.now() - start };
      }
      const pending = narrations[0];
      const text = narrationScript && narrationScript.length > 0 ? narrationScript : String(pending.prompt ?? "");
      const relativePath = typeof pending.expectedRelativePath === "string" && pending.expectedRelativePath.length > 0 ? pending.expectedRelativePath : "audio/narration.wav";

      if (!text) {
        return { actionId: "narration_regeneration", ok: false, detail: "Roteiro de narração vazio — nada para sintetizar.", sideEffectsApplied: [], durationMs: Date.now() - start };
      }

      if (dryRun) {
        const detail = `[dry-run] Sintetizaria a narração via Windows SAPI e salvaria em "${relativePath}" — nenhum arquivo real foi gerado.`;
        return { actionId: "narration_regeneration", ok: false, wouldSucceed: process.platform === "win32", detail, sideEffectsApplied: [], durationMs: Date.now() - start };
      }

      const paths = projectPaths();
      const tempWavPath = join(paths.artifactsDir, executionId, ".autonomous-tmp", `narration-attempt-${attemptNumber}-${Date.now()}.wav`);
      // Rate SAPI mais rápido a cada nova tentativa DENTRO da mesma rodada — hedge simples contra
      // narração que ultrapasse a duração planejada (Nora rejeita áudio > duração+4s).
      const rate = 2 + (attemptNumber - 1) * 2;
      const synthResult = await synthesizeNarrationWav({ text, outputAbsolutePath: tempWavPath, genderPreference: "female", language: "pt-BR", rate });
      if (!synthResult.ok) {
        return { actionId: "narration_regeneration", ok: false, detail: "Falha na síntese de narração via Windows SAPI.", sideEffectsApplied: [], durationMs: Date.now() - start, error: synthResult.error };
      }

      const bytes = await readFile(tempWavPath);
      const artifactDelivery = new LocalArtifactDelivery({ rootDir: paths.artifactsDir });
      const written = await artifactDelivery.writeFile({ executionId, relativePath, content: bytes, mimeType: "audio/wav" });
      await rm(tempWavPath, { force: true }).catch(() => {});

      return {
        actionId: "narration_regeneration",
        ok: true,
        detail: `Narração sintetizada via Windows SAPI (rate=${rate}, ${written.sizeBytes} bytes) e salva em "${written.relativePath}".`,
        sideEffectsApplied: ["write_artifact_file"],
        durationMs: Date.now() - start,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { actionId: "narration_regeneration", ok: false, detail: "Falha ao gerar/gravar narração.", sideEffectsApplied: [], durationMs: Date.now() - start, error: message };
    }
  },
};
