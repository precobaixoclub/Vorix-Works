/**
 * Aprovação de publicações pelo WhatsApp — regras puras (sem I/O): leitura da resposta do aprovador,
 * código do pedido e textos das mensagens. O número é da CONTA (uma conexão de qualquer espaço de
 * trabalho) e atende todas as marcas; cada marca decide se exige aprovação e quem aprova.
 */

export type ApprovalDecision = "approve" | "reject";
export type ApprovalTimeoutPolicy = "skip" | "publish";

/** `unclear`: começa como aprovação mas continua com outro assunto ("Pode refazer", "Ok, mas…") — nunca aprova. */
export type ParsedApprovalReply = { decision: ApprovalDecision; code?: string; reason?: string; unclear?: boolean };

/** O que pode acompanhar uma aprovação sem mudar o sentido ("1 obrigado", "pode publicar 👍"). */
const APPROVE_FILLER = /^(sim|s|ok|okay|pode|publica|publicar|aprovado|aprovada|aprovo|isso|obrigad[oa]|valeu|vlw|beleza|blz|perfeito|perfeita|otimo|ótimo|ótima|otima|top|show|tá|ta|bom|boa|massa|👍|✅|🙏|😊|❤️|!+)$/;

const APPROVE = /^(1|sim|s|ok|aprovar|aprovado|aprovo|aprova|pode|pode publicar|publica|publicar|👍|✅)$/;
const REJECT = /^(2|nao|não|n|reprovar|reprovado|reprovo|reprova|recusar|recuso|não publica|nao publica|👎|❌)$/;

/** Código curto do pedido (sem 0/O/1/I para não confundir quem digita). */
export function approvalCode(random: () => number = Math.random): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  // Sempre letras + números (ex.: K7QZ): assim o código nunca se confunde com "sim"/"ok" na resposta.
  const pick = (alphabet: string) => alphabet[Math.floor(random() * alphabet.length)];
  const chars = [pick(letters), pick(digits), pick(letters + digits), pick(letters + digits)];
  return chars.sort(() => random() - 0.5).join("");
}

/**
 * Lê a resposta: "1", "sim", "aprovar"… aprova; "2", "não", "reprovar"… reprova (o resto do texto vira o
 * motivo). O código do pedido pode vir em qualquer posição ("1 K7QZ", "K7QZ 2 cor errada"). Qualquer outra
 * mensagem NÃO é resposta de aprovação — segue para o atendimento normal.
 */
export function parseApprovalReply(text: string | undefined): ParsedApprovalReply | undefined {
  if (!text) return undefined;
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 500) return undefined;
  const words = clean.split(" ");
  const codeIndex = words.findIndex((word) => /^[A-HJ-NP-Z2-9]{4}$/.test(word.toUpperCase()) && /[A-Za-z]/.test(word) && /\d/.test(word));
  const code = codeIndex >= 0 ? words[codeIndex].toUpperCase() : undefined;
  const rest = words.filter((_, index) => index !== codeIndex);
  if (!rest.length) return undefined;
  const lowered = rest.map((word) => word.toLowerCase().replace(/[.,!;:]+$/, ""));
  // Decisão na 1ª palavra (ou nas duas primeiras: "não publica", "pode publicar").
  for (const size of [2, 1]) {
    const head = lowered.slice(0, size).join(" ");
    const decision: ApprovalDecision | undefined = APPROVE.test(head) ? "approve" : REJECT.test(head) ? "reject" : undefined;
    if (!decision) continue;
    const reason = rest.slice(size).join(" ").replace(/^[-–:,.\s]+/, "").trim();
    // Aprovação só com a palavra de aprovação (e cortesias). "Pode refazer" aprovava o pedido aberto
    // (produção, 26/11/2026): texto a mais depois de "ok/sim/pode" fica sem decisão e o sistema pergunta.
    if (decision === "approve" && lowered.slice(size).some((word) => !APPROVE_FILLER.test(word))) {
      return { decision, ...(code ? { code } : {}), unclear: true };
    }
    return { decision, ...(code ? { code } : {}), ...(decision === "reject" && reason ? { reason: reason.slice(0, 300) } : {}) };
  }
  return undefined;
}

/** Telefone só com dígitos (o mesmo formato canônico guardado no pedido). */
export const phoneDigits = (value: string) => value.replace(/\D/g, "");

const NETWORK_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", kwai: "Kwai" };

