import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "./app-error.js";
import { errorEnvelope } from "./response-envelope.js";

/**
 * Tratamento global de erros — todo erro não tratado por uma rota passa por aqui, nunca vaza um
 * stack trace ou um formato de erro diferente do envelope padrão. `AppError` (e subclasses)
 * controlam o `statusCode`/`code` reais; qualquer outro erro vira um 500 genérico, sem detalhe
 * interno exposto ao cliente.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      request.log.warn({ err: error, code: error.code }, "Requisição terminou em erro de aplicação.");
      reply.status(error.statusCode).send(
        errorEnvelope({ code: error.code, message: error.message, recoverable: error.recoverable, details: error.details }, requestId),
      );
      return;
    }

    // Erros de validação de schema do próprio Fastify chegam aqui com `validation` preenchido.
    if ("validation" in error && error.validation) {
      reply.status(400).send(errorEnvelope({ code: "VALIDATION_ERROR", message: error.message, recoverable: true }, requestId));
      return;
    }

    request.log.error({ err: error }, "Erro não tratado.");
    reply.status(500).send(errorEnvelope({ code: "INTERNAL_ERROR", message: "Erro interno inesperado.", recoverable: false }, requestId));
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply.status(404).send(
      errorEnvelope({ code: "ROUTE_NOT_FOUND", message: `Rota não encontrada: ${request.method} ${request.url}.`, recoverable: true }, request.id),
    );
  });
}
