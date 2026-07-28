import type { AuthPort, AuthPrincipal, AuthVerificationResult } from "../../application/ports/auth.port.js";

/**
 * Único adapter real de `AuthPort` nesta sprint. Sem autenticação real ainda — mas a partir da
 * Sprint 03, endpoints de negócio (Workspace) exigem um `tenantId` vindo do contexto de
 * autenticação (nunca do corpo da requisição), e autenticação real só chega na Sprint 04. Para
 * destravar isso SEM antecipar login: `devPrincipal`, quando configurado (via `DEV_PRINCIPAL_*`
 * em `.env`, ver `api-config.ts`), faz `verifyToken` sempre devolver esse principal fixo,
 * independente do token recebido — um "usuário de desenvolvimento" explícito, nunca um bypass
 * silencioso. Sem `devPrincipal` configurado, o comportamento é o mesmo de sempre:
 * `{ authenticated: false, reason: "not_implemented" }`.
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
