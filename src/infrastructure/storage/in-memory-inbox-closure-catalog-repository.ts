import type { InboxClosureCatalogRepositoryPort } from "../../application/ports/inbox-closure-catalog-repository.port.js";
import type { InboxClosureSubtype, InboxClosureType } from "../../domain/inbox/attendance.model.js";

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type StoredType = Omit<InboxClosureType, "subtypes"> & { deleted: boolean };
type StoredSubtype = InboxClosureSubtype & { deleted: boolean };

export class InMemoryInboxClosureCatalogRepository implements InboxClosureCatalogRepositoryPort {
  private readonly types = new Map<string, StoredType>();
  private readonly subtypes = new Map<string, StoredSubtype>();

  async listByWorkspace(workspaceId: string): Promise<InboxClosureType[]> {
    return [...this.types.values()]
      .filter((type) => type.workspaceId === workspaceId && !type.deleted)
      .sort((a, b) => a.position - b.position)
      .map((type) => this.withSubtypes(type));
  }

  async seedIfEmpty(input: { tenantId: string; workspaceId: string; catalog: readonly { name: string; subtypes: readonly string[] }[] }): Promise<void> {
    if ([...this.types.values()].some((type) => type.workspaceId === input.workspaceId)) return;
    for (const type of input.catalog) {
      const created = await this.createType({ tenantId: input.tenantId, workspaceId: input.workspaceId, name: type.name });
      for (const name of type.subtypes) await this.createSubtype({ tenantId: input.tenantId, workspaceId: input.workspaceId, closureTypeId: created.id, name });
    }
  }

  async getType(id: string): Promise<InboxClosureType | undefined> {
    const type = this.types.get(id);
    return type && !type.deleted ? this.withSubtypes(type) : undefined;
  }

  async getSubtype(id: string): Promise<InboxClosureSubtype | undefined> {
    const subtype = this.subtypes.get(id);
    return subtype && !subtype.deleted ? strip(subtype) : undefined;
  }

  async createType(input: { tenantId: string; workspaceId: string; name: string }): Promise<InboxClosureType> {
    const now = new Date().toISOString();
    const position = Math.max(-1, ...[...this.types.values()].filter((type) => type.workspaceId === input.workspaceId && !type.deleted).map((type) => type.position)) + 1;
    const type: StoredType = { id: newId("closetype"), ...input, position, isActive: true, deleted: false, createdAt: now, updatedAt: now };
    this.types.set(type.id, type);
    return this.withSubtypes(type);
  }

  async updateType(id: string, input: { name?: string; isActive?: boolean }): Promise<InboxClosureType> {
    const current = this.types.get(id);
    if (!current || current.deleted) throw new Error(`INBOX_CLOSURE_TYPE_NOT_FOUND: tipo de finalização "${id}" não existe.`);
    const updated = { ...current, name: input.name ?? current.name, isActive: input.isActive ?? current.isActive, updatedAt: new Date().toISOString() };
    this.types.set(id, updated);
    return this.withSubtypes(updated);
  }

  async deleteType(id: string): Promise<void> {
    const current = this.types.get(id);
    if (current) this.types.set(id, { ...current, deleted: true, isActive: false });
    for (const subtype of this.subtypes.values()) if (subtype.closureTypeId === id) this.subtypes.set(subtype.id, { ...subtype, deleted: true, isActive: false });
  }

  async reorderTypes(workspaceId: string, orderedIds: readonly string[]): Promise<void> {
    orderedIds.forEach((id, position) => {
      const current = this.types.get(id);
      if (current?.workspaceId === workspaceId) this.types.set(id, { ...current, position });
    });
  }

  async createSubtype(input: { tenantId: string; workspaceId: string; closureTypeId: string; name: string }): Promise<InboxClosureSubtype> {
    const now = new Date().toISOString();
    const position = Math.max(-1, ...[...this.subtypes.values()].filter((subtype) => subtype.closureTypeId === input.closureTypeId && !subtype.deleted).map((subtype) => subtype.position)) + 1;
    const subtype: StoredSubtype = { id: newId("closesub"), ...input, position, isActive: true, deleted: false, createdAt: now, updatedAt: now };
    this.subtypes.set(subtype.id, subtype);
    return strip(subtype);
  }

  async updateSubtype(id: string, input: { name?: string; isActive?: boolean }): Promise<InboxClosureSubtype> {
    const current = this.subtypes.get(id);
    if (!current || current.deleted) throw new Error(`INBOX_CLOSURE_SUBTYPE_NOT_FOUND: subtipo de finalização "${id}" não existe.`);
    const updated = { ...current, name: input.name ?? current.name, isActive: input.isActive ?? current.isActive, updatedAt: new Date().toISOString() };
    this.subtypes.set(id, updated);
    return strip(updated);
  }

  async deleteSubtype(id: string): Promise<void> {
    const current = this.subtypes.get(id);
    if (current) this.subtypes.set(id, { ...current, deleted: true, isActive: false });
  }

  async reorderSubtypes(closureTypeId: string, orderedIds: readonly string[]): Promise<void> {
    orderedIds.forEach((id, position) => {
      const current = this.subtypes.get(id);
      if (current?.closureTypeId === closureTypeId) this.subtypes.set(id, { ...current, position });
    });
  }

  private withSubtypes(type: StoredType): InboxClosureType {
    const { deleted: _deleted, ...rest } = type;
    const subtypes = [...this.subtypes.values()].filter((subtype) => subtype.closureTypeId === type.id && !subtype.deleted).sort((a, b) => a.position - b.position).map(strip);
    return { ...rest, subtypes };
  }
}

function strip(subtype: StoredSubtype): InboxClosureSubtype {
  const { deleted: _deleted, ...rest } = subtype;
  return rest;
}
