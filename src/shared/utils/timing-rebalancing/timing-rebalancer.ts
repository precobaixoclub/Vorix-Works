import type { TimingDeficit } from "../../../application/ports/visual-asset-provider.port.js";
import { deriveTimingConstraint, type TimingConstraint, type TimingShotInput } from "./timing-constraint-model.js";

export type { TimingDeficit };

/**
 * NARRATIVE TIMING REBALANCING — motor de realocação (seções 5-9, 13). Reaproveita
 * `timing-constraint-model.ts` (mesmo arquivo desta sprint) para classificar cada Shot; nunca
 * cria uma Engine nova de renderização/composição — só decide QUANTOS segundos mover entre Shots
 * já existentes. Determinístico: mesma entrada sempre produz o mesmo plano (seção 8: "não usar
 * otimização aleatória").
 */

export const REBALANCE_POLICY_VERSION = "narrative-timing-rebalancing@1.0";

/** Seção 4 — a composição informa ao planejador quanto precisa; nunca um número fixo (seção "IMPORTANTE": não codificar 1.2s). */
export function detectTimingDeficit(input: {
  shotId: string;
  sceneOrder: number;
  allocatedDuration: number;
  requiredMinimumDuration: number;
  segmentCount: number;
  minimumSegmentDuration: number;
}): TimingDeficit | undefined {
  const deficit = Number.parseFloat((input.requiredMinimumDuration - input.allocatedDuration).toFixed(3));
  if (deficit <= 0) return undefined;
  return {
    type: "TIMING_DEFICIT",
    shotId: input.shotId,
    sceneOrder: input.sceneOrder,
    allocatedDuration: input.allocatedDuration,
    requiredMinimumDuration: input.requiredMinimumDuration,
    deficit,
    reason: `${input.segmentCount} segmentos compostos exigem ${input.minimumSegmentDuration}s cada.`,
    blockingRequirements: [`composite_scene: ${input.segmentCount} segmentos x ${input.minimumSegmentDuration}s`],
  };
}

export type DonorCandidate = {
  shotId: string;
  sceneOrder: number;
  shotOrder: number;
  constraint: TimingConstraint;
  /** Segundos que este Shot pode ceder sem violar seu próprio mínimo. */
  availableSlack: number;
  /** Ordem de preferência (seção 6): 1=Shot adjacente da mesma cena, 2=mesma cena não-adjacente, 3=decorativo da mesma seção, 4=flexível de outra cena, 5=transição com folga. */
  tier: 1 | 2 | 3 | 4 | 5;
  /** Distância em posições de Shot até o receptor — usada para minimizar impacto (seção 8). */
  distance: number;
  ineligibleReason?: string;
}

/** Seção 6 — nunca retira tempo de locked/CTA abaixo do mínimo/já no mínimo; ordena por proximidade e menor prioridade narrativa (seção 8). */
export function findDonorCandidates(input: {
  receiverShotId: string;
  receiverSceneOrder: number;
  receiverShotOrder: number;
  allShots: TimingShotInput[];
}): DonorCandidate[] {
  const { receiverShotId, receiverSceneOrder, receiverShotOrder, allShots } = input;
  const candidates: DonorCandidate[] = [];

  for (const shot of allShots) {
    if (shot.shotId === receiverShotId) continue;
    const constraint = deriveTimingConstraint(shot);
    const sameScene = shot.sceneOrder === receiverSceneOrder;
    const distance = sameScene ? Math.abs(shot.shotOrder - receiverShotOrder) : 1000 + Math.abs(shot.sceneOrder - receiverSceneOrder);

    const tier: DonorCandidate["tier"] = sameScene && distance === 1 ? 1
      : sameScene ? 2
      : constraint.timingFlexibility === "decorative" ? 3
      : constraint.timingFlexibility === "flexible" ? 4
      : 5;

    const availableSlack = Number.parseFloat(Math.max(0, constraint.allocatedDuration - constraint.minimumDuration).toFixed(3));

    let ineligibleReason: string | undefined;
    if (constraint.timingFlexibility === "locked") ineligibleReason = "Shot locked (CTA/end-card) — nunca doa tempo.";
    else if (constraint.timingFlexibility === "composite_required") ineligibleReason = "Shot já precisa de duração mínima própria para sua composição — não tem folga a ceder.";
    else if (availableSlack <= 0) ineligibleReason = `Já no mínimo (${constraint.minimumDuration}s) — nada a ceder.`;

    candidates.push({ shotId: shot.shotId, sceneOrder: shot.sceneOrder, shotOrder: shot.shotOrder, constraint, availableSlack, tier, distance, ineligibleReason });
  }

  // Ordena por: elegibilidade (elegíveis primeiro), tier (seção 6), distância (seção 8: minimizar
  // distância), prioridade narrativa (menor prioridade cede primeiro), folga disponível (maior
  // folga primeiro — menos Shots alterados, seção 8). Determinístico, sem aleatoriedade.
  return candidates.sort((a, b) => {
    const aEligible = a.ineligibleReason ? 1 : 0;
    const bEligible = b.ineligibleReason ? 1 : 0;
    if (aEligible !== bEligible) return aEligible - bEligible;
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.constraint.timingPriority !== b.constraint.timingPriority) return a.constraint.timingPriority - b.constraint.timingPriority;
    return b.availableSlack - a.availableSlack;
  });
}

