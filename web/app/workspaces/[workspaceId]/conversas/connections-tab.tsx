"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { GuardedButton } from "@/components/GuardedButton";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/contexts/auth-context";
import { createInboxConnection, disconnectInboxConnection, getInboxConnectionQrCode, refreshInboxConnectionStatus } from "@/features/inbox/api";
import { useInboxConnections } from "@/features/inbox/hooks";
import type { MessagingConnection } from "@/features/inbox/types";
import { canOperateWorkspace, RBAC_COPY } from "@/lib/rbac";

export function ConnectionsTab({ workspaceId }: { workspaceId: string }) {
  const { state } = useAuth();
  const canOperate = canOperateWorkspace(state.status === "authenticated" ? state.role : undefined);
  const { data, isLoading, error, mutate } = useInboxConnections(workspaceId);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [creating, setCreating] = useState(false);
  const [qrByConnectionId, setQrByConnectionId] = useState<Record<string, string>>({});
  const [pendingDisconnect, setPendingDisconnect] = useState<MessagingConnection | undefined>();
  const [busyConnectionId, setBusyConnectionId] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();

  async function handleCreateConnection() {
    if (!canOperate) return;
    const displayName = newDisplayName.trim();
    if (!displayName) return;
    setCreating(true);
    setActionError(undefined);
    try {
      await createInboxConnection(workspaceId, displayName);
      setNewDisplayName("");
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível criar o canal.");
    } finally {
      setCreating(false);
    }
  }

  async function handleShowQrCode(connectionId: string) {
    if (!canOperate) return;
    setBusyConnectionId(connectionId);
    setActionError(undefined);
    try {
      const { qrCode } = await getInboxConnectionQrCode(workspaceId, connectionId);
      setQrByConnectionId((prev) => ({ ...prev, [connectionId]: qrCode }));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível carregar o QR Code.");
    } finally {
      setBusyConnectionId(undefined);
    }
  }

  async function handleRefreshStatus(connectionId: string) {
    if (!canOperate) return;
    setBusyConnectionId(connectionId);
    setActionError(undefined);
    try {
      await refreshInboxConnectionStatus(workspaceId, connectionId);
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível atualizar o status.");
    } finally {
      setBusyConnectionId(undefined);
    }
  }

  async function handleDisconnect(connection: MessagingConnection) {
    if (!canOperate) return;
    setBusyConnectionId(connection.id);
    setActionError(undefined);
    try {
      await disconnectInboxConnection(workspaceId, connection.id);
      setPendingDisconnect(undefined);
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível desconectar o canal.");
    } finally {
      setBusyConnectionId(undefined);
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;
  }

  if (error) {
    return <ErrorState error={error} onRetry={() => mutate()} />;
  }

  const connections = data?.connections ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Novo canal de atendimento</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={newDisplayName}
            onChange={(event) => setNewDisplayName(event.target.value)}
            placeholder="Ex.: WhatsApp Comercial"
            className="sm:max-w-sm"
            disabled={!canOperate || creating}
          />
          <GuardedButton onClick={handleCreateConnection} disabled={creating || !newDisplayName.trim()} loading={creating} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
            Criar canal
          </GuardedButton>
        </CardContent>
      </Card>

      {actionError ? <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}

      {connections.length === 0 ? (
        <EmptyState
          title="Nenhum canal de WhatsApp"
          description="Crie um canal acima e escaneie o QR Code pelo WhatsApp do número que vai atender pelo Vorix."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              qrCode={qrByConnectionId[connection.id]}
              canOperate={canOperate}
              busy={busyConnectionId === connection.id}
              onShowQrCode={() => handleShowQrCode(connection.id)}
              onRefreshStatus={() => handleRefreshStatus(connection.id)}
              onDisconnect={() => setPendingDisconnect(connection)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDisconnect)}
        title="Desconectar canal?"
        description={`O canal "${pendingDisconnect?.displayName ?? "selecionado"}" para de receber e enviar mensagens ate ser pareado novamente.`}
        confirmLabel="Desconectar"
        variant="danger"
        busy={Boolean(busyConnectionId)}
        onCancel={() => setPendingDisconnect(undefined)}
        onConfirm={() => { if (pendingDisconnect) return handleDisconnect(pendingDisconnect); }}
      />
    </div>
  );
}

function ConnectionRow({
  connection,
  qrCode,
  canOperate,
  busy,
  onShowQrCode,
  onRefreshStatus,
  onDisconnect,
}: {
  connection: MessagingConnection;
  qrCode: string | undefined;
  canOperate: boolean;
  busy: boolean;
  onShowQrCode: () => void;
  onRefreshStatus: () => void;
  onDisconnect: () => void;
}) {
  const needsQrCode = connection.status === "connecting" || connection.status === "requires_repair";
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{connection.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{connection.phoneNumber ?? "Número ainda não pareado"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={connection.status} />
            <GuardedButton variant="secondary" onClick={onRefreshStatus} loading={busy} disabled={busy} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
              Atualizar status
            </GuardedButton>
            {needsQrCode ? (
              <GuardedButton variant="secondary" onClick={onShowQrCode} loading={busy} disabled={busy} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
                Mostrar QR Code
              </GuardedButton>
            ) : null}
            <GuardedButton variant="danger" onClick={onDisconnect} disabled={busy} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
              Desconectar
            </GuardedButton>
          </div>
        </div>
        {connection.status === "requires_repair" ? (
          <p className="text-sm text-danger">WhatsApp precisa ser conectado novamente. Escaneie um novo QR Code.</p>
        ) : null}
        {qrCode ? (
          <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            Codigo de pareamento: <span className="font-mono">{qrCode}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
