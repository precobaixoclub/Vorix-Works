import type { ZunoEvent, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";

export class InMemoryZunoEventRecorder implements ZunoEventRecorderPort {
  private readonly events: ZunoEvent[] = [];

  async record(event: ZunoEvent): Promise<void> {
    this.events.push(event);
  }

  list(): ZunoEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.splice(0, this.events.length);
  }
}
