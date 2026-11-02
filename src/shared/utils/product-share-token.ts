import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export type ProductShareIdentity = { tenantId: string; workspaceId: string; productId: string; variantId?: string };
export type ProductShareCodec = { create(input: ProductShareIdentity): string; read(token: string): ProductShareIdentity | undefined };

/** Capability opaca, autenticada e restrita a um produto. Não depende de login nem publica o catálogo. */
export function createProductShareCodec(secret: string): ProductShareCodec {
  if (secret.length < 16) throw new Error("PRODUCT_SHARE_SECRET_REQUIRED");
  const key = createHmac("sha256", secret).update("vorix:product-share:v1").digest();
  return {
    create(input) {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify({ v: 1, ...input }), "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
    },
    read(token) {
      try {
        if (!/^[A-Za-z0-9_-]{40,2000}$/.test(token)) return undefined;
        const bytes = Buffer.from(token, "base64url");
        if (bytes.toString("base64url") !== token) return undefined;
        const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
        const id = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 160;
        if (value.v !== 1 || !id(value.tenantId) || !id(value.workspaceId) || !id(value.productId) || (value.variantId !== undefined && !id(value.variantId))) return undefined;
        return { tenantId: value.tenantId, workspaceId: value.workspaceId, productId: value.productId, ...(value.variantId ? { variantId: value.variantId } : {}) };
      } catch { return undefined; }
    },
  };
}
