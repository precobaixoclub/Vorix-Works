import type { FastifyInstance } from "fastify";
import type { ApiContainer } from "../di/container.js";

/**
 * Aprovação de publicações pelo WhatsApp: a cada 10 s envia os pedidos novos, aplica as respostas que o
 * worker de Conversas capturou e encerra os pedidos sem resposta perto do horário (regra da marca).
 */
export function registerWhatsappApprovalScheduler(app: FastifyInstance, container: ApiContainer): void {
  const service = container.whatsappApprovals;
  if (!service) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await service.tick();
      if (result.sent || result.applied || result.expired || result.completed) app.log.info(result, "whatsapp approvals");
    } catch (error) {
      app.log.error({ err: error }, "whatsapp approval scheduler failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 10_000);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); });
}
