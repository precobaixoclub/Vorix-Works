import { ConflictError, NotFoundError, ValidationError } from "../../http/app-error.js";

export function translateExecutionError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("EXECUTION_RUN_NOT_FOUND")) {
    throw new NotFoundError(error.message);
  }
  if (error instanceof Error && (error.message.startsWith("EXECUTION_PRECONDITION_FAILED") || error.message.startsWith("EXECUTION_REAL_PRECONDITION_FAILED") || error.message.startsWith("EXECUTION_OUTPUT_VALIDATION_FAILED") || error.message.startsWith("EXECUTION_BINDING_RESOLUTION_FAILED"))) {
    throw new ValidationError(error.message);
  }
  if (error instanceof Error && (error.message.startsWith("OPTIMISTIC_LOCK_CONFLICT") || error.message.startsWith("EXECUTION_RUN_IDEMPOTENCY_CONFLICT"))) {
    throw new ConflictError(error.message);
  }
  throw error;
}
