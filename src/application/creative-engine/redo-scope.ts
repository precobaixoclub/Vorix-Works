import { interpretRejection, type RejectionInterpretation } from "./feedback-interpretation.js";

/**
 * Refação direcionada: a partir do motivo da reprovação no WhatsApp, decide EXATAMENTE o que muda na nova
 * versão e o que fica igual. Antes (até 26/11/2026) toda refação gerava de novo todas as telas, mesmo
 * quando o cliente só criticou a frase — a composição aprovada mudava e cada tela custava uma geração.
 *
 * Duas leituras do motivo:
 * - determinística (feedback-interpretation): a trava — o que o cliente NÃO criticou não muda;
 * - Codex (que vê a arte reprovada): precisa as telas quando o motivo não cita nenhuma e decide sozinho
 *   só quando o motivo é vago ("não gostei"), como antes.
 */

export type CodexRedoReading = {
  changeText?: boolean;
  textScreens?: readonly number[];
  imageScreens?: readonly number[];
  changeProduct?: boolean;
  captionChanged?: boolean;
};

export type RedoScope = {
  screenCount: number;
  /** Telas cujo texto muda (1 = capa). */
  text: number[];
  /** Telas cuja imagem é gerada de novo; as demais reaproveitam a base aprovada da versão anterior. */
  image: number[];
  caption: boolean;
  product: boolean;
  logo: boolean;
  /** O cliente não quer a peça: devolve ao Bolsão sem gastar uma refação. */
  noRedo: boolean;
  reading: RejectionInterpretation;
  changed: string;
  kept: string;
};

const range = (count: number) => Array.from({ length: count }, (_, index) => index + 1);
const validScreens = (list: readonly number[] | undefined, count: number) =>
  [...new Set((list ?? []).filter((screen) => Number.isInteger(screen) && screen >= 1 && screen <= count))].sort((a, b) => a - b);

function screensLabel(screens: readonly number[], count: number): string {
  if (count <= 1) return "";
  if (screens.length === count) return " de todas as telas";
  const list = (items: readonly number[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} e ${items.at(-1)}` : String(items[0]));
  const others = screens.filter((screen) => screen !== 1);
  const rest = others.length ? `${others.length > 1 ? "das telas" : "da tela"} ${list(others)}` : "";
  return screens.includes(1) ? ` da capa${rest ? ` e ${rest}` : ""}` : ` ${rest}`;
}

export function resolveRedoScope(input: { reason: string | undefined; screenCount: number; codex?: CodexRedoReading }): RedoScope {
  const count = Math.max(1, input.screenCount);
  const reading = interpretRejection(input.reason, { screenCount: count });
  const all = range(count);
  const cited = reading.screens === "all" ? all : reading.screens;
  const codexText = validScreens(input.codex?.textScreens, count);
  const codexImage = validScreens(input.codex?.imageScreens, count);
  let text: number[];
  let image: number[];
  let caption: boolean;
  let product: boolean;
  if (reading.unclear) {
    // Motivo vago: o Codex decide (como antes), com a precisão de tela quando ele indicar.
    text = input.codex?.changeText === false ? [] : codexText.length ? codexText : all;
    image = codexImage.length ? codexImage : all;
    caption = input.codex?.captionChanged === true;
    product = input.codex?.changeProduct === true;
  } else {
    text = reading.changes.text ? (cited ?? (codexText.length ? codexText : all)) : [];
    image = reading.changes.image ? (cited ?? (codexImage.length ? codexImage : all)) : [];
    caption = reading.changes.caption;
    product = reading.changes.product;
  }
  if (product && !image.length) image = all;
  const logo = reading.changes.logo;
  const parts = [
    ...(text.length ? [`texto${screensLabel(text, count)}`] : []),
    ...(image.length ? [`${product ? "peça do catálogo e " : ""}imagem${screensLabel(image, count)}`] : []),
    ...(caption ? ["legenda"] : []),
    ...(logo ? ["tratamento da logo"] : []),
  ];
  const keptImages = all.filter((screen) => !image.includes(screen));
  const keptText = all.filter((screen) => !text.includes(screen));
  const keep = (what: "imagem" | "texto", screens: number[]) => (!screens.length ? []
    : screens.length === count ? [count > 1 && what === "imagem" ? "imagens" : what] : [`${what}${screensLabel(screens, count)}`]);
  const keptParts = [...keep("imagem", keptImages), ...keep("texto", keptText), ...(!caption ? ["legenda"] : [])];
  return {
    screenCount: count, text, image, caption, product, logo, noRedo: reading.noRedo, reading,
    changed: parts.join(", ") || "ajuste geral pedido",
    kept: keptParts.join(", "),
  };
}

export type ArtText = { headline: string; body?: string; slides?: ReadonlyArray<{ headline: string; body?: string }> };

/**
 * Texto da nova versão: só as telas do escopo recebem o texto reescrito; as outras voltam ao original.
 * `undefined` = o texto não muda (nada a sobrescrever na pauta).
 */
export function scopedText(original: ArtText, rewritten: ArtText | undefined, scope: Pick<RedoScope, "text" | "screenCount">): ArtText | undefined {
  if (!rewritten || !scope.text.length) return undefined;
  if (original.slides?.length) {
    if (rewritten.slides?.length !== original.slides.length) return undefined;
    const slides = original.slides.map((slide, index) => (scope.text.includes(index + 1) ? { headline: rewritten.slides![index].headline || slide.headline, body: rewritten.slides![index].body ?? slide.body ?? "" } : { headline: slide.headline, body: slide.body ?? "" }));
    const changed = slides.some((slide, index) => slide.headline !== original.slides![index].headline || (slide.body ?? "") !== (original.slides![index].body ?? ""));
    return changed ? { headline: slides[0].headline, body: slides[0].body, slides } : undefined;
  }
  const headline = rewritten.headline?.trim() || original.headline;
  const body = rewritten.body ?? original.body ?? "";
  return headline !== original.headline || body !== (original.body ?? "") ? { headline, body, slides: [] } : undefined;
}

/**
 * Trava contra republicar a peça reprovada: mesma sequência de imagens E mesma legenda de uma versão que o
 * cliente reprovou = a mesma peça. (Legenda nova sobre a mesma arte é outra peça — reprovação de legenda.)
 */
export function matchesRejectedPiece(candidate: { imageSha256: readonly string[]; caption: string }, rejected: ReadonlyArray<{ imageSha256: readonly string[]; caption?: string }>): boolean {
  const caption = candidate.caption.trim();
  return rejected.some((piece) => piece.imageSha256.length === candidate.imageSha256.length && piece.imageSha256.length > 0
    && piece.imageSha256.every((sha, index) => sha === candidate.imageSha256[index]) && (piece.caption ?? "").trim() === caption);
}

/**
 * Conferência da nova versão contra o escopo: toda tela que devia mudar (texto ou imagem) mudou. Evita mandar
 * para o cliente uma "refação" igual à versão reprovada.
 */
export function redoScopeViolations(scope: Pick<RedoScope, "text" | "image">, previous: ReadonlyArray<string | undefined>, next: readonly string[]): string[] {
  const touched = [...new Set([...scope.text, ...scope.image])].sort((a, b) => a - b);
  return touched.filter((screen) => previous[screen - 1] && previous[screen - 1] === next[screen - 1]).map((screen) => `A tela ${screen} devia mudar e ficou igual à versão reprovada.`);
}
