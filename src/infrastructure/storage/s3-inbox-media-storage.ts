import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { InboxMediaStorageGetResult, InboxMediaStoragePort, InboxMediaStoragePutInput } from "../../application/ports/inbox-media-storage.port.js";

/** Igual a `S3ObjectStorage` na forma de configurar o client — mas SEM `acl`/`publicBaseUrl`: o
 * bucket de mídia de conversas nunca deve ser público (nem por ACL de objeto, nem por domínio
 * custom). Só lido de volta via `get()`, através do proxy autenticado do Vorix. */
export type S3InboxMediaStorageConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

export class S3InboxMediaStorage implements InboxMediaStoragePort {
  private readonly client: S3Client;

  constructor(private readonly config: S3InboxMediaStorageConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? !!config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async health(): Promise<{ ok: boolean; safeMessage?: string }> {
    return { ok: true, safeMessage: "Storage S3 de mídia de conversas configurado." };
  }

  async put(input: InboxMediaStoragePutInput): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: input.key, Body: input.body, ContentType: input.contentType }));
  }

  async get(key: string): Promise<InboxMediaStorageGetResult | undefined> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      if (!result.Body) return undefined;
      const body = Buffer.from(await result.Body.transformToByteArray());
      return { body, contentType: result.ContentType ?? "application/octet-stream" };
    } catch {
      return undefined;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
