import type { CreativePlanAssetRole } from "./gpt-creative-plan.types.js";

/**
 * Guarda de prompt do motor GPT (novo) — migração "GPT como motor criativo único" (PR 2/9).
 * DELIBERADAMENTE separada de `legacy-pedro-image-guard.ts` (motor legado): a escolha de qual
 * guarda se aplica é sempre explícita por qual provider é instanciado
 * (`OpenAiCreativeImageProvider` = esta; `OpenAiIcaroImageProvider` = a legada), nunca inferida a
 * partir do conteúdo da requisição.
 *
 * Esta guarda NUNCA modifica, restringe ou suprime headline, CTA, conceito, layout ou direção de
 * arte — essas decisões pertencem inteiramente ao `creative_plan` do GPT. Ela só protege:
 * fatos comerciais (nunca inventar preço/desconto fora dos confirmados), assets reais (nunca
 * redesenhar o que será colado por composição determinística depois), marca (nunca inventar uma
 * logo/wordmark), referências obrigatórias (nunca substituir por um genérico) e formato/proporção
 * (técnico, mesma mecânica do motor legado). Nenhuma cláusula sobre "não pode haver texto" —
 * exatamente a cláusula do motor legado que hoje anularia o headline/CTA do próprio `creative_plan`
 * se reaproveitada aqui (achado da auditoria "Rodada 3").
 */

const ASSET_ROLE_LABELS: Record<CreativePlanAssetRole, string> = {
  product_photo: "a foto de produto real",
  screenshot: "o screenshot real do site/app",
  logo: "a logo oficial da marca",
  reference_style: "a referência de estilo",
  other: "o asset de apoio anexado",
};

export type CreativeEngineImageGuardInput = {
  /** Proporção/formato pedido, ex.: "4:5" — mesma técnica do motor legado (resolveOpenAiImageSize/
   * resolveCropAwareCompositionHint), nunca decisão criativa. */
  aspectRatio?: string;
  /** Já computado por quem chama (`resolveCropAwareCompositionHint`) — puramente técnico. */
  cropAwareHint?: string;
  /** Papéis de asset que serão colados por composição determinística depois — o modelo deve
   * deixar espaço/cenário ao redor, nunca desenhar o elemento em si. */
  preservedAssetRoles: readonly CreativePlanAssetRole[];
  /** Fatos comerciais já CONFIRMADOS — únicos valores que podem aparecer como preço/desconto/
   * condição. Lista vazia = nenhum número comercial pode aparecer. */
  confirmedFacts: readonly string[];
  /** Elementos que o usuário pediu explicitamente para nunca aparecer. */
  forbiddenElements?: readonly string[];
};

function describePreservedRoles(roles: readonly CreativePlanAssetRole[]): string {
  const unique = [...new Set(roles)];
  return unique.map((role) => ASSET_ROLE_LABELS[role]).join(", ");
}

export function buildCreativeEngineImageGuard(input: CreativeEngineImageGuardInput): string {
  const clauses: string[] = [];

  if (input.preservedAssetRoles.length > 0) {
    clauses.push(
      `REGRA OBRIGATÓRIA — ASSETS REAIS: ${describePreservedRoles(input.preservedAssetRoles)} será(ão) colado(s) por composição determinística depois, como pixels reais. Nunca desenhe, redesenhe ou substitua esse(s) elemento(s) você mesmo — apenas deixe espaço e cenário ao redor. Nunca invente uma interface, produto ou logo genéricos no lugar deles.`,
    );
  }

  clauses.push(
    input.confirmedFacts.length > 0
      ? `REGRA OBRIGATÓRIA — FATOS COMERCIAIS: os ÚNICOS valores comerciais (preço, desconto, prazo, condição) que podem aparecer na imagem são exatamente estes, já confirmados: ${input.confirmedFacts.join("; ")}. Nunca invente, arredonde ou adicione qualquer outro número, percentual ou condição comercial além destes.`
      : "REGRA OBRIGATÓRIA — FATOS COMERCIAIS: nenhum fato comercial foi confirmado para esta peça. Não desenhe nenhum preço, desconto, percentual, prazo ou condição comercial na imagem.",
  );

  clauses.push(
    "REGRA OBRIGATÓRIA — MARCA: nunca invente, desenhe ou sugira uma logo, wordmark ou marca de terceiros que não foi fornecida. Se uma logo real for necessária, ela será colada por composição determinística depois — não desenhe nenhuma logo você mesmo.",
  );

  clauses.push(
    "REGRA OBRIGATÓRIA — REFERÊNCIA OBRIGATÓRIA: nunca substitua um asset de referência obrigatório (produto, screenshot, logo) por um genérico ou reimaginado — se ele não puder ser usado fielmente, é preferível deixar espaço vazio a inventar um substituto.",
  );

  if (input.forbiddenElements && input.forbiddenElements.length > 0) {
    clauses.push(`REGRA OBRIGATÓRIA — PROIBIDO: nunca inclua: ${input.forbiddenElements.join(", ")}.`);
  }

  if (input.cropAwareHint) {
    clauses.push(`REGRA OBRIGATÓRIA — ENQUADRAMENTO: ${input.cropAwareHint}`);
  }

  return clauses.join(" ");
}

export const CREATIVE_ENGINE_MAX_PROMPT_LENGTH = 31_000;

/** Mesma técnica de repetição início+fim do motor legado (achado ao vivo documentado em
 * `legacy-pedro-image-guard.ts`: uma única menção não sobrevive a um prompt grande) — aplicada só
 * às cláusulas factuais acima, nunca a uma cláusula de supressão de texto. */
export function buildCreativeEngineGuardedPrompt(prompt: string, input: CreativeEngineImageGuardInput): string {
  const guard = buildCreativeEngineImageGuard(input);
  const budget = Math.max(0, CREATIVE_ENGINE_MAX_PROMPT_LENGTH - guard.length * 2 - 20);
  const body = prompt.length > budget ? `${prompt.slice(0, budget)}\n[...]` : prompt;
  return `${guard}\n\n${body}\n\n${guard}`;
}
