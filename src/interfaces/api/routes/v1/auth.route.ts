import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import {
  hashRefreshTokenValue,
  login,
  logout,
  refresh,
  signupPublic,
  switchTenant,
  type IdentityUseCaseDeps,
} from "../../../../application/identity/index.js";
import type { PlatformBillingRepositoryPort } from "../../../../application/ports/platform-billing-repository.port.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import type { ApiConfig } from "../../config/api-config.js";
import type { ApiContainer } from "../../di/container.js";
import { ForbiddenError, NotImplementedError, UnauthorizedError } from "../../http/app-error.js";
import { requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { translateIdentityError } from "./identity-error-translator.js";

/**
 * Rotas de autenticação — Sprint 05 (Fase 3/6). O access token NUNCA vai em cookie — o frontend
 * guarda em memória (ver Relatório da Sprint 05, "Nunca armazenar JWT em local inseguro"); só o
 * refresh token vai em cookie HttpOnly, restrito a `path=/v1/auth` (só as próprias rotas de auth
 * recebem esse cookie — nenhuma rota de negócio precisa dele nem consegue lê-lo).
 *
 * Proteção CSRF: `/v1/auth/refresh` e `/v1/auth/logout` dependem do cookie HttpOnly (uma
 * credencial ambiente que o navegador anexa sozinho), então exigem o padrão "double-submit
 * cookie" — um segundo cookie (`zuno_csrf_token`, legível por JS) precisa bater com o header
 * `X-CSRF-Token`. Um site malicioso consegue fazer o navegador da vítima enviar o cookie sozinho,
 * mas não consegue LER o valor do cookie (Same-Origin Policy) para reproduzir no header.
 */

const REFRESH_COOKIE_NAME = "zuno_refresh_token";
const CSRF_COOKIE_NAME = "zuno_csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";

type IdentityDeps = NonNullable<ApiContainer["identity"]>;

function requireIdentity(identity: IdentityDeps | undefined): IdentityDeps {
  if (!identity) {
    throw new NotImplementedError('Autenticação real não está configurada neste ambiente (AUTH_MODE≠"jwt").');
  }
  return identity;
}

function toUseCaseDeps(identity: IdentityDeps): IdentityUseCaseDeps {
  return {
    userRepository: identity.userRepository,
    membershipRepository: identity.membershipRepository,
    sessionRepository: identity.sessionRepository,
    refreshTokenRepository: identity.refreshTokenRepository,
    auditLog: identity.auditLog,
    passwordHasher: identity.passwordHasher,
    jwt: identity.jwt,
    accessTokenTtlSeconds: identity.accessTokenTtlSeconds,
    refreshTokenTtlSeconds: identity.refreshTokenTtlSeconds,
  };
}

function setAuthCookies(reply: FastifyReply, config: ApiConfig, tokens: { refreshToken: string; refreshTokenExpiresAt: string }): void {
  const maxAgeSeconds = Math.max(1, Math.floor((new Date(tokens.refreshTokenExpiresAt).getTime() - Date.now()) / 1000));

  reply.setCookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    // `path: "/"`, não `/v1/auth` — o frontend (`web/`, outra porta) roda um `proxy.ts` que só
    // precisa CONFIRMAR A PRESENÇA deste cookie (nunca ler o valor) para decidir redirecionar
    // para /login. Cookies não são restritos por porta (só domínio+path): um path estreito como
    // `/v1/auth` nunca bateria com nenhuma rota do frontend, e o proxy nunca veria o cookie.
    // HttpOnly já impede leitura por JavaScript — o path largo não abre nenhuma superfície nova.
    path: "/",
    // Sem `config.cookieDomain`: cookie host-only, só visível para o host exato que respondeu
    // (comportamento original). Quando API e frontend vivem em subdomínios irmãos (COOKIE_DOMAIN
    // configurado, ex.: `.exemplo.com`), precisa ir explícito — senão o `proxy.ts` do frontend
    // nunca vê o cookie e bota o usuário de volta em /login mesmo após login bem-sucedido.
    domain: config.cookieDomain,
    maxAge: maxAgeSeconds,
  });

  reply.setCookie(CSRF_COOKIE_NAME, randomBytes(24).toString("hex"), {
    httpOnly: false,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    domain: config.cookieDomain,
    maxAge: maxAgeSeconds,
  });
}

