/**
 * Smart Reframing — trilha de enquadramento (puro, testável). Recebe amostras da região de interesse no
 * tempo (centro + peso, normalizados na mídia) e devolve quadros-chave suaves para recortar um material
 * horizontal num quadro vertical: zona morta (não persegue tremidas), velocidade máxima (sem chicote),
 * mudança de alvo só quando o interesse se sustenta, e o recorte nunca sai da mídia.
 */

export type RoiSample = { t: number; cx: number; cy: number; weight: number };
export type ReframeKey = { t: number; cx: number; cy: number; zoom: number };

export function smoothReframeTrack(samples: readonly RoiSample[], options: { sourceAspect: number; targetAspect: number; zoom?: number; deadZone?: number; maxSpeed?: number; hold?: number }): ReframeKey[] {
  if (!samples.length) return [];
  // Tamanho do recorte em frações da mídia: altura cheia (zoom 1) ou mais fechada; largura pela proporção.
  const zoom = Math.max(1, options.zoom ?? 1);
  const cropH = 1 / zoom;
  const cropW = Math.min(1, (cropH * options.targetAspect) / options.sourceAspect);
  const clampX = (x: number) => Math.min(1 - cropW / 2, Math.max(cropW / 2, x));
  const clampY = (y: number) => Math.min(1 - cropH / 2, Math.max(cropH / 2, y));
  const dead = options.deadZone ?? 0.08;
  const maxSpeed = options.maxSpeed ?? 0.18; // fração da mídia por segundo
  const hold = options.hold ?? 0.6; // o alvo novo precisa se manter por esse tempo
  const keys: ReframeKey[] = [];
  let cx = clampX(samples[0]!.cx);
  let cy = clampY(samples[0]!.cy);
  let pending: { cx: number; cy: number; since: number } | undefined;
  let target = { cx, cy };
  let lastT = samples[0]!.t;
  for (const sample of samples) {
    const dt = Math.max(0, sample.t - lastT);
    lastT = sample.t;
    const wanted = { cx: clampX(sample.cx), cy: clampY(sample.cy) };
    const far = Math.abs(wanted.cx - target.cx) > dead || Math.abs(wanted.cy - target.cy) > dead;
    if (far && sample.weight > 0.15) {
      if (!pending || Math.abs(pending.cx - wanted.cx) > dead || Math.abs(pending.cy - wanted.cy) > dead) pending = { ...wanted, since: sample.t };
      else if (sample.t - pending.since >= hold) { target = { cx: pending.cx, cy: pending.cy }; pending = undefined; }
    } else pending = undefined;
    const step = maxSpeed * dt;
    cx += Math.max(-step, Math.min(step, target.cx - cx));
    cy += Math.max(-step, Math.min(step, target.cy - cy));
    keys.push({ t: Math.round(sample.t * 1000) / 1000, cx: Math.round(clampX(cx) * 10000) / 10000, cy: Math.round(clampY(cy) * 10000) / 10000, zoom });
  }
  return keys;
}
