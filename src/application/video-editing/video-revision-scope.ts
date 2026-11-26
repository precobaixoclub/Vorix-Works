import type { VideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";
import { interpretRejection } from "../creative-engine/feedback-interpretation.js";
import { resolveRedoScope, type RedoScope } from "../creative-engine/redo-scope.js";

/**
 * Refação direcionada no VÍDEO (motor DaVinci): o mesmo motivo de reprovação do WhatsApp vira permissão
 * de edição por cena do plano — o que o cliente não criticou fica idêntico. Cada cena do plano (clipe, na
 * ordem da timeline) corresponde a uma "tela" do motivo ("a cena 2", "o último trecho", "a capa" = 1ª cena).
 *
 * Capacidade real: o vídeo ainda não entra no piloto automático (Etapa A local, sem prova ao vivo). Aqui
 * fica a regra pura — quem gerar a nova versão do plano (IA ou pessoa) passa por esta conferência antes de
 * renderizar.
 */

export type VideoRevisionPermissions = {
  /** Cenas cujo visual (mídia, trecho, movimento, enquadramento, transição) pode mudar. */
  visualClipIds: string[];
  /** Cenas cujos textos sobrepostos podem mudar. */
  textClipIds: string[];
  /** Legendas (fala) — "legenda" no vídeo é a legenda na tela, além da do post. */
  captions: boolean;
  logo: boolean;
  /** Música e narração. */
  audio: boolean;
  scope: RedoScope;
};

const orderedClips = (plan: Pick<VideoEditPlan, "clips">) => [...plan.clips].sort((a, b) => a.recordStartSeconds - b.recordStartSeconds);

export function videoRevisionPermissions(plan: Pick<VideoEditPlan, "clips">, reason: string | undefined): VideoRevisionPermissions {
  const clips = orderedClips(plan);
  const scope = resolveRedoScope({ reason, screenCount: clips.length });
  const reading = interpretRejection(reason, { screenCount: clips.length });
  const ids = (screens: readonly number[]) => screens.map((screen) => clips[screen - 1]?.id).filter((id): id is string => Boolean(id));
  return {
    visualClipIds: ids(scope.image),
    textClipIds: ids(scope.text),
    captions: scope.caption || reading.unclear,
    logo: scope.logo,
    audio: reading.changes.audio || reading.unclear,
    scope,
  };
}

const json = (value: unknown) => JSON.stringify(value ?? null);
const FORMAT_KEYS = ["mode", "aspect", "width", "height", "fps"] as const;

/** O que mudou fora do permitido entre o plano reprovado e o plano da nova versão (vazio = ok). */
export function videoRevisionViolations(original: VideoEditPlan, revised: VideoEditPlan, permissions: VideoRevisionPermissions): string[] {
  const violations: string[] = [];
  for (const key of FORMAT_KEYS) {
    if (json(original[key]) !== json(revised[key])) violations.push(`O formato do vídeo (${key}) não pode mudar na refação.`);
  }
  const before = orderedClips(original);
  const after = orderedClips(revised);
  if (before.length !== after.length || before.some((clip, index) => clip.id !== after[index]?.id)) {
    if (permissions.visualClipIds.length < before.length) violations.push("A sequência de cenas mudou, mas o motivo não pediu para refazer o vídeo inteiro.");
    return violations;
  }
  before.forEach((clip, index) => {
    const next = after[index];
    const { overlays: oldOverlays, ...oldVisual } = clip;
    const { overlays: newOverlays, ...newVisual } = next;
    if (json(oldVisual) !== json(newVisual) && !permissions.visualClipIds.includes(clip.id)) violations.push(`A cena ${index + 1} mudou o visual sem ter sido criticada.`);
    if (json(oldOverlays) !== json(newOverlays) && !permissions.textClipIds.includes(clip.id) && !permissions.visualClipIds.includes(clip.id)) {
      violations.push(`O texto da cena ${index + 1} mudou sem ter sido criticado.`);
    }
  });
  if (json(original.captions) !== json(revised.captions) && !permissions.captions) violations.push("As legendas mudaram sem terem sido criticadas.");
  if (json(original.logo) !== json(revised.logo) && !permissions.logo) violations.push("A logo mudou sem ter sido criticada.");
  const audio = (plan: VideoEditPlan) => json({ music: plan.music, narration: (plan as { narration?: unknown }).narration, gain: plan.sourceAudioGainDb });
  if (audio(original) !== audio(revised) && !permissions.audio) violations.push("O áudio (música/narração) mudou sem ter sido criticado.");
  return violations;
}
