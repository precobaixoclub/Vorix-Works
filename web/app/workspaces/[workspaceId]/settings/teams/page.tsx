"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Star, Trash2, UserPlus } from "lucide-react";
import { PersonAvatar } from "@/components/DashboardKit";
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
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Spinner } from "@/components/Spinner";
import { addTeamMember, createTeam, deleteTeam, removeTeamMember, updateTeam, updateTeamMember } from "@/features/identity/api";
import { useTeamMembers, useTeams } from "@/features/identity/hooks";
import type { Team, TeamMembership, TenantRole } from "@/features/identity/types";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useAuth } from "@/contexts/auth-context";
import { useInboxMembers } from "@/features/inbox/hooks";
import { canManageTenant, RBAC_COPY } from "@/lib/rbac";
import { useMyAccess } from "@/features/auth/access";
import { cn } from "@/lib/utils";

/** Papel NA EQUIPE (0173): gerente da equipe (owner/admin) ou membro (editor/viewer). */
const ROLE_LABEL: Record<TenantRole, string> = { owner: "Gerente da equipe", admin: "Gerente da equipe", editor: "Membro", viewer: "Membro" };

/** Bloco "roteamento por equipe" (réplica adaptada do CMDesk, pedido explícito do usuário) — a UI
 * atual oferece N1-N5 como atalho (mesmos rótulos usados no relatório de referência), mas o
 * backend aceita qualquer string normalizada (`normalizeAttendanceLevel`) — nunca um enum fechado. */
const ATTENDANCE_LEVELS = ["N1", "N2", "N3", "N4", "N5"] as const;

