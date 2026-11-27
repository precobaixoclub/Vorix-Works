/**
 * Trilha ORIGINAL sintetizada pelo FFmpeg (aevalsrc): pad de acordes + arpejo + batida leve, sem
 * amostra nem obra de terceiros — não há licença envolvida. Usada quando o worker não tem biblioteca
 * licenciada instalada. Três climas (pelo estilo de edição) e progressões variadas pela semente, para
 * as peças de uma marca não soarem iguais.
 */

export type ProceduralMood = "elegante" | "dinamico" | "direto";

const PROGRESSIONS: readonly (readonly [number, number, number][])[] = [
  // Lá menor – Fá – Dó – Sol
  [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]],
  // Dó – Sol – Lá menor – Fá
  [[261.63, 329.63, 392], [196, 246.94, 293.66], [220, 261.63, 329.63], [174.61, 220, 261.63]],
  // Ré menor – Si bemol – Fá – Dó
  [[146.83, 174.61, 220], [233.08, 293.66, 349.23], [174.61, 220, 261.63], [261.63, 329.63, 392]],
];

const MOODS: Record<ProceduralMood, { bar: number; step: number; kick: number; kickGain: number; arpGain: number; padGain: number }> = {
  elegante: { bar: 3.2, step: 0.4, kick: 0.8, kickGain: 0.22, arpGain: 0.07, padGain: 0.055 },
  direto: { bar: 2.4, step: 0.3, kick: 0.6, kickGain: 0.36, arpGain: 0.085, padGain: 0.05 },
  dinamico: { bar: 1.92, step: 0.24, kick: 0.48, kickGain: 0.42, arpGain: 0.09, padGain: 0.045 },
};

function channel(mood: ProceduralMood, progression: readonly [number, number, number][], detune: number): string {
  const m = MOODS[mood];
  const bar = `mod(floor(t/${m.bar})\\,4)`;
  const pick = (index: 0 | 1 | 2) => {
    const [a, b, c, d] = progression.map((chord) => chord[index]);
    return `if(eq(${bar}\\,0)\\,${a}\\,if(eq(${bar}\\,1)\\,${b}\\,if(eq(${bar}\\,2)\\,${c}\\,${d})))`;
  };
  const [f1, f2, f3] = [pick(0), pick(1), pick(2)];
  const pad = `${m.padGain}*(sin(2*PI*${f1}*t)+sin(2*PI*${f1}*${detune}*t)+sin(2*PI*${f2}*t)+sin(2*PI*${f3}*t))*(0.75+0.25*sin(2*PI*0.21*t))`;
  const note = `mod(floor(t/${m.step})\\,4)`;
  const arpF = `if(eq(${note}\\,0)\\,${f1}*2\\,if(eq(${note}\\,1)\\,${f2}*2\\,if(eq(${note}\\,2)\\,${f3}*2\\,${f2}*2)))`;
  const arp = `${m.arpGain}*exp(-mod(t\\,${m.step})*9)*sin(2*PI*${arpF}*t)`;
  const kick = `${m.kickGain}*exp(-mod(t\\,${m.kick})*16)*sin(2*PI*(48+90*exp(-mod(t\\,${m.kick})*28))*mod(t\\,${m.kick}))`;
  const hat = `0.03*exp(-mod(t+${m.kick / 2}\\,${m.kick})*55)*(2*random(0)-1)`;
  const intro = "min(1\\,t/3)";
  return `(${pad}+${arp}+${kick}*${intro}+${hat}*${intro})`;
}

/** Argumentos do FFmpeg que gravam a trilha (WAV 48 kHz estéreo) em `output`. */
export function proceduralMusicArgs(input: { mood: ProceduralMood; seconds: number; seed: number; output: string }): string[] {
  const progression = PROGRESSIONS[Math.abs(Math.floor(input.seed)) % PROGRESSIONS.length]!;
  const seconds = Math.max(5, Math.min(120, Math.ceil(input.seconds)));
  return [
    "-hide_banner", "-y", "-f", "lavfi",
    "-i", `aevalsrc=${channel(input.mood, progression, 1.003)}|${channel(input.mood, progression, 0.997)}:s=48000:d=${seconds}`,
    "-af", "aecho=0.8:0.6:90|170:0.22|0.14,highpass=f=35,lowpass=f=11000,loudnorm=I=-16:TP=-2",
    "-ar", "48000", input.output,
  ];
}

/** Semente estável a partir de um texto (ex.: id do projeto). */
export function musicSeed(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}
