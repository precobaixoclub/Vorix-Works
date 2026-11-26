/**
 * Cliente da ponte Vorix ↔ DaVinci por arquivos (ver `lua/VorixBridge.lua`).
 *
 * - Um pedido por vez (fila interna): a ponte é sequencial e o ambiente experimental admite um
 *   único render simultâneo.
 * - Toda operação é validada por `assertValidOperation` antes de ir para o disco.
 * - "Ponte viva" = `status.json` reescrito recentemente (batimento), não só a existência do arquivo.
 * - A raiz da ponte vem do construtor (configuração do worker), nunca de entrada do usuário.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertValidOperation, BRIDGE_PROTOCOL_VERSION, type BridgeOperation, type BridgeResponse } from "./bridge-protocol.js";

export class DavinciBridgeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DavinciBridgeUnavailableError";
  }
}

export class DavinciBridgeTimeoutError extends Error {
  constructor(readonly op: string, readonly timeoutMs: number) {
    super(`A ponte do DaVinci não respondeu a "${op}" em ${Math.round(timeoutMs / 1000)}s.`);
    this.name = "DavinciBridgeTimeoutError";
  }
}

export class DavinciOperationError extends Error {
  constructor(readonly op: string, message: string) {
    super(`DaVinci recusou "${op}": ${message}`);
    this.name = "DavinciOperationError";
  }
}

export class DavinciCancelledError extends Error {
  constructor() {
    super("Operação cancelada.");
    this.name = "DavinciCancelledError";
  }
}

export type BridgeStatus = { alive: boolean; ageMs: number | null; state?: string; bridge?: string; protocol?: number; caps?: Record<string, boolean> };

export type FileBridgeClientOptions = {
  rootDir: string;
  /** Batimento mais velho que isto = ponte parada. A ponte reescreve a cada ~1s. */
  heartbeatMaxAgeMs?: number;
  pollIntervalMs?: number;
  defaultTimeoutMs?: number;
  now?: () => number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class FileBridgeClient {
  readonly rootDir: string;
  private readonly heartbeatMaxAgeMs: number;
  private readonly pollIntervalMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: FileBridgeClientOptions) {
    this.rootDir = options.rootDir;
    this.heartbeatMaxAgeMs = options.heartbeatMaxAgeMs ?? 6_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  get inboxFile(): string {
    return join(this.rootDir, "inbox", "request.json");
  }
  get outboxFile(): string {
    return join(this.rootDir, "outbox", "response.json");
  }
  get statusFile(): string {
    return join(this.rootDir, "status.json");
  }
  jobDir(jobId: string): string {
    return join(this.rootDir, "jobs", jobId);
  }

  async ensureLayout(): Promise<void> {
    await Promise.all([mkdir(join(this.rootDir, "inbox"), { recursive: true }), mkdir(join(this.rootDir, "outbox"), { recursive: true }), mkdir(join(this.rootDir, "jobs"), { recursive: true })]);
  }

  async status(): Promise<BridgeStatus> {
    try {
      const [info, raw] = await Promise.all([stat(this.statusFile), readFile(this.statusFile, "utf8")]);
      const ageMs = this.now() - info.mtimeMs;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // escrita em andamento — o batimento seguinte corrige
      }
      const state = typeof parsed.state === "string" ? parsed.state : undefined;
      return { alive: ageMs <= this.heartbeatMaxAgeMs && state !== "stopped", ageMs, state, bridge: parsed.bridge as string | undefined, protocol: parsed.protocol as number | undefined, caps: parsed.caps as Record<string, boolean> | undefined };
    } catch {
      return { alive: false, ageMs: null };
    }
  }

  async assertAlive(): Promise<BridgeStatus> {
    const status = await this.status();
    if (!status.alive) {
      throw new DavinciBridgeUnavailableError(
        status.ageMs === null
          ? "A ponte do DaVinci nunca foi iniciada neste worker (abra o DaVinci Resolve e rode Workspace > Scripts > VorixBridge)."
          : `A ponte do DaVinci está parada (último sinal há ${Math.round(status.ageMs / 1000)}s).`,
      );
    }
    if (status.protocol !== undefined && status.protocol !== BRIDGE_PROTOCOL_VERSION) {
      throw new DavinciBridgeUnavailableError(`Versão da ponte incompatível (protocolo ${status.protocol}; esperado ${BRIDGE_PROTOCOL_VERSION}). Reinstale a ponte.`);
    }
    return status;
  }

  /** Envia uma operação e espera a resposta. Serializado: chamadas concorrentes entram na fila. */
  call<T extends Record<string, unknown> = Record<string, unknown>>(operation: BridgeOperation, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    const run = this.queue.then(() => this.callNow<T>(operation, options));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async callNow<T>(operation: BridgeOperation, options: { timeoutMs?: number; signal?: AbortSignal }): Promise<T> {
    assertValidOperation(operation);
    if (options.signal?.aborted) throw new DavinciCancelledError();
    const id = randomUUID();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const payload = JSON.stringify({ v: BRIDGE_PROTOCOL_VERSION, id, op: operation.op, args: operation.args ?? {} });
    await this.ensureLayout();
    await rm(this.outboxFile, { force: true });
    const temp = `${this.inboxFile}.${id}.tmp`;
    await writeFile(temp, payload, "utf8");
    await rename(temp, this.inboxFile);
    const startedAt = this.now();
    try {
      while (true) {
        if (options.signal?.aborted) throw new DavinciCancelledError();
        if (this.now() - startedAt > timeoutMs) throw new DavinciBridgeTimeoutError(operation.op, timeoutMs);
        const response = await this.readResponse(id);
        if (response) {
          if (!response.ok) throw new DavinciOperationError(operation.op, response.error ?? "erro desconhecido");
          return (response.result ?? {}) as T;
        }
        await sleep(this.pollIntervalMs);
      }
    } finally {
      // Retira o pedido para que uma ponte atrasada não o execute depois de desistirmos.
      await rm(this.inboxFile, { force: true });
      await rm(this.outboxFile, { force: true });
    }
  }

  private async readResponse(id: string): Promise<BridgeResponse | null> {
    let raw: string;
    try {
      raw = await readFile(this.outboxFile, "utf8");
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as BridgeResponse;
      return parsed && parsed.id === id ? parsed : null;
    } catch {
      return null; // escrita parcial; a próxima leitura pega o arquivo completo
    }
  }
}
