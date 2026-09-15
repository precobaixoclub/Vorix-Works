"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getApiBaseUrl } from "@/lib/api-error";
import { getInboxAvatarToken } from "@/features/inbox/api";
import type { InboxMediaStorageRef } from "@/features/inbox/types";
import { cn } from "@/lib/utils";

/**
 * Foto de perfil/grupo (pedido explícito do usuário em produção, "ajustar para carregar as fotos
 * dos grupos e conversas") — mesmo racional de `MessageMedia`/`useMediaUrl`: mídia privada, nunca
 * a URL do WhatsApp direto no `<img>`, sempre um token de curta duração + proxy autenticado.
 * `storageRef` ausente (ainda não sincronizada, ou a pessoa/grupo não tem foto) cai direto no
 * fallback (iniciais) — nunca tenta buscar token à toa.
 */
export function InboxAvatar({
  workspaceId,
  kind,
  targetId,
  storageRef,
  fallback,
  className,
  fallbackClassName,
}: {
  workspaceId: string;
  kind: "contact" | "conversation";
  targetId: string | undefined;
  storageRef: InboxMediaStorageRef | undefined;
  fallback: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setUrl(undefined);
    if (!storageRef || !targetId) return;
    getInboxAvatarToken(workspaceId, kind, targetId)
      .then(({ avatarToken }) => {
        if (cancelled) return;
        const query = new URLSearchParams({ avatar_token: avatarToken });
        setUrl(`${getApiBaseUrl()}/v1/inbox/avatars/${kind}/${encodeURIComponent(targetId)}?${query.toString()}`);
      })
      .catch(() => {
        // Best-effort — sem token, o Fallback (iniciais) já cobre visualmente. Nunca mostra erro
        // pra algo tão secundário quanto uma foto de perfil.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, kind, targetId, storageRef?.objectKey]);

  return (
    <Avatar className={className}>
      {url ? <AvatarImage src={url} alt="" /> : null}
      <AvatarFallback className={cn("font-semibold", fallbackClassName)}>{fallback}</AvatarFallback>
    </Avatar>
  );
}
