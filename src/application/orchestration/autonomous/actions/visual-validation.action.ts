import { footageReviewList, footageReviewReject } from "../../../../interfaces/cli/run-command.js";
import type { ActionDefinition } from "../autonomous-types.js";

/** Único estágio da Footage Visual Validation 2.0 seguro para rejeição automática — falha objetiva (nenhum dispositivo detectado), nunca uma decisão subjetiva. `needs_human_review`/estágios intermediários nunca são tocados por esta ação (seção 7: aprovar footage é sempre humano). */
const AUTO_REJECTABLE_STAGE = "no_device_detected";

/**
 * Nunca aprova nada — só remove candidatos que já falharam de forma objetiva na Visual Validation
 * 2.0, mantendo a fila de revisão humana honesta. `ok` só é `true` quando ALGUM candidato foi
 * realmente rejeitado (correção genuína aplicada) — "0 de 0 candidatos" é um no-op honesto
 * (`ok: false`), nunca sucesso. Uma versão anterior marcava `ok: true` sempre que a passagem
 * terminava sem erro, mesmo sem rejeitar nada; como este é o ÚLTIMO candidato na prioridade padrão
 * para `video_coverage_low`/`asset_diversity_low`, esse otimismo vazio impedia o Engine de nunca
 * esgotar as tentativas e escalonar — ele ficava "resolvendo" o bloqueio a cada rodada sem nunca
 * progredir de verdade, consumindo o teto global de iterações inteiro sem pedir ajuda humana
 * (validação real: 25/25 iterações, 17min, nunca escalonou). Corrigido para seguir o mesmo
 * princípio de honestidade das outras ações (nunca reivindicar sucesso sem efeito real).
 */
export const visualValidationAction: ActionDefinition = {
  id: "visual_validation",
  name: "Visual Validation",
  description: "Passa pela fila de revisão de footage (Footage Visual Validation 2.0) e rejeita automaticamente só candidatos objetivamente reprovados (estágio 'no_device_detected') — nunca aprova nada, já que aprovação final é julgamento humano.",
  resolves: ["video_coverage_low", "asset_diversity_low"],
  prerequisites: ["Candidatos com `visualValidationStage` pendentes de revisão"],
  expectedDurationMsRange: [50, 2000],
  sideEffects: ["Rejeita (nunca aprova) candidatos objetivamente falhos no catálogo de mídia"],
  limitations: [
    "Nunca aprova candidatos automaticamente — aprovação de footage é decisão humana por design (seção 7).",
    "Rejeitar candidatos ruins não adiciona oferta nova — mesmo quando `ok: true` (algo foi rejeitado), isso não garante que a cobertura melhorou; é a reclassificação da próxima iteração do Engine que confirma isso de fato.",
    "Se não há nenhum candidato pendente no estágio objetivamente reprovável, esta ação não tem nada a fazer e reporta isso honestamente (`ok: false`) — nunca finge ter ajudado.",
  ],
  maxAttempts: 1,
  backoffMs: 0,
  isApplicable: () => true,
  execute: async ({ dryRun }) => {
    const start = Date.now();
    try {
      const pending = await footageReviewList();
      const clearlyFailed = pending.filter((asset) => asset.visualValidationStage === AUTO_REJECTABLE_STAGE);

      if (dryRun) {
        const wouldSucceed = clearlyFailed.length > 0;
        const detail = wouldSucceed
          ? `[dry-run] Rejeitaria ${clearlyFailed.length} de ${pending.length} candidato(s) pendente(s) (estágio "${AUTO_REJECTABLE_STAGE}") — nenhuma alteração real foi feita.`
          : `[dry-run] Nenhum candidato pendente no estágio "${AUTO_REJECTABLE_STAGE}" — nada a rejeitar, nenhuma alteração real foi feita.`;
        return { actionId: "visual_validation", ok: false, wouldSucceed, detail, sideEffectsApplied: [], durationMs: Date.now() - start };
      }

      for (const asset of clearlyFailed) {
        await footageReviewReject(asset.assetId, `Rejeitado automaticamente pelo Autonomous Execution Engine: estágio "${AUTO_REJECTABLE_STAGE}" (nenhum dispositivo detectado).`);
      }
      const ok = clearlyFailed.length > 0;
      const detail = ok
        ? `${clearlyFailed.length} de ${pending.length} candidato(s) pendente(s) rejeitado(s) automaticamente (estágio "${AUTO_REJECTABLE_STAGE}"); os demais seguem aguardando revisão humana.`
        : `Nenhum candidato pendente no estágio "${AUTO_REJECTABLE_STAGE}" (${pending.length} candidato(s) na fila) — nada para corrigir aqui; não é sucesso, é um no-op.`;
      return { actionId: "visual_validation", ok, detail, sideEffectsApplied: ok ? ["reject_media_asset"] : [], durationMs: Date.now() - start };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { actionId: "visual_validation", ok: false, detail: "Falha ao processar fila de revisão visual.", sideEffectsApplied: [], durationMs: Date.now() - start, error: message };
    }
  },
};
