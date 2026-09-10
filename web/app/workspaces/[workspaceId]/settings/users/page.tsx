"use client";

import { useState } from "react";
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
import { inviteTenantMember, removeTenantMember, revokeTenantInvite, updateTenantMemberRole } from "@/features/identity/api";
import { useTenantInvites, useTenantMembers } from "@/features/identity/hooks";
import type { TenantMemberInvite, TenantRole } from "@/features/identity/types";
import { useInboxMembers } from "@/features/inbox/hooks";
import { canManageTenant, RBAC_COPY } from "@/lib/rbac";

const ROLE_LABEL: Record<TenantRole, string> = { owner: "Administrador", admin: "Gestor", editor: "Editor", viewer: "Visualizador" };
const ROLES: TenantRole[] = ["owner", "admin", "editor", "viewer"];

export default function UsersPage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const canManage = canManageTenant(state.status === "authenticated" ? state.role : undefined);
  const { data: members, error: membersError, isLoading: membersLoading, mutate: mutateMembers } = useTenantMembers();
  const { data: invites, error: invitesError, isLoading: invitesLoading, mutate: mutateInvites } = useTenantInvites();
  const { data: inboxMembers } = useInboxMembers(workspace.id);
  const [inviteOpen, setInviteOpen] = useState(false);
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

  async function handleRoleChange(userId: string, nextRole: TenantRole) {
    if (!canManage) return;
    setBusy(true);
    setError(undefined);
    try {
      await updateTenantMemberRole(userId, nextRole);
      await mutateMembers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o papel.");
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
      description="Convide, gerencie papéis e remova acesso de quem trabalha neste workspace."
      actions={<GuardedButton onClick={() => setInviteOpen(true)} allowed={canManage} blockedReason={RBAC_COPY.manageTenant}>Convidar usuário</GuardedButton>}
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
                      <TableHead>Papel</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => {
                    const identity = memberIdentity(member.userId, inboxMembers?.members);
                    return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <PersonAvatar nome={identity.name} className="h-9 w-9" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{identity.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{identity.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select value={member.role} onValueChange={(value) => handleRoleChange(member.userId, value as TenantRole)} disabled={!canManage || busy}>
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Badge variant="default">Ativo</Badge></TableCell>
                      <TableCell className="text-right">
                        <GuardedButton variant="ghost" onClick={() => setPendingRemoval(member.userId)} allowed={canManage} blockedReason={RBAC_COPY.manageTenant} disabled={busy}>Remover</GuardedButton>
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

      {inviteOpen ? (
        <Modal title="Convidar usuário" onClose={() => setInviteOpen(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="invite-email">E-mail</Label>
              <Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="pessoa@empresa.com" />
            </div>
            <div>
              <Label htmlFor="invite-role">Papel</Label>
              <Select value={role} onValueChange={(value) => setRole(value as TenantRole)}>
                <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
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
        description="Este usuário perde acesso a este tenant imediatamente. Essa ação pode ser desfeita convidando-o novamente."
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
