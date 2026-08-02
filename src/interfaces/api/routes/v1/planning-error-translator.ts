import { NotFoundError } from "../../http/app-error.js";

/** Mesmo papel de `translateBriefingError` — traduz erros de `src/application/planning/*`
 * (prefixo `PLANNING_*`) para o status HTTP correto. */
export function translatePlanningError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("PLANNING_NOT_FOUND")) {
    throw new NotFoundError(error.message);
  }
  throw error;
}
