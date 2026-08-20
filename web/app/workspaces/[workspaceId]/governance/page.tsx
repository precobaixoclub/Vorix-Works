"use client";

import { useState, type ReactNode } from "react";
import { mutate } from "swr";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { beginCredentialConnection, checkCredentialHealth, disableCredential, enableCredential, exportAuditEvents, exportCredentialHistory, revokeCredential, rotateCredential } from "@/features/governance/api";
import { useAuditEvents, useComplianceReport, useCredentials } from "@/features/governance/hooks";
import type { Credential } from "@/features/governance/types";
import { formatDateTime } from "@/lib/format";

type GovernanceConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "primary" | "danger";
  action: () => Promise<void>;
};

export default function GovernancePage() {
  const workspace = useCurrentWorkspace();
  const [busy, setBusy] = useState<string | undefined>();
  const [exportPreview, setExportPreview] = useState("");
  const [pendingAction, setPendingAction] = useState<GovernanceConfirmAction | null>(null);
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

  function confirmAuditExport(format: "json" | "csv") {
    setPendingAction({
      title: `Exportar auditoria em ${format.toUpperCase()}?`,
      description: "A exportação pode conter registros operacionais sensíveis do workspace. Use apenas para suporte ou compliance.",
      confirmLabel: `Exportar ${format.toUpperCase()}`,
      action: () => showExport(`audit-${format}`, () => exportAuditEvents(workspace.id, format)),
    });
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Governança" description="Controle de credenciais, auditoria e segurança das integrações do workspace." />

      <ScreenGuide
        title="O que conferir"
        description="Esta tela é para manutenção e suporte. Ela mostra se as conexões ainda estão válidas e auditáveis."
        items={[
          "Credenciais ativas indicam integrações conectadas.",
          "Atenção maior que zero pede revisão.",
          "Conectar provedor refaz autorização externa.",
          "Auditoria mostra mudanças recentes e ações sensíveis.",
        ]}
        aside={<p>Não rotacione ou revogue credenciais sem necessidade; isso pode exigir conectar a rede social novamente.</p>}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-ink-muted">Credenciais</p><p className="text-2xl font-semibold text-ink">{credentials?.length ?? 0}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-muted">Ativas</p><p className="text-2xl font-semibold text-ink">{active}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-muted">Atenção</p><p className="text-2xl font-semibold text-ink">{attention}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-muted">Compliance</p><div className="mt-2"><StatusBadge status={compliance?.overallStatus ?? "pending"} /></div></Card>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Button disabled={!!busy} onClick={connectProvider}>Conectar provedor</Button>
        <Button variant="secondary" disabled={!!busy} onClick={() => confirmAuditExport("json")}>Exportar audit JSON</Button>
        <Button variant="secondary" disabled={!!busy} onClick={() => confirmAuditExport("csv")}>Exportar audit CSV</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutateCredentials()} />
      ) : !credentials || credentials.length === 0 ? (
        <EmptyState title="Nenhuma credencial" description="Conecte um provedor para registrar Credential, CredentialReference e binding governado." />
      ) : (
        <Card className="mb-6 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
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
                <CredentialRow
                  key={credential.id}
                  credential={credential}
                  busy={busy}
                  workspaceId={workspace.id}
                  runAction={runAction}
                  showExport={showExport}
                  requestConfirm={setPendingAction}
                />
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

      <ConfirmDialog
        open={!!pendingAction}
        title={pendingAction?.title ?? ""}
        description={pendingAction?.description ?? ""}
        confirmLabel={pendingAction?.confirmLabel ?? "Confirmar"}
        variant={pendingAction?.variant ?? "primary"}
        busy={!!busy}
        onCancel={() => setPendingAction(null)}
        onConfirm={async () => {
          if (!pendingAction) return;
          await pendingAction.action();
          setPendingAction(null);
        }}
      />
    </main>
  );
}