export default function TeamsPage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  // Estrutura de equipes é do Administrador (ou de quem recebeu "Gerenciar equipes").
  const { can } = useMyAccess();
  const canManage = can("team:manage");
  const { data: teams, error, isLoading, mutate } = useTeams(workspace.id);
  const { data: tenantMembers, isLoading: usersLoading, error: usersError } = useInboxMembers(workspace.id);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<string | undefined>();
  const [pendingMemberRemoval, setPendingMemberRemoval] = useState<string | undefined>();
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<TenantRole>("editor");
  const [memberLevel, setMemberLevel] = useState<string>("N1");
  const [actionError, setActionError] = useState<string | undefined>();

  const { data: members, isLoading: membersLoading, error: membersError, mutate: mutateMembers } = useTeamMembers(selectedTeamId, workspace.id);
  const selectedTeam = teams?.find((team) => team.id === selectedTeamId);
  const peopleById = new Map((tenantMembers?.members ?? []).map((person) => [person.userId, person]));
  const memberOptions = (tenantMembers?.members ?? [])
    .filter((person) => !members?.some((member) => member.userId === person.userId))
    .map((member) => ({ id: member.userId, label: `${member.name} · ${member.email}` }));
  const pickerUnavailable = busy || usersLoading || membersLoading || Boolean(usersError || membersError);
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

  async function handleToggleRoundRobin(team: Team, value: boolean) {
    if (!canManage) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await updateTeam(team.id, workspace.id, team.name, { roundRobinEnabled: value });
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível atualizar o rodízio.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMember() {
    if (!canManage || pickerUnavailable || !selectedTeamId || !memberOptions.some((person) => person.id === memberUserId)) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await addTeamMember(selectedTeamId, workspace.id, memberUserId.trim(), memberRole, { attendanceLevel: memberLevel });
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

  async function handleUpdateMember(member: TeamMembership, patch: { attendanceLevel?: string; participatesInRoundRobin?: boolean; setPrincipal?: boolean }) {
    if (!canManage || !selectedTeamId) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await updateTeamMember(selectedTeamId, workspace.id, member.userId, patch);
      await mutateMembers();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível atualizar o membro.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsShell
      active="teams"
      title="Equipes"
      description="Organize pessoas por área e configure o rodízio automático de atendimento."
      actions={<GuardedButton onClick={() => setCreateOpen(true)} allowed={canManage} blockedReason={RBAC_COPY.manageTenant}>Nova equipe</GuardedButton>}
    >
      {actionError ? <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}

      <div className="grid items-start gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
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
              <div
                key={team.id}
                className={cn(
                  "flex w-full items-center gap-1 rounded-lg p-1 transition-colors",
                  selectedTeamId === team.id ? "bg-primary/10 text-primary" : "bg-muted/40 text-foreground hover:bg-muted",
                )}
              >
                <button type="button" aria-pressed={selectedTeamId === team.id} onClick={() => { setSelectedTeamId(team.id); setMemberUserId(""); }} className="min-w-0 flex-1 rounded-md px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="block truncate text-sm font-medium">{team.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {counts.get(team.id) ?? "Selecione para ver"} membros
                    {team.roundRobinEnabled ? " · Rodízio ativo" : ""}
                  </span>
                </button>
                <GuardedButton variant="ghost" className="h-8 w-8 shrink-0 p-0 text-muted-foreground" aria-label={`Excluir equipe ${team.name}`} onClick={() => setPendingDelete(team.id)} allowed={canManage} blockedReason={RBAC_COPY.manageTenant} disabled={busy}>
                  <Trash2 className="h-4 w-4" />
                </GuardedButton>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex w-full flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{selectedTeam ? selectedTeam.name : "Detalhe da equipe"}</p>
                <p className="mt-1 text-xs text-muted-foreground">Membros, nível de atendimento e rodízio desta equipe.</p>
              </div>
              {selectedTeam ? (
                <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  Rodízio automático
                  <Switch checked={selectedTeam.roundRobinEnabled} onCheckedChange={(value) => handleToggleRoundRobin(selectedTeam, value)} disabled={!canManage || busy} />
                </label>
              ) : null}
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            {!selectedTeam ? (
              <p className="text-sm text-muted-foreground">Selecione uma equipe para ver seus membros.</p>
            ) : (
              <>
                {!selectedTeam.roundRobinEnabled ? (
                  <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    Rodízio desligado — toda conversa nova desta equipe vai sempre para o membro principal (⭐) de cada nível.
                  </p>
                ) : null}
                <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold"><UserPlus className="h-4 w-4 text-primary" />Adicionar à equipe</p>
                    <p className="mt-1 text-xs text-muted-foreground">Busque um usuário cadastrado e defina como ele vai atuar nesta equipe.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="team-member-user">Usuário</Label>
                    <SearchableCombo
                      id="team-member-user"
                      items={memberOptions}
                      value={memberUserId}
                      onValueChange={setMemberUserId}
                      placeholder="Buscar usuário por nome ou e-mail"
                      searchPlaceholder="Buscar por nome ou e-mail..."
                      emptyText="Nenhum usuário disponível com esse nome ou e-mail."
                      loading={usersLoading || membersLoading}
                      disabled={!canManage || pickerUnavailable || memberOptions.length === 0}
                      className="h-14 px-3"
                      leadingIcon={<Search className="h-4 w-4 shrink-0" />}
                      renderItem={(item) => {
                        const person = peopleById.get(item.id);
                        return <><PersonAvatar nome={person?.name ?? item.label} avatarUrl={person?.avatarUrl} className="h-8 w-8 shrink-0" /><span className="min-w-0"><span className="block truncate text-sm font-medium">{person?.name ?? item.label}</span><span className="block truncate text-xs text-muted-foreground">{person?.email}</span></span></>;
                      }}
                    />
                    {usersError || membersError ? <p role="alert" className="text-xs text-destructive">Não foi possível carregar os usuários. Atualize a página para tentar novamente.</p> : !usersLoading && !membersLoading && memberOptions.length === 0 ? <p className="text-xs text-muted-foreground">Todos os usuários cadastrados já fazem parte desta equipe.</p> : null}
                    <p className="text-xs text-muted-foreground">Precisa cadastrar alguém? <Link href={`/workspaces/${workspace.id}/settings/users`} className="font-medium text-primary hover:underline">Gerenciar usuários</Link></p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="team-member-role">Acesso na equipe</Label>
                      <Select value={memberRole} onValueChange={(value) => setMemberRole(value as TenantRole)} disabled={!canManage || busy}>
                        <SelectTrigger id="team-member-role"><SelectValue /></SelectTrigger>
                        <SelectContent>{(["editor", "admin"] as const).map((role) => <SelectItem key={role} value={role}>{ROLE_LABEL[role]}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="team-member-level">Nível de atendimento</Label>
                      <Select value={memberLevel} onValueChange={setMemberLevel} disabled={!canManage || busy}>
                        <SelectTrigger id="team-member-level"><SelectValue /></SelectTrigger>
                        <SelectContent>{ATTENDANCE_LEVELS.map((level) => <SelectItem key={level} value={level}>{level}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <GuardedButton className="w-full gap-2" onClick={handleAddMember} disabled={!memberUserId.trim() || pickerUnavailable} allowed={canManage} blockedReason={RBAC_COPY.manageTenant}><UserPlus className="h-4 w-4" />{busy ? "Adicionando..." : "Adicionar à equipe"}</GuardedButton>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold">Membros da equipe <span className="ml-1 text-xs font-normal text-muted-foreground">({members?.length ?? 0})</span></p>
                  {membersLoading ? <div className="flex justify-center py-4"><Spinner /></div> : null}
                  {(members ?? []).map((member) => (
                    <div key={member.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => handleUpdateMember(member, { setPrincipal: true })}
                              disabled={!canManage || busy || member.isPrincipalForLevel}
                              className={cn("shrink-0 rounded p-0.5", member.isPrincipalForLevel ? "text-warning" : "text-muted-foreground/40 hover:text-muted-foreground")}
                            >
                              <Star className="h-3.5 w-3.5" fill={member.isPrincipalForLevel ? "currentColor" : "none"} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{member.isPrincipalForLevel ? `Principal do nível ${member.attendanceLevel}` : `Marcar como principal do nível ${member.attendanceLevel}`}</TooltipContent>
                        </Tooltip>
                        <PersonAvatar nome={peopleById.get(member.userId)?.name ?? "Usuário"} avatarUrl={peopleById.get(member.userId)?.avatarUrl} className="h-8 w-8 shrink-0" />
                        <span className="min-w-0"><span className="block truncate font-medium text-foreground">{peopleById.get(member.userId)?.name ?? "Membro sem perfil disponível"}</span><span className="block truncate text-xs text-muted-foreground">{peopleById.get(member.userId)?.email}</span></span>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">{ROLE_LABEL[member.role]}</span>
                        <Select value={member.attendanceLevel} onValueChange={(value) => handleUpdateMember(member, { attendanceLevel: value })} disabled={!canManage || busy}>
                          <SelectTrigger className="h-7 w-[72px] text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{ATTENDANCE_LEVELS.map((level) => <SelectItem key={level} value={level}>{level}</SelectItem>)}</SelectContent>
                        </Select>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <label className="flex items-center gap-1 text-xs text-muted-foreground">
                              Rodízio
                              <Switch
                                checked={member.participatesInRoundRobin}
                                onCheckedChange={(value) => handleUpdateMember(member, { participatesInRoundRobin: value })}
                                disabled={!canManage || busy}
                              />
                            </label>
                          </TooltipTrigger>
                          <TooltipContent>{member.participatesInRoundRobin ? "Participa do rodízio deste nível" : "Nunca recebe conversa pelo rodízio — só se for o principal"}</TooltipContent>
                        </Tooltip>
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

function countMembers(teams: readonly Team[], selectedTeamId: string | undefined, selectedCount: number) {
  const counts = new Map<string, number | string>();
  for (const team of teams) counts.set(team.id, "—");
  if (selectedTeamId) counts.set(selectedTeamId, selectedCount);
  return counts;
}
