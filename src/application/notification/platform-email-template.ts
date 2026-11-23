import type { PlatformEmailEvent } from "./platform-email-alerts.js";

/**
 * Layout dos alertas da plataforma (Admin → Notificações por e-mail).
 *
 * HTML de e-mail: tabelas + estilos inline, largura máxima de 560px, sem imagens externas (a marca é
 * tipográfica, então nada some quando o cliente bloqueia imagens) e sem CSS que o Gmail/Outlook
 * descartem. Sempre acompanha a versão em texto puro.
 */

type Tone = "success" | "info" | "warning" | "danger";

type EventLayout = { label: string; tone: Tone; intro?: string; cta: string };

const EVENT_LAYOUT: Record<PlatformEmailEvent | "test", EventLayout> = {
  account_created: { label: "Nova conta", tone: "success", intro: "Uma nova conta acabou de ser criada no Vorix.", cta: "Ver conta" },
  subscription_started: { label: "Assinatura", tone: "success", intro: "Uma assinatura foi confirmada pelo meio de pagamento.", cta: "Ver conta" },
  plan_changed: { label: "Assinatura", tone: "info", intro: "O plano de uma conta foi alterado.", cta: "Ver conta" },
  cancellation_requested: { label: "Cancelamento", tone: "warning", intro: "Um cliente pediu o cancelamento. A assinatura continua ativa até o fim do período atual.", cta: "Ver conta" },
  subscription_cancelled: { label: "Cancelamento", tone: "danger", intro: "Uma assinatura foi cancelada.", cta: "Ver conta" },
  payment_failed: { label: "Pagamento", tone: "danger", intro: "Uma cobrança de assinatura foi recusada.", cta: "Ver conta" },
  publication_failed: { label: "Publicação", tone: "danger", intro: "Uma publicação não saiu como previsto. Confira o motivo e decida o próximo passo.", cta: "Abrir no Vorix" },
  publication_action_required: { label: "Ação necessária", tone: "warning", intro: "Uma publicação precisa de atenção para continuar.", cta: "Resolver no Vorix" },
  test: { label: "Teste", tone: "info", cta: "Abrir configurações" },
};

const TONES: Record<Tone, { text: string; background: string; bar: string }> = {
  success: { text: "#166534", background: "#DCFCE7", bar: "#22C55E" },
  info: { text: "#6B21A8", background: "#F3E8FF", bar: "#9333EA" },
  warning: { text: "#92400E", background: "#FEF3C7", bar: "#F59E0B" },
  danger: { text: "#991B1B", background: "#FEE2E2", bar: "#EF4444" },
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** "Rótulo: valor" vira linha da tabela de detalhes; o resto vira parágrafo. */
export function parseAlertBody(body: string): { rows: Array<{ label: string; value: string }>; paragraphs: string[] } {
  const rows: Array<{ label: string; value: string }> = [];
  const paragraphs: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^([^:]{2,32}):\s+(.+)$/);
    if (match && !/^https?$/i.test(match[1]!)) rows.push({ label: match[1]!.trim(), value: match[2]!.trim() });
    else paragraphs.push(line);
  }
  return { rows, paragraphs };
}

