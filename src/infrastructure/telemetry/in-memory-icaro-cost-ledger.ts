import type { IcaroConsumptionRecord, IcaroCostLedgerPort } from "../../application/ai/icaro.types.js";

export class InMemoryIcaroCostLedger implements IcaroCostLedgerPort {
  private readonly records: IcaroConsumptionRecord[] = [];

  async record(entry: IcaroConsumptionRecord): Promise<void> {
    this.records.push(entry);
  }

  list(): IcaroConsumptionRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records.splice(0, this.records.length);
  }
}
