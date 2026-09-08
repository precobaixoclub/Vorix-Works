"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inviteTenantMember, removeTenantMember, revokeTenantInvite, updateTenantMemberRole } from "@/features/identity/api";
import { useTenantInvites, useTenantMembers } from "@/features/identity/hooks";
import type { TenantMemberInvite, TenantRole } from "@/features/identity/types";

const ROLE_LABEL: Record<TenantRole, string> = { owner: "Administrador", admin: "Gestor", editor: "Editor", viewer: "Visualizador" };
const ROLES: TenantRole[] = ["owner", "admin", "editor", "viewer"];

export default function UsersPage() {
  const { data: members, error: membersError, isLoading: membersLoading, mutate: mutateMembers } = useTenantMembers();
  const { data: invites, error: invitesError, isLoading: invitesLoading, mutate: mutateInvites } = useTenantInvites();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pendingRemoval, setPendingRemoval] = useState<string | undefined>();

  async function handleInvite() {
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
    await updateTenantMemberRole(userId, nextRole);
    await mutateMembers();
  }

  async function handleRemove(userId: string) {
    await removeTenantMember(userId);
    setPendingRemoval(undefined);
    await mutateMembers();
  }

  async function handleRevokeInvite(invite: TenantMemberInvite) {
    await revokeTenantInvite(invite.id);
    await mutateInvites();
  }

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Usuários"
        description="Convide, gerencie papéis e remova acesso de quem trabalha neste workspace."
        actions={<Button onClick={() => setInviteOpen(true)}>Convidar usuário</Button>}
      />

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
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{member.userId}</TableCell>
                      <TableCell>
                        <Select value={member.role} onValueChange={(value) => handleRoleChange(member.userId, value as TenantRole)}>
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" onClick={() => setPendingRemoval(member.userId)}>Remover</Button>
                      </TableCell>
                    </TableRow>
                  ))}
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
                        {invite.status === "pending" ? <Button variant="ghost" onClick={() => handleRevokeInvite(invite)}>Revogar</Button> : null}
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
            {error ? <p className="text-sm text-danger">{error}</p> : null}
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
        onConfirm={() => { if (pendingRemoval) return handleRemove(pendingRemoval); }}
        onCancel={() => setPendingRemoval(undefined)}
      />
    </main>
  );
}
