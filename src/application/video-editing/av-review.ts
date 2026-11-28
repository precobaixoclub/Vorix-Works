/**
 * Revisão audiovisual com EVIDÊNCIA TEMPORAL (funções puras sobre medidas já feitas).
 *
 * Diferente da revisão por quadros soltos: cada achado tem início/fim no vídeo e a medida que o sustenta
 * — imagem (parecença entre planos, movimento), áudio (voz × trilha em cada fala, pausas, entonação,
 * velocidade, picos) e o plano criativo (papel narrativo, texto, fala).
 *
 * LIMITE declarado: a máquina não "ouve". Naturalidade e timbre são estimados por medidas (variação do
 * tom, ritmo de fala, pausas, transcrição); o veredito de áudio é sempre humano.
 */

export type ReviewShot = { index: number; start: number; end: number; kind: string; role?: string; texts: string[]; narration?: string; hash?: bigint; motion?: number; product: boolean };
export type ReviewLine = { line: string; start: number; end: number; syllablesPerSecond: number; pitchStd?: number; longestInnerPause: number };
export type ReviewAudio = { integratedLufs?: number; truePeakDb?: number; voiceOverMusicDb?: number[]; musicOnlyLufs?: number };
export type ReviewInput = { duration: number; shots: ReviewShot[]; lines: ReviewLine[]; audio: ReviewAudio; hasNarration: boolean };

export type ReviewFindingCode =
  | "gancho_fraco" | "narracao_artificial" | "pausas_inadequadas" | "ritmo_inconsistente" | "cenas_redundantes"
  | "movimento_sem_intencao" | "audio_desequilibrado" | "sem_progressao" | "produto_insuficiente" | "encerramento_fraco";
export type ReviewFinding = { code: ReviewFindingCode; severity: "alta" | "media" | "baixa"; from: number; to: number; evidence: string };
export type AvReview = { findings: ReviewFinding[]; measured: Record<string, string | number>; limits: string[] };

const t = (s: number) => `${s.toFixed(1)} s`;

