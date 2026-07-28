import type { AuthPort, AuthVerificationResult } from "../../application/ports/auth.port.js";

/**
 * Único adapter real de `AuthPort` nesta sprint. Nunca autentica ninguém — sempre devolve
 * `authenticated: false, reason: "not_implemented"`, independente do token recebido. Existe para
 * que o middleware de autenticação (Sprint 02) tenha uma dependência real e injetável desde já,
 * em vez de uma decisão hardcoded — trocar por um adapter real (JWT/sessão) na Sprint 04 não
 * exige tocar em nenhuma rota nem no middleware, só trocar esta implementação no container de DI.
 */
export class NoopAuthAdapter implements AuthPort {
  async verifyToken(_token: string | undefined): Promise<AuthVerificationResult> {
    return { authenticated: false, reason: "not_implemented" };
  }
}

export function createNoopAuthAdapter(): NoopAuthAdapter {
  return new NoopAuthAdapter();
}
