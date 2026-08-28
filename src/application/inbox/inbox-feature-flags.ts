/**
 * Feature flags do módulo Conversas — mesmo padrão de `ExecutionFeatureFlags`
 * (`src/application/execution/feature-flags.ts`): struct tipado construído uma vez no container a
 * partir de env (ver `api-config.ts`), nunca lido diretamente de `process.env` fora do boot.
 *
 * `enabled=false` (padrão) impede o registro das rotas `/v1/inbox/*` inteiramente (kill switch
 * global) — o módulo não existe para nenhum tenant até ser habilitado explicitamente. Futuramente
 * pode se tornar habilitação por tenant/plano (ver `features` da Valentina), sem mudar esta forma.
 */
export type InboxFeatureFlags = {
  enabled: boolean;
};

export const DEFAULT_INBOX_FEATURE_FLAGS: InboxFeatureFlags = {
  enabled: false,
};
