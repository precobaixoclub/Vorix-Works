import type { EditorialIdea, EditorialIdeaContent, EditorialIdeaStatus } from "../../domain/editorial/editorial-idea.model.js";

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
  update(workspaceId: string, id: string, patch: { status?: EditorialIdeaStatus; scheduledDate?: string | null; executionRunId?: string | null }): Promise<EditorialIdea | undefined>;
};
