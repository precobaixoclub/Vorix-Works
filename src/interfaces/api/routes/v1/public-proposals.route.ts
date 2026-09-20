import type { FastifyInstance } from "fastify";
import {
  acceptPublicProposal,
  applyProposalAcceptanceToDeal,
  getPublicProposal,
  rejectPublicProposal,
} from "../../../../application/crm/proposal-use-cases.js";
import type { ProposalDealLinkDeps, ProposalUseCaseDeps } from "../../../../application/crm/proposal-use-cases.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import type { Proposal } from "../../../../domain/crm/crm.model.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { successEnvelope } from "../../http/response-envelope.js";

const TOKEN_PARAMS_SCHEMA = { type: "object", required: ["token"], properties: { token: { type: "string", minLength: 1 } } } as const;

function translatePublicProposalError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("PROPOSAL_NOT_FOUND")) throw new NotFoundError(error.message);
  if (error instanceof Error && (error.message.startsWith("PROPOSAL_EXPIRED") || error.message.startsWith("PROPOSAL_ALREADY_RESPONDED") || error.message.startsWith("PROPOSAL_LINK_REVOKED"))) {
    throw new ValidationError(error.message);
  }
  throw error;
}

/**
 * Rota PÚBLICA (sem `requirePermission`/`requirePrincipal`) — o próprio token da URL é a
 * autenticação, mesmo racional do link de proposta que qualquer lead recebe por WhatsApp/e-mail.
 * Vive dentro de `/v1` normalmente (não precisa do isolamento de content-type cru do webhook do
 * Meta) — a ausência de chamada a `requirePermission` é o que a torna pública, não o prefixo.
 */
type PublicProposalRoutesDeps = ProposalUseCaseDeps & ProposalDealLinkDeps & { workspaceRepository: WorkspaceRepositoryPort };

async function publicPayload(deps: PublicProposalRoutesDeps, proposal: Proposal) {
  const [contact, workspace] = await Promise.all([
    proposal.contactId && deps.contactRepository ? deps.contactRepository.getById(proposal.contactId) : undefined,
    deps.workspaceRepository.getById(proposal.workspaceId),
  ]);
  const { publicTokenHash: _secretHash, ...safeProposal } = proposal;
  return { ...safeProposal, customerName: contact?.name, customerCompany: contact?.company, issuerName: workspace?.name };
}

export async function registerPublicProposalsRoutes(app: FastifyInstance, deps: PublicProposalRoutesDeps): Promise<void> {
  app.get("/public/proposals/:token", { schema: { params: TOKEN_PARAMS_SCHEMA } }, async (request) => {
    const { token } = request.params as { token: string };
    try {
      const proposal = await getPublicProposal(deps, token);
      return successEnvelope(await publicPayload(deps, proposal), request.id);
    } catch (error) {
      translatePublicProposalError(error);
    }
  });

  app.post("/public/proposals/:token/accept", { schema: { params: TOKEN_PARAMS_SCHEMA } }, async (request) => {
    const { token } = request.params as { token: string };
    let proposal: Proposal;
    try {
      proposal = await acceptPublicProposal(deps, token);
    } catch (error) {
      translatePublicProposalError(error);
    }
    try {
      // Item 33 do pedido — dois passos separados (nunca uma transação cruzando os dois
      // repositórios); `acceptPublicProposal` já persistiu `status=accepted` quando chegamos
      // aqui, então uma falha nesta segunda chamada NUNCA deveria virar um 500 genérico pro
      // cliente que já aceitou de verdade — o aceite continua registrado (idempotente, ver
      // `respondToPublicProposal`), só o Deal não avançou. Logamos com contexto suficiente pra
      // reconciliação manual (mesmo padrão de best-effort de `notifyBestEffort`); um segundo
      // clique em "Aceitar" já corrige sozinho (`applyProposalAcceptanceToDeal` é idempotente).
      await applyProposalAcceptanceToDeal(deps, proposal);
    } catch (error) {
      console.error(
        `[public-proposals] Proposal "${proposal.id}" (deal "${proposal.dealId ?? "nenhum"}") foi aceita, mas mover o negócio para Ganho falhou — requer reconciliação manual ou novo clique em "Aceitar".`,
        error instanceof Error ? error.message : error,
      );
    }
    return successEnvelope(await publicPayload(deps, proposal), request.id);
  });

  app.post("/public/proposals/:token/reject", { schema: { params: TOKEN_PARAMS_SCHEMA, body: { type: "object", additionalProperties: false, properties: { reason: { type: "string", enum: ["price", "deadline", "scope", "other"] }, comment: { type: "string", maxLength: 1000 } } } } }, async (request) => {
    const { token } = request.params as { token: string };
    try {
      const proposal = await rejectPublicProposal(deps, token, request.body as { reason?: string; comment?: string });
      return successEnvelope(await publicPayload(deps, proposal), request.id);
    } catch (error) {
      translatePublicProposalError(error);
    }
  });
}
