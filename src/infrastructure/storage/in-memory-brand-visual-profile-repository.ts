import type { BrandVisualProfileRepositoryPort } from "../../application/ports/brand-visual-profile-repository.port.js";
import type { BrandVisualProfile } from "../../shared/utils/brand-visual-profile.types.js";

export class InMemoryBrandVisualProfileRepository implements BrandVisualProfileRepositoryPort {
  private readonly byWorkspace = new Map<string, BrandVisualProfile>();

  async getByWorkspace(workspaceId: string): Promise<BrandVisualProfile | undefined> {
    return this.byWorkspace.get(workspaceId);
  }

  async upsert(profile: BrandVisualProfile): Promise<BrandVisualProfile> {
    const stored = { ...profile };
    this.byWorkspace.set(profile.workspaceId, stored);
    return stored;
  }
}
