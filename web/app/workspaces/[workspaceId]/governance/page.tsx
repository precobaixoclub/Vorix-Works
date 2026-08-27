"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { mutate } from "swr";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { ListCard } from "@/components/ListCard";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { SortableHead } from "@/components/SortableHead";
import { Spinner } from "@/components/Spinner";
import { StatsGrid } from "@/components/StatsGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { beginCredentialConnection, checkCredentialHealth, disableCredential, enableCredential, exportAuditEvents, exportCredentialHistory, revokeCredential, rotateCredential } from "@/features/governance/api";
import { useAuditEvents, useComplianceReport, useCredentials } from "@/features/governance/hooks";
import type { Credential, CredentialStatus } from "@/features/governance/types";
import { useDebounce } from "@/hooks/useDebounce";
import { useSortedRows } from "@/hooks/useSortedRows";
import { formatDateTime } from "@/lib/format";

type GovernanceConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "primary" | "danger";
  action: () => Promise<void>;
};

type StatusFilter = "all" | CredentialStatus;
type CredentialSortKey = "provider" | "status" | "scopes" | "expires";

const CREDENTIAL_STATUSES: CredentialStatus[] = ["pending", "connected", "expiring", "expired", "revoked", "invalid", "disabled", "rotation_pending"];

const CREDENTIAL_STATUS_LABEL: Record<CredentialStatus, string> = {
  pending: "Pendente",
  connected: "Conectado",
  expiring: "Expirando",
  expired: "Expirado",
  revoked: "Revogado",
  invalid: "Inválido",
  disabled: "Desabilitado",
  rotation_pending: "Rotação pendente",
};

