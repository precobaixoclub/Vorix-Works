"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { META_RETURN_PATH_KEY } from "@/app/instagram/callback/page";
import { TIKTOK_RETURN_PATH_KEY } from "@/app/tiktok/callback/page";
import { YOUTUBE_RETURN_PATH_KEY } from "@/app/youtube/callback/page";
import { beginMetaOAuth, disconnectMetaAccount } from "@/features/meta/api";
import { useMetaOAuthStatus } from "@/features/meta/hooks";
import { beginTikTokOAuth, disconnectTikTokAccount } from "@/features/tiktok/api";
import { useTikTokOAuthStatus } from "@/features/tiktok/hooks";
import { beginYouTubeOAuth, disconnectYouTubeAccount } from "@/features/youtube/api";
import { useYouTubeOAuthStatus } from "@/features/youtube/hooks";

type HumanConnectionStatus = "connected" | "needs_attention" | "disconnected" | "syncing";
type AccountRow = { id: string; label: string; detail?: string; status: string };

export default function ConnectionsPage() {
  const workspace = useCurrentWorkspace();
  const [feedback, setFeedback] = useState<string | undefined>();

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Integrações</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Conexões</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">Conecte as redes que o Vorix pode utilizar para publicar seus conteúdos.</p>
      </div>

      {feedback ? <Card className="mb-6 border-accent/30 bg-accent-soft/30 p-4"><p className="text-sm text-ink">{feedback}</p></Card> : null}

      <div className="grid gap-4">
        <MetaConnection workspaceId={workspace.id} onFeedback={setFeedback} />
        <TikTokConnection workspaceId={workspace.id} onFeedback={setFeedback} />
        <YouTubeConnection workspaceId={workspace.id} onFeedback={setFeedback} />
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
      icon="♪"
      name="TikTok"
      description="Conta autorizada para publicar vídeos e fotos no TikTok."
      configured={oauth?.configured !== false}
      busy={busy}
      accounts={accounts.map((account) => ({ id: account.credentialReferenceId, label: account.displayName ?? account.openId, detail: account.openId, status: account.status }))}
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
      onFeedback("Conta Meta desconectada.");
    } catch (cause) {
      onFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConnectionCard
      icon="◎"
      name="Meta"
      description="Um login conecta Instagram profissional e Página do Facebook quando ambos estão disponíveis."
      configured={oauth?.configured !== false}
      busy={busy}
      accounts={accounts.map((account) => ({
        id: account.credentialReferenceId,
        label: account.displayName ?? account.providerSubjectId,
        detail: account.providerId === "instagram" ? "Instagram profissional" : "Página do Facebook",
        status: account.status,
      }))}
      onConnect={connect}
      onDisconnect={disconnect}
    />
  );
}

function YouTubeConnection({ workspaceId, onFeedback }: { workspaceId: string; onFeedback: (message: string | undefined) => void }) {
  const { data: oauth, mutate } = useYouTubeOAuthStatus(workspaceId);
  const [busy, setBusy] = useState(false);
  const accounts = oauth?.accounts.filter((account) => account.status !== "revoked") ?? [];

  async function connect() {
    setBusy(true);
    onFeedback(undefined);
    try {
      const result = await beginYouTubeOAuth(workspaceId);
      window.sessionStorage.setItem(YOUTUBE_RETURN_PATH_KEY, `/workspaces/${workspaceId}/connections`);
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
      await disconnectYouTubeAccount(workspaceId, credentialReferenceId);
      await mutate();
      onFeedback("Canal do YouTube desconectado.");
    } catch (cause) {
      onFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConnectionCard
      icon="▶"
      name="YouTube Shorts"
      description="Canal autorizado para publicar Shorts em video."
      configured={oauth?.configured !== false}
      busy={busy}
      accounts={accounts.map((account) => ({ id: account.credentialReferenceId, label: account.displayName ?? account.channelId, detail: account.channelId, status: account.status }))}
      onConnect={connect}
      onDisconnect={disconnect}
    />
  );
}

function ConnectionCard({ icon, name, description, configured, busy, accounts, onConnect, onDisconnect }: { icon: string; name: string; description: string; configured: boolean; busy: boolean; accounts: readonly AccountRow[]; onConnect: () => void; onDisconnect: (id: string) => void }) {
  const activeAccounts = accounts.filter((account) => account.status === "active");
  const inactiveAccounts = accounts.filter((account) => account.status !== "active");
  const connected = activeAccounts.length > 0;
  const humanStatus: HumanConnectionStatus = busy ? "syncing" : connected ? "connected" : inactiveAccounts.length > 0 ? "needs_attention" : "disconnected";
  const statusText = !configured
    ? "Integração ainda não configurada no servidor."
    : humanStatus === "connected"
      ? `${activeAccounts.length} conta${activeAccounts.length === 1 ? "" : "s"} conectada${activeAccounts.length === 1 ? "" : "s"}`
      : humanStatus === "needs_attention"
        ? "Reconecte para voltar a publicar."
        : "Nenhuma conta conectada.";

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-xl font-semibold text-accent">{icon}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-ink">{name}</h2>
              <StatusBadge status={humanStatus} />
            </div>
            <p className="mt-1 text-sm text-ink-muted">{description}</p>
            <p className="mt-2 text-xs text-ink-muted">{statusText}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button disabled={busy || !configured} onClick={onConnect}>{connected ? "Conectar outra" : humanStatus === "needs_attention" ? "Reconectar" : "Conectar"}</Button>
        </div>
      </div>

      {accounts.length > 0 ? (
        <div className="border-t border-border bg-surface/70 p-3 sm:p-4">
          <div className="grid gap-2">
            {accounts.map((account) => (
              <div key={account.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{account.label}</p>
                  {account.detail ? <p className="mt-0.5 truncate text-xs text-ink-muted">{account.detail}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={account.status === "active" ? "connected" : "needs_attention"} />
                  <Button variant="secondary" disabled={busy} onClick={() => onDisconnect(account.id)}>Desconectar</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Não foi possível concluir a operação.";
}
