import type { PublicationProvider } from "../../domain/publication/publication.model.js";
import type { PublicationSecretStoragePort } from "./publication-secret-store.js";

export type PublicationResolvedSecret = {
  credentialReferenceId: string;
  providerId: PublicationProvider;
  expiresAt?: string;
  value: Record<string, string>;
};

export type PublicationSecretResolverPort = {
  health(): Promise<{ ok: boolean; safeMessage?: string }>;
  resolve(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId?: string }): Promise<PublicationResolvedSecret | undefined>;
};

export class InMemoryPublicationSecretResolver implements PublicationSecretResolverPort {
  private readonly secrets = new Map<string, PublicationResolvedSecret>();

  set(secret: PublicationResolvedSecret): void {
    this.secrets.set(secret.credentialReferenceId, secret);
  }

  async health(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async resolve(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId?: string }): Promise<PublicationResolvedSecret | undefined> {
    if (input.credentialReferenceId) return this.secrets.get(input.credentialReferenceId);
    return { credentialReferenceId: `${input.tenantId}:${input.workspaceId}:${input.providerId}:fake`, providerId: input.providerId, value: { token: "fake-secret-not-persisted" } };
  }
}

export class FakePublicationSecretResolver extends InMemoryPublicationSecretResolver {}

export class StoredPublicationSecretResolver implements PublicationSecretResolverPort {
  constructor(private readonly store: PublicationSecretStoragePort) {}

  async health(): Promise<{ ok: boolean; safeMessage?: string }> {
    return this.store.health();
  }

  async resolve(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId?: string }): Promise<PublicationResolvedSecret | undefined> {
    if (!input.credentialReferenceId) return undefined;
    return this.store.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: input.providerId, credentialReferenceId: input.credentialReferenceId });
  }
}

export class CompositePublicationSecretResolver implements PublicationSecretResolverPort {
  constructor(private readonly primary: PublicationSecretResolverPort, private readonly fallback: PublicationSecretResolverPort) {}

  async health(): Promise<{ ok: boolean; safeMessage?: string }> {
    const [primary, fallback] = await Promise.all([this.primary.health(), this.fallback.health()]);
    return { ok: primary.ok && fallback.ok, safeMessage: primary.safeMessage ?? fallback.safeMessage };
  }

  async resolve(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId?: string }): Promise<PublicationResolvedSecret | undefined> {
    if (input.providerId === "dry_run" || input.providerId === "fake") return this.fallback.resolve(input);
    return this.primary.resolve(input);
  }
}
