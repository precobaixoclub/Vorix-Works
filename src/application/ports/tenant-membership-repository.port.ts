import type { TenantMembership, TenantRole } from "../../domain/identity/identity.model.js";

export type CreateMembershipInput = {
  userId: string;
  tenantId: string;
  role: TenantRole;
};

export type TenantMembershipRepositoryPort = {
  create(input: CreateMembershipInput): Promise<TenantMembership>;
  getByUserAndTenant(userId: string, tenantId: string): Promise<TenantMembership | undefined>;
  listByUser(userId: string): Promise<TenantMembership[]>;
  /** Sprint 25 — usado pelo painel admin para listar quem tem acesso a um tenant. */
  listByTenant(tenantId: string): Promise<TenantMembership[]>;
  /** CRM/Comercial (Fase 1) — fecha o gap encontrado na auditoria: até aqui não existia nenhuma
   * forma de trocar papel ou remover um membro, só criação e listagem. */
  updateRole(userId: string, tenantId: string, role: TenantRole): Promise<TenantMembership | undefined>;
  remove(userId: string, tenantId: string): Promise<void>;
};
