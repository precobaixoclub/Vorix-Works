import type { SecretManagerPort } from "../../application/ports/secret-manager.port.js";
import type { SecretManagerHealth, SecretValue } from "../../domain/operations/operations.model.js";

export class InMemorySecretManager implements SecretManagerPort {
  private readonly values = new Map<string, SecretValue>();

  async health(): Promise<SecretManagerHealth> {
    return { ok: true, provider: "local", safeMessage: "Secret Manager local disponivel apenas para dev/test/sandbox." };
  }

  async put(reference: string, value: SecretValue): Promise<void> {
    this.values.set(reference, { value: { ...value.value }, expiresAt: value.expiresAt });
  }

  async get(reference: string): Promise<SecretValue | undefined> {
    const value = this.values.get(reference);
    if (!value) return undefined;
    return { value: { ...value.value }, expiresAt: value.expiresAt };
  }

  async delete(reference: string): Promise<void> {
    this.values.delete(reference);
  }
}

export class FailClosedProductionSecretManager implements SecretManagerPort {
  constructor(private readonly safeMessage = "Secret Manager de producao nao configurado.") {}

  async health(): Promise<SecretManagerHealth> {
    return { ok: false, provider: "not_configured", safeMessage: this.safeMessage };
  }

  async put(): Promise<void> {
    throw new Error("SECRET_MANAGER_NOT_CONFIGURED: Secret Manager de producao nao configurado.");
  }

  async get(): Promise<SecretValue | undefined> {
    throw new Error("SECRET_MANAGER_NOT_CONFIGURED: Secret Manager de producao nao configurado.");
  }

  async delete(): Promise<void> {
    throw new Error("SECRET_MANAGER_NOT_CONFIGURED: Secret Manager de producao nao configurado.");
  }
}

