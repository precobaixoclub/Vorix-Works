import type { SocialAccountView, SocialNetwork } from "./types";

type AuthorizedAccount = { status: string; connectedAt?: string };

const INACTIVE_STATUSES = new Set(["DISCONNECTED", "DISABLED"]);

/**
 * IDs externos das contas escolhidas para esta workspace numa rede (as que aparecem em
 * Integrações). `undefined` enquanto a lista ainda não carregou.
 */
export function workspaceAccountIds(accounts: readonly SocialAccountView[] | undefined, network: SocialNetwork): ReadonlySet<string> | undefined {
  if (!accounts) return undefined;
  return new Set(accounts.filter((account) => account.network === network && !INACTIVE_STATUSES.has(account.status) && account.externalAccountId).map((account) => account.externalAccountId!));
}

/**
 * Entre as autorizações ativas, escolhe a da conta definida para a workspace. Uma mesma
 * autorização da Meta/Google libera várias Páginas, contas e canais; sem esse filtro a
 * publicação iria para a primeira da lista (às vezes a conta de outra marca).
 * Sem conta definida na workspace, mantém o comportamento antigo: a autorização mais recente.
 */
export function pickWorkspaceAccount<T extends AuthorizedAccount>(candidates: readonly T[] | undefined, chosenIds: ReadonlySet<string> | undefined, subjectOf: (account: T) => string | undefined): T | undefined {
  if (!candidates || !chosenIds) return undefined;
  const active = candidates.filter((account) => account.status === "active");
  const eligible = chosenIds.size > 0 ? active.filter((account) => chosenIds.has(subjectOf(account) ?? "")) : active;
  return eligible.reduce<T | undefined>((latest, account) => (!latest || (account.connectedAt ?? "") > (latest.connectedAt ?? "") ? account : latest), undefined);
}
