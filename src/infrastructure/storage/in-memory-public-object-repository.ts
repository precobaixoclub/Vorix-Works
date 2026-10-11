import type { PublicObject, PublicObjectRepositoryPort } from "../../application/ports/public-object-repository.port.js";

export class InMemoryPublicObjectRepository implements PublicObjectRepositoryPort {
  private readonly byKey = new Map<string, PublicObject>();

  async isPublic(objectKey: string): Promise<boolean> {
    return this.byKey.has(objectKey);
  }

  async markPublic(input: Omit<PublicObject, "createdAt">): Promise<PublicObject> {
    const stored = { ...input, createdAt: new Date().toISOString() };
    this.byKey.set(input.objectKey, stored);
    return stored;
  }

  async unmarkPublic(objectKey: string): Promise<void> {
    this.byKey.delete(objectKey);
  }
}
