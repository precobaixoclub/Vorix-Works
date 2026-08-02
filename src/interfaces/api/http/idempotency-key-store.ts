/**
 * Cache de respostas por `Idempotency-Key` — Release Track 1.0 (Fase 2). Em memória, por
 * processo, com TTL — decisão deliberada de não introduzir uma tabela/domínio novo numa sprint de
 * arquitetura congelada (ver `docs/release-track-1.0-final-report.md`, Fase 2). É uma primeira
 * linha de defesa contra retry de rede em endpoints de escrita que não têm idempotência própria no
 * domínio (diferente de Execution/Publication, que já garantem idempotência real e persistida via
 * `idempotency_key` único na própria tabela) — não sobrevive a restart nem funciona entre réplicas
 * de um deployment horizontal. Se a plataforma crescer para múltiplas instâncias, isto deveria
 * virar uma tabela operacional (mesma família de `operational_state`), não antes disso.
 */
export type CachedIdempotentResponse = {
  statusCode: number;
  body: unknown;
  createdAt: number;
};

export class InMemoryIdempotencyKeyStore {
  private readonly cache = new Map<string, CachedIdempotentResponse>();

  constructor(private readonly ttlMs: number = 24 * 60 * 60 * 1000) {}

  get(key: string): CachedIdempotentResponse | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, response: CachedIdempotentResponse): void {
    this.cache.set(key, response);
  }

  clear(): void {
    this.cache.clear();
  }
}
