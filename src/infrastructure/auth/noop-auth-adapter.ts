import type { AuthPort, AuthPrincipal, AuthVerificationResult } from "../../application/ports/auth.port.js";

/**
 * Adapter de desenvolvimento/teste de `AuthPort` — a partir da Sprint 05, NUNCA é o padrão em
 * produção (`AUTH_MODE=jwt` usa `JwtAuthAdapter`; este só é escolhido com `AUTH_MODE=noop`
 * explícito, ver `api-config.ts`/`container.ts`). `devPrincipal`, quando configurado, faz
 * `verifyToken` sempre devolver esse principal fixo (agora incluindo `role`/`sessionId`, exigidos
 * pelo RBAC da Fase 4), independente do token recebido. Sem `devPrincipal` configurado, o
 * comportamento é `{ authenticated: false, reason: "not_implemented" }`.
 */
export class NoopAuthAdapter implements AuthPort {
  private readonly devPrincipal?: AuthPrincipal;

  constructor(options: { devPrincipal?: AuthPrincipal } = {}) {
    this.devPrincipal = options.devPrincipal;
  }

  async verifyToken(_token: string | undefined): Promise<AuthVerificationResult> {
    if (this.devPrincipal) {
      return { authenticated: true, principal: this.devPrincipal };
    }
    return { authenticated: false, reason: "not_implemented" };
  }
}

export function createNoopAuthAdapter(options: { devPrincipal?: AuthPrincipal } = {}): NoopAuthAdapter {
  return new NoopAuthAdapter(options);
}