function clearAuthCookies(reply: FastifyReply, config: ApiConfig): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: "/", domain: config.cookieDomain });
  reply.clearCookie(CSRF_COOKIE_NAME, { path: "/", domain: config.cookieDomain });
}

// Limpa cookies em 403 para quebrar loops de refresh silencioso quando o cookie CSRF fica
// dessincronizado (ex.: duas cópias em `domain=vorixworks.com` e `domain=.vorixworks.com` de
// deploys/sessões anteriores). Sem isso, o navegador entra em ciclo /workspaces → refresh 403 →
// /login → middleware vê refresh cookie e volta para /workspaces.
function assertCsrf(request: FastifyRequest, reply: FastifyReply, config: ApiConfig): void {
  const cookieToken = request.cookies[CSRF_COOKIE_NAME];
  const headerToken = request.headers[CSRF_HEADER_NAME];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    clearAuthCookies(reply, config);
    throw new ForbiddenError("CSRF_TOKEN_MISMATCH: cabeçalho X-CSRF-Token ausente ou não confere com o cookie.");
  }
}

async function resolveSessionIdFromRefreshCookie(identity: IdentityDeps, refreshTokenCookie: string | undefined): Promise<string | undefined> {
  if (!refreshTokenCookie) return undefined;
  const token = await identity.refreshTokenRepository.getByHash(hashRefreshTokenValue(refreshTokenCookie));
  return token?.sessionId;
}

const LOGIN_BODY_SCHEMA = {
  type: "object",
  required: ["email", "password"],
  additionalProperties: false,
  properties: {
    email: { type: "string", minLength: 1 },
    password: { type: "string", minLength: 1 },
  },
} as const;

const SIGNUP_BODY_SCHEMA = {
  type: "object",
  required: ["email", "password", "name"],
  additionalProperties: false,
  properties: {
    email: { type: "string", format: "email", minLength: 3, maxLength: 254 },
    password: { type: "string", minLength: 8, maxLength: 200 },
    name: { type: "string", minLength: 1, maxLength: 120 },
    workspaceName: { type: "string", maxLength: 120 },
  },
} as const;

const SWITCH_TENANT_BODY_SCHEMA = {
  type: "object",
  required: ["tenantId"],
  additionalProperties: false,
  properties: {
    tenantId: { type: "string", minLength: 1 },
  },
} as const;

