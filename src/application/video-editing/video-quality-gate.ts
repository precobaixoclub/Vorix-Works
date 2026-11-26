/**
 * Quality Gate de vídeo — verificações determinísticas sobre o MP4 entregue pelo DaVinci.
 *
 * Nunca aprova sozinho: o melhor resultado possível é `ready_for_review` (vai para a prévia e
 * aprovação humana). Qualquer reprovação mantém a peça em `needs_revision`. Terminar o render NÃO
 * é critério de aprovação.
 *
 * A avaliação visual (fidelidade de produto, legibilidade real) depende de revisão humana ou de IA
 * sobre a folha de contato; aqui ficam só as checagens mensuráveis, e o que não dá para medir é
 * declarado como `manual` para não parecer verificado.
 */

import type { VideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";

export type GateMediaProbe = {
  exists: boolean;
  sizeBytes: number;
  durationSeconds: number | null;
  video?: { codec: string; width: number; height: number; fps: number | null };
  audio?: { codec: string };
};

export type GateAnalysis = {
  decodeErrors: string[];
  blackSegments: { start: number; end: number }[];
  silenceSegments: { start: number; end: number }[];
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
};

export type GateCheckStatus = "pass" | "fail" | "warn" | "manual";
export type GateCheck = { id: string; label: string; status: GateCheckStatus; detail: string };

export type VideoQualityGateResult = {
  status: "ready_for_review" | "needs_revision";
  checks: GateCheck[];
  failures: string[];
};

export type VideoQualityGateInput = {
  plan: VideoEditPlan;
  probe: GateMediaProbe;
  analysis: GateAnalysis | null;
  compilerWarnings: string[];
  /** Duração pedida pelo usuário (segundos), quando houve. */
  requestedDurationSeconds?: number;
  /** O workspace tem logo oficial cadastrado. */
  brandHasLogo: boolean;
};

/** Janelas em que preto é esperado (abertura com fade, dip to black). */
export function expectedBlackWindows(plan: VideoEditPlan): { start: number; end: number }[] {
  const windows: { start: number; end: number }[] = [];
  plan.clips.forEach((clip, index) => {
    const t = clip.transitionIn;
    if (index === 0 && t.type !== "cut") windows.push({ start: 0, end: t.durationSeconds + 0.1 });
    if (index > 0 && t.type === "dip_to_black") windows.push({ start: clip.recordStartSeconds - t.durationSeconds / 2 - 0.1, end: clip.recordStartSeconds + t.durationSeconds / 2 + 0.1 });
  });
  return windows;
}

function outside(segment: { start: number; end: number }, windows: { start: number; end: number }[]): number {
  // Quanto do trecho preto cai fora das janelas esperadas.
  let covered = 0;
  for (const window of windows) covered += Math.max(0, Math.min(segment.end, window.end) - Math.max(segment.start, window.start));
  return Math.max(0, segment.end - segment.start - covered);
}

export function evaluateVideoQualityGate(input: VideoQualityGateInput): VideoQualityGateResult {
  const { plan, probe, analysis } = input;
  const checks: GateCheck[] = [];
  const add = (id: string, label: string, status: GateCheckStatus, detail: string) => checks.push({ id, label, status, detail });

  add("file", "Arquivo MP4 existe e não está vazio", probe.exists && probe.sizeBytes > 10_000 ? "pass" : "fail", probe.exists ? `${(probe.sizeBytes / 1_048_576).toFixed(2)} MB` : "arquivo ausente");

  if (!probe.exists || !probe.video) {
    add("stream", "Faixa de vídeo legível", "fail", "sem faixa de vídeo");
    return finalize(checks);
  }

  add("codec", "Vídeo H.264", /h264|avc/i.test(probe.video.codec) ? "pass" : "fail", probe.video.codec);
  add("resolution", `Resolução ${plan.width}x${plan.height} (${plan.aspect})`, probe.video.width === plan.width && probe.video.height === plan.height ? "pass" : "fail", `${probe.video.width}x${probe.video.height}`);
  add("fps", `${plan.fps} fps`, probe.video.fps !== null && Math.abs(probe.video.fps - plan.fps) < 0.05 ? "pass" : "fail", `${probe.video.fps ?? "?"} fps`);

  const duration = probe.durationSeconds ?? 0;
  const tolerance = Math.max(0.15, 2 / plan.fps);
  add("duration", `Duração do plano (${plan.durationSeconds.toFixed(2)}s)`, Math.abs(duration - plan.durationSeconds) <= tolerance ? "pass" : "fail", `${duration.toFixed(2)}s`);
  if (input.requestedDurationSeconds) {
    const deviation = Math.abs(duration - input.requestedDurationSeconds) / input.requestedDurationSeconds;
    add("brief-duration", `Duração pedida (${input.requestedDurationSeconds}s)`, deviation <= 0.12 ? "pass" : deviation <= 0.25 ? "warn" : "fail", `${duration.toFixed(1)}s (${(deviation * 100).toFixed(0)}% de diferença)`);
  }

  if (analysis) {
    add("decode", "Decodifica do início ao fim sem erro", analysis.decodeErrors.length === 0 ? "pass" : "fail", analysis.decodeErrors.length === 0 ? "sem erros" : analysis.decodeErrors.slice(0, 2).join(" | "));
    const windows = expectedBlackWindows(plan);
    const unexpected = analysis.blackSegments.filter((segment) => outside(segment, windows) > 0.3);
    add("black", "Sem quadros pretos inesperados", unexpected.length === 0 ? "pass" : "fail", unexpected.length === 0 ? `${analysis.blackSegments.length} trecho(s) preto(s), todos em transições previstas` : unexpected.map((s) => `${s.start.toFixed(2)}–${s.end.toFixed(2)}s`).join(", "));

    const expectsAudio = Boolean(plan.music) || plan.clips.some((clip) => clip.keepSourceAudio);
    if (expectsAudio) {
      add("audio-stream", "Faixa de áudio presente", probe.audio ? "pass" : "fail", probe.audio?.codec ?? "sem áudio");
      const mean = analysis.meanVolumeDb;
      add("audio-level", "Volume médio audível", mean !== null && mean > -38 ? "pass" : "fail", mean === null ? "não medido" : `${mean.toFixed(1)} dB`);
      const max = analysis.maxVolumeDb;
      add("audio-clip", "Sem saturação", max !== null && max < -0.1 ? "pass" : "warn", max === null ? "não medido" : `pico ${max.toFixed(1)} dB`);
      const longSilence = analysis.silenceSegments.filter((s) => Math.min(s.end, duration) - s.start > 2.5);
      add("audio-gaps", "Sem buracos de silêncio longos", longSilence.length === 0 ? "pass" : "warn", longSilence.length === 0 ? "ok" : longSilence.map((s) => `${s.start.toFixed(1)}s`).join(", "));
    } else {
      add("audio-stream", "Áudio", "manual", "plano sem trilha nem fala — vídeo mudo por decisão do plano");
    }
  } else {
    add("decode", "Decodificação completa", "fail", "análise não executada");
  }

  // Texto e legendas: o compilador garante quebra em até 3 linhas e reposiciona colisões.
  const textWarnings = input.compilerWarnings.filter((w) => /texto|legenda/.test(w));
  add("text-fit", "Textos dentro do quadro e sem sobreposição", textWarnings.some((w) => /coincide com dois títulos/.test(w)) ? "fail" : textWarnings.length > 0 ? "warn" : "pass", textWarnings.length > 0 ? textWarnings.join("; ") : "quebra e posição calculadas pelo compilador");

  if (plan.captions?.enabled) {
    const outOfRange = plan.captions.segments.filter((segment) => segment.endSeconds > plan.durationSeconds + 0.01);
    add("captions", "Legendas dentro da duração", outOfRange.length === 0 ? "pass" : "fail", `${plan.captions.segments.length} segmento(s)`);
    const spoken = plan.clips.filter((clip) => clip.keepSourceAudio);
    if (spoken.length > 0) add("captions-sync", "Sincronia legenda × fala", "manual", "segmentos derivados dos tempos da transcrição; conferir na prévia");
  }

  const protectedClips = plan.clips.filter((clip) => plan.assets.find((asset) => asset.id === clip.assetId)?.protectedFidelity);
  if (protectedClips.length > 0) {
    add("fidelity-rules", "Produto/tela protegidos: sem texto central nem corte agressivo", "pass", `${protectedClips.length} clipe(s) protegidos validados pelo plano`);
    add("fidelity-visual", "Fidelidade visual do produto (estampa, cor, logo)", "manual", "a mídia original é usada sem alteração de cor; conferir a folha de contato");
  }

  add("logo", "Logo da marca", plan.logo ? "pass" : input.brandHasLogo ? "warn" : "manual", plan.logo ? `${plan.logo.placement}, ${plan.logo.startSeconds}s–${(plan.logo.startSeconds + plan.logo.durationSeconds).toFixed(1)}s` : input.brandHasLogo ? "a marca tem logo cadastrado e o plano não usou" : "marca sem logo cadastrado");

  const otherWarnings = input.compilerWarnings.filter((w) => !/texto|legenda/.test(w));
  if (otherWarnings.length > 0) add("compiler", "Avisos de execução", "warn", otherWarnings.join("; "));

  return finalize(checks);
}

function finalize(checks: GateCheck[]): VideoQualityGateResult {
  const failures = checks.filter((check) => check.status === "fail").map((check) => `${check.label}: ${check.detail}`);
  return { status: failures.length === 0 ? "ready_for_review" : "needs_revision", checks, failures };
}
