import { z } from "zod";
import { validSourceRegion } from "../../../domain/video-editing/video-edit-plan.js";

/**
 * `VideoEditDraftV1` — operação `video_edit_planning`. A IA decide a edição em ALTO NÍVEL: ordem
 * das cenas, ritmo, movimento, transições, textos, legendas, trilha e logo. Ela nunca escreve
 * números de corte, caminhos, comandos ou fala: trechos de vídeo são escolhidos por id das frases
 * da transcrição, e o construtor determinístico (`build-plan-from-draft.ts`) calcula o resto.
 */

export const VIDEO_EDIT_DRAFT_SCHEMA_VERSION = 1;

const SCENE_PURPOSES = ["hook", "product", "detail", "benefit", "proof", "variety", "demo", "context", "cta"] as const;
const MOTIONS = ["static", "push_in", "pull_out", "pan_left", "pan_right", "pan_up", "pan_down", "punch_in", "drift"] as const;
const LAYOUTS = ["full", "framed", "split", "parallax", "inset", "device_phone", "device_laptop", "stage"] as const;
/** Modalidade audiovisual da cena (motor híbrido). `ai_motion` só com foto oficial e geração autorizada. */
export const DESIGN_TEMPLATE_NAMES = ["product_hero", "detail_reveal", "lineup", "software_focus", "title_card", "speech_captions"] as const;
export const SCENE_MODALITIES = ["original_footage", "animated_photo", "motion_graphics", "software_demo", "ai_motion"] as const;
const TRANSITIONS = ["cut", "cross_dissolve", "dip_to_black", "push_left", "push_up", "zoom_in", "blur", "circle_open", "wipe", "flash", "smooth_left"] as const;
const TEXT_ROLES = ["hook", "headline", "cta", "price", "subtitle"] as const;
const POSITIONS = ["top", "center", "bottom", "lower_third"] as const;
const ANIMATIONS = ["fade", "slide_up", "pop", "kinetic", "countdown", "none"] as const;

const textSchema = z
  .object({
    role: z.enum(TEXT_ROLES),
    text: z.string().min(1).max(70),
    position: z.enum(POSITIONS),
    animation: z.enum(ANIMATIONS),
  })
  .strict()
  .refine((item) => item.animation !== "countdown" || item.text === "3 2 1", "A contagem usa exatamente '3 2 1'");

const sceneSchema = z
  .object({
    materialId: z.string().min(1).max(20),
    purpose: z.enum(SCENE_PURPOSES),
    durationSeconds: z.number().min(0.8).max(12),
    sentenceIds: z.array(z.string().min(1).max(10)).max(12).optional(),
    sourceStartSeconds: z.number().min(0).max(3600).optional(),
    motion: z.enum(MOTIONS),
    layout: z.enum(LAYOUTS).optional(),
    modality: z.enum(SCENE_MODALITIES).optional(),
    motionPrompt: z.string().min(1).max(400).optional(),
    /** Intenção emocional da cena (Emotion Engine). */
    emotion: z.enum(["curiosity", "desire", "urgency", "trust", "sophistication", "energy", "authority", "surprise", "identification"]).optional(),
    /** Cena de motion design (Remotion): template + textos curtos; o construtor monta as props. */
    design: z.object({
      template: z.enum(DESIGN_TEMPLATE_NAMES),
      kicker: z.string().min(1).max(40).optional(),
      headline: z.string().min(1).max(60).optional(),
      label: z.string().min(1).max(40).optional(),
      lines: z.array(z.string().min(1).max(40)).max(3).optional(),
      cta: z.string().min(1).max(36).optional(),
      emphasis: z.array(z.string().min(1).max(24)).max(6).optional(),
      extraMaterialIds: z.array(z.string().min(1).max(20)).max(2).optional(),
    }).strict().optional(),
    motionIntensity: z.enum(["subtle", "medium", "strong"]),
    focus: z.enum(["center", "top", "bottom", "left", "right"]),
    region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number(),
      start: z.object({ x: z.number(), y: z.number(), scale: z.number() }).strict().optional() }).strict()
      .refine(validSourceRegion, "Região de origem fora da foto ou captura").optional(),
    transitionIn: z.enum(TRANSITIONS),
    texts: z.array(textSchema).max(2),
  })
  .strict();

