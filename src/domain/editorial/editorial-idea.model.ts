/**
 * Bolsão de pautas editoriais — acervo planejado de ideias de conteúdo de UM workspace.
 *
 * Diferente do Tanque de ideias da Produção (rascunhos rápidos guardados no navegador), uma pauta
 * é uma proposta criativa completa, importada em lote, com estado editorial compartilhado pela
 * equipe e data no calendário. Uma pauta nunca é gerada nem publicada sozinha: alguém escolhe a
 * pauta e a envia ao motor criativo; a publicação continua passando pela aprovação de sempre.
 */

export const EDITORIAL_IDEA_STATUSES = ["available", "in_production", "produced", "approved", "published", "archived"] as const;
export type EditorialIdeaStatus = (typeof EDITORIAL_IDEA_STATUSES)[number];

export const EDITORIAL_IDEA_FORMATS = ["single_image", "carousel", "video"] as const;
export type EditorialIdeaFormat = (typeof EDITORIAL_IDEA_FORMATS)[number];

export const EDITORIAL_IDEA_PRIORITIES = ["high", "normal"] as const;
export type EditorialIdeaPriority = (typeof EDITORIAL_IDEA_PRIORITIES)[number];

export const EDITORIAL_IDEA_STATUS_LABEL: Readonly<Record<EditorialIdeaStatus, string>> = Object.freeze({
  available: "Disponível",
  in_production: "Em produção",
  produced: "Produzida",
  approved: "Aprovada",
  published: "Publicada",
  archived: "Arquivada",
});

export type CarouselSlide = { headline: string; body: string };
export type VideoScene = { time: string; visual: string; text: string };

export type EditorialIdeaContent = {
  /** Identificador estável dado por quem montou o pacote (ex.: "VWX-001"). Único no workspace. */
  externalId: string;
  title: string;
  category: string;
  commercialObjective: string;
  targetAudience: string;
  concept: string;
  keyMessage: string;
  format: EditorialIdeaFormat;
  /** Abordagem editorial (demonstração, comparação, pergunta provocativa...): evita que todas as
   * pautas tenham a mesma cara. */
  approach: string;
  visualDirection: string;
  narrativeStructure: string;
  carouselScript?: readonly CarouselSlide[];
  videoScript?: readonly VideoScene[];
  caption: string;
  cta: string;
  priority: EditorialIdeaPriority;
  /** Data sugerida de publicação (AAAA-MM-DD). */
  suggestedDate?: string;
  /** Prompt criativo específico desta pauta: orienta a composição/narrativa do motor criativo
   * (entra no `ideaText` do brief), sem desrespeitar as regras globais de identidade e veracidade.
   * Opcional — pautas sem prompt seguem o comportamento padrão do motor. */
  creativePrompt?: string;
  /** Imagens de referência da pauta (URLs canônicas do storage do workspace, até 6): a arte usa
   * estas imagens — nunca banco de fotos genérico — quando presentes. */
  referenceImages?: readonly string[];
};

export type EditorialIdea = EditorialIdeaContent & {
  id: string;
  tenantId: string;
  workspaceId: string;
  status: EditorialIdeaStatus;
  /** Data no calendário editorial (AAAA-MM-DD). */
  scheduledDate?: string;
  /** Execução do motor criativo disparada a partir desta pauta. */
  executionRunId?: string;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
};

export const EDITORIAL_PACK_SCHEMA = "vorix.editorial-pack/v1";
export const EDITORIAL_PACK_MAX_IDEAS = 500;

const LIMITS = {
  externalId: 40, title: 200, category: 80, commercialObjective: 300, targetAudience: 300, concept: 1500,
  keyMessage: 400, approach: 80, visualDirection: 1500, narrativeStructure: 1000, caption: 2200, cta: 120,
  slideHeadline: 160, slideBody: 500, sceneTime: 20, sceneVisual: 400, sceneText: 400, creativePrompt: 8000,
} as const;

