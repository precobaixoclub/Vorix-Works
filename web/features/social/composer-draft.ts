import type { ComposerDraft } from "@/features/social/presentation";

/**
 * Rascunho do "Publicar conteúdo pronto" (Fase 4). Guardado NESTE dispositivo (localStorage), por
 * workspace — nunca aparece em outra empresa. Não cria publicação nem agenda nada: é só o que a
 * pessoa estava montando, para retomar depois. A mídia já foi enviada ao armazenamento da workspace
 * no upload; o rascunho guarda só os links.
 */

export type SavedComposerDraft = { savedAt: string; draft: ComposerDraft };

const PREFIX = "vorix:composer-draft";
export const composerDraftKey = (workspaceId: string) => `${PREFIX}:${workspaceId}`;

/** Nada que valha guardar: sem legenda, hashtags, mídia nem rede escolhida. */
export function isEmptyDraft(draft: ComposerDraft): boolean {
  return !draft.caption.trim() && !draft.hashtags.trim() && draft.media.length === 0 && draft.destinations.length === 0;
}

/** Lê com validação: formato estranho (versão antiga, edição manual) vira "sem rascunho". */
export function parseSavedDraft(raw: string | null): SavedComposerDraft | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<SavedComposerDraft>;
    const draft = value.draft as Partial<ComposerDraft> | undefined;
    if (!value.savedAt || !draft || typeof draft.caption !== "string" || typeof draft.hashtags !== "string" || !Array.isArray(draft.media) || !Array.isArray(draft.destinations) || !draft.when) return undefined;
    const media = draft.media.filter((item) => item && typeof item.url === "string" && (item.kind === "image" || item.kind === "video"));
    return { savedAt: value.savedAt, draft: { ...(draft as ComposerDraft), media } };
  } catch {
    return undefined;
  }
}

export function serializeDraft(draft: ComposerDraft, now: Date = new Date()): string {
  return JSON.stringify({ savedAt: now.toISOString(), draft } satisfies SavedComposerDraft);
}

export function readComposerDraft(workspaceId: string): SavedComposerDraft | undefined {
  try {
    return parseSavedDraft(window.localStorage.getItem(composerDraftKey(workspaceId)));
  } catch {
    return undefined;
  }
}

export function writeComposerDraft(workspaceId: string, draft: ComposerDraft): boolean {
  try {
    window.localStorage.setItem(composerDraftKey(workspaceId), serializeDraft(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearComposerDraft(workspaceId: string): void {
  try {
    window.localStorage.removeItem(composerDraftKey(workspaceId));
  } catch {
    /* sem armazenamento: nada a limpar */
  }
}
