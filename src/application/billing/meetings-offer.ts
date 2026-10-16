import type { AddonDefinitionRepositoryPort } from "../ports/plan-version-repository.port.js";
import type { SolutionEntitlementRepositoryPort } from "../ports/solution-entitlement-repository.port.js";
import type { SubscriptionItemRepositoryPort, SubscriptionRepositoryPort } from "../ports/subscription-repository.port.js";
import { isSolutionContractable, SOLUTIONS } from "../../domain/solutions/solution.model.js";

/**
 * Vorix Meetings no billing. A unidade comercial é a GRAVAÇÃO SIMULTÂNEA:
 * - `meetings_base`: o produto, com 1 gravação simultânea (quantidade sempre 1);
 * - `meetings_extra_recording`: +1 gravação simultânea por unidade.
 * Contas de gravação conectadas pelo cliente são infraestrutura e nunca entram na cobrança.
 *
 * A venda obedece ao gate comercial (`isSolutionContractable`): enquanto a gravação não funcionar
 * em produção, nenhum checkout ou compra de adicional do Meetings é aceito.
 */
export const MEETINGS_BASE_ADDON = "meetings_base";
export const MEETINGS_EXTRA_RECORDING_ADDON = "meetings_extra_recording";
export const MEETINGS_RESOURCE = "meetings_concurrent_recordings";

export function isMeetingsAddonCode(code: string): boolean {
  return code === MEETINGS_BASE_ADDON || code === MEETINGS_EXTRA_RECORDING_ADDON;
}

export function isMeetingsSellable(): boolean {
  return isSolutionContractable(SOLUTIONS.meetings);
}

export function assertMeetingsSellable(): void {
  if (!isMeetingsSellable()) {
    throw new Error("MEETINGS_NOT_CONTRACTABLE: o Vorix Meetings ainda não está disponível para contratação.");
  }
}

/** Itens de adicional do Meetings para N gravações simultâneas (N ≥ 1). */
export function meetingsItemsFor(concurrentRecordings: number): { addonCode: string; quantity: number }[] {
  const total = Math.max(1, Math.floor(concurrentRecordings));
  return [{ addonCode: MEETINGS_BASE_ADDON, quantity: 1 }, ...(total > 1 ? [{ addonCode: MEETINGS_EXTRA_RECORDING_ADDON, quantity: total - 1 }] : [])];
}

/** Valida a combinação de itens do Meetings: base obrigatória (1 unidade) se houver extras. */
export function assertValidMeetingsItems(items: readonly { addonCode: string; quantity: number }[]): void {
  const base = items.find((item) => item.addonCode === MEETINGS_BASE_ADDON);
  const extra = items.find((item) => item.addonCode === MEETINGS_EXTRA_RECORDING_ADDON);
  if (base && base.quantity !== 1) throw new Error("CHECKOUT_MEETINGS_INVALID: o Vorix Meetings é contratado uma vez; use gravações adicionais para aumentar a capacidade.");
  if (extra && !base) throw new Error("CHECKOUT_MEETINGS_INVALID: gravações adicionais exigem o Vorix Meetings.");
}

export type MeetingsEntitlementSyncDeps = {
  subscriptionRepository: Pick<SubscriptionRepositoryPort, "getActiveByTenant">;
  subscriptionItemRepository: Pick<SubscriptionItemRepositoryPort, "listBySubscription">;
  addonDefinitionRepository: Pick<AddonDefinitionRepositoryPort, "getByCode">;
  solutionEntitlementRepository: SolutionEntitlementRepositoryPort;
};

const ACCESS_STATUSES = new Set(["active", "trial", "past_due"]);

/**
 * Acesso ao Meetings derivado da ASSINATURA (fonte da verdade): soma as gravações simultâneas
 * contratadas e grava o entitlement `subscription` com `maxConcurrentRecordings`. Sem Meetings
 * contratado (ou assinatura encerrada), revoga apenas o entitlement que veio de assinatura —
 * concessões internas (homologação) nunca são tocadas.
 */
export async function syncMeetingsEntitlementFromSubscription(deps: MeetingsEntitlementSyncDeps, tenantId: string): Promise<{ concurrentRecordings: number }> {
  const subscription = await deps.subscriptionRepository.getActiveByTenant(tenantId);
  let concurrentRecordings = 0;
  if (subscription && ACCESS_STATUSES.has(subscription.status)) {
    for (const item of await deps.subscriptionItemRepository.listBySubscription(subscription.id)) {
      const addon = await deps.addonDefinitionRepository.getByCode(item.addonCode);
      if (addon?.resource === MEETINGS_RESOURCE) concurrentRecordings += addon.increment * item.quantity;
    }
  }
  const current = (await deps.solutionEntitlementRepository.listByTenant(tenantId)).find((entitlement) => entitlement.solutionKey === "meetings");
  if (concurrentRecordings > 0) {
    const unchanged = current?.enabled && current.source === "subscription" && current.limits?.maxConcurrentRecordings === concurrentRecordings;
    if (!unchanged) {
      await deps.solutionEntitlementRepository.set({
        tenantId, solutionKey: "meetings", enabled: true, source: "subscription",
        limits: { ...(current?.limits ?? {}), maxConcurrentRecordings: concurrentRecordings },
        reason: `Assinatura: ${concurrentRecordings} gravação(ões) simultânea(s)`,
      });
    }
  } else if (current?.enabled && current.source === "subscription") {
    await deps.solutionEntitlementRepository.set({ tenantId, solutionKey: "meetings", enabled: false, source: "subscription", reason: "Assinatura sem Vorix Meetings ativo" });
  }
  return { concurrentRecordings };
}
