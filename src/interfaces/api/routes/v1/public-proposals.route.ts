import type { FastifyInstance } from "fastify";
import {
  acceptPublicProposal,
  applyProposalAcceptanceToDeal,
  getPublicProposal,
  publicProposalContent,
  recordPublicProposalDownload,
  recordPublicProposalEngagement,
  rejectPublicProposal,
} from "../../../../application/crm/proposal-use-cases.js";
import type { ProposalDealLinkDeps, ProposalUseCaseDeps } from "../../../../application/crm/proposal-use-cases.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import type { SalesConfigRepositoryPort } from "../../../../application/ports/sales-engine-repository.port.js";
import { DEFAULT_CLOSE_REASONS } from "../../../../domain/sales/sales.model.js";
import { uniqueCloseReasonLabels } from "../../../../domain/sales/close-reasons.js";
import type { Proposal } from "../../../../domain/crm/crm.model.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { successEnvelope } from "../../http/response-envelope.js";

const TOKEN_PARAMS_SCHEMA = { type: "object", required: ["token"], properties: { token: { type: "string", minLength: 1, maxLength: 200 } } } as const;

function translatePublicProposalError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("PROPOSAL_NOT_FOUND")) throw new NotFoundError(error.message);
  if (error instanceof Error && (error.message.startsWith("PROPOSAL_EXPIRED") || error.message.startsWith("PROPOSAL_ALREADY_RESPONDED") || error.message.startsWith("PROPOSAL_LINK_REVOKED") || error.message.startsWith("PROPOSAL_SUPERSEDED"))) {
    throw new ValidationError(error.message);
  }
  throw error;
}

/**
 * Rota PÚBLICA (sem `requirePermission`/`requirePrincipal`) — o próprio token da URL é a
 * autenticação, mesmo racional do link de proposta que qualquer lead recebe por WhatsApp/e-mail.
 * O payload é uma lista FECHADA de campos (nunca a entidade inteira): custo, mínimo, hash do token,
 * dados de auditoria e ids internos jamais saem daqui.
 */
type PublicProposalRoutesDeps = ProposalUseCaseDeps & ProposalDealLinkDeps & { workspaceRepository: WorkspaceRepositoryPort; salesConfigRepository?: SalesConfigRepositoryPort };

async function publicPayload(deps: PublicProposalRoutesDeps, proposal: Proposal) {
  const [contact, workspace, reasons] = await Promise.all([
    proposal.contactId && deps.contactRepository ? deps.contactRepository.getById(proposal.contactId) : undefined,
    deps.workspaceRepository.getById(proposal.workspaceId),
    deps.salesConfigRepository ? deps.salesConfigRepository.listCloseReasons({ tenantId: proposal.tenantId, workspaceId: proposal.workspaceId, kind: "proposal_decline" }) : Promise.resolve([]),
  ]);
  return {
    ...publicProposalContent(proposal),
    status: proposal.status,
    sentAt: proposal.sentAt,
    respondedAt: proposal.respondedAt,
    rejectionReason: proposal.rejectionReason,
    superseded: proposal.status === "superseded",
    customerName: contact?.name,
    customerCompany: contact?.company,
    issuerName: workspace?.name,
    declineReasons: uniqueCloseReasonLabels(reasons.length > 0 ? reasons.map((reason) => reason.label) : DEFAULT_CLOSE_REASONS.proposal_decline),
  };
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
      // Aceite comercial (não é assinatura eletrônica): guarda hash do conteúdo aceito, versão,
      // hash do IP (nunca o IP puro) e user-agent truncado. Idempotente (duplo clique = 1 aceite).
      proposal = await acceptPublicProposal(deps, token, { ip: request.ip, userAgent: request.headers["user-agent"] });
    } catch (error) {
      translatePublicProposalError(error);
    }
    try {
      // Aceite já persistido; uma falha aqui (efeito sobre a oportunidade) nunca vira 500 para o
      // cliente que aceitou de verdade — fica logado para reconciliação (idempotente ao repetir).
      await applyProposalAcceptanceToDeal(deps, proposal);
    } catch (error) {
      console.error(
        `[public-proposals] Proposal "${proposal.id}" (deal "${proposal.dealId ?? "nenhum"}") foi aceita, mas o efeito na oportunidade falhou — requer reconciliação manual ou novo clique em "Aceitar".`,
        error instanceof Error ? error.message : error,
      );
    }
    return successEnvelope(await publicPayload(deps, proposal), request.id);
  });

  app.post("/public/proposals/:token/reject", { schema: { params: TOKEN_PARAMS_SCHEMA, body: { type: "object", additionalProperties: false, properties: { reason: { type: "string", maxLength: 120 }, comment: { type: "string", maxLength: 1000 } } } } }, async (request) => {
    const { token } = request.params as { token: string };
    try {
      const proposal = await rejectPublicProposal(deps, token, request.body as { reason?: string; comment?: string });
      return successEnvelope(await publicPayload(deps, proposal), request.id);
    } catch (error) {
      translatePublicProposalError(error);
    }
  });

  /** Heartbeat de leitura (≤60s por chamada) — tempo aproximado, nunca precisão inventada. */
  app.post("/public/proposals/:token/engagement", { schema: { params: TOKEN_PARAMS_SCHEMA, body: { type: "object", required: ["seconds"], additionalProperties: false, properties: { seconds: { type: "integer", minimum: 1, maximum: 60 } } } } }, async (request, reply) => {
    const { token } = request.params as { token: string };
    try {
      await recordPublicProposalEngagement(deps, token, (request.body as { seconds: number }).seconds);
    } catch (error) {
      translatePublicProposalError(error);
    }
    reply.code(204);
    return null;
  });

  app.post("/public/proposals/:token/download", { schema: { params: TOKEN_PARAMS_SCHEMA } }, async (request, reply) => {
    const { token } = request.params as { token: string };
    try {
      await recordPublicProposalDownload(deps, token);
    } catch (error) {
      translatePublicProposalError(error);
    }
    reply.code(204);
    return null;
  });
}
