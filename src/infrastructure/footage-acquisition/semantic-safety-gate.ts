import { hasReached, type VisualValidationStage } from "./visual-validation-stage.js";

/**
 * FOOTAGE VISUAL VALIDATION 2.0 — Semantic Safety Gate (seção 5). Bloqueia candidatos
 * semanticamente incompatíveis com o Shot ANTES do download (usando o único texto real que o
 * Pexels devolve por resultado — o slug legível da própria `originPageUrl`, ex.:
 * "https://www.pexels.com/video/children-out-in-the-street-trick-or-treating-5856446/") e
 * novamente DEPOIS da análise visual (combinando sinal textual + sinal visual).
 *
 * PRINCÍPIO DE HONESTIDADE: a API do Pexels não devolve descrição/tags por vídeo (confirmado ao
 * implementar a Intent-Based Footage Acquisition) — mas `video.url` (que vira `originPageUrl`)
 * SEMPRE carrega um slug textual descritivo, gerado pelo próprio Pexels a partir do conteúdo real
 * do vídeo. Esta é a evidência de dois dos três falsos positivos comprovados da sprint anterior:
 * o vídeo confundido com "tela" era, na verdade, "children out in the street trick-or-treating"
 * (Halloween) — um simples bloqueio léxico pré-download já teria evitado o download inteiro. A
 * "análise assistida pela IA desenvolvedora" citada na sprint existe hoje só como um mecanismo de
 * pausa/retomada acoplado ao contrato de Skill (`DeveloperAssistedIcaroProvider`, ver
 * `developer-ai-assistance.ts`) — inadequado para um fluxo de CLI em lote como este. Por isso este
 * gate expõe um ponto de extensão opcional (`assistedTextClassifier`) para uso futuro, mas nunca o
 * inventa nem finge chamá-lo quando `undefined` (nenhum resultado é rejeitado/aprovado por uma
 * chamada que não aconteceu).
 */

export type SemanticSafetyVerdict = {
  blocked: boolean;
  riskFlag: boolean;
  reason?: string;
  matchedKeyword?: string;
};

export type AssistedTextClassifier = (text: string) => Promise<{ suspicious: boolean; reason?: string } | undefined>;

const COSTUME_HALLOWEEN_DENYLIST: RegExp[] = [
  /halloween/i, /trick.?or.?treat/i, /costume/i, /fantasia/i, /witch/i, /vampire/i, /zombie/i, /cosplay/i, /\bghost\b/i, /werewolf/i,
];

/** Bloqueado só quando o Shot NÃO é, ele mesmo, sobre cerimônia/casamento — o mesmo tipo de erro do bug original desta saga ("priest praying" retornado para um Shot de "couple using phone"). */
const RELIGIOUS_MISMATCH_DENYLIST: RegExp[] = [
  /\bprayer\b/i, /\bpraying\b/i, /\bpriest\b/i, /\bchurch service\b/i, /\bsermon\b/i, /\bworship\b/i, /\bmonk\b/i, /\btemple ritual\b/i,
];

/** Objetos com formato retangular que a heurística de brilho/contraste do Visual Candidate Validator historicamente confunde com tela — nunca bloqueia sozinho, só força revisão humana quando combinado com um sinal visual positivo (seção 5: "Nunca aprovar apenas porque existe uma região retangular brilhante"). */
const SCREEN_MIMICKING_OBJECT_PATTERNS: RegExp[] = [
  /\bpainting\b/i, /\bpicture frame\b/i, /\bframed\b/i, /\bwindow\b/i, /\btelevision\b/i, /\b(?<!smart)tv\b/i, /\bbillboard\b/i, /\bposter\b/i, /\bmonitor\b/i, /\bmirror\b/i,
];

const CEREMONY_CONTEXT_PATTERN = /cerimonia|ceremony|casamento|wedding|altar|igreja|church/i;

