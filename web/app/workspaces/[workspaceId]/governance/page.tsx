"use client";

import { useState } from "react";
import { mutate } from "swr";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { beginCredentialConnection, checkCredentialHealth, disableCredential, enableCredential, exportAuditEvents, exportCredentialHistory, revokeCredential, rotateCredential } from "@/features/governance/api";
import { useAuditEvents, useComplianceReport, useCredentials } from "@/features/governance/hooks";
import type { Credential } from "@/features/governance/types";
import { formatDateTime } from "@/lib/format";

export default function GovernancePage() {
  const workspace = useCurrentWorkspace();
  const [busy, setBusy] = useState<string | undefined>();
  const [exportPreview, setExportPreview] = useState<string>("");
  const { data: credentials, isLoading, error, mutate: mutateCredentials } = useCredentials(workspace.id);
  const { data: auditEvents } = useAuditEvents(workspace.id);
  const { data: compliance } = useComplianceReport(workspace.id);
  const active = credentials?.filter((credential) => credential.status === "connected" || credential.status === "expiring").length ?? 0;
  const attention = credentials?.filter((credential) => ["expired", "invalid", "revoked", "disabled"].includes(credential.status)).length ?? 0;

  async function runAction(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setExportPreview("");
    try {
      await action();
      await Promise.all([
        mutate(["credentials", workspace.id]),
        mutate(["audit-events", workspace.id]),
        mutate(["compliance", workspace.id]),
      ]);
    } finally {
      setBusy(undefined);
    }
  }

  async function connectProvider() {
    await runAction("connect", async () => {
      const result = await beginCredentialConnection(workspace.id);
      window.location.assign(result.authorizationUrl);
    });
  }

  async function showExport(label: string, action: () => Promise<{ contentType: string; body: string }>) {
    await runAction(label, async () => {
      const result = await action();
      setExportPreview(`${result.contentType}\n${result.body.slice(0, 4000)}`);
    });
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Governança" description="Credenciais externas, rotação, auditoria operacional e checks de compliance do workspace." />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-ink-muted">Credenciais</p><p className="text-2xl font-semibold text-ink">{credentials?.length ?? 0}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-muted">Ativas</p><p className="text-2xl font-semibold text-ink">{active}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-muted">Atenção</p><p className="text-2xl font-semibold text-ink">{attention}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-muted">Compliance</p><div className="mt-2"><StatusBadge status={compliance?.overallStatus ?? "pending"} /></div></Card>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Button disabled={!!busy} onClick={connectProvider}>Conectar provedor</Button>
        <Button variant="secondary" disabled={!!busy} onClick={() => showExport("audit-json", () => exportAuditEvents(workspace.id, "json"))}>Exportar audit JSON</Button>
        <Button variant="secondary" disabled={!!busy} onClick={() => showExport("audit-csv", () => exportAuditEvents(workspace.id, "csv"))}>Exportar audit CSV</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutateCredentials()} />
      ) : !credentials || credentials.length === 0 ? (
        <EmptyState title="Nenhuma credencial" description="Conecte o provider sandbox para registrar Credential, CredentialReference e binding governado." />
      ) : (
        <Card className="mb-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-ink-muted">
                <th className="px-4 py-3 font-medium">Provedor</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Escopos</th>
                <th className="px-4 py-3 font-medium">Expira</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((credential) => (
                <CredentialRow key={credential.id} credential={credential} busy={busy} workspaceId={workspace.id} runAction={runAction} showExport={showExport} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-ink">Compliance</p>
          <div className="space-y-2">
            {compliance?.checks.map((check) => (
              <div key={check.id} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-ink">{check.id}</p>
                  <p className="text-xs text-ink-muted">{check.safeMessage}</p>
                </div>
                <StatusBadge status={check.status} />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-ink">Auditoria recente</p>
          <div className="space-y-3">
            {(auditEvents ?? []).slice(0, 8).map((event) => (
              <div key={event.id} className="border-b border-border pb-2 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-ink">{event.eventType}</p>
                  <StatusBadge status={event.result.status} />
                </div>
                <p className="mt-1 text-xs text-ink-muted">{event.actor.userId} · {event.resource.type}:{event.resource.id} · {formatDateTime(event.createdAt)}</p>
              </div>
            ))}
            {auditEvents?.length === 0 ? <p className="text-sm text-ink-muted">Nenhum evento operacional registrado.</p> : null}
          </div>
        </Card>
      </div>

      {exportPreview ? (
        <Card className="mt-6 p-4">
          <p className="mb-2 text-sm font-medium text-ink">Pré-visualização da exportação</p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-surface-sunken p-3 text-xs text-ink-muted">{exportPreview}</pre>
        </Card>
      ) : null}
    </main>
  );
}

function CredentialRow({ credential, busy, workspaceId, runAction, showExport }: { credential: Credential; busy?: string; workspaceId: string; runAction: (key: string, action: () => Promise<unknown>) => Promise<void>; showExport: (label: string, action: () => Promise<{ contentType: string; body: string }>) => Promise<void> }) {
  const actionDisabled = !!busy;
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <p className="font-medium text-ink">{credential.providerId}</p>
        <p className="text-xs text-ink-muted">{credential.environment} · {credential.providerSubjectId ?? "sem subject"} · {credential.activeReferenceId ?? "sem reference ativa"}</p>
      </td>
      <td className="px-4 py-3"><StatusBadge status={credential.status} /></td>
      <td className="px-4 py-3 text-xs text-ink-muted">
        <p>{credential.grantedScopes.length}/{credential.requiredScopes.length} concedidos</p>
        {credential.missingScopes.length > 0 ? <p className="mt-1 text-red-600">{credential.missingScopes.join(", ")}</p> : null}
      </td>
      <td className="px-4 py-3 text-xs text-ink-muted">{credential.expiresAt ? formatDateTime(credential.expiresAt) : "Sem expiração"}</td>
      <td className="px-4 py-3">
        <div className="flex min-w-96 flex-wrap gap-2">
          <Button variant="secondary" disabled={actionDisabled} onClick={() => runAction(`health:${credential.id}`, () => checkCredentialHealth(workspaceId, credential.id))}>Saúde</Button>
          <Button variant="secondary" disabled={actionDisabled || credential.status === "revoked"} onClick={() => runAction(`rotate:${credential.id}`, () => rotateCredential(workspaceId, credential.id, "Rotação manual via Governança"))}>Rotacionar</Button>
          <Button variant="secondary" disabled={actionDisabled || credential.status === "disabled"} onClick={() => runAction(`disable:${credential.id}`, () => disableCredential(workspaceId, credential.id, "Desativação operacional via Governança"))}>Desabilitar</Button>
          <Button variant="secondary" disabled={actionDisabled || credential.status === "connected"} onClick={() => runAction(`enable:${credential.id}`, () => enableCredential(workspaceId, credential.id, "Ativação operacional via Governança"))}>Habilitar</Button>
          <Button variant="danger" disabled={actionDisabled || credential.status === "revoked"} onClick={() => runAction(`revoke:${credential.id}`, () => revokeCredential(workspaceId, credential.id, "Revogação operacional via Governança"))}>Revogar</Button>
          <Button variant="ghost" disabled={actionDisabled} onClick={() => showExport(`credential-export:${credential.id}`, () => exportCredentialHistory(workspaceId, credential.id, "json"))}>Exportar</Button>
        </div>
      </td>
    </tr>
  );
}
