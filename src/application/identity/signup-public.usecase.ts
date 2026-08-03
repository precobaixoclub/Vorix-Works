import type { PlatformBillingRepositoryPort } from "../ports/platform-billing-repository.port.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";
import type { IdentityUseCaseDeps } from "./identity-use-case-deps.js";
import { login, type LoginUseCaseOutput } from "./login.usecase.js";
import { registerUser } from "./register-user.usecase.js";

export type SignupPublicUseCaseInput = {
  email: string;
  password: string;
  name: string;
  workspaceName?: string;
  userAgent?: string;
  ipAddress?: string;
};

export type SignupPublicDeps = IdentityUseCaseDeps & {
  workspaceRepository: WorkspaceRepositoryPort;
  platformBillingRepository: PlatformBillingRepositoryPort;
  idGenerator: (prefix: string) => string;
  now: () => Date;
};

/**
 * Cadastro público auto-serviço — Fase 2 do rollout B2C. Cria em uma única chamada:
 *   - `User` com senha (hash bcrypt via `passwordHasher`).
 *   - Tenant novo (não há tabela `tenants` — o tenant existe implicitamente via
 *     `workspaces.tenant_id`, `tenant_members.tenant_id`, `tenant_billing.tenant_id`).
 *   - `TenantMembership` do usuário no tenant recém-criado, papel `admin` (dono).
 *   - Workspace default para o tenant.
 *   - `tenant_billing` no plano FREE (100k tokens/mês, `subscription_status='trial'`).
 * Depois faz login imediato e devolve tokens iguais ao fluxo /auth/login.
 *
 * Deliberadamente NÃO faz verificação de email/anti-abuso agressiva nesta fase — a mesma
 * mensagem opaca "email inválido" é retornada em qualquer erro de validação, e o rate limiting
 * do gateway HTTP protege contra flood. Verificação por email fica para Fase 3 se necessário.
 */
export async function signupPublic(
  deps: SignupPublicDeps,
  input: SignupPublicUseCaseInput,
): Promise<LoginUseCaseOutput> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const workspaceName = (input.workspaceName ?? `Workspace de ${name}`).trim();

  const existing = await deps.userRepository.getByEmail(email);
  if (existing) {
    throw new Error("SIGNUP_EMAIL_ALREADY_REGISTERED: já existe uma conta com este email.");
  }

  const tenantId = deps.idGenerator("tenant");

  await registerUser(deps, {
    email,
    password: input.password,
    name,
    tenantId,
    role: "admin",
  });

  await deps.workspaceRepository.create({
    tenantId,
    name: workspaceName || `Workspace de ${name}`,
    kind: "default",
  });

  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId, now: nowIso });

  return login(deps, {
    email,
    password: input.password,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
  });
}
