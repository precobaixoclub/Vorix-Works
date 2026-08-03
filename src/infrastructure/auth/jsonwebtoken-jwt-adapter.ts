import jwt from "jsonwebtoken";
import type { JwtAccessTokenPayload, JwtPort, JwtVerificationResult } from "../../application/ports/jwt.port.js";

/** Único adapter real de `JwtPort`. HS256 com `JWT_SECRET` — simétrico, suficiente enquanto só a
 * própria API emite e verifica tokens (nenhum outro serviço precisa validar sem o segredo). */
export class JsonWebTokenJwtAdapter implements JwtPort {
  constructor(private readonly secret: string) {}

  sign(payload: JwtAccessTokenPayload, expiresInSeconds: number): string {
    return jwt.sign(payload, this.secret, { algorithm: "HS256", expiresIn: expiresInSeconds });
  }

  verify(token: string): JwtVerificationResult {
    try {
      const decoded = jwt.verify(token, this.secret, { algorithms: ["HS256"] });
      if (typeof decoded !== "object" || decoded === null) return { valid: false, reason: "invalid" };
      const { userId, tenantId, role, sessionId, isPlatformAdmin } = decoded as Partial<JwtAccessTokenPayload>;
      if (!userId || !tenantId || !role || !sessionId) return { valid: false, reason: "invalid" };
      return { valid: true, payload: { userId, tenantId, role, sessionId, isPlatformAdmin: isPlatformAdmin === true } };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) return { valid: false, reason: "expired" };
      return { valid: false, reason: "invalid" };
    }
  }
}
