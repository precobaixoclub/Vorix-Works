/**
 * Objetos do storage marcados EXPLICITAMENTE como públicos (`db/migrations/0140_public_objects.sql`).
 * Todo o resto de `/uploads` é privado (URL assinada). Marcar exige um motivo, que fica persistido.
 */
export type PublicObject = {
  objectKey: string;
  tenantId: string;
  workspaceId?: string;
  reason: string;
  publishedBy?: string;
  createdAt: string;
};

export type PublicObjectRepositoryPort = {
  isPublic(objectKey: string): Promise<boolean>;
  markPublic(input: Omit<PublicObject, "createdAt">): Promise<PublicObject>;
  unmarkPublic(objectKey: string): Promise<void>;
};
