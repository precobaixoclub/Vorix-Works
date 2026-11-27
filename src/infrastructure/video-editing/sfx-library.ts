/**
 * Sound Design — biblioteca LOCAL de efeitos sonoros sintetizados pelo FFmpeg a partir de fórmulas deste
 * arquivo (sem amostras de terceiros): obra própria da Vorix, sem licença externa — uso comercial e SaaS
 * livres. Gerados uma vez por versão e reaproveitados (cache em disco).
 *
 * Paletas: soft (sofisticado), crisp (tecnologia), punchy (energia), warm (acolhedor) — escolhidas pela
 * identidade da marca; o tipo do efeito vem do evento visual (clique, revelação, transição, impacto).
 */

import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { SFX_SECONDS, type SfxKind } from "../../application/video-editing/audiovisual-direction.js";
import { runFfmpegCapture } from "./ffmpeg-media-analysis.js";

export const SFX_LIBRARY_VERSION = "sfx-1";

/** Fórmula (aevalsrc ou ruído filtrado) e duração de cada efeito. */
const RECIPES: Record<SfxKind, { source: string; filter: string }> = {
  click: { source: "aevalsrc=0.7*exp(-t*90)*sin(2*PI*1900*t)+0.25*exp(-t*140)*sin(2*PI*3800*t)", filter: "highpass=f=400" },
  soft_click: { source: "aevalsrc=0.45*exp(-t*55)*sin(2*PI*1150*t)", filter: "lowpass=f=5000" },
  tick: { source: "aevalsrc=0.5*exp(-t*160)*sin(2*PI*2900*t)", filter: "highpass=f=800" },
  pop: { source: "aevalsrc=0.7*exp(-t*22)*sin(2*PI*(380*t+2400*t*t))", filter: "lowpass=f=6000" },
  impact: { source: "aevalsrc=0.9*exp(-t*6)*sin(2*PI*(52+110*exp(-t*18))*t)+0.15*exp(-t*30)*(2*random(0)-1)", filter: "lowpass=f=2600" },
  impact_soft: { source: "aevalsrc=0.55*exp(-t*8)*sin(2*PI*(70+80*exp(-t*20))*t)", filter: "lowpass=f=1800" },
  whoosh: { source: "anoisesrc=color=pink:amplitude=0.6", filter: "highpass=f=250,lowpass=f=4500,afade=t=in:d=0.28,afade=t=out:st=0.28:d=0.22" },
  whoosh_soft: { source: "anoisesrc=color=brown:amplitude=0.5", filter: "highpass=f=180,lowpass=f=2200,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.25" },
  reveal: { source: "aevalsrc=0.18*(sin(2*PI*880*t)+sin(2*PI*1320*t)+sin(2*PI*1760*t))*(1-exp(-t*12))*exp(-t*3)", filter: "aecho=0.7:0.5:60:0.25" },
  shimmer: { source: "aevalsrc=0.12*(sin(2*PI*1568*t)+sin(2*PI*2093*t)+sin(2*PI*2637*t))*(0.6+0.4*sin(2*PI*9*t))*(1-exp(-t*8))*exp(-t*2.5)", filter: "aecho=0.6:0.5:90:0.3,highpass=f=600" },
  riser: { source: "aevalsrc=0.25*(t/1)*sin(2*PI*(200*t+600*t*t))+0.12*(t/1)*(2*random(0)-1)", filter: "highpass=f=150,lowpass=f=7000" },
};

export const SFX_KINDS = Object.keys(RECIPES) as SfxKind[];

/** Caminho do efeito (gerado na primeira vez). */
export async function sfxFile(dir: string, kind: SfxKind): Promise<string> {
  const recipe = { ...RECIPES[kind], seconds: SFX_SECONDS[kind] };
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${SFX_LIBRARY_VERSION}-${kind}.wav`);
  if (existsSync(file)) return file;
  const temp = `${file}.${process.pid}.tmp.wav`;
  const result = await runFfmpegCapture(["-y", "-f", "lavfi", "-i", `${recipe.source}:${recipe.source.startsWith("anoisesrc") ? "r" : "s"}=48000:d=${recipe.seconds}`, "-af", `${recipe.filter},aresample=48000,aformat=channel_layouts=stereo,alimiter=limit=0.8`, "-t", String(recipe.seconds), temp], { timeoutMs: 30_000 });
  if (result.exitCode !== 0) throw new Error(`efeito ${kind} não gerado: ${result.stderr.slice(-200)}`);
  await rename(temp, file);
  return file;
}
