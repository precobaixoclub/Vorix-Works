/**
 * Resolve a referência de Price do gateway real para um `(plano|add-on, intervalo)` — usado por
 * checkout (Fase 2) e troca de plano/add-on (Fase 3). `SandboxBillingProvider` nunca valida esta
 * referência, então usa o próprio id como valor determinístico; um gateway real sem o Price
 * configurado é um erro de configuração explícito, nunca um `undefined` silencioso passado adiante.
 */
export function priceRefFor(providerId: string, subjectId: string, ref: string | undefined): string {
  if (ref) return ref;
  if (providerId === "sandbox") return subjectId;
  throw new Error(`CHECKOUT_PRICE_NOT_CONFIGURED: "${subjectId}" não tem Price configurado para o gateway "${providerId}".`);
}
