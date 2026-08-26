/**
 * Contas de anúncio (Marketing API) descobertas por conexão — módulo Meta Ads Manager, Fase 1.
 * Ver `db/migrations/0069_meta_ads_credentials_accounts.sql` para o schema e o raciocínio de
 * isolamento em relação ao domínio de publicação de conteúdo.
 */

export type MetaAdAccount = {
  id: string;
  tenantId: string;
  workspaceId: string;
  credentialReferenceId: string;
  /** Sempre no formato `act_XXXX` — ver `toActAccountId` em `meta-graph-client.ts`. */
  accountId: string;
  name: string;
  currency: string;
  /** Código numérico cru da Meta (1 = ACTIVE) — nunca traduzido aqui, a UI decide o rótulo. */
  accountStatus?: number;
  businessName?: string;
  timezoneName?: string;
  spendCap?: number;
  balance?: number;
  disableReason?: string;
  isActive: boolean;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertMetaAdAccountInput = Omit<MetaAdAccount, "id" | "createdAt" | "updatedAt"> & { id?: string };

export type MetaAdAccountRepositoryPort = {
  /** Upsert por `(workspaceId, credentialReferenceId, accountId)` — resincronizar nunca duplica. */
  upsertAccount(input: UpsertMetaAdAccountInput): Promise<MetaAdAccount>;
  listByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<MetaAdAccount[]>;
  getById(id: string): Promise<MetaAdAccount | undefined>;
  /** Todas as contas ativas, de TODOS os tenants/workspaces — usado só pelo scheduler de sync
   * (Fase 2), que varre o sistema inteiro a cada ciclo, nunca por uma rota autenticada por
   * workspace (isso vazaria dados entre tenants). */
  listAllActive(): Promise<MetaAdAccount[]>;
  /** Marca como inativa qualquer conta deste `credentialReferenceId` cujo `accountId` NÃO esteja
   * em `keepAccountIds` — a Meta pode remover o acesso do usuário a uma conta entre duas
   * sincronizações; sem isto, uma conta desconectada continuaria aparecendo pra sempre. */
  deactivateMissing(input: { credentialReferenceId: string; keepAccountIds: readonly string[] }): Promise<void>;
};
