import type { UserSession } from "../../domain/identity/identity.model.js";

export type CreateSessionInput = {
  userId: string;
  activeTenantId: string;
  userAgent?: string;
  ipAddress?: string;
};

export type SessionRepositoryPort = {
  create(input: CreateSessionInput): Promise<UserSession>;
  getById(id: string): Promise<UserSession | undefined>;
  touch(id: string): Promise<void>;
  revoke(id: string): Promise<void>;
  /** Usado pelo Tenant Switcher (Fase 6) — muda o contexto ativo da sessão para um Tenant que o usuário tem Membership. */
  updateActiveTenant(id: string, tenantId: string): Promise<void>;
};
