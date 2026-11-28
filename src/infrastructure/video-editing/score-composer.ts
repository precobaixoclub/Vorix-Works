/**
 * TRILHA COMPOSTA PARA O STORYBOARD (obra própria, sem amostra nem obra de terceiros — não há licença
 * envolvida). Diferente da trilha procedural antiga (soma de senoides no `aevalsrc`), aqui há instrumentos
 * de verdade sintetizados amostra a amostra: bumbo com pitch e clique, clap/caixa de ruído filtrado,
 * chimbal, baixo serrilhado com filtro, teclado FM (timbre de piano elétrico), pluck Karplus-Strong,
 * pad com vozes desafinadas, riser e impactos — e reverb/delay/sidechain/limitador no master.
 *
 * O ARRANJO segue as seções do storyboard (energia por plano) e os EVENTOS de áudio (entrada de cada
 * elemento, troca de cor, pouso da estampa, logo): a música é escrita para o corte, não o contrário.
 */

import { writeFile } from "node:fs/promises";

export type ScoreMood = "elegant" | "pop" | "cinematic";
export type ScoreSection = { from: number; to: number; energy: number; kind: string };
export type ScoreEvent = { at: number; kind: "hit" | "pop" | "whoosh" | "switch" | "land" | "riser_end" | "logo" | "click" | "tension_stop" | "drop"; strength: number };
export type ScoreInput = {
  bpm: number; seconds: number; mood: ScoreMood; sections: ScoreSection[]; events: ScoreEvent[]; seed?: number; tailSeconds?: number;
  /** Ducking EXATO: intervalos em que a voz fala (segundos) e quanto a trilha abaixa (dB). */
  /** Ducking sob a voz. `depthDb` por trecho sobrepõe o geral (ex.: fala logo depois de um impacto). */
  duck?: { intervals: { from: number; to: number; depthDb?: number }[]; depthDb: number; lookaheadSeconds?: number };
  /** Swing das colcheias (0 = reto; 0,08 = suingado). */
  swing?: number;
};

const SR = 48000;
const TAU = Math.PI * 2;
const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; };
}

/** Filtro de variáveis de estado (Chamberlin): passa-baixa/banda/alta, cutoff por amostra. */
class Svf {
  low = 0; band = 0;
  run(x: number, cutoff: number, q = 0.7) {
    const f = 2 * Math.sin(Math.PI * Math.min(0.24, cutoff / SR));
    const high = x - this.low - q * this.band;
    this.band += f * high;
    this.low += f * this.band;
    return { low: this.low, band: this.band, high };
  }
}

/** Reverb (Freeverb reduzido): 4 pentes + 2 passa-tudo por canal. */
class Reverb {
  private combs: { buf: Float32Array; i: number; store: number }[];
  private aps: { buf: Float32Array; i: number }[];
  constructor(offset: number, private room = 0.82, private damp = 0.3) {
    this.combs = [1116, 1188, 1277, 1356].map((n) => ({ buf: new Float32Array(n + offset), i: 0, store: 0 }));
    this.aps = [556, 441].map((n) => ({ buf: new Float32Array(n + offset), i: 0 }));
  }
  run(x: number) {
    let out = 0;
    for (const c of this.combs) {
      const y = c.buf[c.i]!;
      c.store = y * (1 - this.damp) + c.store * this.damp;
      c.buf[c.i] = x + c.store * this.room;
      c.i = (c.i + 1) % c.buf.length;
      out += y;
    }
    for (const a of this.aps) {
      const b = a.buf[a.i]!;
      a.buf[a.i] = out + b * 0.5;
      out = b - out;
      a.i = (a.i + 1) % a.buf.length;
    }
    return out * 0.25;
  }
}

type Voice = (t: number) => number; // amostra (mono) no tempo t desde o início da nota; NaN = acabou

const kick = (punch = 1): Voice => (t) => {
  if (t > 0.45) return NaN;
  const pitch = 48 + 110 * Math.exp(-t * 32);
  const phase = TAU * (48 * t + (110 / 32) * (1 - Math.exp(-t * 32)));
  return (Math.sin(phase) * Math.exp(-t * 7.5) + (t < 0.004 ? 0.5 * Math.sin(TAU * 3000 * t) : 0)) * punch * (pitch > 0 ? 1 : 0);
};

function noiseVoice(seed: number, dur: number, decay: number, cutoff: number, mode: "low" | "band" | "high", q = 0.6): Voice {
  const r = rng(seed); const f = new Svf();
  return (t) => (t > dur ? NaN : f.run(r(), cutoff, q)[mode] * Math.exp(-t * decay));
}

