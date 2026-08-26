import type { InstagramDmAccountRoute, InstagramDmAccountRouteRepositoryPort } from "../../application/ports/instagram-dm-account-route-repository.port.js";

export class InMemoryInstagramDmAccountRouteRepository implements InstagramDmAccountRouteRepositoryPort {
  private readonly routes = new Map<string, InstagramDmAccountRoute>();

  async upsertRoute(input: { instagramBusinessAccountId: string; tenantId: string; workspaceId: string }): Promise<InstagramDmAccountRoute> {
    const record: InstagramDmAccountRoute = { ...input, updatedAt: new Date().toISOString() };
    this.routes.set(input.instagramBusinessAccountId, record);
    return record;
  }

  async findByInstagramBusinessAccountId(instagramBusinessAccountId: string): Promise<InstagramDmAccountRoute | undefined> {
    return this.routes.get(instagramBusinessAccountId);
  }
}
