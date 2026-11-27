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
  narracao_artificial: "Narração artificial/robótica",
  pausas_inadequadas: "Pausas fora do lugar",
  ritmo_inconsistente: "Ritmo inconsistente",
  cenas_redundantes: "Cenas visualmente redundantes",
  movimento_sem_intencao: "Movimento sem intenção",
  audio_desequilibrado: "Áudio desequilibrado (voz × trilha)",
  sem_progressao: "Falta de progressão",
  encerramento_fraco: "Encerramento fraco",
  revelacao_antecipada: "Revela antes da hora (quebra o mistério)",
  narracao_envolvente: "Narração envolvente",
  trilha_com_identidade: "Trilha com identidade",
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

export type BrandTaste = { preferred: string[]; rejected: string[]; notes: string[]; reviews: number; observed: string[] };

/**
 * Avaliações da tela → eventos da MEMÓRIA CRIATIVA existente (`creative-engine/creative-memory.ts`), a
 * mesma que lê as aprovações do WhatsApp. O projeto de vídeo conta como "pauta" (2 reprovações da
 * mesma versão/pauta não viram regra da marca). O motivo junta a nota e os rótulos dos padrões, para a
 * leitura por categoria (voz, ritmo, trilha…) funcionar igual à do WhatsApp.
 */
export function videoFeedbackEvents(feedback: readonly VideoBrandFeedback[]) {
  return feedback.map((f) => ({
    workspaceId: f.workspaceId,
    publicationId: f.versionId ?? f.id,
    ...(f.projectId ? { ideaId: f.projectId } : {}),
    decision: f.verdict === "approved" ? ("approve" as const) : ("reject" as const),
    reason: [f.note, ...f.patterns.map((p) => VIDEO_TASTE_PATTERNS[p])].filter(Boolean).join(". "),
    at: f.createdAt,
    format: "video" as const,
    archetypes: [] as string[],
    productCodes: [] as string[],
    patterns: f.patterns,
    source: "video_review" as const,
  }));
}

/** Gosto da marca lido da memória criativa (só o que se repetiu; o pontual fica em `observed`). */
export function tasteFromMemory(memory: { videoPatterns?: { avoid: string[]; prefer: string[]; observed: string[] }; lessons: { guidance: string; appliesTo: string[] }[]; sample: { approved: number; rejected: number; ignored: number } }): BrandTaste {
  return {
    preferred: memory.videoPatterns?.prefer ?? [],
    rejected: memory.videoPatterns?.avoid ?? [],
    observed: memory.videoPatterns?.observed ?? [],
    notes: memory.lessons.filter((l) => l.appliesTo.includes("video")).map((l) => l.guidance),
    reviews: memory.sample.approved + memory.sample.rejected + memory.sample.ignored,
  };
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