const clap = (seed: number): Voice => {
  const n = noiseVoice(seed, 0.35, 0, 1600, "band", 0.4);
  return (t) => {
    if (t > 0.35) return NaN;
    const env = [0, 0.011, 0.022].reduce((a, o) => a + (t >= o ? Math.exp(-(t - o) * 70) : 0), 0) * 0.55 + (t >= 0.022 ? Math.exp(-(t - 0.022) * 16) : 0);
    return n(t) * env * 1.6;
  };
};

/** Piano elétrico por FM (portadora 1:1 com índice que decai) — calor sem amostra. */
const keys = (midi: number, dur: number, vel = 1): Voice => {
  const f = mtof(midi);
  return (t) => {
    if (t > dur + 0.6) return NaN;
    const rel = t > dur ? Math.exp(-(t - dur) * 7) : 1;
    const idx = 1.6 * Math.exp(-t * 3.2) + 0.25;
    return Math.sin(TAU * f * t + idx * Math.sin(TAU * f * t)) * Math.exp(-t * 1.4) * rel * 0.5 * vel;
  };
};

/** Corda dedilhada (Karplus-Strong). */
const pluck = (midi: number, seed: number, bright = 0.5): Voice => {
  const n = Math.max(2, Math.round(SR / mtof(midi)));
  const buf = new Float32Array(n);
  const r = rng(seed);
  for (let i = 0; i < n; i += 1) buf[i] = r();
  let i = 0; let last = 0; let k = 0;
  return (t) => {
    if (t > 1.6) return NaN;
    while (k < Math.round(t * SR)) { const cur = buf[i]!; const nxt = buf[(i + 1) % n]!; buf[i] = (cur * (1 - bright) + nxt * bright) * 0.996; last = cur; i = (i + 1) % n; k += 1; }
    return last * 0.6;
  };
};

const bass = (midi: number, dur: number, cutoff: number): Voice => {
  const f = mtof(midi); const flt = new Svf();
  return (t) => {
    if (t > dur + 0.08) return NaN;
    const saw = 2 * ((f * t) % 1) - 1;
    const env = Math.min(1, t / 0.005) * (t > dur ? Math.exp(-(t - dur) * 40) : 1) * Math.exp(-t * 1.2);
    return (flt.run(saw, cutoff * (0.6 + 0.8 * Math.exp(-t * 9)), 0.5).low * 0.8 + Math.sin(TAU * f * t) * 0.35) * env;
  };
};

const pad = (midis: number[], dur: number, cutoff: number): Voice => {
  const flt = new Svf();
  const fs = midis.flatMap((m) => [mtof(m) * 1.003, mtof(m) * 0.997]);
  return (t) => {
    if (t > dur + 0.5) return NaN;
    const env = Math.min(1, t / 0.12) * (t > dur ? Math.exp(-(t - dur) * 5) : 1);
    let s = 0;
    for (const f of fs) s += 2 * ((f * t + f * 0.1) % 1) - 1;
    return flt.run(s / fs.length, cutoff, 0.4).low * env * 0.9;
  };
};

const bell = (midi: number): Voice => {
  const f = mtof(midi);
  return (t) => (t > 3 ? NaN : Math.sin(TAU * f * t + 2.2 * Math.exp(-t * 2) * Math.sin(TAU * f * 3.5 * t)) * Math.exp(-t * 1.5) * 0.45);
};

const riser = (seed: number, dur: number): Voice => {
  const r = rng(seed); const flt = new Svf();
  return (t) => {
    if (t > dur) return NaN;
    const p = t / dur;
    return (flt.run(r(), 300 + 7000 * p * p, 0.5).band * 0.9 + Math.sin(TAU * (200 + 500 * p * p) * t) * 0.08) * p * p;
  };
};

const impact = (seed: number, strength: number): Voice => {
  const n = noiseVoice(seed, 1.2, 4, 900, "low", 0.7);
  return (t) => (t > 1.6 ? NaN : (Math.sin(TAU * (34 * t + (40 / 5) * (1 - Math.exp(-t * 5)))) * Math.exp(-t * 2.6) * 0.9 + n(t) * 0.6) * strength);
};

const whoosh = (seed: number, dur: number, strength: number): Voice => {
  const r = rng(seed); const flt = new Svf();
  return (t) => {
    if (t > dur) return NaN;
    const p = t / dur;
    return flt.run(r(), 400 + 5000 * Math.sin(Math.PI * p), 0.9).band * Math.sin(Math.PI * p) ** 2 * strength;
  };
};

type Note = { at: number; voice: Voice; bus: "drums" | "bass" | "music" | "fx"; gain: number; pan: number; send: number };

