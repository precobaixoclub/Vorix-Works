import type { Pool } from "pg";
import type { InboxMediaStoragePort } from "../../../application/ports/inbox-media-storage.port.js";
import type { MessagingMediaKind, MessagingProvider } from "../../../application/ports/messaging-provider.port.js";

/**
 * Bloco "retry de mídia" — achado ao vivo em produção (relatado pelo usuário: mensagens "só
 * informação de mídia recebida e que não carregou dentro do sistema"). Antes desta reconciliação,
 * `downloadInboundMediaAndAttach` (inbox-use-cases.ts) tinha exatamente UMA chance de baixar cada
 * mídia — uma falha transitória (rede instável, WuzAPI reiniciando no meio do processamento)
 * deixava a mensagem com `media_storage_ref` nulo pra sempre, sem nenhuma chance de reprocessar,
 * porque o ref bruto (url/directPath/mediaKey) só existia na memória do worker durante aquela
 * única tentativa.
 *
 * Agora `attachMediaSourceRef` grava esse ref ANTES de cada tentativa (ver inbox-use-cases.ts) —
 * esta reconciliação varre mensagens que ainda não têm mídia mas já têm o ref persistido, e tenta
 * de novo. Mesmo idioma dos outros reconciliadores (`reconcilePendingContactPictures` etc.): roda
 * imediatamente no boot e depois no intervalo configurado.
 */
export async function reconcilePendingMediaDownloads(
  pool: Pool,
  provider: MessagingProvider,
  inboxMediaStorage: InboxMediaStoragePort | undefined,
  options: { limit?: number } = {},
): Promise<{ scanned: number; synced: number }> {
  if (!provider.downloadMedia || !inboxMediaStorage) return { scanned: 0, synced: 0 };

  const candidates = await pool.query<{
    id: string; tenant_id: string; workspace_id: string; type: string; media_source_ref: Record<string, unknown>; external_session_id: string;
  }>(
    `select m.id, m.tenant_id, m.workspace_id, m.type, m.media_source_ref, mc.external_session_id
     from inbox_messages m
     join messaging_connections mc on mc.id = m.connection_id
     where m.media_storage_ref is null and m.media_source_ref is not null
       and m.type in ('image', 'video', 'audio', 'document')
       and mc.external_session_id is not null
     order by m.created_at asc
     limit $1`,
    [options.limit ?? 50],
  );

  let synced = 0;
  for (const row of candidates.rows) {
    const ref = row.media_source_ref as {
      url?: string; directPath?: string; mediaKey?: string; mimeType?: string; fileSha256?: string; fileEncSha256?: string;
      fileSizeBytes?: number; fileName?: string; durationSeconds?: number; thumbnailBase64?: string;
    };
    if (!ref.url) continue; // defensivo — nunca deveria acontecer (ref sempre gravado com a url do evento original).
    let downloaded;
    try {
      downloaded = await provider.downloadMedia({
        externalSessionId: row.external_session_id,
        type: row.type as Exclude<MessagingMediaKind, "text">,
        ref: {
          url: ref.url, directPath: ref.directPath, mediaKey: ref.mediaKey, mimeType: ref.mimeType,
          fileSha256: ref.fileSha256, fileSizeBytes: ref.fileSizeBytes, fileEncSha256: ref.fileEncSha256,
        },
      });
    } catch {
      continue; // best-effort — um erro pontual numa mensagem nunca deve travar as demais.
    }
    if (!downloaded) continue;

    const objectKey = `${row.tenant_id}/${row.workspace_id}/${row.id}`;
    await inboxMediaStorage.put({ key: objectKey, body: downloaded.body, contentType: downloaded.mimeType ?? ref.mimeType ?? "application/octet-stream" });

    const metadata: Record<string, unknown> = {};
    if (ref.fileName) metadata.fileName = ref.fileName;
    if (ref.fileSizeBytes) metadata.fileSizeBytes = ref.fileSizeBytes;
    if (ref.durationSeconds) metadata.durationSeconds = ref.durationSeconds;
    if (ref.thumbnailBase64) metadata.thumbnailDataUrl = `data:image/jpeg;base64,${ref.thumbnailBase64}`;

    await pool.query(
      "update inbox_messages set media_storage_ref = $2, mime_type = coalesce($3, mime_type), metadata = coalesce(metadata, '{}'::jsonb) || $4::jsonb where id = $1",
      [row.id, JSON.stringify({ provider: "inbox-media", objectKey, metadata: { tenantId: row.tenant_id } }), downloaded.mimeType ?? ref.mimeType ?? null, JSON.stringify(metadata)],
    );
    synced += 1;
  }
  return { scanned: candidates.rows.length, synced };
}
