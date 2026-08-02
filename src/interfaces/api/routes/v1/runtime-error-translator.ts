import { NotFoundError } from "../../http/app-error.js";

/** Mesmo papel de `translatePlanningError` — traduz erros de `src/application/runtime/*`
 * (prefixo `RUNTIME_*`) para o status HTTP correto. */
export function translateRuntimeError(error: unknown): never {
  if (error instanceof Error && (error.message.startsWith("RUNTIME_NOT_FOUND") || error.message.startsWith("RUNTIME_SOURCE_PLANNING_NOT_FOUND"))) {
    throw new NotFoundError(error.message);
  }
  throw error;
}
