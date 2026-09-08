"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/Spinner";
import { addTeamMember, createTeam, deleteTeam, removeTeamMember } from "@/features/identity/api";
import { useTeamMembers, useTeams } from "@/features/identity/hooks";
import type { TenantRole } from "@/features/identity/types";
import { useCurrentWorkspace } from "@/contexts/workspace-context";

const ROLE_LABEL: Record<TenantRole, string> = { owner: "Administrador", admin: "Gestor", editor: "Editor", viewer: "Visualizador" };

export default function TeamsPage() {
  const workspace = useCurrentWorkspace();
  const { data: teams, error, isLoading, mutate } = useTeams(workspace.id);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<string | undefined>();
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<TenantRole>("editor");

  const { data: members, mutate: mutateMembers } = useTeamMembers(selectedTeamId, workspace.id);
  const selectedTeam = teams?.find((team) => team.id === selectedTeamId);

  async function handleCreate() {
    setBusy(true);
    try {
      await createTeam(workspace.id, name.trim());
      setCreateOpen(false);
      setName("");
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(teamId: string) {
    await deleteTeam(teamId, workspace.id);
    setPendingDelete(undefined);
    if (selectedTeamId === teamId) setSelectedTeamId(undefined);
    await mutate();
  }

  async function handleAddMember() {
    if (!selectedTeamId || !memberUserId.trim()) return;
    await addTeamMember(selectedTeamId, workspace.id, memberUserId.trim(), memberRole);
    setMemberUserId("");
    await mutateMembers();
  }

  async function handleRemoveMember(userId: string) {
    if (!selectedTeamId) return;
    await removeTeamMember(selectedTeamId, workspace.id, userId);
    await mutateMembers();
  }

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Equipes"
        description="Sub-grupos dentro do workspace — Comercial, Suporte, Marketing — cada um com seus próprios membros."
        actions={<Button onClick={() => setCreateOpen(true)}>Nova equipe</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <Card>
          <CardHeader><p className="text-sm font-semibold text-foreground">Suas equipes</p></CardHeader>
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
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${selectedTeamId === team.id ? "bg-primary/10 text-primary" : "bg-muted/40 text-foreground hover:bg-muted"}`}
              >
                <span className="font-medium">{team.name}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => { event.stopPropagation(); setPendingDelete(team.id); }}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.stopPropagation(); setPendingDelete(team.id); } }}
                  className="text-xs font-medium text-muted-foreground hover:text-danger"
                >
                  Excluir
                </span>
              </button>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><p className="text-sm font-semibold text-foreground">{selectedTeam ? `Membros — ${selectedTeam.name}` : "Selecione uma equipe"}</p></CardHeader>
          <CardBody className="space-y-3">
            {!selectedTeam ? (
              <p className="text-sm text-muted-foreground">Escolha uma equipe à esquerda para ver e gerenciar seus membros.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Input value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)} placeholder="ID do usuário" className="flex-1" />
                  <Select value={memberRole} onValueChange={(value) => setMemberRole(value as TenantRole)}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["owner", "admin", "editor", "viewer"] as const).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="secondary" onClick={handleAddMember} disabled={!memberUserId.trim()}>Adicionar</Button>
                </div>
                <div className="space-y-1.5">
                  {(members ?? []).map((member) => (
                    <div key={member.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{member.userId}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{ROLE_LABEL[member.role]}</span>
                        <Button variant="ghost" onClick={() => handleRemoveMember(member.userId)}>Remover</Button>
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
        onConfirm={() => { if (pendingDelete) return handleDelete(pendingDelete); }}
        onCancel={() => setPendingDelete(undefined)}
      />
    </main>
  );
}
