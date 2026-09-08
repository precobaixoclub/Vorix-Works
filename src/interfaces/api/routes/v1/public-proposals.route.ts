import type { FastifyInstance } from "fastify";
import {
  acceptPublicProposal,
  applyProposalAcceptanceToDeal,
  getPublicProposal,
  rejectPublicProposal,
} from "../../../../application/crm/proposal-use-cases.js";
import type { ProposalDealLinkDeps, ProposalUseCaseDeps } from "../../../../application/crm/proposal-use-cases.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { successEnvelope } from "../../http/response-envelope.js";

const TOKEN_PARAMS_SCHEMA = { type: "object", required: ["token"], properties: { token: { type: "string", minLength: 1 } } } as const;

function translatePublicProposalError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("PROPOSAL_NOT_FOUND")) throw new NotFoundError(error.message);
  if (error instanceof Error && (error.message.startsWith("PROPOSAL_EXPIRED") || error.message.startsWith("PROPOSAL_ALREADY_RESPONDED"))) {
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
export async function registerPublicProposalsRoutes(app: FastifyInstance, deps: ProposalUseCaseDeps & ProposalDealLinkDeps): Promise<void> {
  app.get("/public/proposals/:token", { schema: { params: TOKEN_PARAMS_SCHEMA } }, async (request) => {
    const { token } = request.params as { token: string };
    try {
      const proposal = await getPublicProposal(deps, token);
      return successEnvelope(proposal, request.id);
    } catch (error) {
      translatePublicProposalError(error);
    }
  });

  app.post("/public/proposals/:token/accept", { schema: { params: TOKEN_PARAMS_SCHEMA } }, async (request) => {
    const { token } = request.params as { token: string };
    try {
      const proposal = await acceptPublicProposal(deps, token);
      await applyProposalAcceptanceToDeal(deps, proposal);
      return successEnvelope(proposal, request.id);
    } catch (error) {
      translatePublicProposalError(error);
    }
  });

  app.post("/public/proposals/:token/reject", { schema: { params: TOKEN_PARAMS_SCHEMA } }, async (request) => {
    const { token } = request.params as { token: string };
    try {
      const proposal = await rejectPublicProposal(deps, token);
      return successEnvelope(proposal, request.id);
    } catch (error) {
      translatePublicProposalError(error);
    }
  });
}
