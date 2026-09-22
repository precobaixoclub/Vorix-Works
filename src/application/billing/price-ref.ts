/**
 * Resolve a referência de Price do gateway real para um `(plano|add-on, intervalo)` — usado por
 * checkout (Fase 2) e troca de plano/add-on (Fase 3). `SandboxBillingProvider` nunca valida esta
 * referência, então usa o próprio id como valor determinístico; um gateway real sem o Price
 * configurado é um erro de configuração explícito, nunca um `undefined` silencioso passado adiante.
 *
 * `MercadoPagoBillingProvider` (Etapa C) nunca lê `providerPlanPriceRef`/`providerPriceRef` — não
 * existe conceito de "Price" reutilizável no Mercado Pago (uma `preapproval` cobra um
 * `transaction_amount` calculado por `capacity.model.ts`, seção 3-4 do pedido); exigir que o admin
 * cadastre um valor sem uso real seria um obstáculo artificial. Mesmo tratamento do `sandbox`.
 */
export function priceRefFor(providerId: string, subjectId: string, ref: string | undefined): string {
  if (ref) return ref;
  if (providerId === "sandbox" || providerId === "mercadopago") return subjectId;
  throw new Error(`CHECKOUT_PRICE_NOT_CONFIGURED: "${subjectId}" não tem Price configurado para o gateway "${providerId}".`);
}
