import type { ValentinaLogEntry, ValentinaLoggerPort } from "../../application/tenancy/valentina-log.contract.js";

export class InMemoryValentinaLogger implements ValentinaLoggerPort {
  private readonly entries: ValentinaLogEntry[] = [];

  async record(entry: ValentinaLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  list(): ValentinaLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.splice(0, this.entries.length);
  }
}
