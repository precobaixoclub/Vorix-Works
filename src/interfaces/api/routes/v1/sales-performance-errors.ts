import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../../http/app-error.js";

/** IA comercial indisponível/falhou — 503 seguro (nunca o erro bruto do provider). */
export class ServiceUnavailableLikeError extends AppError {
  constructor(message: string) {
    super({ code: "DEAL_INSIGHTS_UNAVAILABLE", message, statusCode: 503, recoverable: true });
  }
}

export { ForbiddenError, NotFoundError, ValidationError };
