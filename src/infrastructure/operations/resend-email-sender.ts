import type { TransactionalEmailSender } from "../../application/notification/platform-email-alerts.js";

export class ResendEmailSender implements TransactionalEmailSender {
  constructor(private readonly http: typeof fetch = fetch) {}

  async send({ apiKey, job, text, html }: Parameters<TransactionalEmailSender["send"]>[0]): ReturnType<TransactionalEmailSender["send"]> {
    try {
      const response = await this.http("https://api.resend.com/emails", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `vorix-admin-alert/${job.id}` },
        body: JSON.stringify({ from: `Vorix <${job.fromEmail}>`, to: [job.recipient], subject: job.subject, text, ...(html ? { html } : {}) }),
      });
      const data = await response.json().catch(() => null) as { id?: unknown; name?: unknown; message?: unknown } | null;
      if (response.ok && typeof data?.id === "string" && data.id.length > 0) return { accepted: true, providerId: data.id };
      const retryable = response.ok || response.status === 429 || response.status >= 500 || data?.name === "concurrent_idempotent_requests";
      const reason = String(data?.message ?? "");
      const message = response.status === 401 ? "A chave do Resend não foi aceita."
        : response.status === 403 && /not verified/i.test(reason) ? "O domínio do remetente ainda não foi verificado no Resend. Conclua a verificação em resend.com/domains."
        : response.status === 403 && /testing emails|own email/i.test(reason) ? "Sem domínio verificado, o Resend só entrega para o e-mail dono da conta. Verifique o domínio para enviar a outros destinatários."
        : response.status === 403 ? "O Resend recusou o envio. Verifique o domínio do remetente e as permissões da chave."
        : response.status === 429 ? "O Resend atingiu o limite de envios."
        : response.ok ? "O Resend não retornou a confirmação do envio."
        : `O Resend não aceitou o envio (HTTP ${response.status}).`;
      return { accepted: false, retryable, message };
    } catch {
      return { accepted: false, retryable: true, message: "Falha de comunicação com o Resend." };
    }
  }
}
