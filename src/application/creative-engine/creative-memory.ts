import { FEEDBACK_CATEGORY_LABELS, IMAGE_CATEGORIES, interpretRejection, type FeedbackCategory } from "./feedback-interpretation.js";

/**
 * Memória criativa por marca — o que o cliente aprovou e reprovou pelo WhatsApp, transformado em orientação
 * para as próximas peças. A matéria-prima já existe: cada pedido de aprovação guarda a decisão e o motivo,
 * e cada publicação guarda as linguagens visuais por tela e os produtos usados. Aqui só se agrega.
 *
 * Regras para não engessar a marca:
 * - um erro vira aprendizado só quando se repete em pelo menos DUAS pautas diferentes (refazer a mesma
 *   pauta duas vezes pelo mesmo motivo é uma preferência daquela peça, não da marca);
 * - pedido pontual ("só desta vez", "hoje") e "não quero postar" nunca viram aprendizado;
 * - tudo expira: só valem decisões da janela recente (60 dias); sem nova ocorrência, a lição some;
 * - linguagem visual reprovada perde pontos na escolha, nunca é proibida (proibir é decisão da marca,
 *   em `avoidArchetypes`); aprovada várias vezes ganha um pouco, sem atropelar a variedade.
 * - isolamento: a memória é montada só com eventos do workspace pedido.
 */

export type CreativeFeedbackEvent = {
  workspaceId: string;
  publicationId: string;
  ideaId?: string;
  decision: "approve" | "reject";
  reason?: string;
  at: string;
  format: "single_image" | "carousel" | "video";
  /** Linguagem visual (arquétipo) de cada tela, na ordem. */
  archetypes: readonly string[];
  productCodes: readonly string[];
};

export type LessonTarget = "image" | "video" | "redo";

export type CreativeLesson = {
  category: FeedbackCategory;
  label: string;
  /** Pautas diferentes em que o problema apareceu. */
  occurrences: number;
  lastAt: string;
  examples: string[];
  guidance: string;
  appliesTo: LessonTarget[];
};

export type CreativeMemory = {
  workspaceId: string;
  windowDays: number;
  sample: { approved: number; rejected: number; ignored: number };
  /** Erros recorrentes (≥ 2 pautas): entram nas próximas gerações. */
  lessons: CreativeLesson[];
  /** Vistos uma vez só: registrados, mas NÃO aplicados (preferência pontual). */
  observed: Array<{ category: FeedbackCategory; label: string; lastAt: string; example?: string }>;
  /** Ajuste de pontuação por linguagem visual (negativo = reprovada de forma recorrente). */
  archetypeBias: Record<string, number>;
  /** Peças reprovadas por produto em pautas diferentes: vão para o fim do rodízio (não são bloqueadas). */
  avoidProducts: string[];
};

export const MEMORY_WINDOW_DAYS = 60;
export const MEMORY_MIN_DISTINCT_IDEAS = 2;
const MAX_EXAMPLES = 3;

const GUIDANCE: Record<FeedbackCategory, { text: string; appliesTo: LessonTarget[] }> = {
  texto: { text: "Texto da arte: frase curta e natural, que um brasileiro diria — sem tradução literal nem trocadilho forçado.", appliesTo: ["redo", "video"] },
  legenda: { text: "Legenda: direta, no tom da marca, sem repetir o texto da arte.", appliesTo: ["redo"] },
  imagem: { text: "Imagem: o assunto da pauta precisa estar claro e bem resolvido na cena.", appliesTo: ["image", "video"] },
  imagem_vazia: { text: "Toda tela precisa de uma imagem com assunto visível ocupando a cena — nunca fundo liso com texto no canto.", appliesTo: ["image", "video"] },
  cores: { text: "Cores: siga a paleta da marca com contraste e intenção; nada apagado ou fora da paleta.", appliesTo: ["image", "video"] },
  pessoas: { text: "Pessoas: naturais e coerentes com o público da marca; rostos e mãos sem deformação.", appliesTo: ["image", "video"] },
  estilo_visual: { text: "Estilo: fuja do visual genérico de banco de imagens; uma ideia visual própria da marca.", appliesTo: ["image", "video"] },
  qualidade_imagem: { text: "Qualidade: imagem nítida, sem recorte serrilhado, emenda visível ou distorção.", appliesTo: ["image", "video"] },
  produto: { text: "Produto: a peça mostrada precisa combinar com o assunto da pauta.", appliesTo: ["image", "redo"] },
  logo: { text: "Logo: versão oficial, legível e discreta, sem caixa pesada.", appliesTo: ["image", "video"] },
  repeticao: { text: "Variedade: mude enquadramento e linguagem em relação às peças recentes.", appliesTo: ["image", "video"] },
  informacao: { text: "Informação: nunca invente preço, prazo, promoção ou característica que a pauta não traz.", appliesTo: ["redo", "video"] },
  audio: { text: "Áudio: música abaixo da fala, sem estourar, narração clara.", appliesTo: ["video"] },
};