function CredentialRow({
  credential,
  busy,
  workspaceId,
  runAction,
  showExport,
  requestConfirm,
}: {
  credential: Credential;
  busy?: string;
  workspaceId: string;
  runAction: (key: string, action: () => Promise<unknown>) => Promise<void>;
  showExport: (label: string, action: () => Promise<{ contentType: string; body: string }>) => Promise<void>;
  requestConfirm: (action: GovernanceConfirmAction) => void;
}) {
  const actionDisabled = !!busy;
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <p className="font-medium text-ink">{credential.providerId}</p>
        <p className="text-xs text-ink-muted">{credential.environment} · {credential.providerSubjectId ?? "sem subject"}</p>
        <p className="break-all text-[11px] text-ink-faint">{credential.activeReferenceId ?? "sem referência ativa"}</p>
      </td>
      <td className="px-4 py-3"><StatusBadge status={credential.status} /></td>
      <td className="px-4 py-3 text-xs text-ink-muted">
        <p>{credential.grantedScopes.length}/{credential.requiredScopes.length} concedidos</p>
        {credential.missingScopes.length > 0 ? <p className="mt-1 text-red-600">{credential.missingScopes.join(", ")}</p> : null}
      </td>
      <td className="px-4 py-3 text-xs text-ink-muted">{credential.expiresAt ? formatDateTime(credential.expiresAt) : "Sem expiração"}</td>
      <td className="px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <Button variant="secondary" disabled={actionDisabled} onClick={() => runAction(`health:${credential.id}`, () => checkCredentialHealth(workspaceId, credential.id))}>Saúde</Button>
          <details className="min-w-36">
            <summary className="inline-flex min-h-10 cursor-pointer list-none items-center justify-center rounded-lg border border-border bg-surface-raised px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-sunken">
              Mais ações
            </summary>
            <div className="mt-2 grid gap-1 rounded-lg border border-border bg-surface-raised p-2">
              <MenuAction
                disabled={actionDisabled || credential.status === "revoked"}
                onClick={() =>
                  requestConfirm({
                    title: "Rotacionar credencial?",
                    description: "A rotação cria uma nova referência de credencial e pode exigir nova validação do provedor.",
                    confirmLabel: "Rotacionar",
                    action: () => runAction(`rotate:${credential.id}`, () => rotateCredential(workspaceId, credential.id, "Rotação manual via Governança")),
                  })
                }
              >
                Rotacionar
              </MenuAction>
              <MenuAction
                disabled={actionDisabled || credential.status === "disabled"}
                danger
                onClick={() =>
                  requestConfirm({
                    title: "Desabilitar credencial?",
                    description: "A credencial deixará de ser usada para publicações até ser habilitada novamente.",
                    confirmLabel: "Desabilitar",
                    variant: "danger",
                    action: () => runAction(`disable:${credential.id}`, () => disableCredential(workspaceId, credential.id, "Desativação operacional via Governança")),
                  })
                }
              >
                Desabilitar
              </MenuAction>
              <MenuAction
                disabled={actionDisabled || credential.status === "connected"}
                onClick={() =>
                  requestConfirm({
                    title: "Habilitar credencial?",
                    description: "A credencial voltará a ficar disponível para os fluxos que usam este provedor.",
                    confirmLabel: "Habilitar",
                    action: () => runAction(`enable:${credential.id}`, () => enableCredential(workspaceId, credential.id, "Ativação operacional via Governança")),
                  })
                }
              >
                Habilitar
              </MenuAction>
              <MenuAction
                disabled={actionDisabled || credential.status === "revoked"}
                danger
                onClick={() =>
                  requestConfirm({
                    title: "Revogar credencial?",
                    description: "A revogação interrompe o uso desta credencial e pode exigir reconectar o provedor.",
                    confirmLabel: "Revogar",
                    variant: "danger",
                    action: () => runAction(`revoke:${credential.id}`, () => revokeCredential(workspaceId, credential.id, "Revogação operacional via Governança")),
                  })
                }
              >
                Revogar
              </MenuAction>
              <MenuAction
                disabled={actionDisabled}
                onClick={() =>
                  requestConfirm({
                    title: "Exportar histórico da credencial?",
                    description: "A exportação contém histórico operacional sensível desta credencial.",
                    confirmLabel: "Exportar",
                    action: () => showExport(`credential-export:${credential.id}`, () => exportCredentialHistory(workspaceId, credential.id, "json")),
                  })
                }
              >
                Exportar
              </MenuAction>
            </div>
          </details>
        </div>
      </td>
    </tr>
  );
}

function MenuAction({ children, disabled, danger = false, onClick }: { children: ReactNode; disabled?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-9 rounded-md px-3 text-left text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
        danger ? "text-red-600 hover:bg-red-50" : "text-ink hover:bg-surface-sunken"
      }`}
    >
      {children}
    </button>
  );
}