/** `withCode`: já há outro pedido aguardando este aprovador — a resposta precisa do código (ou citar a mensagem). */
export function approvalRequestText(input: { brand: string; code: string; networks: string[]; when?: string; caption?: string; screens: number; withCode?: boolean; redo?: { attempt: number; max: number; reason: string } }): string {
  const networks = input.networks.map((network) => NETWORK_LABEL[network] ?? network).join(" + ") || "redes sociais";
  const caption = (input.caption ?? "").trim();
  return [
    `*Aprovação de publicação — ${input.brand}*`,
    ...(input.redo ? [`🔁 Versão refeita (ajuste ${input.redo.attempt} de ${input.redo.max}) — você pediu: “${input.redo.reason}”`] : []),
    `${networks} · ${input.when ? `agendada para ${input.when}` : "publicar assim que aprovar"}${input.screens > 1 ? ` · carrossel com ${input.screens} imagens` : ""}`,
    ...(caption ? ["", `Legenda: ${caption.length > 600 ? `${caption.slice(0, 600)}…` : caption}`] : []),
    "",
    ...(input.withCode
      ? [
        `Há mais de uma publicação aguardando você. Responda *1 ${input.code}* para aprovar ou *2 ${input.code}* para reprovar (pode escrever o motivo depois).`,
        `Ou toque em *Responder* nesta mensagem (ou na imagem) e mande só *1* ou *2*.`,
      ]
      : [
        `Responda *1* para aprovar ou *2* para reprovar (pode escrever o motivo depois do 2).`,
        `Também vale tocar em *Responder* nesta mensagem ou na imagem.`,
      ]),
    `Código: *${input.code}*`,
  ].join("\n");
}

export const approvalAckText = {
  approved: (brand: string, when?: string) => `✅ Aprovado — ${brand}. ${when ? `Será publicado em ${when}.` : "Publicando agora."}`,
  rejected: (brand: string, reason?: string) => `❌ Reprovado — ${brand}. A publicação foi cancelada${reason ? ` (motivo: ${reason})` : ""}.`,
  redoQueued: (brand: string, reason: string, attempt: number, max: number) => `❌ Reprovado — ${brand} (motivo: ${reason}). Vou refazer a arte com base no seu motivo e te mando a nova versão para aprovar (ajuste ${attempt} de ${max}).`,
  unclear: (code: string) => `Não entendi se é para aprovar a publicação ${code}. Responda só *1* para aprovar, ou *2* e o que precisa mudar para eu refazer.`,
  redoFailed: (brand: string, detail?: string) => `⚠️ Não consegui refazer a arte de ${brand}${detail ? `: ${detail.slice(0, 220)}` : ""}. A ideia voltou ao Bolsão.`,
  redoLimit: (brand: string, reason: string | undefined, max: number) => `❌ Reprovado — ${brand}${reason ? ` (motivo: ${reason})` : ""}. Já foram ${max} ajustes nesta ideia: ela voltou ao Bolsão para revisão.`,
  expiredSkip: (brand: string, when?: string) => `⏰ Sem resposta — ${brand}: a publicação${when ? ` das ${when}` : ""} não foi feita.`,
  expiredPublish: (brand: string, when?: string) => `⏰ Sem resposta — ${brand}: pela regra da marca, a publicação${when ? ` das ${when}` : ""} seguiu automaticamente.`,
  late: (code: string) => `Esse pedido (${code}) já foi encerrado — nada foi alterado.`,
  ambiguous: (codes: string[]) => `Há ${codes.length} publicações aguardando sua aprovação. Toque em *Responder* na imagem da publicação e mande *1* ou *2* — ou responda com o código, por exemplo: *1 ${codes[0]}* ou *2 ${codes[0]} motivo*. Códigos: ${codes.join(", ")}.`,
  unknownCode: (code: string) => `Não encontrei uma publicação aguardando aprovação com o código ${code}.`,
  failed: (brand: string, detail: string) => `⚠️ Não consegui aplicar sua resposta na publicação de ${brand}: ${detail}`,
  test: (brand: string) => `Teste de aprovação — ${brand}. Quando houver uma publicação para aprovar, ela chega aqui. Responda *1* para aprovar ou *2* para reprovar.`,
};

/** Escolhe o pedido aberto a que a resposta se refere (por código; sem código, só se houver um). */
export function matchPendingRequest<T extends { code: string }>(pending: readonly T[], parsed: ParsedApprovalReply):
  { request: T } | { ambiguous: string[] } | { unknownCode: string } | undefined {
  if (!pending.length) return undefined;
  if (parsed.code) {
    const request = pending.find((item) => item.code === parsed.code);
    return request ? { request } : { unknownCode: parsed.code };
  }
  if (pending.length === 1) return { request: pending[0] };
  return { ambiguous: pending.map((item) => item.code) };
}
