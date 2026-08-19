/**
 * Semantic Occlusion Check (Rodada 2, Fatia 3) — em vez de pedir a um modelo de visão para
 * devolver caixas delimitadoras precisas (pouco confiável para LLMs multimodais sem grounding
 * dedicado), pergunta diretamente se um elemento comercial (headline/badge/preço/CTA/logo/
 * ProductHero) está cobrindo uma região semanticamente importante (rosto, olhos, mãos, produto)
 * na imagem JÁ COMPOSTA — um veredito sim/não é muito mais confiável do que coordenadas. Este
 * veredito alimenta tanto o Repair Loop (decide se tenta reposicionar) quanto o Quality Gate
 * oficial do Lucas (decide severidade/reprovação). Prompt e formato de resposta compartilhados
 * entre os dois pontos de chamada (`OpenAiSemanticOcclusionChecker`, execution-handler-level, usado
 * pelo Repair Loop; `LucasQualityReviewSkill.checkSemanticOcclusion`, usado pelo registro oficial)
 * para nunca divergir em critério.
 *
 * `src/shared` não é uma Skill — importar daqui não viola ADR 0002.
 */

export const OCCLUDED_SUBJECT_TYPES = ["face", "eyes", "hands", "product"] as const;
export type OccludedSubjectType = (typeof OCCLUDED_SUBJECT_TYPES)[number];

export const OCCLUDING_ELEMENT_TYPES = ["headline", "badge", "price", "discount", "cta", "logo", "heroProduct", "benefits", "specs", "rating", "salesProof"] as const;
export type OccludingElementType = (typeof OCCLUDING_ELEMENT_TYPES)[number];

export type SemanticOcclusionViolation = {
  element: OccludingElementType;
  subject: OccludedSubjectType;
  /** "severe" = cobre a região a ponto de comprometer a peça (ex.: olhos/boca inteiros escondidos,
   * mais da metade do produto encoberta); "partial" = toca a região mas não a compromete
   * seriamente (ex.: encosta na borda de uma mão, canto do produto). */
  severity: "severe" | "partial";
  reasoning: string;
};

export type SemanticOcclusionVerdict = {
  hasViolation: boolean;
  violations: SemanticOcclusionViolation[];
};

export const SEMANTIC_OCCLUSION_PROMPT = [
  "Avalie esta peça publicitária JÁ FINALIZADA (a imagem anexada) para OCLUSÃO SEMÂNTICA — elementos comerciais (headline, selo/badge, preço, desconto, CTA, logo, ou o próprio produto) cobrindo partes importantes de uma pessoa ou do produto.",
  "Responda APENAS com JSON válido, sem markdown, no formato exato:",
  '{"hasViolation": true|false, "violations": [{"element": "headline"|"badge"|"price"|"discount"|"cta"|"logo"|"heroProduct"|"benefits"|"specs"|"rating"|"salesProof", "subject": "face"|"eyes"|"hands"|"product", "severity": "severe"|"partial", "reasoning": "1 frase objetiva"}]}',
  "REGRAS:",
  "- \"face\": cobre rosto/testa/olhos/boca de forma que a pessoa fica irreconhecível ou os olhos ficam escondidos = severity \"severe\". Encostar na borda do cabelo ou do queixo sem cobrir feições = \"partial\" ou nem reportar.",
  "- \"hands\": só reporte quando a mão está claramente segurando/interagindo com o produto ou é o foco da composição — mãos incidentais no fundo não contam.",
  "- \"product\": elemento comercial cobrindo mais da metade do produto, ou cobrindo a parte que identifica o que o produto é (ex.: tela de um eletrônico, rótulo de uma embalagem) = \"severe\". Cobrir uma borda/sombra do produto = \"partial\".",
  "- Se não houver pessoa nem produto claramente visível na imagem, ou se nenhum elemento comercial estiver sobre eles, devolva hasViolation: false e violations: [].",
  "- Nunca reporte dois elementos cobrindo o MESMO ponto exato como violações separadas — agrupe.",
].join("\n");

function isOccludedSubjectType(value: unknown): value is OccludedSubjectType {
  return typeof value === "string" && (OCCLUDED_SUBJECT_TYPES as readonly string[]).includes(value);
}

function isOccludingElementType(value: unknown): value is OccludingElementType {
  return typeof value === "string" && (OCCLUDING_ELEMENT_TYPES as readonly string[]).includes(value);
}

/** Parser tolerante — uma violação individual malformada é descartada, nunca derruba o veredito
 * inteiro (mesmo raciocínio best-effort do resto do pipeline de visão). */
export function parseSemanticOcclusionVerdict(raw: string): SemanticOcclusionVerdict | undefined {
  try {
    const parsed = JSON.parse(raw) as { hasViolation?: unknown; violations?: unknown };
    if (typeof parsed.hasViolation !== "boolean") return undefined;
    const rawViolations = Array.isArray(parsed.violations) ? parsed.violations : [];
    const violations: SemanticOcclusionViolation[] = rawViolations
      .map((entry): SemanticOcclusionViolation | undefined => {
        if (!entry || typeof entry !== "object") return undefined;
        const candidate = entry as Record<string, unknown>;
        if (!isOccludingElementType(candidate.element) || !isOccludedSubjectType(candidate.subject)) return undefined;
        const severity = candidate.severity === "severe" ? "severe" : "partial";
        const reasoning = typeof candidate.reasoning === "string" ? candidate.reasoning : "";
        return { element: candidate.element, subject: candidate.subject, severity, reasoning };
      })
      .filter((entry): entry is SemanticOcclusionViolation => entry !== undefined);
    return { hasViolation: parsed.hasViolation, violations };
  } catch {
    return undefined;
  }
}