export default function GovernancePage() {
  const workspace = useCurrentWorkspace();
  const [busy, setBusy] = useState<string | undefined>();
  const [exportPreview, setExportPreview] = useState("");
  const [pendingAction, setPendingAction] = useState<GovernanceConfirmAction | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const { data: credentials, isLoading, error, mutate: mutateCredentials } = useCredentials(workspace.id);
  const { data: auditEvents } = useAuditEvents(workspace.id);
  const { data: compliance } = useComplianceReport(workspace.id);
  const active = credentials?.filter((credential) => credential.status === "connected" || credential.status === "expiring").length ?? 0;
  const attention = credentials?.filter((credential) => ["expired", "invalid", "revoked", "disabled"].includes(credential.status)).length ?? 0;

  const debouncedSearch = useDebounce(searchTerm, 300);

  // filtro (busca debounced por provedor + status)
  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return (credentials ?? []).filter((credential) => {
      const matchesSearch =
        term === "" ||
        credential.providerId.toLowerCase().includes(term) ||
        (credential.providerSubjectId ?? "").toLowerCase().includes(term);
      const matchesStatus = statusFilter === "all" || credential.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [credentials, debouncedSearch, statusFilter]);

  // ordenação da lista INTEIRA (antes de paginar)
  const { sorted, sort, onSort } = useSortedRows<Credential, CredentialSortKey>(
    filtered,
    {
      provider: (c) => c.providerId.toLowerCase(),
      status: (c) => CREDENTIAL_STATUS_LABEL[c.status].toLowerCase(),
      scopes: (c) => c.grantedScopes.length,
      expires: (c) => (c.expiresAt ? new Date(c.expiresAt).getTime() : null),
    },
    { key: "provider", dir: "asc" },
  );

  // paginação adaptativa à altura da viewport
  const {
    currentPage, totalPages, paginatedItems, setCurrentPage, resetPage,
    totalItems, pageSize, containerRef, availableHeight,
  } = usePagination(sorted, { auto: true });

  // reset de página ao mudar filtro OU ordenação
  useEffect(() => {
    resetPage();
  }, [debouncedSearch, statusFilter, sort, resetPage]);

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
      <PageHeader
        title="Governança"
        description="Controle de credenciais, auditoria e segurança das integrações do workspace."
        actions={
          <>
            <Button disabled={!!busy} onClick={connectProvider}>Conectar provedor</Button>
            <Button variant="secondary" disabled={!!busy} onClick={() => confirmAuditExport("json")}>Exportar audit JSON</Button>
            <Button variant="secondary" disabled={!!busy} onClick={() => confirmAuditExport("csv")}>Exportar audit CSV</Button>
          </>
        }
      />

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

      <div className="mb-6">
        <StatsGrid>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Credenciais</p><p className="text-2xl font-semibold text-foreground">{credentials?.length ?? 0}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Ativas</p><p className="text-2xl font-semibold text-foreground">{active}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Atenção</p><p className="text-2xl font-semibold text-foreground">{attention}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Compliance</p><div className="mt-2"><StatusBadge status={compliance?.overallStatus ?? "pending"} /></div></Card>
        </StatsGrid>
      </div>

      <Card className="mb-3 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-64 flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por provedor..."
                className="pl-10"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {CREDENTIAL_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>{CREDENTIAL_STATUS_LABEL[status]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div className="mb-6">
        <ListCard
          ref={containerRef}
          availableHeight={availableHeight}
          footer={
            <TablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
            />
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead columnKey="provider" sort={sort} onSort={onSort}>Provedor</SortableHead>
                <SortableHead columnKey="status" sort={sort} onSort={onSort}>Status</SortableHead>
                <SortableHead columnKey="scopes" sort={sort} onSort={onSort}>Escopos</SortableHead>
                <SortableHead columnKey="expires" sort={sort} onSort={onSort}>Expira</SortableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {error ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8">
                    <ErrorState error={error} onRetry={() => mutateCredentials()} />
                  </TableCell>
                </TableRow>
              ) : isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-14 text-center">
                    <Spinner className="mx-auto h-5 w-5 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : paginatedItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8">
                    {debouncedSearch || statusFilter !== "all" ? (
                      <p className="text-center text-sm text-muted-foreground">Nenhuma credencial encontrada com esses filtros.</p>
                    ) : (
                      <EmptyState title="Nenhuma credencial" description="Conecte um provedor para registrar Credential, CredentialReference e binding governado." />
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedItems.map((credential) => (
                  <CredentialRow
                    key={credential.id}
                    credential={credential}
                    busy={busy}
                    workspaceId={workspace.id}
                    runAction={runAction}
                    showExport={showExport}
                    requestConfirm={setPendingAction}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </ListCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-foreground">Compliance</p>
          <div className="space-y-2">
            {compliance?.checks.map((check) => (
              <div key={check.id} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-foreground">{check.id}</p>
                  <p className="text-xs text-muted-foreground">{check.safeMessage}</p>
                </div>
                <StatusBadge status={check.status} />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-foreground">Auditoria recente</p>
          <div className="space-y-3">
            {(auditEvents ?? []).slice(0, 8).map((event) => (
              <div key={event.id} className="border-b border-border pb-2 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{event.eventType}</p>
                  <StatusBadge status={event.result.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{event.actor.userId} · {event.resource.type}:{event.resource.id} · {formatDateTime(event.createdAt)}</p>
              </div>
            ))}
            {auditEvents?.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum evento operacional registrado.</p> : null}
          </div>
        </Card>
      </div>

      {exportPreview ? (
        <Card className="mt-6 p-4">
          <p className="mb-2 text-sm font-medium text-foreground">Pré-visualização da exportação</p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs text-muted-foreground">{exportPreview}</pre>
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
    <TableRow>
      <TableCell>
        <p className="font-medium text-foreground">{credential.providerId}</p>
        <p className="text-xs text-muted-foreground">{credential.environment} · {credential.providerSubjectId ?? "sem subject"}</p>
        <p className="break-all text-[11px] text-muted-foreground">{credential.activeReferenceId ?? "sem referência ativa"}</p>
      </TableCell>
      <TableCell><StatusBadge status={credential.status} /></TableCell>
      <TableCell className="text-xs text-muted-foreground">
        <p>{credential.grantedScopes.length}/{credential.requiredScopes.length} concedidos</p>
        {credential.missingScopes.length > 0 ? <p className="mt-1 text-destructive">{credential.missingScopes.join(", ")}</p> : null}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{credential.expiresAt ? formatDateTime(credential.expiresAt) : "Sem expiração"}</TableCell>
      <TableCell>
        <div className="flex min-w-0 flex-wrap items-start justify-end gap-2">
          <Button variant="secondary" disabled={actionDisabled} onClick={() => runAction(`health:${credential.id}`, () => checkCredentialHealth(workspaceId, credential.id))}>Saúde</Button>
          <details className="min-w-36">
            <summary className="inline-flex min-h-10 cursor-pointer list-none items-center justify-center rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground hover:bg-muted">
              Mais ações
            </summary>
            <div className="mt-2 grid gap-1 rounded-lg border border-border bg-card p-2 shadow-sm">
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
                    title: `Desabilitar credencial de ${credential.providerId}?`,
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
                    title: `Habilitar credencial de ${credential.providerId}?`,
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
                    title: `Revogar credencial de ${credential.providerId}?`,
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
                    title: `Exportar histórico da credencial de ${credential.providerId}?`,
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
      </TableCell>
    </TableRow>
  );
}

function MenuAction({ children, disabled, danger = false, onClick }: { children: ReactNode; disabled?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-9 rounded-md px-3 text-left text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
        danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
