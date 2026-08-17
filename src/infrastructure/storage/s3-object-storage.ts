import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ObjectStoragePort, ObjectStoragePutInput } from "../../application/ports/object-storage.port.js";

/**
 * Adapter genérico via protocolo S3 — funciona com AWS S3, Cloudflare R2, DigitalOcean Spaces ou
 * qualquer serviço compatível (MinIO etc.), variando só `endpoint`/`region`/`forcePathStyle`.
 * `acl` é opcional porque providers divergem: R2 não implementa ACL por objeto (bucket público via
 * domínio custom); S3/Spaces aceitam `"public-read"`. Deixe `acl` vazio e configure o acesso
 * público no nível do bucket/domínio quando o provider não suportar ACL por objeto.
 */
export type S3ObjectStorageConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Domínio público (ex.: CDN/custom domain do R2 ou Spaces) — se ausente, deriva do endpoint/bucket. */
  publicBaseUrl?: string;
  forcePathStyle?: boolean;
  acl?: string;
};

/** Extraída como função pura para ser testável sem instanciar um `S3Client` real. */
export function resolvePublicUrl(config: S3ObjectStorageConfig, key: string): string {
  if (config.publicBaseUrl) return `${config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
  if (config.endpoint) {
    const base = config.endpoint.replace(/\/$/, "");
    return config.forcePathStyle ?? true ? `${base}/${config.bucket}/${key}` : base.replace("https://", `https://${config.bucket}.`) + `/${key}`;
  }
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`;
}

export class S3ObjectStorage implements ObjectStoragePort {
  private readonly client: S3Client;

  constructor(private readonly config: S3ObjectStorageConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? !!config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async health(): Promise<{ ok: boolean; safeMessage?: string }> {
    return { ok: true, safeMessage: "Object storage configurado." };
  }

  async put(input: ObjectStoragePutInput): Promise<{ url: string }> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      ...(this.config.acl ? { ACL: this.config.acl as "public-read" } : {}),
    }));
    return { url: resolvePublicUrl(this.config, input.key) };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  resolvePublicUrl(key: string): string {
    return resolvePublicUrl(this.config, key);
  }
}
