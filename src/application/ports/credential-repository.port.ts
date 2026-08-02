import type {
  Credential,
  CredentialBinding,
  CredentialDetail,
  CredentialHealth,
  CredentialReference,
  CredentialRotation,
  CredentialStatus,
} from "../../domain/credential/credential.model.js";
import type { PublicationProvider } from "../../domain/publication/publication.model.js";

export type CredentialRepositoryPort = {
  upsertCredential(input: Omit<Credential, "createdAt" | "updatedAt">): Promise<Credential>;
  getCredential(input: { tenantId: string; workspaceId: string; credentialId: string }): Promise<CredentialDetail | undefined>;
  getCredentialByReference(input: { tenantId: string; workspaceId: string; credentialReferenceId: string }): Promise<CredentialDetail | undefined>;
  listCredentials(filter: { tenantId: string; workspaceId: string; providerId?: PublicationProvider; status?: CredentialStatus }): Promise<Credential[]>;
  updateCredentialStatus(input: { tenantId: string; workspaceId: string; credentialId: string; status: CredentialStatus; activeReferenceId?: string; expiresAt?: string; lastHealthCheckAt?: string }): Promise<Credential>;

  upsertReference(input: Omit<CredentialReference, "createdAt" | "updatedAt">): Promise<CredentialReference>;
  listReferences(filter: { tenantId: string; workspaceId: string; credentialId?: string; providerId?: PublicationProvider }): Promise<CredentialReference[]>;
  updateReferenceStatus(input: { tenantId: string; workspaceId: string; credentialReferenceId: string; status: CredentialStatus; revokedAt?: string }): Promise<CredentialReference | undefined>;

  upsertBinding(input: Omit<CredentialBinding, "createdAt" | "updatedAt">): Promise<CredentialBinding>;
  listBindings(filter: { tenantId: string; workspaceId: string; credentialId?: string; providerId?: PublicationProvider }): Promise<CredentialBinding[]>;

  createRotation(input: Omit<CredentialRotation, "createdAt" | "updatedAt">): Promise<CredentialRotation>;
  updateRotation(input: { tenantId: string; workspaceId: string; rotationId: string; status: CredentialRotation["status"]; newCredentialReferenceId?: string; startedAt?: string; completedAt?: string; failureCode?: string }): Promise<CredentialRotation | undefined>;
  listRotations(filter: { tenantId: string; workspaceId: string; credentialId?: string }): Promise<CredentialRotation[]>;

  recordHealth(input: CredentialHealth): Promise<CredentialHealth>;
  getHealth(input: { tenantId: string; workspaceId: string; credentialId: string }): Promise<CredentialHealth | undefined>;
};
