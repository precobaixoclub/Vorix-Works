/**
 * Porta de autenticação — Sprint 02 (Fase 2), preparada para crescer, nunca aplicada de verdade
 * ainda. Não existe login, não existe usuário, não existe sessão nesta sprint (explicitamente
 * fora de escopo). Esta porta só define o formato que a Sprint 04 (identidade/autenticação real)
 * vai preencher, para que o middleware HTTP já tenha um lugar certo para plugar isso sem precisar
 * ser reescrito depois.
 *
 * O único adapter real hoje é `NoopAuthAdapter` (`src/infrastructure/auth/`), que nunca rejeita
 * uma requisição — sempre devolve `principal: null` (visitante anônimo). Nenhuma rota depende de
 * autenticação nesta sprint; a porta existe para o middleware ter uma dependência real a chamar,
 * não uma decisão hardcoded.
 */

/** O que a autenticação real (Sprint 04) vai identificar por trás de uma requisição. Vazio de propósito além do essencial — cresce quando usuários existirem de verdade. */
export type AuthPrincipal = {
  /** Referência ao futuro usuário autenticado — nunca preenchido nesta sprint. */
  userId: string;
  /** Referência ao Workspace/Tenant ativo na sessão — nunca preenchido nesta sprint. */
  tenantId?: string;
};

export type AuthVerificationResult =
  | { authenticated: true; principal: AuthPrincipal }
  | { authenticated: false; reason: "missing_token" | "invalid_token" | "expired_token" | "not_implemented" };

export type AuthPort = {
  /**
   * Verifica um token de autenticação (ex.: um Bearer token JWT) e devolve o principal por trás
   * dele, ou o motivo da falha. `NoopAuthAdapter` sempre devolve `{ authenticated: false, reason:
   * "not_implemented" }` — o chamador (middleware) precisa saber tratar isso como "sem
   * autenticação ainda", nunca como "acesso negado".
   */
  verifyToken(token: string | undefined): Promise<AuthVerificationResult>;
};
