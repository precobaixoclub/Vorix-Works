import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { GatewayScope } from "./protocol.js";

/** Private gateway volume. Every record (including receipts) is encrypted and bound to its scope. */
export class EncryptedGatewayStore {
  private readonly key: Buffer;
  constructor(private readonly root: string, keyBase64: string) {
    this.key = Buffer.from(keyBase64, "base64");
    if (this.key.length !== 32) throw new Error("SOCIAL_GATEWAY_ENCRYPTION_KEY must be 32 random bytes in base64");
  }
  private aad(scope: GatewayScope, id: string): Buffer { return Buffer.from(JSON.stringify([scope.tenantId, scope.workspaceId, scope.network, id])); }
  private bucket(scope: GatewayScope): string { return join(this.root, createHash("sha256").update(this.aad(scope, "")).digest("hex")); }
  private path(scope: GatewayScope, id: string): string { return join(this.bucket(scope), `${createHash("sha256").update(id).digest("hex")}.enc`); }
  async put(scope: GatewayScope, id: string, value: unknown): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.aad(scope, id));
    const bytes = Buffer.concat([cipher.update(JSON.stringify({ id, value }), "utf8"), cipher.final()]);
    const envelope = JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: bytes.toString("base64") });
    await mkdir(this.bucket(scope), { recursive: true, mode: 0o700 });
    const target = this.path(scope, id);
    const temp = `${target}.${randomBytes(8).toString("hex")}.tmp`;
    const handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(envelope); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, target);
    // The pre-submit receipt must survive a process/host crash, including directory metadata.
    if (process.platform !== "win32") { const directory = await open(this.bucket(scope), "r"); try { await directory.sync(); } finally { await directory.close(); } }
  }
  private decode(scope: GatewayScope, id: string, raw: string): unknown {
    const envelope = JSON.parse(raw);
    if (envelope.v !== 1) throw new Error("INVALID_ENCRYPTED_RECORD");
    const cipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(envelope.iv, "base64"));
    cipher.setAAD(this.aad(scope, id));
    cipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.data, "base64")), cipher.final()]).toString("utf8")).value;
  }
  async get<T>(scope: GatewayScope, id: string): Promise<T | undefined> {
    let raw: string;
    try { raw = await readFile(this.path(scope, id), "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("GATEWAY_STORE_READ_FAILED"); }
    try { return this.decode(scope, id, raw) as T; } catch { throw new Error("GATEWAY_STORE_INTEGRITY_FAILED"); }
  }
  async remove(scope: GatewayScope, id: string): Promise<void> { await unlink(this.path(scope, id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw new Error("GATEWAY_STORE_REMOVE_FAILED"); }); }
}
