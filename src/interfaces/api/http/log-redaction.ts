/**
 * Credenciais que trafegam na QUERY de URLs legítimas nunca vão para o log de acesso: assinatura de
 * arquivo (`sig`, ver `object-url-signing.ts`) e os tokens escopados do Inbox/notificações
 * (`media_token`, `avatar_token`, `stream_token`). O resto da URL fica (rota, chave, `exp`) —
 * suficiente para operar sem expor um token reutilizável.
 */
const SENSITIVE_QUERY_PARAMS = /([?&](?:sig|media_token|avatar_token|stream_token|code|state|access_token|refresh_token)=)[^&#]*/gi;

export function redactSensitiveQuery(url: string | undefined): string | undefined {
  return url?.replace(SENSITIVE_QUERY_PARAMS, "$1[REDACTED]");
}

/** Serializer de `req` do logger do Fastify (mesmos campos do padrão, URL redigida). */
export function redactedRequestSerializer(request: { method?: string; url?: string; hostname?: string; ip?: string; socket?: { remotePort?: number } }) {
  return {
    method: request.method,
    url: redactSensitiveQuery(request.url),
    hostname: request.hostname,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}
