import { captureFeatureScore, type BusinessKind, type ClassifiedReference } from "./reference-roles.js";

/**
 * Classificação de intenção visual — decide, POR PAUTA (nunca por empresa inteira), se a peça é:
 * - `physical_product`: vende um produto físico específico → a foto original é obrigatória e manda;
 * - `software`: demonstra uma funcionalidade de software → a interface exibida é uma captura real;
 * - `conceptual`: mensagem institucional/educativa/conceitual → liberdade visual com a identidade.
 *
 * Achado da auditoria (25/11/2026): o piloto automático não tinha essa decisão — toda pauta virava
 * "cena gerada pela IA". Peças da Vorix sobre funcionalidades saíam com monitores vazios e as da
 * CMKV sem a camiseta anunciada. A decisão é auditável (`reasons`, `source`) e editável: o usuário
 * muda o modo escolhendo os materiais da pauta (produto, captura ou nenhum) ou explicitamente.
 */

export const VISUAL_MODES = ["physical_product", "software", "conceptual"] as const;
export type VisualMode = (typeof VISUAL_MODES)[number];

export const VISUAL_MODE_LABELS: Record<VisualMode, string> = {
  physical_product: "Produto físico",
  software: "Software e aplicativos",
  conceptual: "Campanha conceitual",
};

export type VisualIntentIdea = {
  title?: string;
  category?: string;
  approach?: string;
  objective?: string;
  concept?: string;
  keyMessage?: string;
  visualDirection?: string;
  creativePrompt?: string;
};

/** Funcionalidade de software que a marca pode demonstrar (rótulo + palavras que a identificam). */
export type SoftwareFeature = { key: string; label: string; keywords: readonly string[] };

export type VisualIntentInput = {
  businessKind: BusinessKind;
  idea: VisualIntentIdea;
  references: readonly ClassifiedReference[];
  /** Escolha explícita do usuário — vence todo o resto. */
  explicitMode?: VisualMode;
  /** Funcionalidades conhecidas da marca (quando o negócio é software). */
  softwareFeatures?: readonly SoftwareFeature[];
};

export type FeatureMatch = { feature: SoftwareFeature; matched: string[] };

export type VisualIntentDecision = {
  mode: VisualMode;
  source: "explicit" | "references" | "content" | "business_default";
  reasons: string[];
  /** A peça precisa mostrar o produto/interface verdadeiros (bloqueia sem a referência). */
  demonstratesProduct: boolean;
  feature?: FeatureMatch;
};

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ideaText(idea: VisualIntentIdea): string {
  return normalize([idea.title, idea.category, idea.approach, idea.objective, idea.concept, idea.keyMessage, idea.visualDirection, idea.creativePrompt].filter(Boolean).join(" \n "));
}

// Pede para mostrar o produto físico (peça, cor, estampa, coleção, oferta).
const PRODUCT_INTENT = /\b(camiset\w*|peca|pecas|estampa\w*|colec\w*|modelo|modelos|produto\w*|lancamento\w*|novidade\w*|chegou|vitrine|catalogo|cor|cores|variac\w*|tamanho\w*|tecido|caimento|look|oferta\w*|promoc\w*|desconto|compre|garanta|estoque|kit|sku)\b/;
// Pede para mostrar o software funcionando.
const SOFTWARE_INTENT = /\b(tela|telas|interface|sistema|plataforma|painel|dashboard|funcionalidade\w*|recurso\w*|ferramenta|app|aplicativo|como funciona|na pratica|demonstr\w*|veja|mostra\w*|caixa de entrada|inbox|historico|transcric\w*|resumo|gravac\w*|gravador|automac\w*|integrac\w*|whatsapp|crm|funil|kanban|relatorio\w*|agenda)\b/;
// Só o pedido institucional de verdade. "Conceito", "frase", "tendência"… aparecem na direção visual de
// pautas de produto ("Conceito western urbano") e não autorizam inventar a peça de uma marca com catálogo.
const INSTITUTIONAL_INTENT = /\b(institucional|manifesto|valores|missao|proposito|bastidores|data comemorativa|feriado|bem-vindo|boas-vindas|agradec\w*)\b/;
// Mensagem conceitual/institucional explícita.
const CONCEPT_INTENT = /\b(institucional|manifesto|valores|missao|proposito|reflex\w*|frase|bastidores|cultura|data comemorativa|feriado|tendencia\w*|conceito|inspirac\w*|bem-vindo|boas-vindas|agradec\w*)\b/;

