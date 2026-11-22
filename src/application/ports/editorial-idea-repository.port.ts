import type { EditorialIdea, EditorialIdeaContent, EditorialIdeaStatus } from "../../domain/editorial/editorial-idea.model.js";

/** Conteúdo editável de uma pauta (tudo menos o código estável, o estado e as datas de controle). */
export type EditorialIdeaContentPatch = Omit<EditorialIdeaContent, "externalId" | "suggestedDate">;

/**
 * Persistência do bolsão de pautas editoriais. Toda operação recebe o `workspaceId`: uma pauta
 * nunca é lida nem alterada fora do workspace a que pertence. Adapters:
 * `InMemoryEditorialIdeaRepository` (dev/teste) e `PostgresEditorialIdeaRepository`
 * (`db/migrations/0197_editorial_ideas.sql`).
 */
export type EditorialIdeaRepositoryPort = {
  listByWorkspace(workspaceId: string): Promise<EditorialIdea[]>;
  get(workspaceId: string, id: string): Promise<EditorialIdea | undefined>;
  /** Insere as pautas novas; um `externalId` que já existe no workspace é ignorado (nunca
   * sobrescreve o trabalho editorial já feito nem duplica). */
  importMany(input: { tenantId: string; workspaceId: string; ideas: readonly EditorialIdeaContent[] }): Promise<{ created: number; skipped: number }>;
  update(workspaceId: string, id: string, patch: { status?: EditorialIdeaStatus; scheduledDate?: string | null; executionRunId?: string | null; creativePrompt?: string | null }): Promise<EditorialIdea | undefined>;
  /** Regrava o conteúdo da pauta (edição pela tela). Estado, código e calendário não mudam. */
  replaceContent(workspaceId: string, id: string, content: EditorialIdeaContentPatch): Promise<EditorialIdea | undefined>;
  /** Exclui a pauta do workspace. `false` quando não existe nele. */
  delete(workspaceId: string, id: string): Promise<boolean>;
};
