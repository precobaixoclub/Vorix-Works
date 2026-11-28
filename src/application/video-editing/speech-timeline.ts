/**
 * Tempo GUIADO PELA FALA: a narração já gerada e alinhada (tempos reais das palavras) decide onde cada
 * cena começa e termina — em vez de encaixar a voz em cenas de duração fixa.
 *
 *  - Cena com fala: começa um pouco antes da primeira palavra e termina na pausa REAL antes da fala da
 *    cena seguinte (o corte nunca corta uma palavra).
 *  - Cena sem fala (tensão, contagem): mantém a duração em batidas que o diretor pediu.
 *  - Corte puxado para a grade da trilha (¼ de batida) quando isso cabe dentro da pausa — música e corte
 *    juntos sem sacrificar a fala.
 *  - Fechamento: fala da chamada + tempo de leitura.
 */

export type SceneSpeech = { beats: number; role?: string; words: { start: number; end: number }[] };
export type SpeechBlockPlacement = { block: number; at: number };

export type SpeechTimeline = {
  /** Início de cada cena (s) e fim do vídeo. */
  cuts: number[];
  end: number;
  /** Deslocamento de cada bloco de fala no tempo do vídeo (s). */
  blockOffsets: number[];
  notes: string[];
};

/**
 * `scenes[i].words` vêm em tempo RELATIVO ao bloco (`sceneBlock[i]`); blocos são posicionados aqui.
 * `gapAfterBlock[k]`: respiro depois do bloco k quando a cena seguinte também fala.
 */
/** Duração mínima por papel (moda): o olho precisa ler a imagem e o texto, mesmo quando a fala é curta. */
export const MIN_BY_ROLE: Readonly<Record<string, number>> = { hook: 1.4, clue: 1.4, question: 1.8, tension: 1.4, reveal: 2.2, proof: 1.8, offer: 1.8, cta: 2.8 };

export function buildSpeechTimeline(input: { scenes: SceneSpeech[]; sceneBlock: (number | undefined)[]; bpm: number; gapAfterBlock?: number[]; hookLead?: number; minScene?: number; endHold?: number; minByRole?: Readonly<Record<string, number>>;
  /** Fração das batidas pedidas pelo diretor que a cena mantém mesmo com fala curta (ritmo intencional). */
  beatsWeight?: number }): SpeechTimeline {
  const beat = 60 / input.bpm;
  const quarter = beat / 4;
  const lead = 0.12;
  const minScene = input.minScene ?? 0.9;
  const blockOffsets: number[] = [];
  const notes: string[] = [];
  const cuts: number[] = [0];
  let t = 0; // início da cena atual
  let speechEnd = 0; // fim da última palavra posicionada
  const abs = (i: number) => {
    const b = input.sceneBlock[i];
    return b === undefined ? [] : input.scenes[i]!.words.map((w) => ({ start: w.start + blockOffsets[b]!, end: w.end + blockOffsets[b]! }));
  };
  for (let i = 0; i < input.scenes.length; i += 1) {
    const s = input.scenes[i]!;
    const b = input.sceneBlock[i];
    // Posiciona o bloco na primeira cena que o usa.
    if (b !== undefined && blockOffsets[b] === undefined) {
      const first = s.words[0]?.start ?? 0;
      const want = i === 0 ? (input.hookLead ?? 0.3) : t + (s.role === "reveal" ? 0.55 : lead);
      const gap = b > 0 && input.sceneBlock[i - 1] !== undefined ? (input.gapAfterBlock?.[b - 1] ?? 0.12) : 0.12;
      blockOffsets[b] = Math.max(want, speechEnd + gap) - first;
    }
    const words = abs(i);
    if (words.length) speechEnd = Math.max(speechEnd, words[words.length - 1]!.end);
    const last = i === input.scenes.length - 1;
    let end: number;
    if (last) {
      end = Math.max(speechEnd + (input.endHold ?? 1.3), t + 2.6);
    } else if (!words.length) {
      end = t + s.beats * beat;
    } else {
      const next = input.scenes[i + 1]!;
      const nb = input.sceneBlock[i + 1];
      const nextFirst = nb !== undefined && blockOffsets[nb] !== undefined ? next.words[0]!.start + blockOffsets[nb]! : undefined;
      const lastWord = words[words.length - 1]!.end;
      if (nextFirst !== undefined) {
        // Mesmo bloco: corta na pausa real entre as falas (o mais perto da grade possível).
        const lo = lastWord + 0.05, hi = nextFirst - 0.07;
        const mid = (lo + hi) / 2;
        const snapped = Math.round(mid / quarter) * quarter;
        end = hi > lo ? (snapped >= lo && snapped <= hi ? snapped : mid) : lastWord + 0.04;
      } else {
        // Próxima cena começa outro bloco (ou é silenciosa): respira 0,25 s depois da fala.
        const raw = lastWord + 0.25;
        const snapped = Math.ceil(raw / quarter) * quarter;
        end = snapped - raw < 0.12 ? snapped : raw;
      }
    }
    const floor = Math.max(minScene, (input.minByRole ?? MIN_BY_ROLE)[s.role ?? ""] ?? 0, s.beats * beat * (input.beatsWeight ?? 0));
    if (end - t < floor) { notes.push(`cena ${i + 1} (${s.role ?? "?"}): fala ocupa ${(end - t).toFixed(2)} s; imagem segura ${floor} s`); end = t + floor; }
    t = +end.toFixed(3);
    cuts.push(t);
  }
  const endTime = cuts.pop()!;
  return { cuts, end: endTime, blockOffsets: blockOffsets.map((o) => +o.toFixed(3)), notes };
}