const draftSchema = z
  .object({
    schemaVersion: z.literal(VIDEO_EDIT_DRAFT_SCHEMA_VERSION),
    /** História que o vídeo conta (diretor audiovisual). */
    story: z.string().max(300).optional(),
    /** Efeitos sonoros: automáticos pelos eventos visuais, ou nenhum. */
    sfx: z.enum(["auto", "none"]).optional(),
    strategy: z.string().min(1).max(60),
    rationale: z.string().max(900),
    scenes: z.array(sceneSchema).min(1).max(14),
    captions: z.boolean(),
    music: z.enum(["none", "subtle", "present"]),
    logo: z.enum(["none", "end", "corner"]),
    warnings: z.array(z.string().max(240)).max(10),
  })
  .strict();

export type VideoEditDraft = z.infer<typeof draftSchema>;
export type VideoEditDraftScene = z.infer<typeof sceneSchema>;

const text = (description: string, maxLength: number) => ({ type: "string", minLength: 1, maxLength, description });

export const VIDEO_EDIT_DRAFT_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "strategy", "rationale", "scenes", "captions", "music", "logo", "warnings"],
  properties: {
    schemaVersion: { const: VIDEO_EDIT_DRAFT_SCHEMA_VERSION },
    strategy: text("Rótulo curto da estratégia de composição (ex.: produto-herói, prova-social, antes-e-depois, demo-guiada).", 60),
    rationale: { type: "string", maxLength: 900, description: "Por que essa sequência atende ao pedido e ao tipo de campanha." },
    scenes: {
      type: "array",
      minItems: 1,
      maxItems: 14,
      description: "Cenas na ordem de exibição.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["materialId", "purpose", "durationSeconds", "motion", "motionIntensity", "focus", "transitionIn", "texts"],
        properties: {
          materialId: text('Id de um material da lista (ex.: "M2") ou "CARD" para um cartão com as cores da marca.', 20),
          purpose: { type: "string", enum: [...SCENE_PURPOSES] },
          durationSeconds: { type: "number", minimum: 0.8, maximum: 12, description: "Tempo da cena. Em vídeo com frases, o tempo real vem das frases escolhidas." },
          sentenceIds: { type: "array", maxItems: 12, items: { type: "string", maxLength: 10 }, description: "Só para vídeo com fala: ids de frases CONSECUTIVAS do mesmo material (ex.: [\"S4\",\"S5\"])." },
          sourceStartSeconds: { type: "number", minimum: 0, description: "Só para vídeo SEM fala: segundo da fonte onde a cena começa." },
          motion: { type: "string", enum: [...MOTIONS], description: "punch_in = aproximação rápida (gancho); drift = deriva diagonal lenta." },
          layout: { type: "string", enum: [...LAYOUTS], description: "Composição (só imagem): full = tela cheia; framed = produto num cartão sobre a cor da marca; split = foto + painel da marca com o texto; parallax = produto em camada sobre fundo (profundidade); inset = lupa no detalhe; device_phone/device_laptop = captura real dentro de um aparelho." },
          region: { type: "object", additionalProperties: false, required: ["x", "y", "width", "height"], properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, start: { type: "object", additionalProperties: false, required: ["x", "y", "scale"], properties: { x: { type: "number" }, y: { type: "number" }, scale: { type: "number" } } } }, description: "Retângulo normalizado em full. Em foto, start inicia com um recorte menor e abre até o retângulo completo." },
          motionIntensity: { type: "string", enum: ["subtle", "medium", "strong"] },
          focus: { type: "string", enum: ["center", "top", "bottom", "left", "right"], description: "Onde está o assunto principal no material." },
          transitionIn: { type: "string", enum: [...TRANSITIONS], description: "Transição de entrada da cena." },
          texts: {
            type: "array",
            maxItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["role", "text", "position", "animation"],
              properties: {
                role: { type: "string", enum: [...TEXT_ROLES] },
                text: text("Texto curto em português (ganchos e CTAs com até 6 palavras).", 70),
                position: { type: "string", enum: [...POSITIONS] },
                animation: { type: "string", enum: [...ANIMATIONS] },
              },
            },
          },
        },
      },
    },
    captions: { type: "boolean", description: "Legendas automáticas da fala (o texto vem da transcrição, nunca escrito por você)." },
    music: { type: "string", enum: ["none", "subtle", "present"] },
    logo: { type: "string", enum: ["none", "end", "corner"] },
    warnings: { type: "array", maxItems: 10, items: { type: "string", maxLength: 240 }, description: "O que foi pedido e não dá para fazer com os materiais." },
  },
};