/** Distância de Hamming entre dois dHash de 64 bits. */
export function hashDistance(a: bigint, b: bigint): number {
  let x = a ^ b, n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

export function reviewAudiovisual(input: ReviewInput): AvReview {
  const f: ReviewFinding[] = [];
  const shots = input.shots;
  const first = shots[0];
  const last = shots[shots.length - 1];
  // Gancho: curto, com texto ou fala logo no início e movimento.
  if (first) {
    const len = first.end - first.start;
    if (len > 2.2) f.push({ code: "gancho_fraco", severity: "alta", from: first.start, to: first.end, evidence: `1º plano dura ${t(len)} (máx. 2,2 s)` });
    if (!first.texts.length && !first.narration) f.push({ code: "gancho_fraco", severity: "alta", from: 0, to: Math.min(1.5, first.end), evidence: "sem frase na tela nem fala no 1º plano" });
    if ((first.motion ?? 10) < 1.5) f.push({ code: "gancho_fraco", severity: "media", from: 0, to: first.end, evidence: `1º plano quase parado (movimento ${first.motion?.toFixed(1)})` });
    if (input.hasNarration && !input.lines.some((l) => l.start < 0.6)) f.push({ code: "gancho_fraco", severity: "baixa", from: 0, to: 0.6, evidence: "a voz só entra depois de 0,6 s" });
  }
  // Ritmo: variação da duração dos planos e planos longos parados.
  const durs = shots.slice(0, -1).map((s) => s.end - s.start);
  const mean = durs.reduce((a, b) => a + b, 0) / Math.max(1, durs.length);
  const cv = Math.sqrt(durs.reduce((a, d) => a + (d - mean) ** 2, 0) / Math.max(1, durs.length)) / Math.max(0.01, mean);
  if (durs.length >= 4 && cv < 0.18) f.push({ code: "ritmo_inconsistente", severity: "media", from: 0, to: input.duration, evidence: `planos todos com ~${mean.toFixed(1)} s (variação ${Math.round(cv * 100)}%): ritmo de metrônomo` });
  for (const s of shots) {
    const len = s.end - s.start;
    if (s !== last && len > 3.6 && (s.motion ?? 10) < 2 && !s.narration) f.push({ code: "movimento_sem_intencao", severity: "media", from: s.start, to: s.end, evidence: `plano ${s.index + 1} (${s.kind}) parado por ${t(len)} sem fala` });
  }
  // Redundância: planos seguidos visualmente quase iguais.
  shots.forEach((s, i) => {
    const prev = shots[i - 1];
    if (prev?.hash !== undefined && s.hash !== undefined) {
      const d = hashDistance(prev.hash, s.hash);
      if (d <= 6) f.push({ code: "cenas_redundantes", severity: "media", from: prev.start, to: s.end, evidence: `planos ${i} e ${i + 1} quase iguais (dHash ${d}/64)` });
    }
  });
  // Progressão: papel repetido em sequência, falta de revelação/prova, CTA no fim.
  shots.forEach((s, i) => {
    const prev = shots[i - 1];
    if (prev?.role && s.role && prev.role === s.role && !["clue"].includes(s.role)) f.push({ code: "sem_progressao", severity: "baixa", from: prev.start, to: s.end, evidence: `dois planos seguidos com a mesma função (${s.role})` });
  });
  if (shots.some((s) => s.role) && !shots.some((s) => s.role === "reveal" || s.role === "proof")) f.push({ code: "sem_progressao", severity: "media", from: 0, to: input.duration, evidence: "nenhum plano de revelação ou prova do produto" });
  // Produto em cena.
  const productTime = shots.filter((s) => s.product).reduce((a, s) => a + (s.end - s.start), 0);
  if (productTime / Math.max(0.1, input.duration) < 0.6) f.push({ code: "produto_insuficiente", severity: "media", from: 0, to: input.duration, evidence: `produto em ${Math.round((productTime / input.duration) * 100)}% do tempo` });
  // Encerramento.
  if (last) {
    const len = last.end - last.start;
    if (len < 2.4) f.push({ code: "encerramento_fraco", severity: "media", from: last.start, to: last.end, evidence: `fechamento de ${t(len)} (curto para ler a chamada)` });
    if (first && last.texts.some((x) => first.texts.some((y) => y.replace(/\*/g, "").toLowerCase() === x.replace(/\*/g, "").toLowerCase()))) f.push({ code: "encerramento_fraco", severity: "media", from: last.start, to: last.end, evidence: "o fechamento repete a frase do gancho" });
  }
  // Narração: velocidade, entonação (proxy de naturalidade), pausas.
  for (const l of input.lines) {
    if (l.syllablesPerSecond > 7.2) f.push({ code: "narracao_artificial", severity: "media", from: l.start, to: l.end, evidence: `"${l.line}" a ${l.syllablesPerSecond.toFixed(1)} sílabas/s (corrido)` });
    if (l.syllablesPerSecond < 3.2) f.push({ code: "narracao_artificial", severity: "baixa", from: l.start, to: l.end, evidence: `"${l.line}" a ${l.syllablesPerSecond.toFixed(1)} sílabas/s (arrastado)` });
    if (l.pitchStd !== undefined && l.end - l.start >= 1 && l.pitchStd < 1.4) f.push({ code: "narracao_artificial", severity: "media", from: l.start, to: l.end, evidence: `"${l.line}" com entonação plana (variação ${l.pitchStd.toFixed(1)} semitons)` });
    if (l.longestInnerPause > 0.8) f.push({ code: "pausas_inadequadas", severity: "media", from: l.start, to: l.end, evidence: `pausa de ${t(l.longestInnerPause)} no meio de "${l.line}"` });
  }
  input.lines.forEach((l, i) => {
    const next = input.lines[i + 1];
    const tensionBetween = shots.some((s) => s.role === "tension" && s.start < next?.start! && s.end > l.end);
    if (next && next.start - l.end > 2.2 && !tensionBetween) f.push({ code: "pausas_inadequadas", severity: "baixa", from: l.end, to: next.start, evidence: `${t(next.start - l.end)} de silêncio de voz entre falas` });
  });
  // Áudio: voz acima da trilha em cada fala, picos e volume percebido.
  (input.audio.voiceOverMusicDb ?? []).forEach((db, i) => {
    const l = input.lines[i];
    if (l && db < 6) f.push({ code: "audio_desequilibrado", severity: db < 3 ? "alta" : "media", from: l.start, to: l.end, evidence: `voz só ${db.toFixed(1)} dB acima da trilha em "${l.line}" (mín. 6 dB)` });
  });
  if ((input.audio.truePeakDb ?? -9) > -1) f.push({ code: "audio_desequilibrado", severity: "alta", from: 0, to: input.duration, evidence: `pico real ${input.audio.truePeakDb} dBTP (máx. −1)` });
  if (input.audio.integratedLufs !== undefined && Math.abs(input.audio.integratedLufs + 14) > 1.5) f.push({ code: "audio_desequilibrado", severity: "media", from: 0, to: input.duration, evidence: `volume percebido ${input.audio.integratedLufs} LUFS (alvo −14 ± 1,5)` });
  const rank = { alta: 0, media: 1, baixa: 2 };
  f.sort((a, b) => rank[a.severity] - rank[b.severity] || a.from - b.from);
  return {
    findings: f,
    measured: { planos: shots.length, planoMedio: +mean.toFixed(2), variacaoDoRitmo: Math.round(cv * 100), produtoNaTela: Math.round((productTime / Math.max(0.1, input.duration)) * 100), falas: input.lines.length, ...(input.audio.integratedLufs !== undefined ? { lufs: input.audio.integratedLufs } : {}), ...(input.audio.truePeakDb !== undefined ? { picoDbtp: input.audio.truePeakDb } : {}) },
    limits: ["A revisão não ouve: naturalidade, timbre e emoção da voz e da trilha são estimados por medidas (variação do tom, sílabas/s, pausas, níveis) e precisam de escuta humana.", "Legibilidade é estimada pelo tempo de leitura e pela luz sob o texto, não por leitura real."],
  };
}