function extractSlugText(originPageUrl: string): string {
  try {
    const url = new URL(originPageUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    const slug = segments[segments.length - 1] ?? "";
    return slug.replace(/-\d+$/, "").replace(/[-_]+/g, " ").trim();
  } catch {
    return "";
  }
}

export type SemanticShotContext = { narrativeGoal?: string; mainAction?: string; protagonist?: string };

/** Seção 5, checkpoint 1 — roda ANTES do download, usando só o texto já disponível no resultado de busca (`hit.originPageUrl`). Nunca inventa texto: quando a URL não segue o padrão esperado, `extractSlugText` devolve string vazia e nada é bloqueado por falta de evidência (na dúvida, deixa passar para a validação visual/pré-composição decidir). `shotContext` é opcional (caminhos ad-hoc como `--media-acquire <resultId>` não têm um Shot Plan associado) — sem ele, a checagem de descarte religioso (que depende de saber se O PRÓPRIO Shot é sobre cerimônia) é pulada por segurança, nunca aplicada com um contexto adivinhado. */
export function evaluateSemanticSafetyPreDownload(input: { originPageUrl: string; shotContext?: SemanticShotContext }): SemanticSafetyVerdict {
  const text = extractSlugText(input.originPageUrl);
  if (!text) return { blocked: false, riskFlag: false };

  const costumeMatch = COSTUME_HALLOWEEN_DENYLIST.find((pattern) => pattern.test(text));
  if (costumeMatch) {
    return {
      blocked: true,
      riskFlag: false,
      reason: `Título do candidato ("${text}") indica fantasia/Halloween — semanticamente incompatível com qualquer Shot desta campanha.`,
      matchedKeyword: costumeMatch.source,
    };
  }

  if (input.shotContext) {
    const shotIsAboutCeremony = CEREMONY_CONTEXT_PATTERN.test(`${input.shotContext.narrativeGoal ?? ""} ${input.shotContext.mainAction ?? ""} ${input.shotContext.protagonist ?? ""}`);
    if (!shotIsAboutCeremony) {
      const religiousMatch = RELIGIOUS_MISMATCH_DENYLIST.find((pattern) => pattern.test(text));
      if (religiousMatch) {
        return {
          blocked: true,
          riskFlag: false,
          reason: `Título do candidato ("${text}") indica conteúdo religioso, mas este Shot não é sobre cerimônia — mesmo tipo de erro já documentado (busca por tema retornando "padre rezando" para um Shot de "casal usando celular").`,
          matchedKeyword: religiousMatch.source,
        };
      }
    }
  }

  const mimickingMatch = SCREEN_MIMICKING_OBJECT_PATTERNS.find((pattern) => pattern.test(text));
  if (mimickingMatch) {
    return {
      blocked: false,
      riskFlag: true,
      reason: `Título do candidato ("${text}") menciona um objeto com formato semelhante a tela (quadro/janela/TV/pôster/espelho) — não bloqueado sozinho, mas combinado com qualquer detecção visual positiva de "tela" exige revisão humana.`,
      matchedKeyword: mimickingMatch.source,
    };
  }

  return { blocked: false, riskFlag: false };
}

/** Seção 5, checkpoint 2 — roda DEPOIS da análise visual, combinando o `riskFlag` textual do checkpoint 1 com o estágio já calculado pelo Visual Candidate Validator. Só força `needs_human_review`; nunca reverte um estágio automático para `compositing_ready` nem rejeita sozinho (a decisão final de rejeitar por risco semântico + visual combinado continua sendo humana). */
export function evaluateSemanticSafetyPostAnalysis(input: { riskFlag: boolean; visualStage: VisualValidationStage }): { forceHumanReview: boolean; reason?: string } {
  if (input.riskFlag && hasReached(input.visualStage, "screen_visible")) {
    return {
      forceHumanReview: true,
      reason: "Sinal textual de objeto que mimetiza tela (seção 5) combinado com detecção visual positiva de tela — risco elevado de falso positivo, revisão humana obrigatória antes de considerar compositing_ready.",
    };
  }
  return { forceHumanReview: false };
}

/**
 * Ponto de extensão opcional para "análise assistida pela IA desenvolvedora quando necessário"
 * (seção 5). Nunca chamado automaticamente por este módulo — só existe para que um caller (CLI)
 * possa, no futuro, injetar um classificador real sem precisar reabrir este arquivo. `undefined`
 * (o padrão) significa que nenhuma chamada assistida acontece, nunca que uma aconteceu e disse
 * "ok".
 */
export async function runAssistedSemanticCheckIfConfigured(text: string, classifier?: AssistedTextClassifier): Promise<{ suspicious: boolean; reason?: string } | undefined> {
  if (!classifier) return undefined;
  return classifier(text);
}
