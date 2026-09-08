import type { FastifyInstance } from "fastify";
import { getGrowthDashboard, type GrowthDashboardUseCaseDeps } from "../../../../application/growth/growth-dashboard-use-cases.js";
import { requirePlatformAdmin } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/**
 * Growth Dashboard — Fatia E (Trial + Product Analytics). Painel MÍNIMO, só leitura, ADMIN-only
 * (mesmo guard de `admin.route.ts`, nunca um segundo mecanismo de RBAC). Deliberadamente uma rota
 * própria, separada de `/admin/dashboard` (que é sobre lucro/margem de custo de IA por tenant,
 * nunca sobre funil/MRR de verdade) — GROWTH_DASHBOARD_ENABLED não existe como flag porque a rota
 * já nasce atrás de `requirePlatformAdmin`; um segundo kill switch seria redundante.
 */
export async function registerGrowthDashboardRoutes(app: FastifyInstance, deps: GrowthDashboardUseCaseDeps): Promise<void> {
  app.get("/admin/growth-dashboard", async (request) => {
    requirePlatformAdmin(request);
    const dashboard = await getGrowthDashboard(deps);
    return successEnvelope(dashboard, request.id);
  });
}
