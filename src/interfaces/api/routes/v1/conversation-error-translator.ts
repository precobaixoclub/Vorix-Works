import { NotFoundError, ValidationError } from "../../http/app-error.js";

/** Mesmo papel de `translateWorkspaceError`/`translateIdentityError` — traduz os erros de
 * `src/application/conversation/*` (prefixos `CONVERSATION_*`) para o status HTTP correto. */
export function translateConversationError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("CONVERSATION_WORKSPACE_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("CONVERSATION_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("CONVERSATION_VALIDATION_ERROR")) throw new ValidationError(error.message);
  }
  throw error;
}
