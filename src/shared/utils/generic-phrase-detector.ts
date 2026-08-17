import { normalize } from "./skill-parsing.js";

/**
 * Denylist de clichês genéricos que poderiam servir para qualquer empresa (o pedido original cita
 * exemplos como "Descubra um novo jeito de...", "Qualidade e estilo para você."). Usado por Maria
 * (`maria-copywriting.skill.ts`, no loop de regeneração já existente) e por Lucas
 * (`lucas-quality-review.skill.ts`, novo issue `GENERIC_CLICHE_IN_COPY`) — extraído para
 * `src/shared` em vez de duplicado nos dois lados, mesmo padrão de outras constantes já
 * compartilhadas entre Skills (ex.: `MAX_ON_SCREEN_TEXT_LENGTH`). Utilitário puro, sem estado.
 */
const GENERIC_PHRASES: string[] = [
  "descubra um novo jeito de",
  "descubra uma nova forma de",
  "qualidade e estilo para voce",
  "conforto qualidade e praticidade",
  "transforme sua experiencia",
  "transforme sua rotina",
  "encontre tudo o que precisa",
  "encontre tudo que voce precisa",
  "nao perca essa oportunidade",
  "nao perca esta oportunidade",
  "a solucao que voce precisa",
  "o que voce precisa para",
  "viva o melhor da vida",
  "feito para voce",
  "porque voce merece",
  "tudo que voce precisa em um so lugar",
];

/** Devolve as frases-clichê detectadas literalmente no texto (comparação normalizada — minúsculas,
 * sem acento). Vazio quando o texto não contém nenhuma delas. */
export function detectGenericPhrases(text: string): string[] {
  if (!text?.trim()) return [];
  const normalized = normalize(text);
  return GENERIC_PHRASES.filter((phrase) => normalized.includes(normalize(phrase)));
}
