import type { PublicationProvider } from "../../domain/publication/publication.model.js";
import type { PublicationResolvedSecret } from "./publication-secret-resolver.js";

export type PublicationSecretRecord = PublicationResolvedSecret & {
  tenantId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicationSecretStoragePort = {
  health(): Promise<{ ok: boolean; safeMessage?: string }>;
  put(input: PublicationSecretRecord): Promise<void>;
  get(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId: string }): Promise<PublicationResolvedSecret | undefined>;
  delete(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId: string }): Promise<void>;
};

export class LocalPublicationSecretStore implements PublicationSecretStoragePort {
  private readonly secrets = new Map<string, PublicationSecretRecord>();

  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async put(input: PublicationSecretRecord): Promise<void> {
    this.secrets.set(this.key(input), { ...input, value: { ...input.value } });
  }

  async get(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId: string }): Promise<PublicationResolvedSecret | undefined> {
    const secret = this.secrets.get(this.key(input));
    if (!secret) return undefined;
    return { credentialReferenceId: secret.credentialReferenceId, providerId: secret.providerId, expiresAt: secret.expiresAt, value: { ...secret.value } };
  }

  async delete(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId: string }): Promise<void> {
    this.secrets.delete(this.key(input));
  }

  private key(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId: string }): string {
    return `${input.tenantId}:${input.workspaceId}:${input.providerId}:${input.credentialReferenceId}`;
  }
}

