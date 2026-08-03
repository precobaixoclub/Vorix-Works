import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from "../../http/app-error.js";

/**
 * Traduz os erros de `src/application/identity/*.usecase.ts` (prefixos `IDENTITY_*`/
 * `USER_EMAIL_ALREADY_EXISTS`) para o status HTTP e código corretos — mesma responsabilidade de
 * `translateWorkspaceError` (`workspaces.route.ts`, Sprint 03), nunca dentro do caso de uso.
 */
export function translateIdentityError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("IDENTITY_INVALID_CREDENTIALS")) {
      throw new UnauthorizedError(error.message, "INVALID_CREDENTIALS");
    }
    if (error.message.startsWith("IDENTITY_NO_TENANT_ACCESS")) {
      throw new ForbiddenError(error.message);
    }
    if (error.message.startsWith("IDENTITY_VALIDATION_ERROR")) {
      throw new ValidationError(error.message);
    }
    if (error.message.startsWith("IDENTITY_INVALID_REFRESH_TOKEN")) {
      throw new UnauthorizedError(error.message, "INVALID_REFRESH_TOKEN");
    }
    if (error.message.startsWith("IDENTITY_REFRESH_TOKEN_REUSED")) {
      throw new UnauthorizedError(error.message, "REFRESH_TOKEN_REUSED");
    }
    if (error.message.startsWith("IDENTITY_REFRESH_TOKEN_EXPIRED")) {
      throw new UnauthorizedError(error.message, "REFRESH_TOKEN_EXPIRED");
    }
    if (error.message.startsWith("IDENTITY_SESSION_REVOKED")) {
      throw new UnauthorizedError(error.message, "SESSION_REVOKED");
    }
    if (error.message.startsWith("USER_EMAIL_ALREADY_EXISTS")) {
      throw new ConflictError(error.message);
    }
    if (error.message.startsWith("SIGNUP_EMAIL_ALREADY_REGISTERED")) {
      throw new ConflictError(error.message);
    }
  }
  throw error;
}
