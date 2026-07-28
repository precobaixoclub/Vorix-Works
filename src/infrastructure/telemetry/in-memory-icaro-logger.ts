import type { IcaroLogEntry, IcaroLoggerPort } from "../../application/ai/icaro-log.contract.js";

export class InMemoryIcaroLogger implements IcaroLoggerPort {
  private readonly entries: IcaroLogEntry[] = [];

  async record(entry: IcaroLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  list(): IcaroLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.splice(0, this.entries.length);
  }
}
