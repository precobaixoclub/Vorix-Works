export type RemoteInputAction =
  | { kind: "text"; text: string }
  | { kind: "key"; key: string }
  | { kind: "click"; x: number; y: number }
  | { kind: "drag"; x: number; y: number; toX: number; toY: number }
  | { kind: "scroll"; delta: number };

/** Entrada transitória: agrupa letras sem trocar sua ordem em relação a cliques e teclas. */
export class RemoteInputQueue {
  private text = "";
  private timer?: ReturnType<typeof setTimeout>;
  private tail: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private generation = 0;
  constructor(private readonly deliver: (action: RemoteInputAction) => Promise<unknown>, private readonly onError: (error: unknown) => void, private readonly delayMs = 60) {}

  enqueue(action: RemoteInputAction) {
    if (this.stopped) return;
    if (action.kind !== "text") { this.flushText(); this.append(action); return; }
    if (!action.text) return;
    if (this.text.length + action.text.length > 2000) this.flushText();
    for (let offset = 0; offset < action.text.length; offset += 2000) {
      const part = action.text.slice(offset, offset + 2000);
      if (this.text.length + part.length > 2000) this.flushText();
      this.text += part;
    }
    // Janela fixa: mesmo durante digitação contínua, a primeira letra não espera mais de 60 ms.
    this.timer ??= setTimeout(() => this.flushText(), this.delayMs);
  }
  private append(action: RemoteInputAction) {
    const generation = this.generation;
    this.tail = this.tail.then(() => this.stopped || generation !== this.generation ? undefined : this.deliver(action)).catch(this.onError);
  }
  private flushText() {
    clearTimeout(this.timer); this.timer = undefined;
    const text = this.text; this.text = "";
    if (text && !this.stopped) this.append({ kind: "text", text });
  }
  flush() { this.flushText(); return this.tail; }
  discardPending() { this.generation++; this.text = ""; clearTimeout(this.timer); this.timer = undefined; }
  discard() { this.discardPending(); this.stopped = true; }
}
