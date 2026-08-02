export type ClockPort = {
  now(): Date;
  nowIso(): string;
};

export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }

  nowIso(): string {
    return this.now().toISOString();
  }
}

export class FixedClock implements ClockPort {
  constructor(private readonly fixed: Date) {}

  now(): Date {
    return new Date(this.fixed.getTime());
  }

  nowIso(): string {
    return this.now().toISOString();
  }
}

export class MutableTestClock implements ClockPort {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  set(value: Date | string): void {
    this.current = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
