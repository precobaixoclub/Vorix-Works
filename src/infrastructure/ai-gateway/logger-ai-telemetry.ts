import type { AiTelemetryEvent, AiTelemetryPort } from "../../application/ports/ai-telemetry.port.js";

export type LoggerAiTelemetrySink = (event: Record<string, unknown>) => void;

/** Adapter de produção — encaminha o evento (já sem conteúdo sensível, ver `AiTelemetryEvent`)
 * para um sink de log estruturado (ex.: `app.log.info.bind(app.log)`, o logger pino do Fastify).
 * Nunca formata o evento como string livre — sempre um objeto estruturado. */
export class LoggerAiTelemetry implements AiTelemetryPort {
  constructor(private readonly sink: LoggerAiTelemetrySink) {}

  record(event: AiTelemetryEvent): void {
    this.sink({ msg: "ai_gateway_execution", ...event });
  }
}
