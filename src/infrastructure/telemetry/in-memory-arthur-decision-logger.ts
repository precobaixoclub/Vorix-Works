import type { ArthurDecisionLogEntry, ArthurDecisionLoggerPort } from "../../application/orchestration/arthur-decision-log.contract.js";

export class InMemoryArthurDecisionLogger implements ArthurDecisionLoggerPort {
  private readonly entries: ArthurDecisionLogEntry[] = [];

  async record(entry: ArthurDecisionLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  list(): ArthurDecisionLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.splice(0, this.entries.length);
  }
}