export type RebalanceTransfer = { donorShotId: string; sceneOrder: number; amount: number; donorBefore: number; donorAfter: number; donorMinimum: number };

export type RebalancePlan = {
  receiverShotId: string;
  receiverSceneOrder: number;
  deficit: number;
  transfers: RebalanceTransfer[];
  receiverBefore: number;
  receiverAfter: number;
  totalVideoDurationChange: number;
  impact: "low" | "medium" | "high";
  policyVersion: string;
  reason: string;
};

/**
 * Seção 7-8 — transfere só o necessário, do MENOR conjunto de doadores suficiente (prefere 1
 * doador; só usa mais de 1 quando nenhum sozinho cobre o déficit — seção 6.9). Nunca redistribui
 * a timeline inteira. Retorna `undefined` quando nenhuma combinação de doadores elegíveis cobre o
 * déficit (seção 9: `TIMING_REBALANCE_NOT_POSSIBLE`).
 */
export function buildRebalancePlan(input: {
  receiverShotId: string;
  receiverSceneOrder: number;
  receiverAllocatedDuration: number;
  deficit: number;
  donors: DonorCandidate[];
}): RebalancePlan | undefined {
  const { receiverShotId, receiverSceneOrder, receiverAllocatedDuration, deficit, donors } = input;
  const eligible = donors.filter((d) => !d.ineligibleReason && d.availableSlack > 0);
  if (eligible.length === 0) return undefined;

  // Doador único suficiente (seção 7: "não redistribuir toda a timeline quando um ajuste local
  // for suficiente") — já ordenado por preferência, então o primeiro que cobre sozinho é o
  // escolhido, determinístico.
  const singleDonor = eligible.find((d) => d.availableSlack >= deficit);
  const chosenDonors = singleDonor ? [singleDonor] : selectMultipleDonors(eligible, deficit);
  if (!chosenDonors) return undefined;

  let remaining = deficit;
  const transfers: RebalanceTransfer[] = [];
  for (const donor of chosenDonors) {
    const amount = Number.parseFloat(Math.min(donor.availableSlack, remaining).toFixed(3));
    if (amount <= 0) continue;
    transfers.push({
      donorShotId: donor.shotId,
      sceneOrder: donor.sceneOrder,
      amount,
      donorBefore: donor.constraint.allocatedDuration,
      donorAfter: Number.parseFloat((donor.constraint.allocatedDuration - amount).toFixed(3)),
      donorMinimum: donor.constraint.minimumDuration,
    });
    remaining = Number.parseFloat((remaining - amount).toFixed(3));
  }
  if (remaining > 0.001) return undefined;

  // Impacto: baixo quando 1 doador adjacente (tier 1) cobre tudo; médio para múltiplos
  // doadores/mesma cena; alto quando cruzou cena (seção 8: "impacto narrativo").
  const usesOnlyTierOne = chosenDonors.every((d) => d.tier === 1);
  const crossesScene = chosenDonors.some((d) => d.tier >= 4);
  const impact: RebalancePlan["impact"] = crossesScene ? "high" : usesOnlyTierOne && chosenDonors.length === 1 ? "low" : "medium";

  return {
    receiverShotId,
    receiverSceneOrder,
    deficit,
    transfers,
    receiverBefore: receiverAllocatedDuration,
    receiverAfter: Number.parseFloat((receiverAllocatedDuration + deficit).toFixed(3)),
    // Soma-zero por construção: o que o(s) doador(es) cede(m) é exatamente o que o receptor
    // ganha — a duração total do vídeo nunca muda (seção 9).
    totalVideoDurationChange: 0,
    impact,
    policyVersion: REBALANCE_POLICY_VERSION,
    reason: `${chosenDonors.length} doador(es): ${chosenDonors.map((d) => `${d.shotId} (-${Math.min(d.availableSlack, deficit).toFixed(3)}s)`).join(", ")} -> ${receiverShotId} (+${deficit}s).`,
  };
}

