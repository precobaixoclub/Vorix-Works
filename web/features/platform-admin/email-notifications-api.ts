import { apiClient } from "@/lib/api-client";

export const EMAIL_NOTIFICATION_EVENTS = [
  { id: "account_created", label: "Nova conta", description: "Cadastro concluído no Vorix." },
  { id: "subscription_started", label: "Nova assinatura", description: "Assinatura paga confirmada, incluindo conversão do teste." },
  { id: "plan_changed", label: "Mudança de plano", description: "Upgrade ou downgrade aplicado à assinatura." },
  { id: "cancellation_requested", label: "Pedido de cancelamento", description: "Cancelamento solicitado para o fim do período." },
  { id: "subscription_cancelled", label: "Assinatura cancelada", description: "Cancelamento efetivado." },
  { id: "payment_failed", label: "Falha de pagamento", description: "O provedor registrou uma falha na cobrança da assinatura." },
  { id: "publication_failed", label: "Falha na publicação", description: "O Vorix não conseguiu enviar ou preparar uma postagem." },
  { id: "publication_action_required", label: "Publicação precisa de atenção", description: "Conta a reconectar, fila pausada, atraso ou resultado a confirmar." },
] as const;

export type EmailNotificationEvent = typeof EMAIL_NOTIFICATION_EVENTS[number]["id"];
export type EmailNotificationSettings = {
  enabled: boolean;
  fromEmail: string | null;
  recipients: string[];
  events: EmailNotificationEvent[];
  hasApiKey: boolean;
};

export type EmailNotificationHistoryItem = {
  id: string;
  subject: string;
  recipient: string;
  status: "pending" | "sending" | "accepted" | "failed" | "cancelled";
  attempts: number;
  createdAt: string;
  finishedAt: string | null;
  lastError: string | null;
};

const base = "/v1/admin/email-notifications";
export const getEmailNotificationSettings = () => apiClient.get<EmailNotificationSettings>(base);
export const saveEmailNotificationSettings = (input: Omit<EmailNotificationSettings, "hasApiKey"> & { apiKey?: string }) =>
  apiClient.put<EmailNotificationSettings>(base, input);
export const getEmailNotificationHistory = () => apiClient.get<EmailNotificationHistoryItem[]>(`${base}/history`);
export const sendEmailNotificationTest = () => apiClient.post<{ queued: number }>(`${base}/test`);
