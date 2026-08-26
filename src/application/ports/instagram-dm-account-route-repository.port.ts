/** Roteamento de webhook inbound por conta do Instagram — módulo Instagram DM Automation, Fase 5.
 * Ver `db/migrations/0076_instagram_dm_account_routes.sql` para o porquê desta tabela existir. */

export type InstagramDmAccountRoute = {
  instagramBusinessAccountId: string;
  tenantId: string;
  workspaceId: string;
  updatedAt: string;
};

export type InstagramDmAccountRouteRepositoryPort = {
  /** Upsert por `instagramBusinessAccountId` — reconectar a mesma conta nunca duplica nem deixa
   * um roteamento velho apontando pro workspace errado. */
  upsertRoute(input: { instagramBusinessAccountId: string; tenantId: string; workspaceId: string }): Promise<InstagramDmAccountRoute>;
  findByInstagramBusinessAccountId(instagramBusinessAccountId: string): Promise<InstagramDmAccountRoute | undefined>;
};
