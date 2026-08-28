/**
 * Sanitização de payload bruto do WuzAPI para virar fixture de teste — spike de verificação da
 * Fase 2. Objetivo: capturar a FORMA real do evento (nomes de campo, tipos, estrutura aninhada)
 * sem persistir dado sensível (telefone, nome, texto de mensagem, token, JID completo) em um
 * arquivo que vai parar no repositório Git.
 *
 * Preserva a estrutura (chaves, profundidade, tipos) e substitui só o CONTEÚDO de campos
 * conhecidos como sensíveis. Campos desconhecidos de tipo string são truncados/marcados como
 * `"<string:N>"` (N = tamanho original) em vez de redigidos byte a byte — suficiente pra validar
 * o mapper sem arriscar vazar algo que não foi antecipado nesta lista.
 */

const SENSITIVE_KEYS = new Set([
  "sender", "pushname", "jid", "phone", "phonenumber", "participant", "chat", "remotejid",
  "conversation", "text", "caption", "body", "url", "filename", "token", "instancetoken",
  "sessionid", "id", // "Info.ID" é o id da mensagem — não é PII, mas evitamos vazar ids reais de produção
]);

function redactString(key: string, value: string): string {
  const lowerKey = key.toLowerCase();
  if (SENSITIVE_KEYS.has(lowerKey)) return `<redacted:${value.length}>`;
  return value.length > 40 ? `<string:${value.length}>` : value;
}

export function sanitizeWuzApiEventForFixture(value: unknown, key = ""): unknown {
  if (typeof value === "string") return redactString(key, value);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeWuzApiEventForFixture(item, key));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      result[childKey] = sanitizeWuzApiEventForFixture(childValue, childKey);
    }
    return result;
  }
  return "<unknown>";
}
