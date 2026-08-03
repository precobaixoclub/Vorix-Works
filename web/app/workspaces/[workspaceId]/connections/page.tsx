"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { beginTikTokOAuth, disconnectTikTokAccount } from "@/features/tiktok/api";
import { useTikTokOAuthStatus } from "@/features/tiktok/hooks";
import { TIKTOK_RETURN_PATH_KEY } from "@/app/tiktok/callback/page";
import { beginMetaOAuth, disconnectMetaAccount } from "@/features/meta/api";
import { useMetaOAuthStatus } from "@/features/meta/hooks";
import { META_RETURN_PATH_KEY } from "@/app/instagram/callback/page";

/**
 * Um único lugar pra conectar/desconectar cada rede social — as telas de TikTok/Instagram/Facebook
 * só publicam, não gerenciam mais a conexão (ver `docs/instagram-publishing.md`/`docs/tiktok-publishing.md`).
 */
export default function ConnectionsPage() {
  const workspace = useCurrentWorkspace();
  const [feedback, setFeedback] = useState<string | undefined>();

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader title="Conexões" description="Conecte as contas das redes sociais deste workspace. Cada uma faz login com a própria conta." />

      {feedback ? <Card className="mb-6 p-4"><p className="text-sm text-ink">{feedback}</p></Card> : null}

      <div className="space-y-4">
        <TikTokConnection workspaceId={workspace.id} onFeedback={setFeedback} />
        <MetaConnection workspaceId={workspace.id} onFeedback={setFeedback} />
        <ComingSoonConnection name="Kwai" icon="🎬" />
      </div>
    </main>
  );
}

function TikTokConnection({ workspaceId, onFeedback }: { workspaceId: string; onFeedback: (message: string | undefined) => void }) {
  const { data: oauth, mutate } = useTikTokOAuthStatus(workspaceId);
  const [busy, setBusy] = useState(false);
  const accounts = oauth?.accounts.filter((account) => account.status !== "revoked") ?? [];

  async function connect() {
    setBusy(true);
    onFeedback(undefined);
    try {
      const result = await beginTikTokOAuth(workspaceId);
      window.sessionStorage.setItem(TIKTOK_RETURN_PATH_KEY, `/workspaces/${workspaceId}/connections`);
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
      await disconnectTikTokAccount(workspaceId, credentialReferenceId);
      await mutate();
      onFeedback("Conta do TikTok desconectada.");
    } catch (cause) {
      onFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConnectionCard
      icon="🎵"
      name="TikTok"
      configured={oauth?.configured !== false}
      busy={busy}
      accounts={accounts.map((account) => ({ id: account.credentialReferenceId, label: account.displayName ?? account.openId, status: account.status }))}
      onConnect={connect}
      onDisconnect={disconnect}
    />
  );
}

function MetaConnection({ workspaceId, onFeedback }: { workspaceId: string; onFeedback: (message: string | undefined) => void }) {
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
      onFeedback("Conta desconectada.");
    } catch (cause) {
      onFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConnectionCard
      icon="📷"
      name="Instagram + Facebook"
      description="Um único login do Meta conecta o Instagram profissional e a Página do Facebook vinculada a ele."
      configured={oauth?.configured !== false}
      busy={busy}
      accounts={accounts.map((account) => ({
        id: account.credentialReferenceId,
        label: `${account.providerId === "instagram" ? "Instagram" : "Página"} · ${account.displayName ?? account.providerSubjectId}`,
        status: account.status,
      }))}
      onConnect={connect}
      onDisconnect={disconnect}
    />
  );
}

type ConnectionCardProps = {
  icon: string;
  name: string;
  description?: string;
  configured: boolean;
  busy: boolean;
  accounts: readonly { id: string; label: string; status: string }[];
  onConnect: () => void;
  onDisconnect: (id: string) => void;
};

function ConnectionCard({ icon, name, description, configured, busy, accounts, onConnect, onDisconnect }: ConnectionCardProps) {
  const connected = accounts.some((account) => account.status === "active");
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">{icon} {name}</p>
          <p className="text-xs text-ink-muted">
            {!configured
              ? "Integração ainda não configurada no servidor."
              : description ?? (connected ? "Conectado." : "Nenhuma conta conectada.")}
          </p>
        </div>
        <Button disabled={busy || !configured} onClick={onConnect}>
          {connected ? "Conectar outra conta" : "Conectar"}
        </Button>
      </div>

      {accounts.length === 0 ? null : (
        <div className="space-y-2">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center justify-between gap-4 rounded border border-border px-3 py-2">
              <p className="text-sm text-ink">{account.label}</p>
              <div className="flex items-center gap-3">
                <StatusBadge status={account.status} />
                <Button variant="secondary" disabled={busy} onClick={() => onDisconnect(account.id)}>Desconectar</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ComingSoonConnection({ name, icon }: { name: string; icon: string }) {
  return (
    <Card className="flex items-center justify-between gap-4 p-5 opacity-60">
      <p className="text-sm font-medium text-ink">{icon} {name}</p>
      <span className="text-xs text-ink-muted">Em breve</span>
    </Card>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Não foi possível concluir a operação.";
}
