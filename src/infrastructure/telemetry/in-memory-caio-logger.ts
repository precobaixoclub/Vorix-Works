import type { CaioLogEntry, CaioLoggerPort } from "../../application/workflows/caio-log.contract.js";

export class InMemoryCaioLogger implements CaioLoggerPort {
  private readonly entries: CaioLogEntry[] = [];

  async record(entry: CaioLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  list(): CaioLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.splice(0, this.entries.length);
  }
}
