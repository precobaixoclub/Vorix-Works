import type { AiTelemetryEvent, AiTelemetryPort } from "../../application/ports/ai-telemetry.port.js";

/** Usado em testes e como padrão seguro quando nenhum sink de produção é injetado — só acumula em
 * memória, nunca escreve em lugar nenhum. */
export class InMemoryAiTelemetry implements AiTelemetryPort {
  private readonly events: AiTelemetryEvent[] = [];

  record(event: AiTelemetryEvent): void {
    this.events.push(structuredClone(event));
  }

  list(): readonly AiTelemetryEvent[] {
    return this.events.map((event) => structuredClone(event));
  }

  clear(): void {
    this.events.length = 0;
  }
}
