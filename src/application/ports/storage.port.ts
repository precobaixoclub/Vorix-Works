export type StoredAsset = {
  id: string;
  uri: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
};

export type StoragePort = {
  save(input: { name: string; data: Uint8Array; mimeType?: string }): Promise<StoredAsset>;
  read(uri: string): Promise<Uint8Array>;
};

export * from "./artifact-delivery.port.js";
