/**
 * Roteiro FALADO → trechos para o sintetizador local (Piper/Kokoro).
 *
 * Os motores locais não aceitam SSML. O que eles realmente oferecem: texto, velocidade por trecho e
 * (Piper) expressividade. Então a interpretação é construída com o que funciona:
 *  - PAUSA: cada trecho é sintetizado separado; o silêncio entre eles é exato (`pauseAfterMs`).
 *  - ÊNFASE: a palavra marcada com *asteriscos* vira um trecho próprio, um pouco mais lento, com
 *    micro-pausa antes ("Era a... *A*.") — é assim que um locutor destaca.
 *  - PRONÚNCIA: léxico pt-BR (letras soltas, siglas, números, marcas) antes da síntese. Medido com o
 *    Whisper: sem léxico, "Era a A." virou "Teiro alas" e "A ou B" virou "A OBS".
 *  - INTERPRETAÇÃO por tipo de campanha (moda, tecnologia, casamento, ofertas): voz, velocidade,
 *    expressividade, respiro e quanto a trilha abaixa sob a fala.
 */

export type CampaignKind = "moda" | "tecnologia" | "casamento" | "ofertas";

export type VoiceProfile = {
  kind: CampaignKind;
  label: string;
  /** Motor e voz preferidos (a escolha final é humana — ver docs/narracao-humanizada.md). */
  engine: "piper" | "kokoro";
  voice: string;
  speed: number;
  expressiveness: number;
  /** Multiplica as pausas do roteiro. */
  pauseScale: number;
  /** Quanto a trilha abaixa sob a fala (dB). */
  duckDb: number;
  direction: string;
};

export const VOICE_PROFILES: Readonly<Record<CampaignKind, VoiceProfile>> = {
  moda: { kind: "moda", label: "Moda — envolvente e sofisticada", engine: "kokoro", voice: "pf_dora", speed: 0.96, expressiveness: 0.7, pauseScale: 1.15, duckDb: 9, direction: "Fala próxima, sem pressa, sorriso na voz; segura a palavra-chave." },
  tecnologia: { kind: "tecnologia", label: "Tecnologia — clara, segura e dinâmica", engine: "kokoro", voice: "pm_alex", speed: 1.05, expressiveness: 0.5, pauseScale: 0.9, duckDb: 10, direction: "Frases diretas, ritmo firme, pausa curta antes do benefício." },
  casamento: { kind: "casamento", label: "Casamento — acolhedora e emocional", engine: "kokoro", voice: "pf_dora", speed: 0.9, expressiveness: 0.75, pauseScale: 1.3, duckDb: 8, direction: "Calor e calma; respira entre as ideias; nada de tom de vendedor." },
  ofertas: { kind: "ofertas", label: "Ofertas — enérgica sem soar artificial", engine: "kokoro", voice: "pm_santa", speed: 1.1, expressiveness: 0.65, pauseScale: 0.8, duckDb: 7, direction: "Energia na primeira frase, conversa no meio, chamada clara no fim." },
};

/** Tipo de campanha a partir do tipo de negócio/tom da marca. */
export function campaignKindOf(input: { businessKind?: string; tone?: string; category?: string }): CampaignKind {
  const text = `${input.tone ?? ""} ${input.category ?? ""}`.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (/casament|noiv|wedding|romant/.test(text)) return "casamento";
  if (/ofert|promoc|desconto|preco|economi/.test(text)) return "ofertas";
  if (input.businessKind === "software" || /tecnolog|software|automac|saas|sistema/.test(text)) return "tecnologia";
  return "moda";
}

// ---------------------------------------------------------------------------------------------
// Pronúncia
// ---------------------------------------------------------------------------------------------

const LETTERS: Record<string, string> = { A: "á", B: "bê", C: "cê", D: "dê", E: "é", F: "éfe", G: "gê", H: "agá", I: "i", J: "jota", K: "cá", L: "éle", M: "eme", N: "ene", O: "ó", P: "pê", Q: "quê", R: "érre", S: "ésse", T: "tê", U: "u", V: "vê", W: "dáblio", X: "xis", Y: "ípsilon", Z: "zê" };
const UNITS = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

/** Número por extenso (pt-BR), 0–999.999. */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return String(n);
  if (n < 20) return UNITS[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? ` e ${UNITS[n % 10]}` : "");
  if (n === 100) return "cem";
  if (n < 1000) return HUNDREDS[Math.floor(n / 100)]! + (n % 100 ? ` e ${numberToWords(n % 100)}` : "");
  const thousands = Math.floor(n / 1000), rest = n % 1000;
  const head = thousands === 1 ? "mil" : `${numberToWords(thousands)} mil`;
  return rest ? `${head}${rest < 100 || rest % 100 === 0 ? " e" : ""} ${numberToWords(rest)}` : head;
}

