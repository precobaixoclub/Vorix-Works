import { describe, expect, it } from "vitest";
import { deriveObjective, extractExecutionRunFailure, isUnrecoverableSemanticOcclusionFailure, MAX_OBJECTIVE_LENGTH } from "../features/production-line/api";
import type { ExecutionRunDetail } from "../features/execution/types";

// Bug real achado ao vivo (Rodada 2, Fatia 3): o editor de ideias não tem campo separado de
// objetivo — o texto livre da ideia (até 2000 caracteres) era espelhado direto em `objective`,
// que a API limita a 300. Qualquer ideia com mais de 300 caracteres nunca conseguia gerar.
describe("deriveObjective", () => {
  it("usa o objective quando presente, cortado no limite da API", () => {
    const longObjective = "x".repeat(400);
    expect(deriveObjective(longObjective, "ideia curta")).toHaveLength(MAX_OBJECTIVE_LENGTH);
  });

  it("cai pro ideaText quando objective está vazio, também cortado no limite (o bug real: ideia sem objetivo dedicado, com texto longo)", () => {
    const longIdeaText = "Descreva uma promoção completa. ".repeat(20);
    expect(longIdeaText.length).toBeGreaterThan(MAX_OBJECTIVE_LENGTH);
    const result = deriveObjective(undefined, longIdeaText);
    expect(result).toHaveLength(MAX_OBJECTIVE_LENGTH);
    expect(result).toBe(longIdeaText.slice(0, MAX_OBJECTIVE_LENGTH));
  });

  it("não corta desnecessariamente quando o texto já cabe no limite", () => {
    expect(deriveObjective(undefined, "Ideia curta e direta.")).toBe("Ideia curta e direta.");
  });
});

// Espelha `evaluateSemanticOcclusion` em `lucas-quality-review.skill.ts` (Rodada 2, Fatia 3) —
// achado ao vivo: uma reprovação por rosto/olhos cobertos que o Repair Loop já tentou e não
// resolveu não deveria disparar a regeneração automática (o problema é a composição fotográfica,
// não algo que regenerar copy/estratégia do zero conserte).
describe("isUnrecoverableSemanticOcclusionFailure", () => {
  it("reconhece a mensagem exata para rosto coberto", () => {
    const message = 'Peça não passou no quality gate — status "rejected" (nota 50/100). Principais motivos: Elemento "headline" sobre "face" (severe): O headline cobre completamente o rosto da pessoa.';
    expect(isUnrecoverableSemanticOcclusionFailure(message)).toBe(true);
  });

  it("reconhece também para olhos cobertos", () => {
    expect(isUnrecoverableSemanticOcclusionFailure('Elemento "badge" sobre "eyes" (severe): cobre os olhos.')).toBe(true);
  });

  it("NÃO reconhece oclusão sobre produto — regeneração continua valendo a pena", () => {
    expect(isUnrecoverableSemanticOcclusionFailure('Elemento "headline" sobre "product" (severe): cobre o produto.')).toBe(false);
  });

  it("NÃO reconhece outras causas de reprovação (alucinação, tipografia)", () => {
    expect(isUnrecoverableSemanticOcclusionFailure('Condição comercial não confirmada: "frete grátis".')).toBe(false);
    expect(isUnrecoverableSemanticOcclusionFailure('Zona "price" quebrou em 2 linhas.')).toBe(false);
  });

  it("undefined/vazio nunca bloqueia a regeneração", () => {
    expect(isUnrecoverableSemanticOcclusionFailure(undefined)).toBe(false);
    expect(isUnrecoverableSemanticOcclusionFailure("")).toBe(false);
  });
});

function detailWithAttempts(attempts: ExecutionRunDetail["attempts"]): ExecutionRunDetail {
  return {
    run: { id: "run-1", runtimePlanId: "plan-1", planningId: "planning-1", tenantId: "t1", workspaceId: "w1", state: "failed", mode: "real", idempotencyKey: "k1", sourceGraphFingerprint: "f1", runtimeFingerprint: "f2", correlationId: "c1", traceId: "tr1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", version: 1 },
    tasks: [],
    attempts,
    traces: [],
  } as unknown as ExecutionRunDetail;
}

describe("extractExecutionRunFailure", () => {
  it("devolve o code/message do último attempt com falha registrada", () => {
    const detail = detailWithAttempts([
      { id: "a1", executionRunId: "run-1", taskRunId: "t1", attemptNumber: 1, state: "completed", startedAt: "2026-01-01T00:00:00Z", idempotencyKey: "k1", correlationId: "c1" } as never,
      { id: "a2", executionRunId: "run-1", taskRunId: "t2", attemptNumber: 1, state: "failed", startedAt: "2026-01-01T00:00:00Z", failure: { code: "QUALITY_GATE_NOT_PASSED", message: "reprovado", category: "invalid_output", retryable: false }, idempotencyKey: "k2", correlationId: "c1" } as never,
    ]);
    expect(extractExecutionRunFailure(detail)).toEqual({ code: "QUALITY_GATE_NOT_PASSED", message: "reprovado" });
  });

  it("devolve undefined/undefined quando nenhum attempt tem falha registrada", () => {
    const detail = detailWithAttempts([]);
    expect(extractExecutionRunFailure(detail)).toEqual({ code: undefined, message: undefined });
  });
});
