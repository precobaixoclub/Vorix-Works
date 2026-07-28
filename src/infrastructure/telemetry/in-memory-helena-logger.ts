import type { HelenaLogEntry, HelenaLoggerPort } from "../../application/skills/helena-log.contract.js";

export class InMemoryHelenaLogger implements HelenaLoggerPort {
  private readonly entries: HelenaLogEntry[] = [];

  async record(entry: HelenaLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  list(): HelenaLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.splice(0, this.entries.length);
  }
}
