/**
 * Verificação pós-renderização — Sprint 08 (Fase 10/decisão 12). Segunda camada de defesa,
 * independente do `AiInputSanitizer`: depois que o `PromptTemplate` já renderizou o texto final
 * (instruções + input do usuário), confere de novo — nunca "depender só do prompt para segurança"
 * (Fase 10) também significa não depender só da sanitização de ENTRADA; o texto final pode crescer
 * de formas que o sanitizer não previu (ex.: um catálogo de campos muito grande).
 */

const LEAK_PATTERNS: readonly RegExp[] = [/bearer\s+[a-z0-9._-]{10,}/i, /sk-[a-z0-9]{10,}/i, /-----BEGIN [A-Z ]+-----/, /"?password"?\s*[:=]/i];

export type PostRenderCheckResult = { ok: true } | { ok: false; reason: string };

export function checkRenderedPrompt(params: { systemPrompt: string; userInput: string; maxTotalChars: number }): PostRenderCheckResult {
  const combined = `${params.systemPrompt}\n${params.userInput}`;

  if (combined.length > params.maxTotalChars) {
    return { ok: false, reason: `rendered_prompt_exceeds_limit:${combined.length}>${params.maxTotalChars}` };
  }

  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(combined)) {
      return { ok: false, reason: "rendered_prompt_matches_leak_pattern" };
    }
  }

  return { ok: true };
}
