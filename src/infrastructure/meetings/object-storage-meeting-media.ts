import type { MeetingMediaStoragePort } from "../../application/meetings/meeting-use-cases.js";
import type { ObjectStoragePort } from "../../application/ports/object-storage.port.js";
import { isObjectUrlSigningConfigured, signObjectKey } from "../../shared/utils/object-url-signing.js";

/**
 * Gravações de reunião sobre o object storage do Core (o mesmo `/uploads` PRIVADO por padrão, com
 * URL assinada de escopo único e validade curta — ver `object-url-signing.ts`). Sem um storage que
 * garanta leitura privada assinada (ex.: bucket S3 com URL pública), `isPrivateSigned()` é `false`
 * e o Meetings recusa o upload em vez de gravar a reunião num lugar acessível.
 */
export class ObjectStorageMeetingMedia implements MeetingMediaStoragePort {
  constructor(private readonly storage: ObjectStoragePort) {}

  isPrivateSigned(): boolean {
    return typeof this.storage.putFile === "function" && isObjectUrlSigningConfigured();
  }

  async putFile(input: { key: string; filePath: string; contentType: string }): Promise<void> {
    if (!this.storage.putFile) throw new Error("MEETING_STORAGE_UNAVAILABLE: storage sem gravação por arquivo.");
    await this.storage.putFile(input);
  }

  signedReadUrl(key: string, ttlSeconds: number): string | undefined {
    return signObjectKey(key, ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.storage.delete(key);
  }
}
