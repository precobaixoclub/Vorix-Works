/**
 * Gosto da marca em vídeo — preferências e reprovações ESPECÍFICAS registradas por pessoas.
 *
 * O Quality Gate técnico continua verificando integridade (decodificação, quadros pretos, áudio,
 * loudness). O PADRÃO COMERCIAL não é declarado por máquina: só uma avaliação humana aprova
 * editorialmente uma versão, e cada reprovação diz O QUE estava errado (padrões do vocabulário
 * abaixo + nota livre). O diretor criativo recebe esse histórico e a seleção de propostas penaliza
 * padrões reprovados pela marca. A opinião do Codex é consultiva e nunca aprova sozinha.
 */

export const VIDEO_TASTE_PATTERNS = {
  foto_em_cartao_sobre_fundo_desfocado: "Foto em cartão flutuando sobre fundo escuro desfocado",
  cartoes_de_foto: "Cartões/grade de fotos na mesma tela",
  cena_estatica_longa: "Cena parada longa",
  slideshow: "Cara de slideshow (foto, zoom, foto)",
  quadro_vazio: "Quadro vazio/escuro sem conteúdo",
  texto_centralizado: "Todo texto centralizado",
  tipografia_inconsistente: "Tipografia muda de cena para cena",
  cartao_final_generico: "Cartão final genérico (igual para toda marca)",
  trilha_sintetica_fraca: "Trilha fraca/artificial",
  transicoes_variadas: "Transições demais/diferentes",
  gancho_fraco: "Gancho fraco nos primeiros segundos",
  produto_pequeno: "Produto pequeno no quadro",
  estampa_alterada: "Estampa/cor do produto alterada",
  montagem_da_estampa: "Estampa montada/desenhada em motion",
  troca_de_cor_com_match: "Troca de cor com a estampa travada no lugar",
  gancho_tipografico: "Gancho tipográfico gigante no 1º quadro",
  fundo_escuro: "Fundo escuro com um acento",
  legenda_em_pilula: "Legenda em pílula que acende",
} as const;
export type VideoTastePattern = keyof typeof VIDEO_TASTE_PATTERNS;
export const isVideoTastePattern = (value: string): value is VideoTastePattern => Object.prototype.hasOwnProperty.call(VIDEO_TASTE_PATTERNS, value);

export type VideoFeedbackVerdict = "approved" | "rejected";
export type VideoBrandFeedback = {
  id: string;
  tenantId: string;
  workspaceId: string;
  projectId?: string;
  versionId?: string;
  verdict: VideoFeedbackVerdict;
  /** O que foi aprovado (gostei disto) ou reprovado (o problema era isto). */
  patterns: VideoTastePattern[];
  note?: string;
  reviewerId: string;
  createdAt: string;
};

export type BrandTaste = { preferred: VideoTastePattern[]; rejected: VideoTastePattern[]; notes: string[]; reviews: number };

/**
 * Preferências da marca a partir das avaliações: um padrão REPROVADO mais vezes do que aprovado vira
 * proibido; um aprovado sem reprovação vira preferido. As notas mais recentes vão inteiras ao diretor.
 */
export function deriveBrandTaste(feedback: readonly VideoBrandFeedback[], maxNotes = 6): BrandTaste {
  const score = new Map<VideoTastePattern, { up: number; down: number }>();
  for (const item of feedback) {
    for (const pattern of item.patterns) {
      const s = score.get(pattern) ?? { up: 0, down: 0 };
      if (item.verdict === "approved") s.up += 1; else s.down += 1;
      score.set(pattern, s);
    }
  }
  const rejected = [...score].filter(([, s]) => s.down > 0 && s.down >= s.up).map(([p]) => p);
  const preferred = [...score].filter(([, s]) => s.up > 0 && s.down === 0).map(([p]) => p);
  const notes = [...feedback].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((f) => f.note).slice(0, maxNotes).map((f) => `${f.verdict === "approved" ? "Aprovado" : "Reprovado"}: ${f.note}`);
  return { preferred, rejected, notes, reviews: feedback.length };
}

export type EditorialVerdict = { status: "blocked_technical" | "awaiting_human" | "approved_commercial" | "rejected"; reason: string };

/**
 * Situação editorial de UMA versão. Ordem: integridade técnica primeiro; depois só a pessoa decide.
 * `advisory` (ex.: revisão do Codex) entra como observação e NUNCA aprova.
 */
export function editorialVerdict(input: { technical: "ready_for_review" | "needs_revision" | string; feedback: readonly VideoBrandFeedback[]; advisory?: string }): EditorialVerdict {
  if (input.technical !== "ready_for_review") return { status: "blocked_technical", reason: "O Quality Gate técnico reprovou a versão." };
  const last = [...input.feedback].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!last) return { status: "awaiting_human", reason: `Aguardando avaliação humana.${input.advisory ? ` Observação consultiva: ${input.advisory}` : ""}` };
  if (last.verdict === "approved") return { status: "approved_commercial", reason: `Aprovado por pessoa em ${last.createdAt.slice(0, 10)}.` };
  return { status: "rejected", reason: `Reprovado: ${last.patterns.map((p) => VIDEO_TASTE_PATTERNS[p]).join("; ") || "sem padrão marcado"}${last.note ? ` — ${last.note}` : ""}` };
}

export function normalizeFeedbackInput(input: { verdict?: unknown; patterns?: unknown; note?: unknown }): { verdict: VideoFeedbackVerdict; patterns: VideoTastePattern[]; note?: string } {
  if (input.verdict !== "approved" && input.verdict !== "rejected") throw new Error("VIDEO_FEEDBACK_INVALID: veredito precisa ser approved ou rejected.");
  const patterns = Array.isArray(input.patterns) ? [...new Set(input.patterns.filter((p): p is string => typeof p === "string").filter(isVideoTastePattern))] : [];
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
  if (input.verdict === "rejected" && !patterns.length && !note) throw new Error("VIDEO_FEEDBACK_INVALID: diga o que estava errado (um padrão ou uma nota).");
  return { verdict: input.verdict, patterns, ...(note ? { note } : {}) };
}
