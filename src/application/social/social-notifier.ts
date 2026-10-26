import type { NotificationUseCaseDeps } from "../notification/notification-use-cases.js";
import { notifyBestEffort } from "../notification/notification-use-cases.js";
import type { SocialRepositoryPort } from "../ports/social-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../ports/tenant-membership-repository.port.js";
import { effectivePermissions, type Permission } from "../../domain/identity/identity.model.js";
import type { SocialNetwork } from "../../domain/social/social-publishing.model.js";
import { NETWORK_LABEL } from "../../domain/social/social-publishing.model.js";

export const SOCIAL_ALERT_KINDS = ["account_reauth", "account_problem", "publication_failed", "publication_partial", "publication_published", "publication_blocked", "publication_late", "music_unavailable", "provider_paused"] as const;
export type SocialAlertKind = (typeof SOCIAL_ALERT_KINDS)[number];

/** E-mail preparado como porta; o Vorix ainda não tem canal de e-mail configurado. */
export type SocialEmailNotifierPort = {
  send(input: { tenantId: string; userId: string; subject: string; body: string; ctaLabel?: string; ctaUrl?: string }): Promise<void>;
};

export type SocialAlert = {
  tenantId: string;
  workspaceId: string;
  kind: SocialAlertKind;
  network: SocialNetwork;
  /** Agrupa avisos repetidos (ex.: a mesma conta pedindo reconexão). */
  subjectId: string;
  title: string;
  body: string;
  sourceUrl: string;
  /** Só para quem criou (ex.: publicado com sucesso) em vez de todos os responsáveis. */
  onlyUserId?: string;
};

/** Janela de silêncio por tipo: não bombardear o usuário com o mesmo aviso. */
const DEDUPE_WINDOW_MS: Record<SocialAlertKind, number> = {
  account_reauth: 12 * 3_600_000,
  account_problem: 6 * 3_600_000,
  publication_failed: 0,
  publication_partial: 0,
  publication_published: 0,
  publication_blocked: 12 * 3_600_000,
  publication_late: 6 * 3_600_000,
  music_unavailable: 0,
  provider_paused: 12 * 3_600_000,
};

/** Quem recebe problemas de integração: quem gerencia contas sociais (Administrador/Gerente por padrão). */
const RESPONSIBLE_PERMISSION: Permission = "marketing:social_manage_accounts";

export class SocialNotifier {
  constructor(private readonly deps: {
    repository: Pick<SocialRepositoryPort, "claimNotification">;
    memberships?: Pick<TenantMembershipRepositoryPort, "listByTenant">;
    notification?: Partial<NotificationUseCaseDeps>;
    email?: SocialEmailNotifierPort;
    now?: () => Date;
  }) {}

  async notify(alert: SocialAlert): Promise<{ sent: number; deduplicated: boolean }> {
    const window = DEDUPE_WINDOW_MS[alert.kind];
    const now = (this.deps.now ?? (() => new Date()))();
    if (window > 0) {
      const claimed = await this.deps.repository.claimNotification({ tenantId: alert.tenantId, dedupeKey: `${alert.kind}:${alert.subjectId}`, now: now.toISOString(), windowMs: window }).catch(() => false);
      if (!claimed) return { sent: 0, deduplicated: true };
    }
    const recipients = alert.onlyUserId ? [alert.onlyUserId] : await this.responsibles(alert.tenantId);
    for (const userId of recipients) {
      notifyBestEffort(this.deps.notification, { tenantId: alert.tenantId, workspaceId: alert.workspaceId, userId, title: alert.title, body: alert.body, sourceType: `social_${alert.kind}`, sourceId: alert.subjectId, sourceUrl: alert.sourceUrl });
      if (this.deps.email && (alert.kind === "account_reauth" || alert.kind === "provider_paused")) {
        void this.deps.email.send({ tenantId: alert.tenantId, userId, subject: alert.title, body: alert.body, ctaLabel: alert.kind === "account_reauth" ? "Reconectar conta" : undefined, ctaUrl: alert.sourceUrl }).catch(() => undefined);
      }
    }
    return { sent: recipients.length, deduplicated: false };
  }

  private async responsibles(tenantId: string): Promise<string[]> {
    if (!this.deps.memberships) return [];
    const members = await this.deps.memberships.listByTenant(tenantId).catch(() => []);
    return members
      .filter((member) => member.status === "active" && effectivePermissions(member.role, member.permissionGrants, member.permissionRevokes).includes(RESPONSIBLE_PERMISSION))
      .map((member) => member.userId);
  }
}

/** Telas do Marketing para onde as notificações levam. */
export const SOCIAL_PATHS = {
  integrations: (workspaceId: string) => `/workspaces/${workspaceId}/social/integrations`,
  calendar: (workspaceId: string) => `/workspaces/${workspaceId}/social/calendar`,
  post: (workspaceId: string, postId: string) => `/workspaces/${workspaceId}/social/calendar?post=${encodeURIComponent(postId)}`,
};

export function reauthAlert(input: { tenantId: string; workspaceId: string; accountId: string; network: SocialNetwork; pendingCount: number; checkpoint: boolean }): SocialAlert {
  const label = NETWORK_LABEL[input.network];
  const pending = input.pendingCount === 0 ? "" : input.pendingCount === 1 ? " Existe 1 publicação aguardando." : ` Existem ${input.pendingCount} publicações aguardando.`;
  return {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    kind: "account_reauth",
    network: input.network,
    subjectId: input.accountId,
    title: `Sua conta do ${label} precisa ser reconectada`,
    body: `${input.checkpoint ? `O ${label} pediu uma confirmação de segurança. Confirme o acesso no app e reconecte.` : `Sua conta do ${label} precisa ser reconectada.`}${pending}`,
    sourceUrl: SOCIAL_PATHS.integrations(input.workspaceId),
  };
}
