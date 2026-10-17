export type AiCreditPurchaseStatus = "pending" | "paid" | "failed" | "cancelled";
export type AiCreditPurchaseMethod = "saved_card" | "checkout";

export type AiCreditPurchase = {
  id: string;
  tenantId: string;
  credits: number;
  amountCents: number;
  currency: string;
  status: AiCreditPurchaseStatus;
  provider: string;
  method: AiCreditPurchaseMethod;
  providerPaymentId?: string;
  checkoutUrl?: string;
  failureReason?: string;
  createdBy?: string;
  createdAt: string;
  paidAt?: string;
};

export type AiCreditPurchaseRepositoryPort = {
  create(input: { tenantId: string; credits: number; amountCents: number; currency: string; provider: string; method: AiCreditPurchaseMethod; createdBy?: string }): Promise<AiCreditPurchase>;
  getById(id: string): Promise<AiCreditPurchase | undefined>;
  listByTenant(tenantId: string, limit: number): Promise<AiCreditPurchase[]>;
  update(id: string, patch: { method?: AiCreditPurchaseMethod; providerPaymentId?: string; checkoutUrl?: string; failureReason?: string | null }): Promise<void>;
  /** pending → paid de forma atômica; devolve a compra só para quem fez a transição (uma vez). */
  claimPaid(id: string, providerPaymentId?: string): Promise<AiCreditPurchase | undefined>;
  /** Desfaz um `claimPaid` cujo crédito não pôde ser lançado (o webhook tenta de novo). */
  revertToPending(id: string): Promise<void>;
  /** pending → failed (nunca mexe numa compra já paga). */
  markFailed(id: string, reason: string): Promise<void>;
};
