import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import { NotFoundError } from "../../http/app-error.js";

export async function assertWorkspaceBelongsToTenant(
  workspaceRepository: WorkspaceRepositoryPort,
  input: { tenantId: string; workspaceId: string },
): Promise<void> {
  const workspace = await workspaceRepository.getById(input.workspaceId);
  if (!workspace || workspace.tenantId !== input.tenantId) {
    throw new NotFoundError("Workspace nao encontrado.");
  }
}