const MOODS: Record<ScoreMood, { root: number; minor: boolean; prog: number[] }> = {
  elegant: { root: 50, minor: false, prog: [0, 9, 5, 7] }, // Ré maior: I – vi – IV – V
  pop: { root: 57, minor: true, prog: [0, 8, 3, 10] }, // Lá menor: i – VI – III – VII
  cinematic: { root: 45, minor: true, prog: [0, 8, 5, 10] },
};

function chordNotes(root: number, degree: number, minor: boolean) {
  const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const base = root + degree;
  // Tríade em posição próxima do centro (voice leading simples).
  const third = scale.includes((degree + 4) % 12) ? 4 : 3;
  return [base, base + third, base + 7].map((m) => (m > root + 9 ? m - 12 : m));
}

export function composeScore(input: ScoreInput): { left: Float32Array; right: Float32Array; notes: number } {
  const beat = 60 / input.bpm;
  const tail = input.tailSeconds ?? 1.5;
  const total = Math.ceil((input.seconds + tail) * SR);
  const mood = MOODS[input.mood];
  const seed = input.seed ?? 7;
  const notes: Note[] = [];
  const add = (at: number, voice: Voice, bus: Note["bus"], gain: number, pan = 0, send = 0.15) => { if (at >= 0 && at < input.seconds + tail) notes.push({ at, voice, bus, gain, pan, send }); };
  const energyAt = (t: number) => input.sections.find((s) => t >= s.from && t < s.to)?.energy ?? input.sections[input.sections.length - 1]?.energy ?? 0.5;
  const kindAt = (t: number) => input.sections.find((s) => t >= s.from && t < s.to)?.kind ?? "";
  const bars = Math.ceil(input.seconds / (beat * 4));
  const scale = mood.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  for (let bar = 0; bar < bars; bar += 1) {
    const chord = chordNotes(mood.root, mood.prog[bar % 4]!, mood.minor);
    for (let b = 0; b < 4; b += 1) {
      const t = (bar * 4 + b) * beat;
      if (t >= input.seconds) break;
      const e = energyAt(t);
      const k = kindAt(t);
      const ending = k === "logo_resolve";
      // Harmonia: pad sempre; teclado/pluck na elegante; acordes cheios na pop.
      if (b === 0) {
        add(t, pad(chord.map((m) => m + 12), beat * 4, 900 + 2200 * e), "music", input.mood === "cinematic" ? 0.5 : 0.32, 0, 0.35);
        if (input.mood !== "cinematic") for (const [i, m] of chord.entries()) add(t + i * 0.012, keys(m + 12, beat * (ending ? 4 : 2), 0.8), "music", 0.28, (i - 1) * 0.3, 0.3);
      }
      if (input.mood === "elegant" && b === 2 && !ending) for (const [i, m] of chord.entries()) add(t + i * 0.012, keys(m + 12, beat * 1.5, 0.6), "music", 0.22, (i - 1) * 0.3, 0.3);
      if (ending) continue;
      // Bateria por energia: só no corpo do vídeo (o gancho tem o impacto; o fim, a resolução).
      const drums = e >= 0.55 && k !== "hook_type";
      if (drums) {
        const four = input.mood === "pop" && e >= 0.8;
        if (four || b === 0 || (b === 2 && e >= 0.7)) add(t, kick(input.mood === "cinematic" ? 1.2 : 1), "drums", 0.9);
        if ((b === 1 || b === 3) && input.mood !== "cinematic" && e >= 0.7) add(t, clap(seed + bar * 4 + b), "drums", 0.5, 0, 0.25);
        if (input.mood !== "cinematic") for (const off of e >= 0.85 ? [0.5] : [0.5]) add(t + off * beat, noiseVoice(seed + bar * 8 + b, 0.06, 60, 8000, "high"), "drums", 0.16 + 0.1 * e, b % 2 ? 0.25 : -0.25, 0.05);
        if (input.mood === "cinematic" && e >= 0.8) for (const off of [0, 0.5]) add(t + off * beat, bass(mood.root - 12, beat * 0.4, 500), "bass", 0.5);
      }
      if (e >= 0.7 && input.mood !== "cinematic") {
        const pattern = input.mood === "pop" ? [0, 0.5] : [0];
        for (const off of pattern) add(t + off * beat, bass(chord[0]! - 12 + (input.mood === "pop" && off ? 12 : 0), beat * (input.mood === "pop" ? 0.42 : 0.9), 420 + 500 * e), "bass", 0.55);
      }
    }
  }
  // Motivo melódico (identidade): 4 notas por compasso nas seções de pista/pergunta, com variação a cada
  // 2 compassos (a última nota sobe ou desce) — a trilha deixa de ser um laço de acordes.
  const motif = [0, 2, 4, 2];
  const swing = input.swing ?? (input.mood === "cinematic" ? 0 : 0.06);
  for (let bar = 0; bar < bars; bar += 1) {
    const t0 = bar * 4 * beat;
    const e = energyAt(t0);
    if (kindAt(t0) === "logo_resolve" || e < 0.5 || e > 0.95) continue;
    const root = chordNotes(mood.root, mood.prog[bar % 4]!, mood.minor)[0]! + 24;
    const steps = [0, 0.75, 1.5, 2.5];
    motif.forEach((degree, k) => {
      const varied = k === 3 && bar % 2 === 1 ? degree + (bar % 4 === 1 ? 2 : -1) : degree;
      const interval = scale[((varied % scale.length) + scale.length) % scale.length]! + 12 * Math.floor(varied / scale.length);
      const at = t0 + steps[k]! * beat + (k % 2 ? swing * beat : 0);
      add(at, input.mood === "cinematic" ? bell(root + interval - 12) : pluck(root + interval, seed + bar * 4 + k, 0.5), "music", input.mood === "cinematic" ? 0.18 : 0.34, (k - 1.5) * 0.2, 0.4);
    });
  }
  // Virada: semicolcheias de clap na meia batida antes de uma subida de energia.
  input.sections.forEach((s, k) => {
    const prev = input.sections[k - 1];
    if (!prev || s.energy - prev.energy < 0.25 || input.mood === "cinematic") return;
    for (let j = 0; j < 4; j += 1) add(s.from - beat / 2 + j * beat / 8, clap(seed + 900 + k * 8 + j), "drums", 0.18 + j * 0.06, 0, 0.2);
  });
  // Eventos do storyboard: cada movimento visual tem o seu som (melódico, não ruído aleatório).
  input.events.forEach((ev, i) => {
    const chord = chordNotes(mood.root, mood.prog[Math.floor(ev.at / (beat * 4)) % 4]!, mood.minor);
    switch (ev.kind) {
      case "hit": add(ev.at, impact(seed + i, ev.strength), "fx", 0.8, 0, 0.4); add(ev.at, kick(1.3), "drums", 0.9); break;
      case "pop": add(ev.at, pluck(mood.root + 24 + scale[i % scale.length]!, seed + i, 0.55), "music", 0.55 * ev.strength, ((i % 5) - 2) * 0.25, 0.35); break;
      case "land": add(ev.at, impact(seed + i, 0.5 * ev.strength), "fx", 0.6, 0, 0.3); break;
      case "whoosh": add(Math.max(0, ev.at - 0.18), whoosh(seed + i, 0.36, ev.strength), "fx", 0.35, (i % 2 ? 0.4 : -0.4), 0.3); break;
      case "switch": add(ev.at, whoosh(seed + i, 0.3, ev.strength), "fx", 0.32, (i % 2 ? 0.5 : -0.5), 0.25); break;
      case "riser_end": add(Math.max(0, ev.at - beat * 2), riser(seed + i, beat * 2), "fx", 0.35, 0, 0.3); break;
      case "logo": add(ev.at, impact(seed + i, 0.55), "fx", 0.6, 0, 0.5); for (const m of chord) add(ev.at, bell(m + 24), "music", 0.32, 0, 0.6); break;
      case "click": add(ev.at, (t) => (t > 0.02 ? NaN : Math.sin(TAU * 2200 * t) * Math.exp(-t * 300)), "fx", 0.25, 0, 0.1); break;
      // Tensão: um riser que termina no SILÊNCIO (a música segura uma batida antes da resposta).
      case "tension_stop": add(Math.max(0, ev.at - beat * 2), riser(seed + i, beat * 2), "fx", 0.4, 0, 0.35); break;
      // Revelação: impacto + bumbo + prato (ruído brilhante longo) e o motivo volta.
      case "drop": add(ev.at, impact(seed + i, 1), "fx", 0.85, 0, 0.5); add(ev.at, kick(1.4), "drums", 0.95); add(ev.at, noiseVoice(seed + 77 + i, 1.6, 2.2, 6500, "high", 0.5), "fx", 0.22, 0, 0.6); break;
    }
  });
  const stops = input.events.filter((e) => e.kind === "tension_stop").map((e) => ({ from: e.at, to: e.at + beat }));
  const inStop = (t: number) => stops.some((w) => t >= w.from - 0.01 && t < w.to);
  for (let k = notes.length - 1; k >= 0; k -= 1) if (notes[k]!.bus !== "fx" && inStop(notes[k]!.at)) notes.splice(k, 1);
  notes.sort((a, b) => a.at - b.at);
  const left = new Float32Array(total), right = new Float32Array(total);
  const fxL = new Float32Array(total), fxR = new Float32Array(total);
  const send = new Float32Array(total);
  const kickEnv = new Float32Array(total);
  for (const n of notes) {
    const start = Math.floor(n.at * SR);
    const gl = n.gain * Math.cos(((n.pan + 1) * Math.PI) / 4), gr = n.gain * Math.sin(((n.pan + 1) * Math.PI) / 4);
    for (let i = start; i < total; i += 1) {
      const v = n.voice((i - start) / SR);
      if (Number.isNaN(v)) break;
      if (n.bus === "fx") { fxL[i]! += v * gl; fxR[i]! += v * gr; } else { left[i]! += v * gl; right[i]! += v * gr; }
      send[i]! += v * n.gain * n.send;
      if (n.bus === "drums" && n.gain >= 0.85) kickEnv[i] = Math.max(kickEnv[i]!, Math.exp(-((i - start) / SR) * 9));
    }
  }
  // Sidechain leve (respiração do pad/baixo com o bumbo), reverb e limitador suave.
  const rl = new Reverb(0), rr = new Reverb(23);
  // Envelope da música: zera (com 25 ms de rampa) nas janelas de tensão; abaixa sob a voz (120/350 ms).
  const musicGain = new Float32Array(total).fill(1);
  for (const w of stops) for (let i = Math.floor(w.from * SR); i < Math.min(total, Math.floor(w.to * SR)); i += 1) musicGain[i] = Math.min(musicGain[i]!, Math.min(1, Math.max(0, (Math.floor(w.from * SR) + 0.025 * SR - i) / (0.025 * SR))));
  const duckGain = new Float32Array(total).fill(1);
  if (input.duck?.intervals.length) {
    // Antecipação (padrão 0,12 s = uma constante de ataque): a música já está baixa quando a 1ª sílaba entra.
    const ahead = input.duck.lookaheadSeconds ?? 0.12;
    const target = new Float32Array(total).fill(1);
    for (const iv of input.duck.intervals) {
      const floor = 10 ** (-Math.abs(iv.depthDb ?? input.duck.depthDb) / 20);
      for (let i = Math.max(0, Math.floor((iv.from - ahead) * SR)); i < Math.min(total, Math.floor(iv.to * SR)); i += 1) target[i] = Math.min(target[i]!, floor);
    }
    let g = 1;
    const att = Math.exp(-1 / (0.12 * SR)), rel = Math.exp(-1 / (0.35 * SR));
    for (let i = 0; i < total; i += 1) { const coef = target[i]! < g ? att : rel; g = target[i]! + (g - target[i]!) * coef; duckGain[i] = g; }
  }
  let peak = 0;
  for (let i = 0; i < total; i += 1) {
    const duck = (1 - 0.35 * kickEnv[i]!) * musicGain[i]! * duckGain[i]!;
    const fxDuck = duckGain[i]!;
    const wl = rl.run(send[i]!), wr = rr.run(send[i]!);
    left[i] = Math.tanh((left[i]! * duck + fxL[i]! * fxDuck + wl * 0.9 * duckGain[i]!) * 0.9);
    right[i] = Math.tanh((right[i]! * duck + fxR[i]! * fxDuck + wr * 0.9 * duckGain[i]!) * 0.9);
    peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  }
  const norm = peak > 0 ? 0.89 / peak : 1;
  const fadeStart = Math.floor((input.seconds + tail - 0.6) * SR);
  for (let i = 0; i < total; i += 1) {
    const fade = i > fadeStart ? Math.max(0, 1 - (i - fadeStart) / (0.6 * SR)) : 1;
    left[i] = left[i]! * norm * fade;
    right[i] = right[i]! * norm * fade;
  }
  return { left, right, notes: notes.length };
}

/** WAV PCM 16 bits estéreo 48 kHz (com dither triangular). */
export async function writeWav(path: string, left: Float32Array, right: Float32Array): Promise<void> {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  const r = rng(99);
  const q = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 32767 + (r() + r()) * 0.5)));
  for (let i = 0; i < n; i += 1) { buf.writeInt16LE(q(left[i]!), 44 + i * 4); buf.writeInt16LE(q(right[i]!), 46 + i * 4); }
  await writeFile(path, buf);
}

export async function composeScoreFile(path: string, input: ScoreInput) {
  const { left, right, notes } = composeScore(input);
  await writeWav(path, left, right);
  return { path, seconds: left.length / SR, notes };
}
