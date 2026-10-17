import type { FastifyInstance } from "fastify";
import { runProposalFollowUps } from "../../../application/sales/proposal-sales-use-cases.js";
import type { ApiContainer } from "../di/container.js";

/**
 * Follow-up de propostas (Sales Engine) — mesmo padrão de `trial-expiration-scheduler.ts`
 * (`setInterval` + `unref()` + `onClose`). Nunca envia mensagem ao cliente sozinho: cria tarefa de
 * follow-up (enviada e não aberta em 24h) e alerta o vendedor (aberta e sem resposta em 48h,
 * perto do vencimento) — cada gatilho uma única vez por proposta.
 */
export function registerProposalFollowUpScheduler(app: FastifyInstance, container: ApiContainer, options: { enabled: boolean; intervalMs: number }): void {
  if (!options.enabled || !container.identity) return;
  const identity = container.identity;

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await runProposalFollowUps({
        dealRepository: identity.dealRepository,
        pipelineStageRepository: identity.pipelineStageRepository,
        productRepository: identity.productRepository,
        timelineEventRepository: identity.timelineEventRepository,
        dealItemRepository: identity.dealItemRepository,
        salesCatalogRepository: identity.salesCatalogRepository,
        salesConfigRepository: identity.salesConfigRepository,
        approvalRepository: identity.commercialApprovalRepository,
        membershipRepository: identity.membershipRepository,
        teamMembershipRepository: identity.teamMembershipRepository,
        taskRepository: identity.taskRepository,
        contactRepository: identity.contactRepository,
        proposalRepository: identity.proposalRepository,
        notification: { notificationRepository: container.notificationRepository, realtimePublisher: container.notificationRealtimePublisher },
      });
      if (result.tasks > 0 || result.reminders > 0) app.log.info(result, "proposal follow-up scheduler tick");
    } catch (error) {
      app.log.error({ err: error }, "proposal follow-up scheduler tick failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), options.intervalMs);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
}
