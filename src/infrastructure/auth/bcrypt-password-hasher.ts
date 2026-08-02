import bcrypt from "bcryptjs";
import type { PasswordHasherPort } from "../../application/ports/password-hasher.port.js";

const SALT_ROUNDS = 12;

/** Único adapter real de `PasswordHasherPort`. `bcryptjs` (implementação pura em JS) de propósito
 * — evita binário nativo (`bcrypt`) e os problemas de compilação/portabilidade que isso traz. */
export class BcryptPasswordHasher implements PasswordHasherPort {
  async hash(plainPassword: string): Promise<string> {
    return bcrypt.hash(plainPassword, SALT_ROUNDS);
  }

  async verify(plainPassword: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, passwordHash);
  }
}
