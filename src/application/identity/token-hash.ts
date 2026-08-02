import { createHash, randomBytes } from "node:crypto";

/** Refresh token: valor bruto opaco (nunca um JWT) — só o hash é persistido (ver `RefreshToken.tokenHash`). */
export function generateRefreshTokenValue(): string {
  return randomBytes(32).toString("hex");
}

export function hashRefreshTokenValue(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
