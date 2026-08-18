/**
 * Hierarquia comercial automática (Fase 3) — decide quais argumentos disponíveis merecem espaço
 * visual, na ordem fixa: preço excepcional > desconto > promoção > benefício principal > prova
 * social > avaliação > quantidade vendida > frete > condição de pagamento > especificação >
 * diferenciais > CTA. Função pura: nunca inventa um argumento ausente, só ordena o que já existe.
 */

export type CommercialArgumentInputs = {
  price?: string;
  discount?: string;
  promotion?: string;
  mainBenefit?: string;
  socialProof?: string;
  rating?: string;
  salesCount?: string;
  shipping?: string;
  paymentTerms?: string;
  specification?: string;
  differentiator?: string;
  cta?: string;
};

export const COMMERCIAL_ARGUMENT_ORDER: ReadonlyArray<keyof CommercialArgumentInputs> = [
  "price",
  "discount",
  "promotion",
  "mainBenefit",
  "socialProof",
  "rating",
  "salesCount",
  "shipping",
  "paymentTerms",
  "specification",
  "differentiator",
  "cta",
];

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Devolve os argumentos REALMENTE disponíveis, na ordem de força — nunca preenche um slot vazio. */
export function rankCommercialArguments(inputs: CommercialArgumentInputs): Array<keyof CommercialArgumentInputs> {
  return COMMERCIAL_ARGUMENT_ORDER.filter((key) => hasValue(inputs[key]));
}
