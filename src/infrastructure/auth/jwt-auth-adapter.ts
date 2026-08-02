import type { AuthPort, AuthVerificationResult } from "../../application/ports/auth.port.js";
import type { JwtPort } from "../../application/ports/jwt.port.js";

/**
 * Adapter real de `AuthPort` a partir da Sprint 05 — usado sempre que `AUTH_MODE=jwt` (o padrão
 * em produção, ver `api-config.ts`). Só verifica a ASSINATURA/expiração do access token; não
 * consulta banco nenhum (é isso que torna a verificação rápida em toda requisição — o preço é
 * pago no refresh, que sim consulta `RefreshTokenRepositoryPort`).
 */
export class JwtAuthAdapter implements AuthPort {
  constructor(private readonly jwtPort: JwtPort) {}

  async verifyToken(token: string | undefined): Promise<AuthVerificationResult> {
    if (!token) return { authenticated: false, reason: "missing_token" };

    const result = this.jwtPort.verify(token);
    if (!result.valid) {
      return { authenticated: false, reason: result.reason === "expired" ? "expired_token" : "invalid_token" };
    }
    return { authenticated: true, principal: result.payload };
  }
}
