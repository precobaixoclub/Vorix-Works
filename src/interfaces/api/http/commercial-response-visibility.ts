import type { FastifyInstance } from "fastify";
import { loadCommercialSettings, resolveVisibility, type SalesEngineDeps } from "../../../application/sales/sales-context.js";

const costFields = new Set(["costCents", "unitCostCents", "unitCostCentsSnapshot", "subtotalCostCents", "totalCostCents", "finalCostCents"]);
const marginFields = new Set(["grossProfitCents", "finalGrossProfitCents", "grossMarginBp", "marginBp", "finalMarginBp", "averageMarginBp"]);

/** Snapshots in details and timeline payloads obey the same visibility as the cockpit. */
export function filterCommercialResponse(value: unknown, visibility: { canViewCost: boolean; canViewMargin: boolean }): unknown {
  if (Array.isArray(value)) return value.map(item => filterCommercialResponse(item, visibility));
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => (visibility.canViewCost || !costFields.has(key)) && (visibility.canViewMargin || !marginFields.has(key))).map(([key, item]) => [key, filterCommercialResponse(item, visibility)]));
}

export function registerCommercialResponseVisibility(app: FastifyInstance, deps: Pick<SalesEngineDeps, "salesConfigRepository">): void {
  app.addHook("preSerialization", async (request, _reply, payload) => {
    const path = (request.routeOptions.url ?? "").replace(/^\/v1/, "");
    if (!/^\/(deals|contacts|proposals)(?:\/|$)/.test(path)) return payload;
    const actor = request.zunoContext?.principal;
    const workspaceId = (request.body as { workspaceId?: string } | undefined)?.workspaceId ?? (request.query as { workspaceId?: string })?.workspaceId;
    if (!actor || !workspaceId) return payload;
    const settings = await loadCommercialSettings(deps, actor.tenantId, workspaceId);
    return filterCommercialResponse(payload, resolveVisibility(actor, settings));
  });
}
