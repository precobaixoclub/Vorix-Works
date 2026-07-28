/**
 * Autoridade única de classificação de formato de conteúdo — usada tanto pelo Eduardo (Skill,
 * capability `editorial_planning`, que produz o Editorial Brief com `recommendedFormat`) quanto
 * pelo Arthur (orquestrador, que decide qual pipeline — imagem ou vídeo — entra no
 * `ExecutionPlan`). `src/shared` não é uma Skill — importar daqui não viola o isolamento entre
 * Skills (ADR 0002), e Arthur nunca foi uma Skill.
 *
 * Antes desta extração, Arthur tinha sua própria detecção de "pedido de vídeo" (`detectsVideoRequest`,
 * lista de palavras própria), completamente independente da classificação do Eduardo. Como Caio
 * executa um plano estático (não replaneja depois que uma Skill já rodou), Arthur decide a
 * pipeline ANTES do Eduardo executar — então as duas listas de palavras podiam divergir e Arthur
 * construía uma pipeline diferente da que o próprio Eduardo, ao rodar, recomendava. Eliminar essa
 * segunda implementação (em vez de só mantê-la sincronizada manualmente) é o que garante que as
 * duas decisões nunca mais divirjam: Arthur passou a chamar exatamente estas mesmas funções.
 */
import { normalize } from "./skill-parsing.js";

export const RECOMMENDED_CONTENT_FORMATS = ["imagem_unica", "carrossel", "reels", "video", "story"] as const;

export type RecommendedContentFormat = (typeof RECOMMENDED_CONTENT_FORMATS)[number];

export type ContentObjective = "conversao" | "demonstracao" | "educacao" | "engajamento" | "awareness";

/** Pipeline estrutural (quais capabilities entram no ExecutionPlan) correspondente a um `RecommendedContentFormat`. */
export type ContentPipeline = "image" | "video";

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

/**
 * Cada verbo no infinitivo listado aqui também precisa da sua forma no gerúndio como entrada
 * separada: a checagem de palavra-chave é por substring literal (`containsAny`), e a forma no
 * gerúndio nunca é um substring do infinitivo (ex.: "explicando" não contém "explicar", já que
 * "-ar"/"-er" viram "-ando"/"-endo"). Sem o gerúndio explícito, textos comuns em português
 * ("...explicando como cadastrar...", "...vendendo o plano...") caíam sempre no objetivo padrão
 * `awareness` em vez do objetivo correto. Termos que não são verbos (ex.: "taxa zero", "desconto")
 * não precisam de gerúndio.
 */
const CONVERSION_KEYWORDS = [
  "vender", "vendendo", "comprar", "comprando", "assinar", "assinando", "conversao", "taxa zero",
  "sem taxa", "gratis", "gratuito", "desconto", "economizar", "economizando", "vantagem",
  "beneficio", "presentear", "anunciar", "anunciando", "promocao",
];
const DEMONSTRATION_KEYWORDS = [
  "apresentar", "apresentando", "demonstrar", "demonstrando", "mostrar", "mostrando",
  "como funciona", "funcionalidade", "recurso", "painel", "tour",
];
const EDUCATION_KEYWORDS = [
  "educar", "educando", "explicar", "explicando", "ensinar", "ensinando", "informar", "informando",
  "entender", "entendendo", "aprender", "aprendendo",
];
const ENGAGEMENT_KEYWORDS = [
  "engajar", "engajando", "interacao", "comunidade", "comentar", "comentando", "participar", "participando",
];
const URGENCY_TOPIC_KEYWORDS = ["confirmacao de presenca", "rsvp", "lembrete", "ultimo dia", "prazo"];
const STORY_KEYWORDS = ["story", "stories"];
const VIDEO_KEYWORDS = ["video", "videos", "reels", "reel", "shorts", "short", "tiktok"];
const CAROUSEL_KEYWORDS = ["carrossel", "carrosseis", "carousel", "carousels", "slides", "slide"];
const SINGLE_IMAGE_KEYWORDS = ["imagem unica", "post unico", "uma imagem", "unica imagem"];

export function classifyContentObjective(normalizedText: string): ContentObjective {
  if (containsAny(normalizedText, CONVERSION_KEYWORDS)) return "conversao";
  if (containsAny(normalizedText, DEMONSTRATION_KEYWORDS)) return "demonstracao";
  if (containsAny(normalizedText, EDUCATION_KEYWORDS)) return "educacao";
  if (containsAny(normalizedText, ENGAGEMENT_KEYWORDS)) return "engajamento";
  return "awareness";
}

/**
 * Decisão de formato — antes decidida por Arthur (`detectFormat`/`detectImageCount`), depois só
 * pelo Eduardo, agora a única função que decide isso em todo o Zuno. Palavras explícitas de
 * formato sempre vencem; na ausência delas, o formato é inferido do objetivo de conteúdo
 * (demonstração tende a vídeo, conversão tende a carrossel) ou do assunto (confirmação de
 * presença/RSVP tende a Story, por ser uma comunicação rápida e urgente).
 */
export function classifyRecommendedFormat(normalizedText: string, contentObjective: ContentObjective): RecommendedContentFormat {
  if (containsAny(normalizedText, STORY_KEYWORDS)) return "story";
  if (containsAny(normalizedText, VIDEO_KEYWORDS)) return "reels";
  if (containsAny(normalizedText, SINGLE_IMAGE_KEYWORDS)) return "imagem_unica";
  if (containsAny(normalizedText, CAROUSEL_KEYWORDS)) return "carrossel";
  if (containsAny(normalizedText, URGENCY_TOPIC_KEYWORDS)) return "story";
  if (contentObjective === "demonstracao") return "reels";
  if (contentObjective === "conversao") return "carrossel";
  return "imagem_unica";
}

/**
 * Única correspondência entre `recommendedFormat` e a pipeline estrutural (quais Skills entram no
 * ExecutionPlan): imagem/carrossel/story sempre pipeline de imagem (Sofia → Bianca → Pedro);
 * reels/video sempre pipeline de vídeo (Bruno → Vanessa → Diego → Rafa). Não existem valores
 * `shorts`/`tiktok` em `RecommendedContentFormat` — essas são variações de rótulo de plataforma
 * para a mesma pipeline de vídeo (decidida separadamente por Arthur a partir do canal, sem afetar
 * qual pipeline roda).
 */
export function pipelineForRecommendedFormat(format: RecommendedContentFormat): ContentPipeline {
  return format === "reels" || format === "video" ? "video" : "image";
}
