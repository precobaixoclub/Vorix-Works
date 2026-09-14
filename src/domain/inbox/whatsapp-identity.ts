/**
 * Resolução de identidade do WhatsApp — bloco "Identity UX" da experiência completa de Conversas
 * (ver docs/conversas-whatsapp-experience-completion.md). Único lugar do projeto que interpreta
 * PN (`@s.whatsapp.net`)/LID (`@lid`)/grupo (`@g.us`)/canal (`@newsletter`) — nenhum outro arquivo
 * deve fazer `.replace("@lid", ...)`/`.endsWith("@s.whatsapp.net")` etc. por conta própria.
 *
 * PRINCÍPIO (pedido original, seção 0): PESSOA (telefone, pivô comercial) ≠ CHAT (conversa
 * operacional) ≠ IDENTIDADE TÉCNICA DO PROVIDER (JID/LID, só roteamento). O telefone é o
 * identificador central da PESSOA sempre que disponível — LID nunca é mostrado como identidade
 * principal pro usuário, só existe como alias técnico pra deduplicação/roteamento.
 *
 * EVIDÊNCIA REAL (diagnóstico ao vivo em produção, ver docs/conversas-canonical-chat-identity.md):
 * o whatsmeow/WuzAPI já entrega o par PN↔LID quando aplicável, via `Info.SenderAlt`/
 * `Info.RecipientAlt` — quando `Info.Sender` (ou `Info.Chat`) vem como `@lid`, o campo `*Alt`
 * correspondente às vezes vem preenchido com o JID `@s.whatsapp.net` (telefone real) da MESMA
 * pessoa. Isso é dado do PRÓPRIO PROVIDER, nunca uma heurística nossa — é a única fonte aceitável
 * pra ligar um LID a um telefone (ver seção 4 do pedido original: "não inferir por heurística
 * insegura"). Quando o `*Alt` não vem preenchido, não há como saber o telefone real: a pessoa fica
 * identificada só pelo LID (pivô degradado, documentado como risco) até algum evento futuro trazer
 * o alt.
 */

const PN_SUFFIX = "@s.whatsapp.net";
const LID_SUFFIX = "@lid";
const GROUP_SUFFIX = "@g.us";

export type WhatsAppJidKind = "pn" | "lid" | "group" | "newsletter" | "unknown";

export function classifyWhatsAppJid(jid: string): WhatsAppJidKind {
  if (jid.endsWith(PN_SUFFIX)) return "pn";
  if (jid.endsWith(LID_SUFFIX)) return "lid";
  if (jid.endsWith(GROUP_SUFFIX)) return "group";
  if (jid.endsWith("@newsletter")) return "newsletter";
  return "unknown";
}

/** Um JID representa uma PESSOA (nunca um grupo/canal) quando é PN ou LID. */
export function isPersonJid(jid: string): boolean {
  const kind = classifyWhatsAppJid(jid);
  return kind === "pn" || kind === "lid";
}

/** `"<dígitos>.<device>:<agent>@domínio"` (própria sessão) ou `"<dígitos>@domínio"` (contato) —
 * mesmo formato pra PN, LID e grupo; só o domínio muda o significado. */
function digitsOf(jid: string): string {
  return jid.split("@")[0]?.split(".")[0]?.split(":")[0] ?? jid;
}

/** JID de grupo/canal preservado como veio (nunca formatado como telefone — ver
 * `wuzapi-event-mapper.ts:normalizeWhatsmeowGroupJid`, mesma regra aqui). */
export function normalizeAliasValue(jid: string): string {
  const digits = digitsOf(jid);
  return digits ? `+${digits}` : jid;
}

export type ResolvedPersonIdentity = {
  /** Telefone E.164 canônico da pessoa — `undefined` quando só temos LID e o provider nunca
   * mandou o `*Alt` correspondente (pivô degradado, ver comentário no topo do arquivo). */
  phoneE164?: string;
  /** Alias técnico PN (`+<dígitos>`), quando conhecido — pode vir do próprio `jid` ou do `altJid`. */
  pn?: string;
  /** Alias técnico LID (`+<dígitos>`), quando conhecido — idem. */
  lid?: string;
};

/**
 * Resolve a identidade de UMA pessoa a partir do JID observado num evento e, quando disponível, do
 * seu par alternante (`*Alt`) reportado pelo próprio whatsmeow/WuzAPI. `jid`/`altJid` podem vir em
 * qualquer ordem (PN ou LID em qualquer um dos dois slots) — a função classifica cada um pelo
 * sufixo e monta o resultado sem assumir qual é qual.
 */
export function resolveWhatsAppPersonIdentity(jid: string, altJid?: string): ResolvedPersonIdentity {
  const candidates = [jid, altJid].filter((value): value is string => Boolean(value && value.trim()));
  let pn: string | undefined;
  let lid: string | undefined;
  for (const candidate of candidates) {
    const kind = classifyWhatsAppJid(candidate);
    if (kind === "pn" && !pn) pn = normalizeAliasValue(candidate);
    else if (kind === "lid" && !lid) lid = normalizeAliasValue(candidate);
  }
  return { phoneE164: pn, pn, lid };
}