const cleanExample = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/["“”]/g, "'").replace(/\s+/g, " ").trim().slice(0, 120);

/** Linhas do banco (pedido de aprovação + publicação) → eventos. Linha sem decisão é descartada. */
export function feedbackEventsFromRows(rows: ReadonlyArray<Record<string, unknown>>): CreativeFeedbackEvent[] {
  const events: CreativeFeedbackEvent[] = [];
  for (const row of rows) {
    const decision = row.decision === "approve" || row.decision === "reject" ? row.decision : undefined;
    const workspaceId = typeof row.workspace_id === "string" ? row.workspace_id : undefined;
    const publicationId = typeof row.publication_id === "string" ? row.publication_id : undefined;
    if (!decision || !workspaceId || !publicationId) continue;
    const payload = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>;
    const creative = (payload.creative && typeof payload.creative === "object" ? payload.creative : {}) as Record<string, unknown>;
    const archetypes = Array.isArray(creative.archetypes) ? creative.archetypes.map(String) : [];
    const images = Array.isArray(payload.imageUrls) ? payload.imageUrls.length : 0;
    const at = row.decided_at instanceof Date ? row.decided_at.toISOString() : typeof row.decided_at === "string" ? row.decided_at : undefined;
    if (!at) continue;
    events.push({
      workspaceId, publicationId, decision, at,
      ...(typeof payload.editorialIdeaId === "string" ? { ideaId: payload.editorialIdeaId } : {}),
      ...(typeof row.reason === "string" && row.reason.trim() ? { reason: row.reason.trim() } : {}),
      format: payload.format === "video" ? "video" : Math.max(images, archetypes.length) > 1 ? "carousel" : "single_image",
      archetypes,
      productCodes: Array.isArray(payload.catalogProductCodes) ? payload.catalogProductCodes.map(String) : [],
    });
  }
  return events;
}

export function buildCreativeMemory(
  events: readonly CreativeFeedbackEvent[],
  options: { workspaceId: string; now?: Date; windowDays?: number; minDistinctIdeas?: number },
): CreativeMemory {
  const windowDays = options.windowDays ?? MEMORY_WINDOW_DAYS;
  const minDistinct = options.minDistinctIdeas ?? MEMORY_MIN_DISTINCT_IDEAS;
  const since = (options.now ?? new Date()).getTime() - windowDays * 86_400_000;
  const recent = events
    .filter((event) => event.workspaceId === options.workspaceId && Date.parse(event.at) >= since)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const sample = { approved: 0, rejected: 0, ignored: 0 };
  const byCategory = new Map<FeedbackCategory, { ideas: Set<string>; examples: string[]; lastAt: string }>();
  const archetypeRejections = new Map<string, Set<string>>();
  const archetypeApprovals = new Map<string, number>();
  const productRejections = new Map<string, Set<string>>();
  for (const event of recent) {
    const idea = event.ideaId ?? event.publicationId;
    if (event.decision === "approve") {
      sample.approved += 1;
      for (const archetype of new Set(event.archetypes)) archetypeApprovals.set(archetype, (archetypeApprovals.get(archetype) ?? 0) + 1);
      continue;
    }
    const reading = interpretRejection(event.reason, { screenCount: Math.max(1, event.archetypes.length) });
    // Sem motivo, "não quero postar" ou pedido pontual: a reprovação fica registrada, mas não ensina nada.
    if (!event.reason || reading.noRedo || reading.oneOff || reading.unclear) { sample.ignored += 1; continue; }
    sample.rejected += 1;
    for (const category of reading.categories) {
      const entry = byCategory.get(category) ?? { ideas: new Set<string>(), examples: [], lastAt: event.at };
      entry.ideas.add(idea);
      const example = cleanExample(event.reason);
      if (entry.examples.length < MAX_EXAMPLES && !entry.examples.includes(example)) entry.examples.push(example);
      byCategory.set(category, entry);
    }
    if (reading.categories.some((category) => IMAGE_CATEGORIES.includes(category))) {
      const screens = Array.isArray(reading.screens) ? reading.screens : undefined;
      const blamed = screens ? screens.map((screen) => event.archetypes[screen - 1]).filter(Boolean) : event.archetypes;
      for (const archetype of new Set(blamed)) {
        const set = archetypeRejections.get(archetype) ?? new Set<string>();
        set.add(idea);
        archetypeRejections.set(archetype, set);
      }
    }
    if (reading.categories.includes("produto")) {
      for (const code of new Set(event.productCodes)) {
        const set = productRejections.get(code) ?? new Set<string>();
        set.add(idea);
        productRejections.set(code, set);
      }
    }
  }
  const lessons: CreativeLesson[] = [];
  const observed: CreativeMemory["observed"] = [];
  for (const [category, entry] of byCategory) {
    const label = FEEDBACK_CATEGORY_LABELS[category];
    if (entry.ideas.size >= minDistinct) {
      const guidance = `${GUIDANCE[category].text} Já reprovado ${entry.ideas.size}x: ${entry.examples.map((example) => `"${example}"`).join("; ")}.`;
      lessons.push({ category, label, occurrences: entry.ideas.size, lastAt: entry.lastAt, examples: entry.examples, guidance, appliesTo: GUIDANCE[category].appliesTo });
    } else {
      observed.push({ category, label, lastAt: entry.lastAt, ...(entry.examples[0] ? { example: entry.examples[0] } : {}) });
    }
  }
  lessons.sort((a, b) => b.occurrences - a.occurrences || b.lastAt.localeCompare(a.lastAt));
  const archetypeBias: Record<string, number> = {};
  for (const archetype of new Set([...archetypeRejections.keys(), ...archetypeApprovals.keys()])) {
    const rejected = archetypeRejections.get(archetype)?.size ?? 0;
    const approved = archetypeApprovals.get(archetype) ?? 0;
    const net = rejected - approved * 0.5;
    const bias = rejected >= minDistinct && net > 0 ? -Math.min(1.8, 0.9 * net)
      : rejected === 0 && approved >= 2 ? Math.min(0.5, 0.15 * approved) : 0;
    if (bias) archetypeBias[archetype] = Number(bias.toFixed(2));
  }
  const avoidProducts = [...productRejections].filter(([, ideas]) => ideas.size >= minDistinct).map(([code]) => code).sort();
  return { workspaceId: options.workspaceId, windowDays, sample, lessons, observed, archetypeBias, avoidProducts };
}

/** Orientações da memória para um motor (imagem/carrossel, vídeo ou a reescrita da refação). */
export function memoryGuidance(memory: CreativeMemory | undefined, target: LessonTarget): string[] {
  return (memory?.lessons ?? []).filter((lesson) => lesson.appliesTo.includes(target)).slice(0, 5).map((lesson) => lesson.guidance);
}

/** Rodízio de produtos com a memória: peças reprovadas por produto em pautas diferentes vão para o fim. */
export function applyProductMemory(codes: readonly string[], memory: CreativeMemory | undefined): string[] {
  const avoid = new Set(memory?.avoidProducts ?? []);
  return [...codes.filter((code) => !avoid.has(code)), ...codes.filter((code) => avoid.has(code))];
}
