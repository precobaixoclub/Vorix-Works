import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteInputQueue, type RemoteInputAction } from "../features/social/remote-input";

afterEach(() => vi.useRealTimers());
describe("entrada do navegador remoto", () => {
  it("envia uma sequência rápida em uma requisição e preserva letras repetidas", async () => {
    vi.useFakeTimers(); const delivered: RemoteInputAction[] = [];
    const queue = new RemoteInputQueue(async action => { delivered.push(action); }, () => {});
    for (const text of "usuario-teste-001@example.invalid") queue.enqueue({ kind: "text", text });
    expect(delivered).toEqual([]);
    await vi.advanceTimersByTimeAsync(60);
    await queue.flush();
    expect(delivered).toEqual([{ kind: "text", text: "usuario-teste-001@example.invalid" }]);
  });
  it("preserva a ordem texto, Tab, texto, Backspace e Enter antes de concluir", async () => {
    const delivered: RemoteInputAction[] = [];
    const queue = new RemoteInputQueue(async action => { delivered.push(action); }, () => {});
    queue.enqueue({ kind: "text", text: "usuario" }); queue.enqueue({ kind: "key", key: "Tab" });
    queue.enqueue({ kind: "text", text: "teste" }); queue.enqueue({ kind: "key", key: "Backspace" }); queue.enqueue({ kind: "key", key: "Enter" });
    await queue.flush();
    expect(delivered).toEqual([{ kind: "text", text: "usuario" }, { kind: "key", key: "Tab" }, { kind: "text", text: "teste" }, { kind: "key", key: "Backspace" }, { kind: "key", key: "Enter" }]);
  });
  it("mantém o limite do protocolo e não embaralha um clique com o texto", async () => {
    const delivered: RemoteInputAction[] = [];
    const queue = new RemoteInputQueue(async action => { delivered.push(action); }, () => {});
    queue.enqueue({ kind: "text", text: "x".repeat(4200) }); queue.enqueue({ kind: "click", x: 30, y: 70 });
    await queue.flush();
    expect(delivered.slice(0, -1).map(action => action.kind === "text" ? action.text.length : 0)).toEqual([2000, 2000, 200]);
    expect(delivered.at(-1)).toEqual({ kind: "click", x: 30, y: 70 });
  });
  it("cancelamento descarta texto pendente, mas permite digitar se o cancelamento falhar", async () => {
    const deliver = vi.fn(async () => {}), queue = new RemoteInputQueue(deliver, () => {});
    queue.enqueue({ kind: "text", text: "nao-enviar" }); queue.discardPending(); await queue.flush();
    expect(deliver).not.toHaveBeenCalled();
    queue.enqueue({ kind: "text", text: "nova-entrada" }); await queue.flush(); expect(deliver).toHaveBeenCalledExactlyOnceWith({ kind: "text", text: "nova-entrada" });
  });
  it("não envia ações enfileiradas após sair da tela", async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const delivered: RemoteInputAction[] = [];
    const queue = new RemoteInputQueue(async action => { delivered.push(action); await gate; }, () => {});
    queue.enqueue({ kind: "click", x: 10, y: 20 }); await Promise.resolve();
    queue.enqueue({ kind: "text", text: "descartar" }); queue.enqueue({ kind: "key", key: "Enter" }); queue.discard(); release(); await queue.flush();
    expect(delivered).toEqual([{ kind: "click", x: 10, y: 20 }]);
  });
});