/** Prompt criativo específico (opcional): texto longo, multilinha. Vazio vira "sem prompt". */
export function normalizeCreativePrompt(value: unknown, where = "prompt criativo"): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new EditorialPackError(`${where}: precisa ser texto.`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > LIMITS.creativePrompt) throw new EditorialPackError(`${where}: passa de ${LIMITS.creativePrompt} caracteres.`);
  return trimmed;
}

export class EditorialPackError extends Error {
  constructor(message: string) {
    super(`EDITORIAL_PACK_INVALID: ${message}`);
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function text(item: Record<string, unknown>, field: string, max: number, where: string): string {
  const value = item[field];
  if (typeof value !== "string" || !value.trim()) throw new EditorialPackError(`${where}: campo "${field}" é obrigatório.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new EditorialPackError(`${where}: campo "${field}" passa de ${max} caracteres.`);
  return trimmed;
}

function slides(value: unknown, where: string): CarouselSlide[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length < 2 || value.length > 10) throw new EditorialPackError(`${where}: o roteiro de carrossel precisa de 2 a 10 telas.`);
  return value.map((slide, index) => {
    if (!slide || typeof slide !== "object") throw new EditorialPackError(`${where}: tela ${index + 1} inválida.`);
    const record = slide as Record<string, unknown>;
    return { headline: text(record, "headline", LIMITS.slideHeadline, `${where} tela ${index + 1}`), body: text(record, "body", LIMITS.slideBody, `${where} tela ${index + 1}`) };
  });
}

function scenes(value: unknown, where: string): VideoScene[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length < 2 || value.length > 12) throw new EditorialPackError(`${where}: o roteiro de vídeo precisa de 2 a 12 cenas.`);
  return value.map((scene, index) => {
    if (!scene || typeof scene !== "object") throw new EditorialPackError(`${where}: cena ${index + 1} inválida.`);
    const record = scene as Record<string, unknown>;
    return {
      time: text(record, "time", LIMITS.sceneTime, `${where} cena ${index + 1}`),
      visual: text(record, "visual", LIMITS.sceneVisual, `${where} cena ${index + 1}`),
      text: text(record, "text", LIMITS.sceneText, `${where} cena ${index + 1}`),
    };
  });
}

/**
 * Valida um pacote de pautas (`vorix.editorial-pack/v1`) e devolve o conteúdo normalizado. Falha
 * no primeiro problema, com a posição da pauta — nunca importa metade de um pacote quebrado.
 */
export function parseEditorialPack(input: unknown): EditorialIdeaContent[] {
  if (!input || typeof input !== "object") throw new EditorialPackError("o arquivo não é um pacote de pautas.");
  const pack = input as Record<string, unknown>;
  if (pack.schema !== EDITORIAL_PACK_SCHEMA) throw new EditorialPackError(`esquema esperado "${EDITORIAL_PACK_SCHEMA}".`);
  if (!Array.isArray(pack.ideas) || pack.ideas.length === 0) throw new EditorialPackError("o pacote não tem pautas.");
  if (pack.ideas.length > EDITORIAL_PACK_MAX_IDEAS) throw new EditorialPackError(`no máximo ${EDITORIAL_PACK_MAX_IDEAS} pautas por importação.`);
  const seen = new Set<string>();
  return pack.ideas.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new EditorialPackError(`pauta ${index + 1} inválida.`);
    const item = raw as Record<string, unknown>;
    const where = `pauta ${index + 1}`;
    const externalId = text(item, "id", LIMITS.externalId, where);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(externalId)) throw new EditorialPackError(`${where}: id "${externalId}" tem caracteres inválidos.`);
    if (seen.has(externalId)) throw new EditorialPackError(`id "${externalId}" aparece duas vezes no pacote.`);
    seen.add(externalId);
    const format = item.format;
    if (!EDITORIAL_IDEA_FORMATS.includes(format as EditorialIdeaFormat)) throw new EditorialPackError(`${where}: formato "${String(format)}" inválido.`);
    const priority = item.priority ?? "normal";
    if (!EDITORIAL_IDEA_PRIORITIES.includes(priority as EditorialIdeaPriority)) throw new EditorialPackError(`${where}: prioridade "${String(priority)}" inválida.`);
    const suggestedDate = item.suggestedDate;
    if (suggestedDate !== undefined && !isIsoDate(suggestedDate)) throw new EditorialPackError(`${where}: data sugerida "${String(suggestedDate)}" inválida.`);
    const carouselScript = slides(item.carouselScript, where);
    const videoScript = scenes(item.videoScript, where);
    if (format === "carousel" && !carouselScript) throw new EditorialPackError(`${where}: carrossel sem roteiro de telas.`);
    if (format === "video" && !videoScript) throw new EditorialPackError(`${where}: vídeo sem roteiro de cenas.`);
    return {
      externalId,
      title: text(item, "title", LIMITS.title, where),
      category: text(item, "category", LIMITS.category, where),
      commercialObjective: text(item, "commercialObjective", LIMITS.commercialObjective, where),
      targetAudience: text(item, "targetAudience", LIMITS.targetAudience, where),
      concept: text(item, "concept", LIMITS.concept, where),
      keyMessage: text(item, "keyMessage", LIMITS.keyMessage, where),
      format: format as EditorialIdeaFormat,
      approach: text(item, "approach", LIMITS.approach, where),
      visualDirection: text(item, "visualDirection", LIMITS.visualDirection, where),
      narrativeStructure: text(item, "narrativeStructure", LIMITS.narrativeStructure, where),
      ...(carouselScript ? { carouselScript } : {}),
      ...(videoScript ? { videoScript } : {}),
      caption: text(item, "caption", LIMITS.caption, where),
      cta: text(item, "cta", LIMITS.cta, where),
      priority: priority as EditorialIdeaPriority,
      ...(typeof suggestedDate === "string" ? { suggestedDate } : {}),
      ...(normalizeCreativePrompt(item.creativePrompt, `${where} prompt criativo`) ? { creativePrompt: normalizeCreativePrompt(item.creativePrompt, where)! } : {}),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Cadastro manual (uma ideia por vez, pela tela)
// ---------------------------------------------------------------------------------------------

export const EDITORIAL_REFERENCE_IMAGES_MAX = 6;
export const MANUAL_EXTERNAL_ID_PREFIX = "IDEIA";

function optionalText(item: Record<string, unknown>, field: string, max: number, fallback: string): string {
  const value = item[field];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new EditorialPackError(`campo "${field}" precisa ser texto.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new EditorialPackError(`campo "${field}" passa de ${max} caracteres.`);
  return trimmed || fallback;
}

/** Lista de imagens de referência: só URLs http(s), sem repetição, no máximo 6. */
export function normalizeReferenceImages(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new EditorialPackError("imagens de referência precisam ser uma lista.");
  const urls = [...new Set(value.map((url) => (typeof url === "string" ? url.trim() : "")).filter(Boolean))];
  if (urls.length > EDITORIAL_REFERENCE_IMAGES_MAX) throw new EditorialPackError(`no máximo ${EDITORIAL_REFERENCE_IMAGES_MAX} imagens de referência por ideia.`);
  for (const url of urls) {
    if (url.length > 2000 || !/^https?:\/\//i.test(url)) throw new EditorialPackError("imagem de referência inválida.");
  }
  return urls;
}

/** Próximo código de ideia manual do workspace (IDEIA-001, IDEIA-002…), sem colidir com os existentes. */
export function nextManualExternalId(existing: readonly string[]): string {
  const pattern = new RegExp(`^${MANUAL_EXTERNAL_ID_PREFIX}-(\\d+)$`);
  const max = existing.reduce((highest, id) => Math.max(highest, Number(pattern.exec(id)?.[1] ?? 0)), 0);
  return `${MANUAL_EXTERNAL_ID_PREFIX}-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Ideia cadastrada à mão. Diferente do pacote importado, só o essencial é obrigatório (título e
 * formato; carrossel precisa das telas): o resto ganha um padrão derivado do próprio título, para
 * cadastrar rápido sem formulário gigante. Vídeo pode entrar sem roteiro de cenas.
 */
export function parseManualEditorialIdea(input: unknown, externalId: string): EditorialIdeaContent {
  if (!input || typeof input !== "object") throw new EditorialPackError("ideia inválida.");
  const item = input as Record<string, unknown>;
  if (typeof item.title !== "string" || !item.title.trim()) throw new EditorialPackError("dê um título para a ideia.");
  const title = text(item, "title", LIMITS.title, "ideia");
  const format = item.format;
  if (!EDITORIAL_IDEA_FORMATS.includes(format as EditorialIdeaFormat)) throw new EditorialPackError(`formato "${String(format)}" inválido.`);
  const priority = item.priority ?? "normal";
  if (!EDITORIAL_IDEA_PRIORITIES.includes(priority as EditorialIdeaPriority)) throw new EditorialPackError(`prioridade "${String(priority)}" inválida.`);
  const carouselScript = format === "carousel" ? slides(item.carouselScript, "ideia") : undefined;
  if (format === "carousel" && !carouselScript) throw new EditorialPackError("carrossel precisa de 2 a 10 telas.");
  const videoScript = format === "video" && item.videoScript ? scenes(item.videoScript, "ideia") : undefined;
  const keyMessage = optionalText(item, "keyMessage", LIMITS.keyMessage, title);
  const creativePrompt = normalizeCreativePrompt(item.creativePrompt);
  const referenceImages = normalizeReferenceImages(item.referenceImages);
  return {
    externalId,
    title,
    category: optionalText(item, "category", LIMITS.category, "Geral"),
    commercialObjective: optionalText(item, "commercialObjective", LIMITS.commercialObjective, "Engajar e atrair clientes"),
    targetAudience: optionalText(item, "targetAudience", LIMITS.targetAudience, "Público da marca"),
    concept: optionalText(item, "concept", LIMITS.concept, keyMessage),
    keyMessage,
    format: format as EditorialIdeaFormat,
    approach: optionalText(item, "approach", LIMITS.approach, "Cadastro manual"),
    visualDirection: optionalText(item, "visualDirection", LIMITS.visualDirection, referenceImages.length ? "Usar as imagens de referência da ideia." : "Seguir a identidade visual da marca."),
    narrativeStructure: optionalText(item, "narrativeStructure", LIMITS.narrativeStructure, keyMessage),
    ...(carouselScript ? { carouselScript } : {}),
    ...(videoScript ? { videoScript } : {}),
    caption: optionalText(item, "caption", LIMITS.caption, keyMessage),
    cta: optionalText(item, "cta", LIMITS.cta, "Saiba mais no link da bio"),
    priority: priority as EditorialIdeaPriority,
    ...(creativePrompt ? { creativePrompt } : {}),
    ...(referenceImages.length ? { referenceImages } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Calendário editorial
// ---------------------------------------------------------------------------------------------

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Dias úteis (segunda a sexta) de `[startDate, startDate + days)`. */
export function businessDays(startDate: string, days: number): string[] {
  const result: string[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(startDate, offset);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday >= 1 && weekday <= 5) result.push(date);
  }
  return result;
}

export type CalendarAssignment = { ideaId: string; date: string };

/**
 * Cronograma inicial: uma pauta por dia útil (5 por semana) na janela pedida. Datas já ocupadas por
 * pautas agendadas continuam onde estão (rodar de novo não bagunça nada); os dias livres recebem
 * pautas disponíveis, na ordem da data sugerida e da prioridade, evitando repetir a categoria do
 * dia anterior e o formato dos dois dias anteriores sempre que houver alternativa.
 */
export function buildEditorialCalendar(ideas: readonly EditorialIdea[], input: { startDate: string; days: number }): CalendarAssignment[] {
  const dates = businessDays(input.startDate, input.days);
  const taken = new Map<string, EditorialIdea>();
  for (const idea of ideas) if (idea.scheduledDate && dates.includes(idea.scheduledDate) && idea.status !== "archived") taken.set(idea.scheduledDate, idea);
  const pool = ideas
    .filter((idea) => idea.status === "available" && !idea.scheduledDate)
    .sort((a, b) => (a.suggestedDate ?? "9999").localeCompare(b.suggestedDate ?? "9999") || (a.priority === b.priority ? 0 : a.priority === "high" ? -1 : 1) || a.externalId.localeCompare(b.externalId));
  const assignments: CalendarAssignment[] = [];
  const history: EditorialIdea[] = [];
  for (const date of dates) {
    const fixed = taken.get(date);
    if (fixed) { history.push(fixed); continue; }
    if (pool.length === 0) break;
    const previous = history[history.length - 1];
    const before = history[history.length - 2];
    const sameFormatRun = previous && before && previous.format === before.format ? previous.format : undefined;
    const pick = pool.findIndex((idea) => idea.category !== previous?.category && idea.format !== sameFormatRun);
    const index = pick >= 0 ? pick : Math.max(0, pool.findIndex((idea) => idea.category !== previous?.category));
    const [chosen] = pool.splice(index, 1);
    assignments.push({ ideaId: chosen.id, date });
    history.push(chosen);
  }
  return assignments;
}

// ---------------------------------------------------------------------------------------------
// Envio ao motor criativo
// ---------------------------------------------------------------------------------------------

export type EditorialGenerationBrief = {
  name: string;
  objective: string;
  ideaText: string;
  targetAudience: string;
  format: Exclude<EditorialIdeaFormat, "video">;
};

/** O motor criativo de ideias gera imagem única e carrossel; vídeo segue para produção manual. */
export function isGeneratableFormat(format: EditorialIdeaFormat): format is Exclude<EditorialIdeaFormat, "video"> {
  return format !== "video";
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Brief enviado ao motor criativo existente (mesma rota da Produção). A identidade visual, a
 * paleta, o logotipo e as diretrizes criativas do workspace são aplicados pelo próprio motor; aqui
 * vai só o conceito da pauta, para a IA variar a composição sem descaracterizar a ideia.
 */
/** Orçamento de caracteres do `ideaText` (bate com o maxLength do schema de `POST /production/ideas/generate`). */
export const EDITORIAL_IDEA_TEXT_BUDGET = 8000;

export function buildEditorialGenerationBrief(idea: EditorialIdeaContent): EditorialGenerationBrief {
  if (!isGeneratableFormat(idea.format)) throw new Error("EDITORIAL_FORMAT_NOT_GENERATABLE: pautas de vídeo seguem para produção manual.");
  // O fecho (CTA e a regra de não inventar nada) sempre vai inteiro; quem encolhe é o miolo.
  const references = idea.referenceImages?.length
    ? "\nUse as imagens de referência anexadas como base visual da arte (não troque por banco de fotos genérico)."
    : "";
  const closing = `CTA: ${idea.cta}\nUse apenas capacidades reais da marca; não invente números, preços, integrações ou depoimentos.${references}`;
  const structure = idea.carouselScript
    ? `Telas: ${idea.carouselScript.map((slide, index) => `${index + 1}) ${slide.headline} — ${slide.body}`).join(" ")}`
    : `Estrutura: ${idea.narrativeStructure}`;
  // Com prompt próprio: ele é a direção dominante de composição/narrativa. Um cabeçalho curto
  // preserva o vínculo com a pauta (id, título, mensagem, roteiro); o prompt vem logo em seguida.
  // Sem prompt: comportamento padrão (conceito + direção visual da pauta).
  const body = idea.creativePrompt
    ? [
        `Pauta ${idea.externalId} — ${idea.title}`,
        `Mensagem principal: ${idea.keyMessage}`,
        structure,
        "",
        "PROMPT CRIATIVO ESPECÍFICO (direção dominante de arte e narrativa):",
        idea.creativePrompt,
      ].join("\n")
    : [
        `Pauta ${idea.externalId} — ${idea.title}`,
        `Mensagem principal: ${idea.keyMessage}`,
        structure,
        `Conceito: ${idea.concept}`,
        `Direção visual: ${idea.visualDirection}`,
      ].join("\n");
  return {
    name: clip(idea.title, 200),
    objective: clip(idea.commercialObjective, 300),
    ideaText: `${clip(body, EDITORIAL_IDEA_TEXT_BUDGET - closing.length - 1)}\n${closing}`,
    targetAudience: clip(idea.targetAudience, 300),
    format: idea.format,
  };
}
