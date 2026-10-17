import { isLowStock, type Deal, type Product } from "../../domain/crm/crm.model.js";
import { notifyBestEffort } from "../notification/notification-use-cases.js";
import { listManagerUserIds, type SalesEngineDeps } from "./sales-context.js";

/**
 * Controle de estoque — baixa automática no ganho da oportunidade e devolução quando ela deixa de
 * estar ganha (reaberta/perdida). Idempotente pelo saldo de movimentos da própria oportunidade:
 * nunca baixa duas vezes, nunca devolve o que não baixou (ex.: estoque ativado depois do ganho).
 * Cruzar o ponto de reposição notifica a gestão — uma vez por cruzamento, não a cada venda.
 */
type AlertDeps = Pick<SalesEngineDeps, "productRepository" | "membershipRepository" | "notification">;
type StockDeps = AlertDeps & Pick<SalesEngineDeps, "dealItemRepository">;

export async function deductStockForWonDeal(deps: StockDeps, deal: Deal, actorUserId?: string): Promise<void> {
  await bestEffort("baixa", () => deductStock(deps, deal, actorUserId));
}

async function deductStock(deps: StockDeps, deal: Deal, actorUserId?: string): Promise<void> {
  const already = await deps.productRepository.netStockByDeal(deal.id);
  if (already.some((entry) => entry.delta < 0)) return;
  const items = await deps.dealItemRepository.listByDeal(deal.id);
  const quantities = new Map<string, number>();
  for (const item of items) {
    if (!item.productId || !(item.quantity > 0)) continue;
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  for (const [productId, quantity] of quantities) {
    const before = await deps.productRepository.getById(productId);
    if (!before?.trackStock) continue;
    const after = await deps.productRepository.adjustStock({ productId, delta: -quantity, reason: "deal_won", dealId: deal.id, userId: actorUserId });
    if (after && isLowStock(after) && !isLowStock(before)) await notifyLowStock(deps, after);
  }
}

export async function revertStockForDeal(deps: StockDeps, deal: Deal, actorUserId?: string): Promise<void> {
  await bestEffort("devolução", () => revertStock(deps, deal, actorUserId));
}

async function revertStock(deps: StockDeps, deal: Deal, actorUserId?: string): Promise<void> {
  for (const entry of await deps.productRepository.netStockByDeal(deal.id)) {
    if (entry.delta >= 0) continue;
    await deps.productRepository.adjustStock({ productId: entry.productId, delta: -entry.delta, reason: "deal_reverted", dealId: deal.id, userId: actorUserId });
  }
}

/** Ajuste manual (inventário, compra recebida) — `quantity` é o novo saldo absoluto. */
export async function setStockQuantity(deps: AlertDeps, product: Product, quantity: number, actorUserId: string): Promise<Product> {
  const delta = quantity - product.stockQuantity;
  if (delta === 0) return product;
  const after = await deps.productRepository.adjustStock({ productId: product.id, delta, reason: "manual", userId: actorUserId });
  if (!after) return product;
  if (isLowStock(after) && !isLowStock(product)) await notifyLowStock(deps, after);
  return after;
}

async function notifyLowStock(deps: AlertDeps, product: Product): Promise<void> {
  const unit = product.unit ? ` ${product.unit}` : "";
  for (const userId of await listManagerUserIds(deps, product.tenantId)) {
    notifyBestEffort(deps.notification, {
      tenantId: product.tenantId, workspaceId: product.workspaceId, userId, title: "Estoque baixo — hora de repor",
      body: `${product.name}: ${product.stockQuantity.toLocaleString("pt-BR")}${unit} em estoque (alerta em ${product.stockAlertThreshold?.toLocaleString("pt-BR")}${unit}).`,
      sourceType: "product_low_stock", sourceId: product.id, sourceUrl: `/workspaces/${product.workspaceId}/products?filtro=repor`,
    });
  }
}

export type StockRiskLevel = "ok" | "warning" | "critical";
export type ProductStockRisk = { productId: string; name: string; unit?: string; stockQuantity: number; openDemand: number; level: StockRiskLevel };
export type DealStockRisk = { dealId: string; level: Exclude<StockRiskLevel, "ok">; items: { productId: string; name: string; unit?: string; quantity: number; available: number; openDemand: number; level: Exclude<StockRiskLevel, "ok"> }[] };

/**
 * Risco de estoque das oportunidades em andamento. O saldo do produto já desconta as vendas
 * fechadas (baixa no ganho), então:
 * - crítico (vermelho): esta oportunidade sozinha pede mais do que há em estoque — revisar;
 * - atenção (laranja): ela cabe no estoque, mas a soma das oportunidades abertas não cabe — se
 *   as outras fecharem antes, vai faltar.
 */
export async function getOpenDealsStockRisk(deps: Pick<SalesEngineDeps, "productRepository">, input: { tenantId: string; workspaceId: string }): Promise<{ products: ProductStockRisk[]; deals: DealStockRisk[] }> {
  const [products, demand] = await Promise.all([
    deps.productRepository.listByWorkspace({ tenantId: input.tenantId, workspaceId: input.workspaceId }),
    deps.productRepository.listOpenStockDemand(input),
  ]);
  const tracked = new Map(products.filter((product) => product.trackStock).map((product) => [product.id, product]));
  const openByProduct = new Map<string, number>();
  for (const row of demand) openByProduct.set(row.productId, (openByProduct.get(row.productId) ?? 0) + row.quantity);

  const productRisks: ProductStockRisk[] = [...tracked.values()].map((product) => {
    const openDemand = openByProduct.get(product.id) ?? 0;
    const level: StockRiskLevel = openDemand === 0 ? "ok" : openDemand > product.stockQuantity ? (product.stockQuantity <= 0 ? "critical" : "warning") : "ok";
    return { productId: product.id, name: product.name, unit: product.unit, stockQuantity: product.stockQuantity, openDemand, level };
  });

  const byDeal = new Map<string, DealStockRisk["items"]>();
  for (const row of demand) {
    const product = tracked.get(row.productId);
    if (!product) continue;
    const openDemand = openByProduct.get(row.productId) ?? 0;
    const level = row.quantity > product.stockQuantity ? "critical" : openDemand > product.stockQuantity ? "warning" : undefined;
    if (!level) continue;
    const items = byDeal.get(row.dealId) ?? [];
    items.push({ productId: product.id, name: product.name, unit: product.unit, quantity: row.quantity, available: product.stockQuantity, openDemand, level });
    byDeal.set(row.dealId, items);
  }
  const deals: DealStockRisk[] = [...byDeal.entries()].map(([dealId, items]) => ({ dealId, level: items.some((item) => item.level === "critical") ? "critical" : "warning", items }));
  return { products: productRisks, deals };
}

/** Estoque nunca impede fechar/reabrir uma venda — falha vira log, o saldo pode ser ajustado à mão. */
async function bestEffort(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.warn(`[stock] falha na ${label} de estoque (a venda segue normalmente):`, error instanceof Error ? error.message : error);
  }
}