export async function registerAuthRoutes(app: FastifyInstance, deps: { identity?: IdentityDeps; config: ApiConfig; workspaceRepository?: WorkspaceRepositoryPort }): Promise<void> {
  app.post("/auth/login", { schema: { body: LOGIN_BODY_SCHEMA } }, async (request, reply) => {
    const identity = requireIdentity(deps.identity);
    const body = request.body as { email: string; password: string };

    const result = await login(toUseCaseDeps(identity), {
      email: body.email,
      password: body.password,
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip,
    }).catch(translateIdentityError);

    setAuthCookies(reply, deps.config, result);
    return successEnvelope(
      {
        accessToken: result.accessToken,
        expiresIn: identity.accessTokenTtlSeconds,
        user: result.user,
        tenantId: result.tenantId,
        role: result.role,
      },
      request.id,
    );
  });

  // Cadastro público (Fase 2). Cria User + Tenant + Workspace + tenant_billing FREE em uma
  // única chamada, e devolve o mesmo envelope de /auth/login já autenticado. Sem verificação de
  // email nesta fase — rate limiting HTTP + email opaco error protegem contra abuso básico.
  app.post("/auth/signup", { schema: { body: SIGNUP_BODY_SCHEMA } }, async (request, reply) => {
    const identity = requireIdentity(deps.identity);
    if (!deps.workspaceRepository) {
      throw new NotImplementedError("Signup público indisponível: workspaceRepository não configurado.");
    }
    const body = request.body as { email: string; password: string; name: string; workspaceName?: string };

    const result = await signupPublic(
      {
        ...toUseCaseDeps(identity),
        workspaceRepository: deps.workspaceRepository,
        platformBillingRepository: identity.platformBillingRepository,
        idGenerator: (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        now: () => new Date(),
      },
      {
        email: body.email,
        password: body.password,
        name: body.name,
        workspaceName: body.workspaceName,
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
      },
    ).catch(translateIdentityError);

    setAuthCookies(reply, deps.config, result);
    reply.code(201);
    return successEnvelope(
      {
        accessToken: result.accessToken,
        expiresIn: identity.accessTokenTtlSeconds,
        user: result.user,
        tenantId: result.tenantId,
        role: result.role,
      },
      request.id,
    );
  });

  app.post("/auth/logout", async (request, reply) => {
    const identity = requireIdentity(deps.identity);
    assertCsrf(request, reply, deps.config);

    const principal = request.zunoContext.principal;
    const refreshTokenCookie = request.cookies[REFRESH_COOKIE_NAME];
    const sessionId = principal?.sessionId ?? (await resolveSessionIdFromRefreshCookie(identity, refreshTokenCookie));
    if (sessionId) {
      await logout(toUseCaseDeps(identity), { sessionId });
    }

    clearAuthCookies(reply, deps.config);
    return successEnvelope({ loggedOut: true }, request.id);
  });

  app.post("/auth/refresh", async (request, reply) => {
    const identity = requireIdentity(deps.identity);
    assertCsrf(request, reply, deps.config);

    const refreshTokenCookie = request.cookies[REFRESH_COOKIE_NAME];
    if (!refreshTokenCookie) {
      clearAuthCookies(reply, deps.config);
      throw new UnauthorizedError("Refresh token ausente.", "MISSING_REFRESH_TOKEN");
    }

    let result;
    try {
      result = await refresh(toUseCaseDeps(identity), { refreshToken: refreshTokenCookie });
    } catch (error) {
      clearAuthCookies(reply, deps.config);
      throw translateIdentityError(error);
    }

    setAuthCookies(reply, deps.config, result);
    return successEnvelope(
      { accessToken: result.accessToken, expiresIn: identity.accessTokenTtlSeconds, tenantId: result.tenantId, role: result.role },
      request.id,
    );
  });

  app.post("/auth/switch-tenant", { schema: { body: SWITCH_TENANT_BODY_SCHEMA } }, async (request) => {
    const identity = requireIdentity(deps.identity);
    const principal = requirePrincipal(request);
    const body = request.body as { tenantId: string };

    const result = await switchTenant(toUseCaseDeps(identity), {
      userId: principal.userId,
      sessionId: principal.sessionId,
      targetTenantId: body.tenantId,
    }).catch(translateIdentityError);

    return successEnvelope({ ...result, expiresIn: identity.accessTokenTtlSeconds }, request.id);
  });

  app.get("/auth/memberships", async (request) => {
    const identity = requireIdentity(deps.identity);
    const principal = requirePrincipal(request);
    const memberships = await identity.membershipRepository.listByUser(principal.userId);
    return successEnvelope(memberships, request.id);
  });

  /** "Quem sou eu" — necessário para restaurar a UI (nome/email/tenant/papel) depois de um
   * refresh silencioso na carga da página, já que o access token some da memória a cada reload
   * de propósito (nunca persistido em local inseguro) e `/auth/refresh` não devolve dados de
   * usuário (só tenant/papel, que já bastam para as chamadas de negócio). */
  app.get("/auth/me", async (request) => {
    const identity = requireIdentity(deps.identity);
    const principal = requirePrincipal(request);
    const user = await identity.userRepository.getById(principal.userId);
    if (!user) throw new UnauthorizedError("Usuário não encontrado.", "UNAUTHORIZED");
    return successEnvelope(
      {
        user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.isPlatformAdmin === true },
        tenantId: principal.tenantId,
        role: principal.role,
      },
      request.id,
    );
  });
}
