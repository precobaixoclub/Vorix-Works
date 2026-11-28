/**
 * Finalização sonora: voz tratada (passa-altas, compressão suave, presença) + trilha (já com ducking exato,
 * ver `score-composer.ts`) → limitador → loudness em DUAS passagens (−14 LUFS integrado, pico −1,5 dBTP).
 * O teto final (−2,9 dBFS) deixa folga para os picos entre amostras que o AAC cria (medido: até +1 dB).
 * A primeira passagem mede; a segunda aplica a correção linear (sem "bombear" o volume).
 */

import { runFfmpegCapture } from "./ffmpeg-media-analysis.js";

const VOICE_CHAIN = "highpass=f=80,acompressor=threshold=-18dB:ratio=3:attack=5:release=90:makeup=3,equalizer=f=3000:t=q:w=1:g=2";

/**
 * Voz tratada num arquivo PRÓPRIO: a mixagem usa este arquivo e a revisão mede ESTE arquivo — o equilíbrio
 * voz × trilha medido é o mesmo que se ouve.
 */
export async function processVoice(input: string, output: string): Promise<void> {
  const r = await runFfmpegCapture(["-y", "-i", input, "-af", `${VOICE_CHAIN},aresample=48000`, "-ac", "1", "-c:a", "pcm_s16le", output], { timeoutMs: 120_000 });
  if (r.exitCode !== 0) throw new Error("falha ao tratar a voz");
}

function graph(hasVoice: boolean, loudnorm: string) {
  return hasVoice
    ? `[1:a][2:a]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89:level=0,${loudnorm}[a]`
    : `[1:a]alimiter=limit=0.89:level=0,${loudnorm}[a]`;
}

export async function masterAudio(input: { video: string; music: string; voice?: string; output: string; targetLufs?: number }): Promise<{ integratedLufs: number; truePeakDb: number }> {
  const target = input.targetLufs ?? -14;
  const inputs = ["-i", input.video, "-i", input.music, ...(input.voice ? ["-i", input.voice] : [])];
  const first = `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`;
  const probe = await runFfmpegCapture(["-y", ...inputs, "-filter_complex", graph(Boolean(input.voice), first), "-map", "[a]", "-f", "null", "-"], { timeoutMs: 300_000 });
  const json = probe.stderr.slice(probe.stderr.lastIndexOf("{"), probe.stderr.lastIndexOf("}") + 1);
  const m = JSON.parse(json) as Record<string, string>;
  const second = `loudnorm=I=${target}:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,alimiter=limit=0.72:level=0,aresample=48000`;
  const out = await runFfmpegCapture(["-y", ...inputs, "-filter_complex", graph(Boolean(input.voice), second), "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", input.output], { timeoutMs: 300_000 });
  if (out.exitCode !== 0) throw new Error(`falha na finalização sonora: ${out.stderr.slice(-600)}`);
  return { integratedLufs: Number(m.output_i ?? NaN), truePeakDb: Number(m.output_tp ?? NaN) };
}

/** Monta a faixa de voz: cada fala (WAV mono) no instante dela, silêncio entre elas. */
export async function assembleVoiceTrack(input: { lines: { file: string; at: number; from?: number; to?: number }[]; seconds: number; output: string }): Promise<void> {
  const { readWavMono } = await import("./av-measure.js");
  const { writeWav } = await import("./score-composer.js");
  const rate = 48000;
  const track = new Float32Array(Math.ceil(input.seconds * rate));
  for (const line of input.lines) {
    // Reamostragem de QUALIDADE (filtro longo do FFmpeg) para 48 kHz: interpolação linear criava imagens
    // de alta frequência (brilho metálico e picos que estouram depois do AAC).
    const resampled = `${line.file}.48k.wav`;
    const r = await runFfmpegCapture(["-y", "-i", line.file, "-af", "aresample=48000:filter_size=64:cutoff=0.95", "-ac", "1", "-c:a", "pcm_s16le", resampled], { timeoutMs: 60_000 });
    if (r.exitCode !== 0) throw new Error("falha ao reamostrar a fala");
    const wav = await readWavMono(resampled);
    const start = Math.floor(line.at * rate);
    const a = Math.max(0, Math.floor((line.from ?? 0) * rate));
    const b = Math.min(wav.samples.length, line.to === undefined ? wav.samples.length : Math.ceil(line.to * rate));
    // Rampas de 8 ms nas bordas da fatia (corte na respiração sem clique).
    const ramp = Math.floor(0.008 * rate);
    for (let i = a; i < b && start + i - a < track.length; i += 1) {
      const g = Math.min(1, (i - a) / ramp, (b - 1 - i) / ramp);
      track[start + i - a] += wav.samples[i]! * Math.max(0, g);
    }
  }
  await writeWav(input.output, track, track);
}