function formatSentAt(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function renderPlatformEmail(input: { event: PlatformEmailEvent | "test"; subject: string; body: string; link?: string; sentAt?: Date }): { html: string; text: string } {
  const layout = EVENT_LAYOUT[input.event] ?? EVENT_LAYOUT.test;
  const tone = TONES[layout.tone];
  const { rows, paragraphs } = parseAlertBody(input.body);
  const sentAt = formatSentAt(input.sentAt ?? new Date());
  const intro = layout.intro ?? paragraphs.shift() ?? "";
  const preheader = [intro, ...rows.slice(0, 2).map((row) => `${row.label}: ${row.value}`)].filter(Boolean).join(" · ");

  const detailRows = rows.map((row, index) => `
              <tr>
                <td style="padding:12px 16px;${index ? "border-top:1px solid #ECE9F3;" : ""}font:500 13px/1.4 ${FONT};color:#6B6880;width:38%;vertical-align:top;">${escapeHtml(row.label)}</td>
                <td style="padding:12px 16px;${index ? "border-top:1px solid #ECE9F3;" : ""}font:600 14px/1.4 ${FONT};color:#16131F;vertical-align:top;">${escapeHtml(row.value)}</td>
              </tr>`).join("");
  const details = rows.length ? `
          <tr><td style="padding:0 32px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid #ECE9F3;border-radius:12px;background:#FBFAFD;">${detailRows}
            </table>
          </td></tr>` : "";
  const extra = paragraphs.map((paragraph) => `
          <tr><td style="padding:12px 32px 0;font:400 14px/1.6 ${FONT};color:#3F3B4F;">${escapeHtml(paragraph)}</td></tr>`).join("");
  const button = input.link ? `
          <tr><td style="padding:24px 32px 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="border-radius:10px;background:#9333EA;">
                <a href="${escapeHtml(input.link)}" style="display:inline-block;padding:13px 22px;font:600 14px/1 ${FONT};color:#FFFFFF;text-decoration:none;border-radius:10px;">${escapeHtml(layout.cta)} &rarr;</a>
              </td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:8px 32px 0;font:400 12px/1.5 ${FONT};color:#8A8699;">Se o botão não abrir, copie este endereço: <a href="${escapeHtml(input.link)}" style="color:#7E22CE;word-break:break-all;">${escapeHtml(input.link)}</a></td></tr>` : "";

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F4F2F8;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2F8;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E7E3F0;">
        <tr><td style="background:#0B0F19;padding:22px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font:800 20px/1 ${FONT};letter-spacing:3px;color:#FFFFFF;"><span style="color:#B990FC;">V</span>ORIX <span style="font:600 10px/1 ${FONT};letter-spacing:3px;color:#B990FC;">WORKS</span></td>
            <td align="right" style="font:500 12px/1 ${FONT};color:#9CA3AF;">Alerta da plataforma</td>
          </tr></table>
        </td></tr>
        <tr><td style="height:4px;background:${tone.bar};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px 0;">
          <span style="display:inline-block;padding:5px 10px;border-radius:999px;background:${tone.background};color:${tone.text};font:700 11px/1 ${FONT};letter-spacing:.6px;text-transform:uppercase;">${escapeHtml(layout.label)}</span>
        </td></tr>
        <tr><td style="padding:14px 32px 0;font:700 22px/1.3 ${FONT};color:#16131F;">${escapeHtml(input.subject)}</td></tr>
        ${intro ? `<tr><td style="padding:8px 32px 20px;font:400 15px/1.6 ${FONT};color:#4B475C;">${escapeHtml(intro)}</td></tr>` : ""}${details}${extra}${button}
        <tr><td style="padding:28px 32px 26px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #ECE9F3;padding-top:16px;font:400 12px/1.6 ${FONT};color:#8A8699;">
            Enviado em ${escapeHtml(sentAt)} (horário de Brasília).<br>
            Você recebe este alerta porque está na lista de destinatários em <strong style="color:#6B6880;">Admin → Notificações por e-mail</strong> do Vorix.
          </td></tr></table>
        </td></tr>
      </table>
      <div style="padding:16px 12px 0;font:400 11px/1.5 ${FONT};color:#A39FB3;">Vorix Works · vorixworks.com</div>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    input.subject,
    "",
    ...(intro ? [intro, ""] : []),
    ...rows.map((row) => `${row.label}: ${row.value}`),
    ...(paragraphs.length ? ["", ...paragraphs] : []),
    ...(input.link ? ["", `${layout.cta}: ${input.link}`] : []),
    "",
    `Enviado em ${sentAt} (horário de Brasília) · Alerta da plataforma Vorix`,
  ].join("\n");
  return { html, text };
}
