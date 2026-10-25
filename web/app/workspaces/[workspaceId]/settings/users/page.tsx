"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { UserProfileModal } from "@/components/settings/UserProfileModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { GuardedButton } from "@/components/GuardedButton";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PersonAvatar } from "@/components/DashboardKit";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/Spinner";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inviteTenantMember, removeTenantMember, revokeTenantInvite, setMemberStatus } from "@/features/identity/api";
import { UserAccessModal } from "@/components/settings/UserAccessModal";
import { useMyAccess } from "@/features/auth/access";
import { useTenantInvites, useTenantMembers } from "@/features/identity/hooks";
import type { TenantMemberInvite, TenantMembership, TenantRole } from "@/features/identity/types";
import { useInboxMembers } from "@/features/inbox/hooks";
import { RBAC_COPY } from "@/lib/rbac";

/** Perfis (0173): owner = Administrador, admin = Gerente, editor = Atendente; viewer é legado. */
const ROLE_LABEL: Record<TenantRole, string> = { owner: "Administrador", admin: "Gerente", editor: "Atendente", viewer: "Visualizador" };
const INVITE_ROLES: TenantRole[] = ["owner", "admin", "editor"];

export default function UsersPage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const { can } = useMyAccess();
  const currentUserId = state.status === "authenticated" ? state.user.id : undefined;
  const actorIsOwner = state.status === "authenticated" && state.role === "owner";
  // Permissões efetivas (perfil + exceções), não só o nome do perfil.
  const canManage = can("tenant_member:manage");
  const canManageAccess = can("tenant_member:manage_permissions");
  const [accessEditor, setAccessEditor] = useState<{ userId: string; name: string }>();
  const { data: members, error: membersError, isLoading: membersLoading, mutate: mutateMembers } = useTenantMembers();
  const { data: invites, error: invitesError, isLoading: invitesLoading, mutate: mutateInvites } = useTenantInvites();
  const { data: inboxMembers } = useInboxMembers(workspace.id);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [profileEditor, setProfileEditor] = useState<TenantMembership | "new">();
  const { mutate: mutateCache } = useSWRConfig();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pendingRemoval, setPendingRemoval] = useState<string | undefined>();

  async function handleInvite() {
    if (!canManage) return;
    setBusy(true);
    setError(undefined);
    try {
      await inviteTenantMember(email.trim(), role);
      setInviteOpen(false);
      setEmail("");
      await mutateInvites();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar o convite.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStatus(userId: string, status: "active" | "disabled") {
    if (!canManage) return;
    setBusy(true);
    setError(undefined);
    try {
      await setMemberStatus(userId, status);
      await mutateMembers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível alterar o status.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(userId: string) {
    if (!canManage) return;
    setBusy(true);
    setError(undefined);
    try {
      await removeTenantMember(userId);
      setPendingRemoval(undefined);
      await mutateMembers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível remover o usuário.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeInvite(invite: TenantMemberInvite) {
    if (!canManage) return;
    setBusy(true);
    setError(undefined);
    try {
      await revokeTenantInvite(invite.id);
      await mutateInvites();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível revogar o convite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsShell
      active="users"
      title="Usuários"
      description="Cadastre nome, e-mail e foto de quem trabalha com você e gerencie o acesso à conta."
      actions={<div className="flex gap-2"><GuardedButton variant="secondary" onClick={() => setInviteOpen(true)} allowed={canManage} blockedReason={RBAC_COPY.manageTenant}>Convidar por e-mail</GuardedButton><GuardedButton onClick={() => setProfileEditor("new")} allowed={canManage} blockedReason={RBAC_COPY.manageTenant}>Cadastrar usuário</GuardedButton></div>}
    >
      {error ? <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <Card className="mb-4">
        <CardHeader><p className="text-sm font-semibold text-foreground">Membros</p></CardHeader>
        <CardBody>
          {membersLoading ? <div className="flex justify-center py-10"><Spinner /></div> : null}
          {membersError ? <ErrorState error={membersError} onRetry={() => mutateMembers()} /> : null}
          {!membersLoading && !membersError && members ? (
            members.length === 0 ? (
              <EmptyState title="Nenhum membro ainda" description="Convide o primeiro usuário para este workspace." />
            ) : (
              <Table>
                <TableHeader>
                    <TableRow>
                      <TableHead>Usuário</TableHead>
                      <TableHead>Perfil</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => {
                    const fallback = memberIdentity(member.userId, inboxMembers?.members);
                    const identity = { name: member.name ?? fallback.name, email: member.email ?? fallback.email, avatarUrl: member.avatarUrl };
                    return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <PersonAvatar nome={identity.name} avatarUrl={identity.avatarUrl} className="h-9 w-9" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{identity.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{identity.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm text-foreground">{ROLE_LABEL[member.role]}</span>
                          {member.isAccountOwner ? <Badge variant="outline">Principal</Badge> : null}
                          {member.customizedPermissions ? <Badge variant="secondary" title="Permissões ajustadas sobre o padrão do perfil">Personalizado</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell>{member.status === "disabled" ? <Badge variant="outline">Desativado</Badge> : <Badge variant="default">Ativo</Badge>}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" onClick={() => setAccessEditor({ userId: member.userId, name: identity.name })} disabled={busy}>Acesso</Button>
                        <GuardedButton variant="ghost" onClick={() => setProfileEditor({ ...member, ...identity })} allowed={canManage} blockedReason={RBAC_COPY.manageTenant} disabled={busy}>Editar</GuardedButton>
                        {member.userId !== currentUserId && !member.isAccountOwner ? (
                          <>
                            <GuardedButton variant="ghost" onClick={() => void handleStatus(member.userId, member.status === "disabled" ? "active" : "disabled")} allowed={canManage} blockedReason={RBAC_COPY.manageTenant} disabled={busy}>
                              {member.status === "disabled" ? "Reativar" : "Desativar"}
                            </GuardedButton>
                            <GuardedButton variant="ghost" onClick={() => setPendingRemoval(member.userId)} allowed={canManage} blockedReason={RBAC_COPY.manageTenant} disabled={busy}>Remover</GuardedButton>
                          </>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );})}
                </TableBody>
              </Table>
            )
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><p className="text-sm font-semibold text-foreground">Convites pendentes</p></CardHeader>
        <CardBody>
          {invitesLoading ? <div className="flex justify-center py-10"><Spinner /></div> : null}
          {invitesError ? <ErrorState error={invitesError} onRetry={() => mutateInvites()} /> : null}
          {!invitesLoading && !invitesError && invites ? (
            invites.length === 0 ? (
              <EmptyState title="Nenhum convite enviado" description="Convites enviados aparecem aqui até serem aceitos, revogados ou expirarem." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((invite) => (
                    <TableRow key={invite.id}>
                      <TableCell>{invite.email}</TableCell>
                      <TableCell className="text-muted-foreground">{ROLE_LABEL[invite.role]}</TableCell>
                      <TableCell>
                        <Badge variant={invite.status === "pending" ? "secondary" : invite.status === "accepted" ? "default" : "outline"}>
                          {invite.status === "pending" ? "Pendente" : invite.status === "accepted" ? "Aceito" : invite.status === "revoked" ? "Revogado" : "Expirado"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {invite.status === "pending" ? <GuardedButton variant="ghost" onClick={() => handleRevokeInvite(invite)} allowed={canManage} blockedReason={RBAC_COPY.manageTenant} disabled={busy}>Revogar</GuardedButton> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : null}
        </CardBody>
      </Card>

      {profileEditor && canManage ? <UserProfileModal member={profileEditor === "new" ? undefined : profileEditor} onClose={() => setProfileEditor(undefined)} onSaved={async () => {
        await mutateMembers();
        await mutateCache((key) => Array.isArray(key) && key[0] === "inbox-members");
      }} /> : null}

      {accessEditor ? (
        <UserAccessModal
          userId={accessEditor.userId}
          name={accessEditor.name}
          workspaceId={workspace.id}
          isSelf={accessEditor.userId === currentUserId || !canManageAccess}
          actorIsOwner={actorIsOwner}
          onClose={() => setAccessEditor(undefined)}
          onSaved={async () => { await mutateMembers(); }}
        />
      ) : null}

      {inviteOpen ? (
        <Modal title="Convidar usuário" onClose={() => setInviteOpen(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="invite-email">E-mail</Label>
              <Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="pessoa@empresa.com" />
            </div>
            <div>
              <Label htmlFor="invite-role">Perfil</Label>
              <Select value={role} onValueChange={(value) => setRole(value as TenantRole)}>
                <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INVITE_ROLES.filter((r) => r !== "owner" || actorIsOwner).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setInviteOpen(false)} disabled={busy}>Cancelar</Button>
              <Button onClick={handleInvite} loading={busy} disabled={!email.trim() || busy}>Enviar convite</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingRemoval)}
        title="Remover usuário"
        description="Este usuário perde acesso a esta empresa imediatamente. Para só suspender o acesso mantendo tudo configurado, use Desativar."
        confirmLabel="Remover"
        variant="danger"
        busy={busy}
        onConfirm={() => { if (pendingRemoval) return handleRemove(pendingRemoval); }}
        onCancel={() => setPendingRemoval(undefined)}
      />
    </SettingsShell>
  );
}

function memberIdentity(userId: string, members: readonly { userId: string; name: string; email: string }[] | undefined) {
  const member = members?.find((item) => item.userId === userId);
  return member ? { name: member.name, email: member.email } : { name: "Membro do tenant", email: "E-mail indisponível nesta API" };
}
