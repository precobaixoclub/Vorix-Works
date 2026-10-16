import type { BillingInterval } from "../../domain/platform-billing/subscription.model.js";

/** Item do pedido: adicional, quantidade e preço unitário CONGELADO no momento do pedido. */
export type CheckoutIntentItem = { addonCode: string; quantity: number; unitPrice: number; currency: string };

/**
 * Pedido de checkout — o que a pessoa configurou (plano + adicionais com quantidade). Criado ao
 * abrir o checkout; aplicado só quando o webhook do gateway confirmar o pagamento/autorização.
 */
export type CheckoutIntent = {
  id: string;
  tenantId: string;
  planVersionId: string;
  billingInterval: BillingInterval;
  items: CheckoutIntentItem[];
  amount: number;
  currency: string;
  provider: string;
  providerSessionId?: string;
  status: "pending" | "completed" | "superseded";
  createdAt: string;
  completedAt?: string;
};

export type CheckoutIntentRepositoryPort = {
  /** Cria o pedido e marca como `superseded` os pendentes anteriores do mesmo tenant. */
  createReplacingPending(input: Omit<CheckoutIntent, "status" | "createdAt" | "completedAt">): Promise<CheckoutIntent>;
  /** Pedido pendente que originou a sessão/assinatura no gateway; senão, o pendente mais recente
   * do tenant para a mesma versão de plano. */
  findPendingForCompletion(input: { tenantId: string; planVersionId: string; providerSessionId?: string }): Promise<CheckoutIntent | undefined>;
  /** `true` só na primeira vez (idempotente sob reentrega de webhook). */
  markCompleted(id: string): Promise<boolean>;
  /** Liga o pedido (criado ANTES do checkout) à sessão devolvida pelo gateway. */
  attachSession(id: string, providerSessionId: string): Promise<void>;
};