export function validateVideoEditDraftStructure(raw: unknown): { valid: true; data: VideoEditDraft } | { valid: false; errors: readonly string[] } {
  const result = draftSchema.safeParse(raw);
  if (!result.success) return { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
  return { valid: true, data: result.data };
}

type PlanningMaterialInput = { id: string; kind: string; hasSpeech?: boolean };
type SentenceInput = { id: string; materialId: string };

/**
 * Validação semântica contra o que foi enviado: só materiais e frases existentes, frases
 * consecutivas do mesmo vídeo, vídeo com fala sempre por frases, nada de preço/número inventado.
 */
export function applyVideoEditDraftSemanticValidation(draft: VideoEditDraft, input: Readonly<Record<string, unknown>>): { valid: true; data: VideoEditDraft; warnings: readonly string[] } | { valid: false; errors: readonly string[] } {
  const materials = new Map(((input.materials as PlanningMaterialInput[] | undefined) ?? []).map((material) => [material.id, material]));
  const sentences = ((input.sentences as SentenceInput[] | undefined) ?? []).map((sentence, index) => ({ ...sentence, index }));
  const sentenceById = new Map(sentences.map((sentence) => [sentence.id, sentence]));
  const sourceText = JSON.stringify([input.request ?? "", input.brand ?? {}, input.products ?? []]);
  const errors: string[] = [];
  const warnings: string[] = [];

  draft.scenes.forEach((scene, index) => {
    const path = `scenes[${index}]`;
    if (scene.materialId === "CARD") {
      if (scene.sentenceIds?.length) errors.push(`${path}: cartão não tem frases`);
    } else {
      const material = materials.get(scene.materialId);
      if (!material) {
        errors.push(`${path}: material "${scene.materialId}" não existe`);
        return;
      }
      if (material.kind === "video" && material.hasSpeech && !scene.sentenceIds?.length) errors.push(`${path}: vídeo com fala precisa das frases escolhidas (sentenceIds)`);
      if (material.kind !== "video" && scene.sentenceIds?.length) errors.push(`${path}: só vídeo tem frases`);
      if (scene.sentenceIds?.length) {
        const picked = scene.sentenceIds.map((id) => sentenceById.get(id));
        if (picked.some((sentence) => !sentence)) errors.push(`${path}: frase inexistente`);
        else {
          if (picked.some((sentence) => sentence!.materialId !== scene.materialId)) errors.push(`${path}: frase de outro material`);
          if (picked.some((sentence, i) => i > 0 && sentence!.index !== picked[i - 1]!.index + 1)) errors.push(`${path}: frases precisam ser consecutivas (não pule nem inverta a fala)`);
        }
      }
    }
    const designTexts = scene.design ? [scene.design.kicker, scene.design.headline, scene.design.label, scene.design.cta, ...(scene.design.lines ?? [])].filter((item): item is string => Boolean(item)).map((item) => ({ text: item })) : [];
    for (const text of [...scene.texts, ...designTexts]) {
      // Preço, porcentagem ou número só se vierem do pedido/dados: a IA não inventa oferta.
      for (const number of text.text.match(/\d+[.,]?\d*\s*%?/g) ?? []) {
        if (!sourceText.includes(number.replace(/\s/g, "").replace(/%$/, ""))) errors.push(`${path}: o número "${number.trim()}" não está no pedido nem nos dados do produto`);
      }
      if (/r\$/i.test(text.text) && !/r\$/i.test(sourceText)) errors.push(`${path}: preço não informado no pedido`);
    }
  });
  if (!draft.scenes.some((scene) => scene.purpose === "cta" || Boolean(scene.design?.cta) || scene.texts.some((text) => text.role === "cta"))) warnings.push("sem chamada para ação");
  return errors.length > 0 ? { valid: false, errors } : { valid: true, data: draft, warnings };
}