export function matchSoftwareFeature(text: string, features: readonly SoftwareFeature[] | undefined): FeatureMatch | undefined {
  let best: FeatureMatch | undefined;
  for (const feature of features ?? []) {
    const matched = feature.keywords.filter((keyword) => text.includes(normalize(keyword)));
    if (matched.length && (!best || matched.length > best.matched.length)) best = { feature, matched };
  }
  return best;
}

export function classifyVisualIntent(input: VisualIntentInput): VisualIntentDecision {
  const text = ideaText(input.idea);
  const feature = matchSoftwareFeature(text, input.softwareFeatures);
  const hasProductReference = input.references.some((reference) => reference.role === "product_photo" || reference.role === "product_variant");
  const captures = input.references.filter((reference) => reference.role === "software_capture");
  const conceptAsked = CONCEPT_INTENT.test(text);

  if (input.explicitMode) {
    return {
      mode: input.explicitMode,
      source: "explicit",
      reasons: [`Modo "${VISUAL_MODE_LABELS[input.explicitMode]}" escolhido explicitamente.`],
      demonstratesProduct: input.explicitMode !== "conceptual",
      ...(input.explicitMode === "software" && feature ? { feature } : {}),
    };
  }

  if (hasProductReference) {
    return {
      mode: "physical_product",
      source: "references",
      reasons: ["A pauta tem a fotografia de um produto selecionada — a peça anuncia esse produto e preserva a foto original."],
      demonstratesProduct: true,
    };
  }

  if (captures.length && input.businessKind === "software") {
    const relevant = feature ? captures.some((capture) => captureFeatureScore(capture, feature.feature.keywords) > 0) : true;
    if (relevant) {
      return {
        mode: "software",
        source: "references",
        reasons: ["A pauta tem uma captura real do software — a peça demonstra essa interface."],
        demonstratesProduct: true,
        ...(feature ? { feature } : {}),
      };
    }
  }

  if (input.businessKind === "physical_products" && PRODUCT_INTENT.test(text) && !conceptAsked) {
    return {
      mode: "physical_product",
      source: "content",
      reasons: ["O negócio vende produtos físicos e a pauta fala do produto (peça, cor, estampa, coleção ou oferta)."],
      demonstratesProduct: true,
    };
  }

  // Marca de produto físico sem pedido explícito de peça institucional: mostra uma peça REAL do catálogo
  // (o planejador escolhe no rodízio). Antes caía em "cena conceitual" e a IA desenhava a roupa do zero —
  // em produção (25/11/2026) a CMKV recebeu camiseta com estampa que não existe no catálogo.
  if (input.businessKind === "physical_products" && !INSTITUTIONAL_INTENT.test(text)) {
    return {
      mode: "physical_product",
      source: "business_default",
      reasons: ["O negócio vende produtos físicos: a peça mostra um produto real do catálogo, nunca uma peça inventada."],
      demonstratesProduct: true,
    };
  }

  if (input.businessKind === "software" && !conceptAsked && (feature || SOFTWARE_INTENT.test(text))) {
    return {
      mode: "software",
      source: "content",
      reasons: [feature
        ? `A pauta divulga a funcionalidade "${feature.feature.label}" (${feature.matched.slice(0, 3).join(", ")}).`
        : "O negócio é software e a pauta pede para mostrar o sistema funcionando."],
      demonstratesProduct: true,
      ...(feature ? { feature } : {}),
    };
  }

  return {
    mode: "conceptual",
    source: conceptAsked ? "content" : "business_default",
    reasons: [conceptAsked
      ? "A pauta é institucional/conceitual — liberdade visual preservando a identidade da marca."
      : "A pauta não anuncia um produto específico nem demonstra uma funcionalidade — campanha conceitual."],
    demonstratesProduct: false,
  };
}

/** Tipo de negócio a partir do que a marca realmente tem (catálogo físico, capturas de software, notas). */
export function inferBusinessKind(input: { explicit?: BusinessKind; physicalCatalogCount?: number; softwareCaptureCount?: number; brandNotes?: string }): BusinessKind {
  if (input.explicit && input.explicit !== "unknown") return input.explicit;
  const notes = normalize(input.brandNotes ?? "");
  if ((input.softwareCaptureCount ?? 0) > 0 || /\b(software|saas|plataforma|sistema|aplicativo|app|crm|automac\w*)\b/.test(notes)) return "software";
  if ((input.physicalCatalogCount ?? 0) > 0 || /\b(loja|moda|vestuario|camiset\w*|roupa|produto\w* fisico\w*|e-?commerce|acessorio\w*|cosmetic\w*|moveis|alimento\w*)\b/.test(notes)) return "physical_products";
  if (/\b(servico\w*|consultoria|evento\w*|casamento\w*|clinica|escola|curso\w*)\b/.test(notes)) return "services";
  return "unknown";
}
