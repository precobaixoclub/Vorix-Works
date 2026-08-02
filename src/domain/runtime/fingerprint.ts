import { createHash } from "node:crypto";

/**
 * Fingerprint canônico — Sprint 10 (decisão obrigatória 34). Mesmo mecanismo (`sha256`) já usado
 * pelo runner de migrations (`postgres/migration-runner.ts`) para checksums de arquivo, aplicado
 * aqui a uma estrutura de dados: serializa de forma determinística (chaves de objeto ordenadas
 * recursivamente) para que o mesmo conteúdo LÓGICO produza sempre o mesmo hash, independente da
 * ordem em que os campos foram construídos. Quem chama é responsável por já ter removido do valor
 * IDs aleatórios e timestamps antes de passar aqui — esta função não sabe (nem deveria saber) o
 * que é "ruído" num grafo de Planning ou num RuntimePlan; só serializa e resume.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function computeFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}
