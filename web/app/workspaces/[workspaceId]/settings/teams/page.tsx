"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { GuardedButton } from "@/components/GuardedButton";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SearchableCombo } from "@/components/SearchableCombo";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/Spinner";
import { addTeamMember, createTeam, deleteTeam, removeTeamMember } from "@/features/identity/api";
import { useTeamMembers, useTeams } from "@/features/identity/hooks";
import type { Team, TenantRole } from "@/features/identity/types";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useAuth } from "@/contexts/auth-context";
import { useInboxMembers } from "@/features/inbox/hooks";
import { canManageTenant, RBAC_COPY } from "@/lib/rbac";

const ROLE_LABEL: Record<TenantRole, string> = { owner: "Administrador", admin: "Gestor", editor: "Editor", viewer: "Visualizador" };

export default function TeamsPage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const canManage = canManageTenant(state.status === "authenticated" ? state.role : undefined);
  const { data: teams, error, isLoading, mutate } = useTeams(workspace.id);
  const { data: tenantMembers } = useInboxMembers(workspace.id);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<string | undefined>();
  const [pendingMemberRemoval, setPendingMemberRemoval] = useState<string | undefined>();
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<TenantRole>("editor");
  const [actionError, setActionError] = useState<string | undefined>();

  const { data: members, mutate: mutateMembers } = useTeamMembers(selectedTeamId, workspace.id);
  const selectedTeam = teams?.find((team) => team.id === selectedTeamId);
  const memberOptions = (tenantMembers?.members ?? []).map((member) => ({ id: member.userId, label: `${member.name} · ${member.email}` }));
  const counts = useMemo(() => countMembers(teams ?? [], selectedTeamId, members?.length ?? 0), [teams, selectedTeamId, members?.length]);

  async function handleCreate() {
    if (!canManage) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await createTeam(workspace.id, name.trim());
      setCreateOpen(false);
      setName("");
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível criar a equipe.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(teamId: string) {
    if (!canManage) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await deleteTeam(teamId, workspace.id);
      setPendingDelete(undefined);
      if (selectedTeamId === teamId) setSelectedTeamId(undefined);
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível excluir a equipe.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMember() {
    if (!canManage || !selectedTeamId || !memberUserId.trim()) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await addTeamMember(selectedTeamId, workspace.id, memberUserId.trim(), memberRole);
      setMemberUserId("");
      await mutateMembers();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível adicionar o membro.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!canManage || !selectedTeamId) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await removeTeamMember(selectedTeamId, workspace.id, userId);
      setPendingMemberRemoval(undefined);
      await mutateMembers();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível remover o membro.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsShell
      active="teams"
      title="Equipes"
      description="Organize pessoas por área sem expor IDs técnicos."
      actions={<GuardedButton onClick={() => setCreateOpen(true)} allowed={canManage} blockedReason={RBAC_COPY.manageTenant}>Nova equipe</GuardedButton>}
    >
      {actionError ? <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)]">
        <Card>
          <CardHeader>
            <div>
              <p className="text-sm font-semibold text-foreground">Equipes</p>
              <p className="mt-1 text-xs text-muted-foreground">{teams?.length ?? 0} equipes cadastradas.</p>
            </div>
          </CardHeader>
          <CardBody className="space-y-2">
            {isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : null}
            {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}
            {!isLoading && !error && teams && teams.length === 0 ? (
              <EmptyState title="Nenhuma equipe ainda" description="Crie a primeira equipe para organizar responsáveis por área." />
            ) : null}
            {teams?.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => setSelectedTeamId(team.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition-colors ${selectedTeamId === team.id ? "bg-primary/10 text-primary" : "bg-muted/40 text-foreground hover:bg-muted"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{team.name}</span>
                  <span className="text-xs text-muted-foreground">{counts.get(team.id) ?? "Selecione para ver"} membros</span>
                </span>
                <GuardedButton variant="ghost" onClick={(event) => { event.stopPropagation(); setPendingDelete(team.id); }} allowed={canManage} blockedReason={RBAC_COPY.manageTenant} disabled={busy}>
                  Excluir
                </GuardedButton>
              </button>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <p className="text-sm font-semibold text-foreground">{selectedTeam ? selectedTeam.name : "Detalhe da equipe"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Membros e papel dentro desta equipe.</p>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            {!selectedTeam ? (
              <p className="text-sm text-muted-foreground">Selecione uma equipe para ver seus membros.</p>
            ) : (
              <>
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_150px_auto]">
                  <SearchableCombo
                    items={memberOptions}
                    value={memberUserId}
                    onValueChange={setMemberUserId}
                    placeholder="Adicionar membro"
                    searchPlaceholder="Buscar por nome ou e-mail..."
                    emptyText="Nenhum membro encontrado."
                    disabled={!canManage || busy}
                  />
                  <Select value={memberRole} onValueChange={(value) => setMemberRole(value as TenantRole)} disabled={!canManage || busy}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{(["owner", "admin", "editor", "viewer"] as const).map((role) => <SelectItem key={role} value={role}>{ROLE_LABEL[role]}</SelectItem>)}</SelectContent>
                  </Select>
                  <GuardedButton variant="secondary" onClick={handleAddMember} disabled={!memberUserId.trim() || busy} allowed={canManage} blockedReason={RBAC_COPY.manageTenant}>Adicionar</GuardedButton>
                </div>

                <div className="space-y-2">
                  {(members ?? []).map((member) => (
                    <div key={member.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-foreground">{teamMemberLabel(member.userId, tenantMembers?.members ?? [])}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground">{ROLE_LABEL[member.role]}</span>
                        <GuardedButton variant="ghost" onClick={() => setPendingMemberRemoval(member.userId)} allowed={canManage} blockedReason={RBAC_COPY.manageTenant} disabled={busy}>Remover</GuardedButton>
                      </div>
                    </div>
                  ))}
                  {members && members.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum membro nesta equipe ainda.</p> : null}
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      {createOpen ? (
        <Modal title="Nova equipe" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="team-name">Nome</Label>
              <Input id="team-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Comercial" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>Cancelar</Button>
              <Button onClick={handleCreate} loading={busy} disabled={!name.trim() || busy}>Criar</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Excluir equipe"
        description="Os membros perdem a associação a esta equipe. Essa ação não pode ser desfeita."
        confirmLabel="Excluir"
        variant="danger"
        busy={busy}
        onConfirm={() => { if (pendingDelete) return handleDelete(pendingDelete); }}
        onCancel={() => setPendingDelete(undefined)}
      />
      <ConfirmDialog
        open={Boolean(pendingMemberRemoval)}
        title="Remover membro da equipe"
        description="A pessoa continua no tenant, mas deixa de fazer parte desta equipe."
        confirmLabel="Remover"
        variant="danger"
        busy={busy}
        onConfirm={() => { if (pendingMemberRemoval) return handleRemoveMember(pendingMemberRemoval); }}
        onCancel={() => setPendingMemberRemoval(undefined)}
      />
    </SettingsShell>
  );
}

function teamMemberLabel(userId: string, members: readonly { userId: string; name: string; email: string }[]): string {
  const member = members.find((item) => item.userId === userId);
  return member ? `${member.name} · ${member.email}` : "Membro sem perfil disponível";
}

function countMembers(teams: readonly Team[], selectedTeamId: string | undefined, selectedCount: number) {
  const counts = new Map<string, number | string>();
  for (const team of teams) counts.set(team.id, "—");
  if (selectedTeamId) counts.set(selectedTeamId, selectedCount);
  return counts;
}
