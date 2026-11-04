/**
 * Liveness do container web (HEALTHCHECK do docker-compose): resposta estática, sem renderizar
 * página. Antes o healthcheck renderizava `/login` inteira a cada 30 s.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response("ok", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