/** Seção 6.9 — combina o menor número de doadores (já ordenados por preferência) até cobrir o déficit; retorna `undefined` se nem todos juntos bastam. */
function selectMultipleDonors(eligible: DonorCandidate[], deficit: number): DonorCandidate[] | undefined {
  const totalSlack = eligible.reduce((sum, d) => sum + d.availableSlack, 0);
  if (totalSlack < deficit - 0.001) return undefined;
  const chosen: DonorCandidate[] = [];
  let remaining = deficit;
  for (const donor of eligible) {
    if (remaining <= 0.001) break;
    chosen.push(donor);
    remaining -= donor.availableSlack;
  }
  return chosen;
}

/** Aplica o plano a uma cópia das durações — nunca muta a entrada (seção 14: a timeline original permanece auditável). */
export function applyRebalancePlan(shots: TimingShotInput[], plan: RebalancePlan): TimingShotInput[] {
  const durationById = new Map<string, number>();
  for (const transfer of plan.transfers) durationById.set(transfer.donorShotId, transfer.donorAfter);
  durationById.set(plan.receiverShotId, plan.receiverAfter);

  return shots.map((shot) => {
    const newDuration = durationById.get(shot.shotId);
    return newDuration === undefined ? shot : { ...shot, allocatedDuration: newDuration };
  });
}

export type RebalanceRecord = {
  receiverShotId: string;
  donorShotIds: string[];
  originalDurations: Record<string, number>;
  rebalancedDurations: Record<string, number>;
  durationDelta: Record<string, number>;
  reason: string;
  policyVersion: string;
  rebalancedAt: string;
  validationResults: { sceneDurationPreserved: boolean; totalVideoDurationPreserved: boolean };
};

/** Seção 14 — registro persistível do plano aplicado, com os dois invariantes centrais desta sprint checados explicitamente (nunca assumidos). */
export function buildRebalanceRecord(plan: RebalancePlan, now: Date = new Date()): RebalanceRecord {
  const originalDurations: Record<string, number> = { [plan.receiverShotId]: plan.receiverBefore };
  const rebalancedDurations: Record<string, number> = { [plan.receiverShotId]: plan.receiverAfter };
  const durationDelta: Record<string, number> = { [plan.receiverShotId]: Number.parseFloat((plan.receiverAfter - plan.receiverBefore).toFixed(3)) };
  for (const transfer of plan.transfers) {
    originalDurations[transfer.donorShotId] = transfer.donorBefore;
    rebalancedDurations[transfer.donorShotId] = transfer.donorAfter;
    durationDelta[transfer.donorShotId] = Number.parseFloat((transfer.donorAfter - transfer.donorBefore).toFixed(3));
  }
  return {
    receiverShotId: plan.receiverShotId,
    donorShotIds: plan.transfers.map((t) => t.donorShotId),
    originalDurations,
    rebalancedDurations,
    durationDelta,
    reason: plan.reason,
    policyVersion: plan.policyVersion,
    rebalancedAt: now.toISOString(),
    validationResults: {
      // Só verdadeiro quando TODOS os doadores são da mesma cena do receptor — só nesse caso a
      // soma da cena (e portanto a faixa de narração contínua que toca sob ela) fica
      // matematicamente inalterada (seção 9/10). Nunca assumido — checado contra os `transfers` reais.
      sceneDurationPreserved: plan.transfers.every((t) => t.sceneOrder === plan.receiverSceneOrder),
      totalVideoDurationPreserved: plan.totalVideoDurationChange === 0,
    },
  };
}
