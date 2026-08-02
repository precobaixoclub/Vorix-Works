import type { SecretManagerHealth, SecretValue } from "../../domain/operations/operations.model.js";

export type SecretManagerPort = {
  health(): Promise<SecretManagerHealth>;
  put(reference: string, value: SecretValue): Promise<void>;
  get(reference: string): Promise<SecretValue | undefined>;
  delete(reference: string): Promise<void>;
};

