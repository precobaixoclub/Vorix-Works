import type { ClaraLogEntry, ClaraLoggerPort } from "../../application/knowledge/clara-log.contract.js";

export class InMemoryClaraLogger implements ClaraLoggerPort {
  private readonly entries: ClaraLogEntry[] = [];

  async record(entry: ClaraLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  list(): ClaraLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.splice(0, this.entries.length);
  }
}
