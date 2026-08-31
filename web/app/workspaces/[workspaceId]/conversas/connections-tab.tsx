"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { createInboxConnection, disconnectInboxConnection, getInboxConnectionQrCode, refreshInboxConnectionStatus } from "@/features/inbox/api";
import { useInboxConnections } from "@/features/inbox/hooks";
import type { MessagingConnection } from "@/features/inbox/types";

/** Módulo Conversas — Fase 1 (Fundação). Gestão de conexão (cadastrar, parear via QR, status,
 * desconectar). A Inbox de verdade fica em `inbox-tab.tsx`, construída sobre esta base. */
export function ConnectionsTab({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, error, mutate } = useInboxConnections(workspaceId);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [creating, setCreating] = useState(false);
  const [qrByConnectionId, setQrByConnectionId] = useState<Record<string, string>>({});

  async function handleCreateConnection() {
    const displayName = newDisplayName.trim();
    if (!displayName) return;
    setCreating(true);
    try {
      await createInboxConnection(workspaceId, displayName);
      setNewDisplayName("");
      await mutate();
    } finally {
      setCreating(false);
    }
  }

  async function handleShowQrCode(connectionId: string) {
    const { qrCode } = await getInboxConnectionQrCode(workspaceId, connectionId);
    setQrByConnectionId((prev) => ({ ...prev, [connectionId]: qrCode }));
  }

  async function handleRefreshStatus(connectionId: string) {
    await refreshInboxConnectionStatus(workspaceId, connectionId);
    await mutate();
  }

  async function handleDisconnect(connectionId: string) {
    await disconnectInboxConnection(workspaceId, connectionId);
    await mutate();
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
        <CardHeader><CardTitle className="text-base">Nova conexão</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={newDisplayName}
            onChange={(event) => setNewDisplayName(event.target.value)}
            placeholder="Ex.: WhatsApp Comercial"
            className="sm:max-w-sm"
          />
          <Button onClick={handleCreateConnection} disabled={creating || !newDisplayName.trim()}>
            {creating ? "Criando..." : "Criar conexão"}
          </Button>
        </CardContent>
      </Card>

      {connections.length === 0 ? (
        <EmptyState
          title="Nenhuma conexão de WhatsApp"
          description="Crie uma conexão acima e escaneie o QR Code pelo WhatsApp do número que vai atender pelo Vorix."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              qrCode={qrByConnectionId[connection.id]}
              onShowQrCode={() => handleShowQrCode(connection.id)}
              onRefreshStatus={() => handleRefreshStatus(connection.id)}
              onDisconnect={() => handleDisconnect(connection.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectionRow({
  connection,
  qrCode,
  onShowQrCode,
  onRefreshStatus,
  onDisconnect,
}: {
  connection: MessagingConnection;
  qrCode: string | undefined;
  onShowQrCode: () => void;
  onRefreshStatus: () => void;
  onDisconnect: () => void;
}) {
  const needsQrCode = connection.status === "connecting" || connection.status === "requires_repair";
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">{connection.displayName}</p>
            <p className="text-xs text-muted-foreground">{connection.phoneNumber ?? "Número ainda não pareado"}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={connection.status} />
            <Button variant="secondary" onClick={onRefreshStatus}>Atualizar status</Button>
            {needsQrCode ? <Button variant="secondary" onClick={onShowQrCode}>Mostrar QR Code</Button> : null}
            <Button variant="danger" onClick={onDisconnect}>Desconectar</Button>
          </div>
        </div>
        {connection.status === "requires_repair" ? (
          <p className="text-sm text-red-600">WhatsApp precisa ser conectado novamente — escaneie um novo QR Code.</p>
        ) : null}
        {qrCode ? (
          <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            Código de pareamento: <span className="font-mono">{qrCode}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
