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
    // Variantes: a transição de status no PostgreSQL faz a baixa/devolução atômica (0164).
    if (!item.productId || !(item.quantity > 0)) continue;
    if(item.variantId&&(await deps.productRepository.getById(item.productId))?.details?.options.length)continue;
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

export {getOpenDealsStockRisk,type StockRiskLevel,type ProductStockRisk,type DealStockRisk} from "./product-stock-risk.js";

/** Estoque nunca impede fechar/reabrir uma venda — falha vira log, o saldo pode ser ajustado à mão. */
async function bestEffort(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.warn(`[stock] falha na ${label} de estoque (a venda segue normalmente):`, error instanceof Error ? error.message : error);
  }
}
