import { NotFoundError } from "../../http/app-error.js";

/** Mesmo papel de `translateConversationError` — traduz erros de `src/application/briefing/*`
 * (prefixo `BRIEFING_*`) para o status HTTP correto. */
export function translateBriefingError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("BRIEFING_NOT_FOUND")) {
    throw new NotFoundError(error.message);
  }
  throw error;
}
