/**
 * Erros de aplicação reconhecidos pelo tratamento global de erros (`error-handler.ts`). Mesmo
 * vocabulário `{code, message, recoverable}` já usado em `SkillResponse.error` e em `Result<T>`
 * (`src/shared/types/result.ts`) — a API não inventa um formato de erro novo, reaproveita o que o
 * resto do projeto já usa.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly recoverable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(input: { code: string; message: string; statusCode: number; recoverable?: boolean; details?: Record<string, unknown> }) {
    super(input.message);
    this.name = "AppError";
    this.code = input.code;
    this.statusCode = input.statusCode;
    this.recoverable = input.recoverable ?? true;
    this.details = input.details;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso não encontrado.", details?: Record<string, unknown>) {
    super({ code: "NOT_FOUND", message, statusCode: 404, recoverable: true, details });
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "Requisição inválida.", details?: Record<string, unknown>) {
    super({ code: "VALIDATION_ERROR", message, statusCode: 400, recoverable: true, details });
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Autenticação necessária.", details?: Record<string, unknown>) {
    super({ code: "UNAUTHORIZED", message, statusCode: 401, recoverable: true, details });
    this.name = "UnauthorizedError";
  }
}

/** Estado atual do recurso não permite a operação pedida (ex.: transição de status inválida) — nunca um erro de formato de entrada. */
export class ConflictError extends AppError {
  constructor(message = "Conflito de estado.", details?: Record<string, unknown>) {
    super({ code: "CONFLICT", message, statusCode: 409, recoverable: true, details });
    this.name = "ConflictError";
  }
}

export class NotImplementedError extends AppError {
  constructor(message = "Ainda não implementado.", details?: Record<string, unknown>) {
    super({ code: "NOT_IMPLEMENTED", message, statusCode: 501, recoverable: false, details });
    this.name = "NotImplementedError";
  }
}
