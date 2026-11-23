"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AtSign, type LucideIcon } from "lucide-react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { META_RETURN_PATH_KEY } from "@/app/instagram/callback/page";
import { beginMetaOAuth, disconnectMetaAccount } from "@/features/meta/api";
import { useMetaOAuthStatus } from "@/features/meta/hooks";
import { useSolutions } from "@/features/solutions/hooks";

type HumanConnectionStatus = "connected" | "needs_attention" | "disconnected" | "syncing";
type AccountRow = { id: string; label: string; detail?: string; status: string };

export default function ConnectionsPage() {
  const workspace = useCurrentWorkspace();
  const [feedback, setFeedback] = useState<string | undefined>();
  const router = useRouter();
  const { available, isLoading } = useSolutions();
  // Esta tela é o Instagram Direct do Conversas. Fase 10: só encaminha para Redes sociais quando a
  // conta NÃO tem Conversas (antes dependia da ferramenta "ativa" da sessão).
  const toSocial = !isLoading && !available.includes("conversations") && available.includes("marketing");
  useEffect(() => {
    if (toSocial) router.replace(`/workspaces/${workspace.id}/social/integrations`);
  }, [toSocial, router, workspace.id]);
  if (toSocial) return null;

  return (
    <SettingsShell active="integrations" title="Instagram Direct" description="Conta do Instagram usada no atendimento. O WhatsApp é conectado em Conversas › Canais.">
      {feedback ? <Card className="mb-6 border-primary/30 bg-primary/5 p-4"><p className="text-sm text-foreground">{feedback}</p></Card> : null}
      <div className="grid gap-4">
        <MetaConnection workspaceId={workspace.id} onFeedback={setFeedback} hasMarketing={false} />
      </div>
    </SettingsShell>
  );
}

function MetaConnection({ workspaceId, onFeedback, hasMarketing }: { workspaceId: string; onFeedback: (message: string | undefined) => void; hasMarketing: boolean }) {
  const { data: oauth, mutate } = useMetaOAuthStatus(workspaceId);
  const [busy, setBusy] = useState(false);
  const accounts = oauth?.accounts.filter((account) => account.status !== "revoked") ?? [];

  async function connect() {
    setBusy(true);
    onFeedback(undefined);
    try {
      const result = await beginMetaOAuth(workspaceId);
      window.sessionStorage.setItem(META_RETURN_PATH_KEY, `/workspaces/${workspaceId}/connections`);
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      onFeedback(messageOf(cause));
      setBusy(false);
    }
  }

  async function disconnect(credentialReferenceId: string) {
    setBusy(true);
    onFeedback(undefined);
    try {
      await disconnectMetaAccount(workspaceId, credentialReferenceId);
      await mutate();
      onFeedback("Conta Meta desconectada.");
    } catch (cause) {
      onFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConnectionCard
      icon={AtSign}
      name="Meta"
      description={hasMarketing ? "Um login conecta Instagram profissional e Página do Facebook quando ambos estão disponíveis." : "Um login conecta o Instagram profissional da empresa para atender o Direct em Conversas."}
      configured={oauth?.configured !== false}
      busy={busy}
      accounts={accounts.map((account) => ({
        id: account.credentialReferenceId,
        label: account.displayName ?? (account.providerId === "instagram" ? "Instagram profissional" : "Página do Facebook"),
        detail: account.providerId === "instagram" ? "Instagram profissional" : "Página do Facebook",
        status: account.status,
      }))}
      onConnect={connect}
      onDisconnect={disconnect}
    />
  );
}

function ConnectionCard({ icon: Icon, name, description, configured, busy, accounts, onConnect, onDisconnect }: { icon: LucideIcon; name: string; description: string; configured: boolean; busy: boolean; accounts: readonly AccountRow[]; onConnect: () => void; onDisconnect: (id: string) => void | Promise<void> }) {
  const [confirmTarget, setConfirmTarget] = useState<AccountRow | null>(null);
  const activeAccounts = accounts.filter((account) => account.status === "active");
  const inactiveAccounts = accounts.filter((account) => account.status !== "active");
  const connected = activeAccounts.length > 0;
  const humanStatus: HumanConnectionStatus = busy ? "syncing" : connected ? "connected" : inactiveAccounts.length > 0 ? "needs_attention" : "disconnected";
  const statusText = !configured
    ? "Integração ainda não configurada no servidor."
    : humanStatus === "connected"
      ? `${activeAccounts.length} conta${activeAccounts.length === 1 ? "" : "s"} conectada${activeAccounts.length === 1 ? "" : "s"}`
      : humanStatus === "needs_attention"
        ? "Reconecte para voltar a usar esta conta."
        : "Nenhuma conta conectada.";

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">{name}</h2>
              <StatusBadge status={humanStatus} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            <p className="mt-2 text-xs text-muted-foreground">{statusText}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button disabled={busy || !configured} onClick={onConnect}>{connected ? "Conectar outra" : humanStatus === "needs_attention" ? "Reconectar" : "Conectar"}</Button>
        </div>
      </div>

      {accounts.length > 0 ? (
        <div className="border-t border-border bg-card/70 p-3 sm:p-4">
          <div className="grid gap-2">
            {accounts.map((account) => (
              <div key={account.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{account.label}</p>
                  {account.detail ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{account.detail}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={account.status === "active" ? "connected" : "needs_attention"} />
                  <Button variant="secondary" disabled={busy} onClick={() => setConfirmTarget(account)}>Desconectar</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmTarget !== null}
        title={`Desconectar de ${name}?`}
        description={`Isso desconecta "${confirmTarget?.label ?? ""}" de ${name}. Você vai precisar reconectar essa conta para voltar a usá-la.`}
        confirmLabel="Desconectar"
        variant="danger"
        busy={busy}
        onConfirm={async () => {
          if (confirmTarget) await onDisconnect(confirmTarget.id);
          setConfirmTarget(null);
        }}
        onCancel={() => setConfirmTarget(null)}
      />
    </Card>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Não foi possível concluir a operação.";
}
