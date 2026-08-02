import type { FastifyInstance } from "fastify";

/**
 * Headers de segurança HTTP — Release Track 1.0 (Fase 3), achado da Sprint 24 ("nenhum header de
 * segurança registrado"). Implementado à mão via `onSend` (em vez de instalar `@fastify/helmet`)
 * para não introduzir uma dependência nova numa sprint de hardening/congelamento arquitetural —
 * são 6 headers estáticos, sem necessidade de configuração dinâmica por rota.
 *
 * A API nunca serve HTML (só JSON, ver `docs/sprint-24-final-report.md` §7) — por isso a CSP pode
 * ser a mais restritiva possível (`default-src 'none'`) sem quebrar nenhum caso de uso real.
 * `Strict-Transport-Security` só é enviado quando `cookieSecure` está ligado (mesmo sinal já usado
 * em `api-config.ts` para "este ambiente é servido via HTTPS de verdade") — enviá-lo sobre HTTP
 * puro não tem efeito nos browsers, mas evita ruído/confusão em logs de dev local.
 */
export function registerSecurityHeadersMiddleware(app: FastifyInstance, options: { cookieSecure: boolean }): void {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=(), usb=()");
    if (options.cookieSecure) {
      reply.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    }
    return payload;
  });
}
