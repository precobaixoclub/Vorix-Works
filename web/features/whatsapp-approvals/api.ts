import { apiClient } from "@/lib/api-client";

/** Aprovação de publicações pelo WhatsApp: número da CONTA (de qualquer espaço de trabalho) e regra por MARCA. */
export type ApprovalTimeoutPolicy = "skip" | "publish";
/** Reprovada com motivo: refazer a arte e reenviar, ou devolver a ideia ao Bolsão. */
export type ApprovalRejectPolicy = "redo" | "return";
export type ApprovalRule = { workspaceId: string; enabled: boolean; approverUserId?: string; approverPhone?: string; onTimeout: ApprovalTimeoutPolicy; onReject?: ApprovalRejectPolicy; enabledAt?: string };
export type ApprovalRequestStatus = "pending" | "sent" | "decided" | "applied" | "expired" | "failed";
export type ApprovalRequestView = {
  id: string; workspaceId: string; publicationId: string; code: string; status: ApprovalRequestStatus;
  decision?: "approve" | "reject"; reason?: string; detail?: string; createdAt: string; sentAt?: string; decidedAt?: string; appliedAt?: string;
};
export type WhatsappApprovalsOverview = {
  settings: { enabled: boolean; connectionId?: string };
  connections: Array<{ id: string; workspaceId: string; workspaceName?: string; displayName?: string; phoneNumber?: string; status: string }>;
  workspaces: Array<{ id: string; name: string; rule: ApprovalRule }>;
  approvers: Array<{ userId: string; name: string; email?: string }>;
  recent: ApprovalRequestView[];
  canManage: boolean;
};

export const getWhatsappApprovals = () => apiClient.get<WhatsappApprovalsOverview>("/v1/whatsapp-approvals");
export const saveWhatsappApprovalSettings = (input: { enabled: boolean; connectionId?: string | null }) => apiClient.put("/v1/whatsapp-approvals/settings", input);
export const saveWhatsappApprovalRule = (workspaceId: string, input: { enabled: boolean; approverUserId?: string | null; approverPhone?: string | null; onTimeout: ApprovalTimeoutPolicy; onReject: ApprovalRejectPolicy }) =>
  apiClient.put(`/v1/whatsapp-approvals/rules/${encodeURIComponent(workspaceId)}`, input);
export const sendWhatsappApprovalTest = (workspaceId: string) => apiClient.post<{ sent: boolean }>("/v1/whatsapp-approvals/test", { workspaceId });

export const APPROVAL_STATUS_LABEL: Record<ApprovalRequestStatus, string> = {
  pending: "Enviando pedido",
  sent: "Aguardando resposta",
  decided: "Resposta recebida",
  applied: "Concluído",
  expired: "Sem resposta no prazo",
  failed: "Falhou",
};