/** Léxico padrão (marcas e termos comuns) — a marca pode acrescentar o seu (`lexicon`). */
export const DEFAULT_LEXICON: Readonly<Record<string, string>> = { Pix: "píks", PIX: "píks", Vorix: "Vórix", Club: "clâb", app: "ép", site: "sáite", online: "onláine" };

/**
 * Texto para a voz: aplica o léxico da marca, soletra siglas, fala números e letras soltas.
 * "Era a A." → "Era a á."; "A ou B" → "á ou bê"; "CMKV 000037" → "cê eme cá vê, trinta e sete".
 */
export function normalizeForSpeech(text: string, lexicon: Readonly<Record<string, string>> = {}): string {
  const lex = { ...DEFAULT_LEXICON, ...lexicon };
  let out = text.replace(/\*/g, "");
  for (const [from, to] of Object.entries(lex).sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\d])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\d])`, "gu"), to);
  }
  // Códigos com zeros à esquerda: fala o número ("000037" → "trinta e sete").
  out = out.replace(/\b\d{1,6}\b/g, (digits) => numberToWords(Number(digits)));
  // Siglas (2–5 maiúsculas) soletradas; letra solta maiúscula vira o nome da letra.
  out = out.replace(/\b[A-Z]{2,5}\b/g, (acronym) => acronym.split("").map((c) => LETTERS[c] ?? c).join(" "));
  out = out.replace(/(?<![\p{L}])([A-Z])(?![\p{L}])/gu, (_, c: string) => LETTERS[c] ?? c);
  return out.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------------------------
// Trechos (pausa e ênfase)
// ---------------------------------------------------------------------------------------------

export type NarrationLine = { text: string; pauseAfterMs?: number; delivery?: string };
export type TtsSegment = { text: string; speed: number; expressiveness: number; pauseAfterMs: number; lineIndex: number; emphasis: boolean };

/**
 * Linhas do roteiro → trechos. A ênfase (*palavra*) vira trecho próprio, 12% mais lento, com 140 ms de
 * respiro antes; reticências viram pausa. Pausas multiplicadas pelo perfil da campanha.
 */
export function toSegments(lines: readonly NarrationLine[], profile: VoiceProfile, lexicon: Readonly<Record<string, string>> = {}): TtsSegment[] {
  const out: TtsSegment[] = [];
  lines.forEach((line, lineIndex) => {
    const parts = line.text.split(/(\*[^*]+\*|\.\.\.|…)/).map((p) => p.trim()).filter(Boolean);
    const finalPause = Math.round((line.pauseAfterMs ?? 300) * profile.pauseScale);
    parts.forEach((part, k) => {
      const last = k === parts.length - 1;
      if (part === "..." || part === "…") {
        if (out.length) out[out.length - 1]!.pauseAfterMs += Math.round(380 * profile.pauseScale);
        return;
      }
      const emphasis = part.startsWith("*");
      const text = normalizeForSpeech(part, lexicon);
      if (!text) return;
      // Pontuação solta ("." depois da ênfase) gruda no trecho anterior e leva a pausa final dele.
      if (/^[.,!?;:]+$/.test(text)) {
        const prev = out[out.length - 1];
        if (prev && prev.lineIndex === lineIndex) { prev.text += text; if (last) prev.pauseAfterMs = finalPause; }
        return;
      }
      if (emphasis && out.length && out[out.length - 1]!.lineIndex === lineIndex) out[out.length - 1]!.pauseAfterMs += 140;
      out.push({ text, speed: +(profile.speed * (emphasis ? 0.88 : 1)).toFixed(3), expressiveness: Math.min(1, profile.expressiveness + (emphasis ? 0.1 : 0)), pauseAfterMs: last ? finalPause : emphasis ? 60 : 40, lineIndex, emphasis });
    });
  });
  return out;
}

export type SegmentTiming = { start: number; end: number };

/**
 * Encaixe da narração nos planos: cada linha começa no plano dela (+ entrada) e precisa terminar antes do
 * fim do plano. Devolve os atrasos por linha e o que não coube (o QG/revisor acusa).
 */
export function fitNarration(lineDurations: readonly number[], scenes: readonly { start: number; end: number; line?: number }[], leadSeconds = 0.12) {
  const placements: { line: number; at: number; overflow: number }[] = [];
  let cursor = 0;
  for (const scene of scenes) {
    if (scene.line === undefined) continue;
    const at = Math.max(scene.start + leadSeconds, cursor);
    const duration = lineDurations[scene.line] ?? 0;
    placements.push({ line: scene.line, at: +at.toFixed(3), overflow: +Math.max(0, at + duration - scene.end).toFixed(3) });
    cursor = at + duration + 0.08;
  }
  return { placements, overflowing: placements.filter((p) => p.overflow > 0.15) };
}

// ---------------------------------------------------------------------------------------------
// Direção de locução (intenção por trecho) e síntese por BLOCO narrativo
// ---------------------------------------------------------------------------------------------

/**
 * Intenção do trecho, escolhida pelo diretor. Os motores locais não têm "estilo": a intenção vira o que
 * eles obedecem — velocidade, pontuação final (entonação de pergunta/exclamação), respiro depois e (Piper)
 * variação de expressividade. Valores MEDIDOS na prova da CMKV (avaliação humana: "lenta e pausada").
 */
export const SPEECH_INTENTS = ["curiosidade", "surpresa", "entusiasmo", "explicacao", "emocao", "chamada"] as const;
export type SpeechIntent = (typeof SPEECH_INTENTS)[number];

const INTENT: Record<SpeechIntent, { speed: number; pauseAfterMs: number; ending?: "?" | "!"; expressiveness: number }> = {
  curiosidade: { speed: 1.04, pauseAfterMs: 160, ending: "?", expressiveness: 0.65 },
  surpresa: { speed: 1.1, pauseAfterMs: 120, ending: "!", expressiveness: 0.75 },
  entusiasmo: { speed: 1.12, pauseAfterMs: 120, ending: "!", expressiveness: 0.75 },
  explicacao: { speed: 1.08, pauseAfterMs: 140, expressiveness: 0.5 },
  emocao: { speed: 0.98, pauseAfterMs: 220, expressiveness: 0.7 },
  chamada: { speed: 1.06, pauseAfterMs: 0, expressiveness: 0.6 },
};

/** Ritmo-base de locução por campanha (publicidade: sem arrastar). */
export const CAMPAIGN_SPEECH: Readonly<Record<CampaignKind, { speed: number; sentencePause: number; clausePause: number }>> = {
  moda: { speed: 1.0, sentencePause: 0.14, clausePause: 0.05 },
  tecnologia: { speed: 1.1, sentencePause: 0.12, clausePause: 0.05 },
  casamento: { speed: 1.0, sentencePause: 0.2, clausePause: 0.07 },
  ofertas: { speed: 1.14, sentencePause: 0.1, clausePause: 0.04 },
};

export type DirectedLine = { scene: number; text: string; intent: SpeechIntent };
export type SpeechBlock = { id: number; lines: DirectedLine[] };

/** Pontuação final coerente com a intenção (sem reticências: elas viravam pausa artificial). */
function shapeEnding(text: string, intent: SpeechIntent): string {
  const clean = text.replace(/\*/g, "").replace(/\s*(\.\.\.|…)\s*/g, ", ").replace(/[,\s]+$/g, "").trim();
  const want = INTENT[intent].ending;
  if (/[?!.]$/.test(clean)) return want && !clean.endsWith("?") ? clean.replace(/[.!]$/, want) : clean;
  return `${clean}${want ?? "."}`;
}

/** Linhas → blocos: linhas seguidas sem plano de silêncio entre elas formam UM bloco contínuo. */
export function speechBlocks(lines: readonly DirectedLine[]): SpeechBlock[] {
  const blocks: SpeechBlock[] = [];
  for (const line of lines) {
    const last = blocks[blocks.length - 1];
    const prev = last?.lines[last.lines.length - 1];
    if (last && prev && line.scene === prev.scene + 1 && last.lines.length < 3 && line.intent !== "chamada") last.lines.push(line);
    else blocks.push({ id: blocks.length, lines: [line] });
  }
  return blocks;
}

export type SpeechStrategy = "frase" | "bloco";

/**
 * Trechos para o sintetizador. `frase`: uma chamada por linha (como antes, mas sem cortar a ênfase).
 * `bloco`: uma chamada por bloco narrativo — prosódia contínua; o respiro entre frases é o do perfil.
 * Velocidade do bloco = base da campanha × média das intenções (o motor tem UMA velocidade por chamada).
 */
export function directedSegments(lines: readonly DirectedLine[], kind: CampaignKind, strategy: SpeechStrategy, lexicon: Readonly<Record<string, string>> = {}): (TtsSegment & { sentencePause: number; clausePause: number; scenes: number[] })[] {
  const base = CAMPAIGN_SPEECH[kind];
  const groups = strategy === "bloco" ? speechBlocks(lines).map((b) => b.lines) : lines.map((l) => [l]);
  return groups.map((group, k) => {
    const speed = base.speed * (group.reduce((a, l) => a + INTENT[l.intent].speed, 0) / group.length);
    const text = group.map((l) => normalizeForSpeech(shapeEnding(l.text, l.intent), lexicon)).join(" ");
    const last = group[group.length - 1]!;
    return { text, speed: +speed.toFixed(3), expressiveness: Math.max(...group.map((l) => INTENT[l.intent].expressiveness)), pauseAfterMs: INTENT[last.intent].pauseAfterMs, lineIndex: k, emphasis: false, sentencePause: base.sentencePause, clausePause: base.clausePause, scenes: group.map((l) => l.scene) };
  });
}
