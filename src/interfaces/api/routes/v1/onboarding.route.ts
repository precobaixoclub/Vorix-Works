import type { FastifyInstance } from "fastify";
import {
  advanceOnboardingStep,
  completeOnboarding,
  connectChannelDuringOnboarding,
  getOnboarding,
  inviteTeamMemberDuringOnboarding,
  saveCompanyStep,
  startOnboarding,
  type OnboardingUseCaseDeps,
} from "../../../../application/onboarding/onboarding-use-cases.js";
import { ONBOARDING_GOALS, ONBOARDING_STEPS } from "../../../../domain/onboarding/onboarding.model.js";
import { TENANT_ROLES } from "../../../../domain/identity/identity.model.js";
import { ConflictError, NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

export type OnboardingRoutesDeps = OnboardingUseCaseDeps;

function translateOnboardingError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("ONBOARDING_WORKSPACE_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("USAGE_LIMIT_REACHED") || error.message.startsWith("ENTITLEMENT_ACCOUNT_READ_ONLY")) {
      throw new ConflictError(error.message);
    }
    if (error.message.startsWith("INBOX_DISPLAY_NAME_EMPTY") || error.message.startsWith("IDENTITY_VALIDATION_ERROR")) {
      throw new ValidationError(error.message);
    }
  }
  throw error;
}

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const WORKSPACE_BODY_SCHEMA = { type: "object", required: ["workspaceId"], additionalProperties: false, properties: { workspaceId: { type: "string", minLength: 1 } } } as const;

const COMPANY_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    segment: { type: "string", maxLength: 80 },
    size: { type: "string", maxLength: 40 },
    goal: { type: "string", enum: [...ONBOARDING_GOALS] },
  },
} as const;

const INVITE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "email", "role"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    email: { type: "string", format: "email", minLength: 3, maxLength: 254 },
    role: { type: "string", enum: [...TENANT_ROLES] },
  },
} as const;

const CONNECT_CHANNEL_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "displayName"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    displayName: { type: "string", minLength: 1, maxLength: 120 },
  },
} as const;

const ADVANCE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "step"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    step: { type: "string", enum: [...ONBOARDING_STEPS] },
    skipped: { type: "boolean" },
  },
} as const;

/**
 * `/v1/onboarding/*` — onboarding guiado (self-service). Toda ação real (convidar membro, criar
 * conexão) delega para o caso de uso já existente daquele módulo — nunca uma segunda
 * implementação. Por isso as permissões aqui SÃO AS MESMAS que já protegem aquela ação: convidar
 * durante o onboarding exige `tenant_member:manage` (mesma permissão de `POST /tenant-members/
 * invites`), conectar canal exige `inbox:manage_connections` (mesma de `POST /inbox/connections`)
 * — nunca um caminho mais frouxo pra a mesma operação só porque veio do wizard.
 */
export async function registerOnboardingRoutes(app: FastifyInstance, deps: OnboardingRoutesDeps): Promise<void> {
  app.get("/onboarding", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const progress = await getOnboarding(deps, { tenantId: principal.tenantId, workspaceId }).catch(translateOnboardingError);
    return successEnvelope(progress ?? null, request.id);
  });

  app.post("/onboarding/start", { schema: { body: WORKSPACE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "workspace:update");
    const { workspaceId } = request.body as { workspaceId: string };
    const progress = await startOnboarding(deps, { tenantId: principal.tenantId, workspaceId }).catch(translateOnboardingError);
    reply.code(201);
    return successEnvelope(progress, request.id);
  });

  app.patch("/onboarding/company", { schema: { body: COMPANY_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:update");
    const { workspaceId, segment, size, goal } = request.body as { workspaceId: string; segment?: string; size?: string; goal?: (typeof ONBOARDING_GOALS)[number] };
    const progress = await saveCompanyStep(deps, { tenantId: principal.tenantId, workspaceId, segment, size, goal }).catch(translateOnboardingError);
    return successEnvelope(progress, request.id);
  });

  app.post("/onboarding/invite-team-member", { schema: { body: INVITE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "tenant_member:manage");
    const { workspaceId, email, role } = request.body as { workspaceId: string; email: string; role: (typeof TENANT_ROLES)[number] };
    const result = await inviteTeamMemberDuringOnboarding(deps, {
      tenantId: principal.tenantId,
      workspaceId,
      email,
      role,
      invitedByUserId: principal.userId,
    }).catch(translateOnboardingError);
    reply.code(result.alreadyPending ? 200 : 201);
    return successEnvelope(result, request.id);
  });

  app.post("/onboarding/connect-channel", { schema: { body: CONNECT_CHANNEL_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "inbox:manage_connections");
    const { workspaceId, displayName } = request.body as { workspaceId: string; displayName: string };
    const result = await connectChannelDuringOnboarding(deps, { tenantId: principal.tenantId, workspaceId, displayName }).catch(translateOnboardingError);
    reply.code(result.reused ? 200 : 201);
    return successEnvelope(result, request.id);
  });

  app.post("/onboarding/advance", { schema: { body: ADVANCE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:update");
    const { workspaceId, step, skipped } = request.body as { workspaceId: string; step: (typeof ONBOARDING_STEPS)[number]; skipped?: boolean };
    const progress = await advanceOnboardingStep(deps, { tenantId: principal.tenantId, workspaceId, step, skipped }).catch(translateOnboardingError);
    return successEnvelope(progress, request.id);
  });

  app.post("/onboarding/complete", { schema: { body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:update");
    const { workspaceId } = request.body as { workspaceId: string };
    const progress = await completeOnboarding(deps, { tenantId: principal.tenantId, workspaceId }).catch(translateOnboardingError);
    return successEnvelope(progress, request.id);
  });
}
