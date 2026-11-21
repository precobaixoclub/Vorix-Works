import { getPublication } from "@/features/publication/api";

export type PublicationSubmissionResult = { publicationId: string; state: string; scheduledAt?: string };
export type PublicationSubmissionOutcome = { publicationId: string; status: "published" | "scheduled" | "processing"; message: string };
type Failure = { code?: unknown; message?: unknown };
type SubmissionDetail = { failures?: readonly Failure[]; attempts?: readonly { failure?: Failure }[] };

const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  url_ownership_unverified: "O domínio dos arquivos ainda não está validado no TikTok para este aplicativo. Revise a verificação do domínio na integração.",
  unaudited_client_can_only_post_to_private_accounts: "Para testar antes da aprovação do aplicativo, use uma conta TikTok privada e escolha “Só eu” na publicação.",
  unaudited_client_can_only_post_to_private: "Antes da aprovação do aplicativo, a publicação no TikTok deve usar a opção “Só eu”.",
  privacy_level_option_mismatch: "A privacidade escolhida não está disponível nesta conta TikTok. Revise a opção antes de enviar novamente.",
  scope_not_authorized: "A conta não autorizou a permissão de publicação. Reconecte a conta e autorize o envio.",
  access_token_invalid: "A conexão com a rede expirou. Reconecte a conta antes de publicar.",
};

/** HTTP success means the request was received; the publication state determines its outcome. */
export async function checkPublicationSubmission(
  workspaceId: string,
  result: PublicationSubmissionResult,
  loadDetail: () => Promise<SubmissionDetail> = () => getPublication(workspaceId, result.publicationId) as Promise<SubmissionDetail>,
): Promise<PublicationSubmissionOutcome> {
  const state = result.state.toLowerCase();
  if (state === "published" || state === "completed" || state === "confirmed_published") return { publicationId: result.publicationId, status: "published", message: "Publicado." };
  if (["failed", "validation_failed", "dead_lettered", "confirmed_not_published", "cancelled", "superseded"].includes(state)) {
    const detail = await loadDetail().catch(() => undefined);
    const failure = detail?.failures?.at(-1) ?? detail?.attempts?.filter((attempt) => attempt.failure).at(-1)?.failure;
    const code = typeof failure?.code === "string" ? failure.code : "";
    const message = typeof failure?.message === "string" ? failure.message : "";
    throw new Error(FAILURE_MESSAGES[code] || message || "A publicação falhou. Consulte o histórico para revisar o motivo antes de tentar novamente.");
  }
  if (state === "unknown_outcome") throw new Error("A rede ainda não confirmou o resultado do envio. Consulte o histórico antes de tentar novamente para evitar uma publicação duplicada.");
  if (state === "scheduled" || (result.scheduledAt && ["draft", "approved", "waiting_for_approval"].includes(state))) return { publicationId: result.publicationId, status: "scheduled", message: "Agendado." };
  if (["draft", "approved", "waiting_for_approval", "publishing", "pending", "queued", "in_progress"].includes(state)) return { publicationId: result.publicationId, status: "processing", message: "Em processamento. Acompanhe a confirmação no histórico." };
  throw new Error("Não foi possível confirmar o estado da publicação. Consulte o histórico antes de tentar novamente.");
}
