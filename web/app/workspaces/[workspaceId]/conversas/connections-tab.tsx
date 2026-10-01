"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { GuardedButton } from "@/components/GuardedButton";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api-client";
import { createInboxConnection, deleteInboxConnection, disconnectInboxConnection, getInboxConnectionQrCode, refreshInboxConnectionStatus, updateChannelRouting } from "@/features/inbox/api";
import { useChannelRouting, useInboxConnections } from "@/features/inbox/hooks";
import { useTeams } from "@/features/identity/hooks";
import type { ChannelDistributionMode, MessagingConnection } from "@/features/inbox/types";
import { canManageTenant, canOperateWorkspace, RBAC_COPY } from "@/lib/rbac";

export function ConnectionsTab({ workspaceId }: { workspaceId: string }) {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.role : undefined;
  const canOperate = canOperateWorkspace(role);
  // Achado real do usuário ("não tá sendo possível excluir o canal"): o botão usava `canOperate`
  // (inclui "editor"), mas o backend exige `inbox:delete_connections` — degrau restrito a
  // owner/admin (mesmo tier de `inbox:delete_conversations`, ver `canDelete` em `inbox-tab.tsx`).
  // Um editor via o botão habilitado e a exclusão sempre falhava com 403.
  const canDelete = canManageTenant(role);
  const { data, isLoading, error, mutate } = useInboxConnections(workspaceId);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [creating, setCreating] = useState(false);
  const [qrByConnectionId, setQrByConnectionId] = useState<Record<string, string>>({});
  const [pendingDisconnect, setPendingDisconnect] = useState<MessagingConnection | undefined>();
  const [pendingDelete, setPendingDelete] = useState<MessagingConnection | undefined>();
  // Segunda confirmação (pedido explícito do usuário: "adicionar uma segunda confirmação... e o
  // impacto que vai ter") — etapa 1 explica o impacto, etapa 2 exige digitar o nome exato do canal
  // antes de liberar o botão final, mesmo padrão usado por ações irreversíveis de alto risco.
  const [deleteStage, setDeleteStage] = useState<"impact" | "final">("impact");
  const [deleteNameInput, setDeleteNameInput] = useState("");
  const [busyConnectionId, setBusyConnectionId] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();

  function resetDeleteFlow() {
    setPendingDelete(undefined);
    setDeleteStage("impact");
    setDeleteNameInput("");
  }

  async function handleCreateConnection() {
    if (!canOperate) return;
    const displayName = newDisplayName.trim();
    if (!displayName) return;
    setCreating(true);
    setActionError(undefined);
    try {
      await createInboxConnection(workspaceId, displayName);
      setNewDisplayName("");
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível criar o canal.");
    } finally {
      setCreating(false);
    }
  }

  async function handleShowQrCode(connectionId: string) {
    if (!canOperate) return;
    setBusyConnectionId(connectionId);
    setActionError(undefined);
    try {
      const { qrCode } = await getInboxConnectionQrCode(workspaceId, connectionId);
      setQrByConnectionId((prev) => ({ ...prev, [connectionId]: qrCode }));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível carregar o QR Code.");
    } finally {
      setBusyConnectionId(undefined);
    }
  }

  async function handleRefreshStatus(connectionId: string) {
    if (!canOperate) return;
    setBusyConnectionId(connectionId);
    setActionError(undefined);
    try {
      await refreshInboxConnectionStatus(workspaceId, connectionId);
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível atualizar o status.");
    } finally {
      setBusyConnectionId(undefined);
    }
  }

  async function handleDisconnect(connection: MessagingConnection) {
    if (!canOperate) return;
    setBusyConnectionId(connection.id);
    setActionError(undefined);
    try {
      await disconnectInboxConnection(workspaceId, connection.id);
      setPendingDisconnect(undefined);
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível desconectar o canal.");
    } finally {
      setBusyConnectionId(undefined);
    }
  }

  // Bloco "excluir canal" (pedido explícito do usuário: "excluir automaticamente todas as
  // conversas e contatos relacionados a esse número... se excluir o canal limpa a base do canal
  // excluído") — permanente, nunca reaproveita `handleDisconnect` (são ações completamente
  // diferentes: desconectar preserva tudo, excluir apaga a base do canal).
  async function handleDeleteConnection(connection: MessagingConnection) {
    if (!canDelete) return;
    setBusyConnectionId(connection.id);
    setActionError(undefined);
    try {
      await deleteInboxConnection(workspaceId, connection.id);
      resetDeleteFlow();
      await mutate();
    } catch (cause) {
      // Achado real do usuário: a lista pode ficar com um canal "fantasma" (já excluído em outra
      // aba/sessão, ou por um clique duplo anterior) — o backend responde "não existe", mas o
      // resultado final é exatamente o que o usuário queria (canal sumido). Trata como sucesso em
      // vez de mostrar um erro confuso sobre algo que já foi resolvido.
      if (cause instanceof ApiError && cause.code === "INBOX_CONNECTION_NOT_FOUND") {
        resetDeleteFlow();
        await mutate();
        return;
      }
      setActionError(cause instanceof Error ? cause.message : "Não foi possível excluir o canal.");
    } finally {
      setBusyConnectionId(undefined);
    }
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
        <CardHeader><CardTitle className="text-base">Novo canal de atendimento</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={newDisplayName}
            onChange={(event) => setNewDisplayName(event.target.value)}
            placeholder="Ex.: WhatsApp Comercial"
            className="sm:max-w-sm"
            disabled={!canOperate || creating}
          />
          <GuardedButton onClick={handleCreateConnection} disabled={creating || !newDisplayName.trim()} loading={creating} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
            Criar canal
          </GuardedButton>
        </CardContent>
      </Card>

      {actionError ? <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}

      {connections.length === 0 ? (
        <EmptyState
          title="Nenhum canal de WhatsApp"
          description="Crie um canal acima e escaneie o QR Code pelo WhatsApp do número que vai atender pelo Vorix."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              workspaceId={workspaceId}
              connection={connection}
              qrCode={qrByConnectionId[connection.id]}
              canOperate={canOperate}
              busy={busyConnectionId === connection.id}
              onShowQrCode={() => handleShowQrCode(connection.id)}
              onRefreshStatus={() => handleRefreshStatus(connection.id)}
              onDisconnect={() => setPendingDisconnect(connection)}
              canDelete={canDelete}
              onDelete={() => { setPendingDelete(connection); setDeleteStage("impact"); setDeleteNameInput(""); }}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDisconnect)}
        title="Desconectar canal?"
        description={`O canal "${pendingDisconnect?.displayName ?? "selecionado"}" para de receber e enviar mensagens ate ser pareado novamente.`}
        confirmLabel="Desconectar"
        variant="danger"
        busy={Boolean(busyConnectionId)}
        onCancel={() => setPendingDisconnect(undefined)}
        onConfirm={() => { if (pendingDisconnect) return handleDisconnect(pendingDisconnect); }}
      />

      {/* Etapa 1/2 — explica o impacto completo antes de qualquer coisa acontecer de verdade.
         "Continuar" só avança pra etapa 2, nunca exclui. */}
      <ConfirmDialog
        open={Boolean(pendingDelete) && deleteStage === "impact"}
        title="Excluir canal?"
        description={`Isso apaga PERMANENTEMENTE o canal "${pendingDelete?.displayName ?? "selecionado"}" e todas as conversas e mensagens que existem só por causa dele. Contatos que também conversam por outro canal deste workspace são preservados; os demais são apagados junto. Essa ação não pode ser desfeita.`}
        confirmLabel="Continuar"
        variant="danger"
        onCancel={resetDeleteFlow}
        onConfirm={() => setDeleteStage("final")}
      />

      {/* Etapa 2/2 — confirmação final: só libera o botão quando o nome digitado bate exatamente
         com o do canal (mesmo padrão de ações destrutivas de alto risco), reforçando que não tem
         volta. */}
      <ConfirmDialog
        open={Boolean(pendingDelete) && deleteStage === "final"}
        title="Confirme a exclusão definitiva"
        description={`Para confirmar, digite o nome exato do canal: "${pendingDelete?.displayName ?? ""}". Ao confirmar, TODAS as conversas e mensagens deste canal são apagadas agora, junto com os contatos que não conversam por nenhum outro canal deste workspace. Não existe desfazer.`}
        confirmLabel="Excluir canal definitivamente"
        confirmDisabled={deleteNameInput.trim() !== (pendingDelete?.displayName ?? "")}
        variant="danger"
        busy={Boolean(busyConnectionId)}
        onCancel={resetDeleteFlow}
        onConfirm={() => { if (pendingDelete) return handleDeleteConnection(pendingDelete); }}
      >
        <Input
          autoFocus
          value={deleteNameInput}
          onChange={(event) => setDeleteNameInput(event.target.value)}
          placeholder={pendingDelete?.displayName ?? ""}
          disabled={Boolean(busyConnectionId)}
        />
      </ConfirmDialog>
    </div>
  );
}

function ConnectionRow({
  workspaceId,
  connection,
  qrCode,
  canOperate,
  canDelete,
  busy,
  onShowQrCode,
  onRefreshStatus,
  onDisconnect,
  onDelete,
}: {
  workspaceId: string;
  connection: MessagingConnection;
  qrCode: string | undefined;
  canOperate: boolean;
  /** Degrau de permissão PRÓPRIO (owner/admin, `inbox:delete_connections`) — mais restrito que
   * `canOperate`. Achado real: usar `canOperate` aqui deixava o botão "habilitado" pra um editor,
   * que então sempre tomava 403 do backend ao tentar excluir. */
  canDelete: boolean;
  busy: boolean;
  onShowQrCode: () => void;
  onRefreshStatus: () => void;
  onDisconnect: () => void;
  onDelete: () => void;
}) {
  // "requires_repair"/"logged_out"/"error"/"disconnected" são estados terminais por design (nunca
  // reconectam sozinhos, ver docs/conversas-runbook.md seção 2) — precisam do mesmo pareamento
  // manual via QR que "connecting". Mesmo agrupamento já usado em
  // app/workspaces/[workspaceId]/onboarding/page.tsx (`needsRepair`); aqui faltava "logged_out",
  // "error" e "disconnected" — deixando um canal deslogado/desconectado sem nenhum caminho de
  // volta na UI (achado real do usuário: clicou em "Desconectar" e o botão continuou vermelho
  // como se ainda estivesse conectado, sem nenhum "Conectar" pra voltar).
  const isDisconnectedState =
    connection.status === "disconnected" ||
    connection.status === "requires_repair" ||
    connection.status === "logged_out" ||
    connection.status === "error";
  const needsQrCode = connection.status === "connecting" || isDisconnectedState;
  // Achado real do usuário: um canal RECÉM-CRIADO nasce em "connecting" (aguardando o primeiro QR
  // ser escaneado, nunca esteve pareado) — mas "Desconectar" aparecia do mesmo jeito, como se já
  // houvesse algo pra desconectar, obrigando a desconectar/reconectar só pra conseguir o QR.
  // "Desconectar" só faz sentido quando existe uma sessão de verdade (pareada uma vez, mesmo que
  // agora tentando se recuperar) — nunca no primeiro pareamento.
  const canDisconnectNow = connection.status === "connected" || connection.status === "reconnecting";
  const [routingOpen, setRoutingOpen] = useState(false);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{connection.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{connection.phoneNumber ?? "Número ainda não pareado"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={connection.status} />
            <GuardedButton variant="secondary" onClick={onRefreshStatus} loading={busy} disabled={busy} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
              Atualizar status
            </GuardedButton>
            {needsQrCode ? (
              // Rótulo distingue "ainda pareando pela primeira vez" (mostrar o QR que já está no
              // ar) de "precisa conectar de novo" (canal desconectado/deslogado) — mesmo botão,
              // mesma ação (`onShowQrCode`), só o texto muda pra nunca parecer que dá pra
              // desconectar algo que já está desconectado.
              <GuardedButton variant={isDisconnectedState ? "primary" : "secondary"} onClick={onShowQrCode} loading={busy} disabled={busy} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
                {isDisconnectedState ? "Conectar" : "Mostrar QR Code"}
              </GuardedButton>
            ) : null}
            <Button variant="secondary" onClick={() => setRoutingOpen((value) => !value)}>
              <Users className="h-3.5 w-3.5" />
              Roteamento
              {routingOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
            {/* Achado real do usuário: "Desconectar" continuava vermelho/clicável depois de já ter
               desconectado, como se fosse possível desconectar de novo — e também aparecia num
               canal RECÉM-CRIADO ("connecting", nunca pareado), fazendo o usuário ter que
               desconectar/reconectar só pra conseguir o primeiro QR. Só faz sentido quando existe
               uma sessão de verdade (pareada uma vez, mesmo tentando se recuperar agora). */}
            {canDisconnectNow ? (
              <GuardedButton variant="danger" onClick={onDisconnect} disabled={busy} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
                Desconectar
              </GuardedButton>
            ) : null}
            <GuardedButton variant="danger" onClick={onDelete} disabled={busy} allowed={canDelete} blockedReason={RBAC_COPY.deleteConnections}>
              Excluir canal
            </GuardedButton>
          </div>
        </div>
        {routingOpen ? <ChannelRoutingPanel workspaceId={workspaceId} connectionId={connection.id} canOperate={canOperate} /> : null}
        {connection.status === "disconnected" ? (
          <p className="text-sm text-muted-foreground">Canal desconectado. Clique em "Conectar" e escaneie um novo QR Code para voltar a receber mensagens.</p>
        ) : connection.status === "requires_repair" || connection.status === "logged_out" || connection.status === "error" ? (
          <p className="text-sm text-danger">WhatsApp precisa ser conectado novamente. Escaneie um novo QR Code.</p>
        ) : null}
        {qrCode ? <QrPreview value={qrCode} /> : null}
      </CardContent>
    </Card>
  );
}

/** Bloco "roteamento por equipe" (réplica adaptada do CMDesk, pedido explícito do usuário) —
 * versão simplificada: equipes vinculadas ao canal + equipe padrão + distribuição fixa vs rodízio
 * entre elas. Sem menu hierárquico/sticky-pinned (fora de escopo desta rodada). */
function ChannelRoutingPanel({ workspaceId, connectionId, canOperate }: { workspaceId: string; connectionId: string; canOperate: boolean }) {
  const { data: teams } = useTeams(workspaceId);
  const { data: routing, error, isLoading, mutate } = useChannelRouting(workspaceId, connectionId);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [defaultTeamId, setDefaultTeamId] = useState<string>("");
  const [distributionMode, setDistributionMode] = useState<ChannelDistributionMode>("default");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  // Sincroniza o estado local com o que veio do backend só quando os dados chegam/mudam — depois
  // disso, o usuário controla livremente (nunca sobrescreve uma edição em andamento com um
  // refetch do SWR).
  useEffect(() => {
    if (!routing) return;
    setSelectedTeamIds(routing.teamIds);
    setDefaultTeamId(routing.config?.defaultTeamId ?? routing.teamIds[0] ?? "");
    setDistributionMode(routing.config?.distributionMode ?? "default");
  }, [routing]);

  function toggleTeam(teamId: string, checked: boolean) {
    setSelectedTeamIds((current) => {
      const next = checked ? [...current, teamId] : current.filter((id) => id !== teamId);
      // Equipe padrão nunca pode ficar fora da lista vinculada — se foi removida, cai pra
      // primeira que sobrou (mesma trava que o backend reforça de novo no save).
      if (!next.includes(defaultTeamId)) setDefaultTeamId(next[0] ?? "");
      return next;
    });
  }

  async function handleSave() {
    if (!canOperate || !defaultTeamId) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await updateChannelRouting(workspaceId, connectionId, { teamIds: selectedTeamIds, defaultTeamId, distributionMode });
      await mutate();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Não foi possível salvar o roteamento.");
    } finally {
      setSaving(false);
    }
  }

  const linkedTeams = (teams ?? []).filter((team) => selectedTeamIds.includes(team.id));

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
      {isLoading ? (
        <div className="flex justify-center py-4"><Spinner className="h-4 w-4" /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : (
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Equipes vinculadas</p>
            {(teams ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma equipe cadastrada — crie equipes em Configurações → Equipes.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {(teams ?? []).map((team) => (
                  <label key={team.id} className="flex items-center gap-1.5 text-xs text-foreground">
                    <Checkbox checked={selectedTeamIds.includes(team.id)} onCheckedChange={(checked) => toggleTeam(team.id, checked === true)} disabled={!canOperate || saving} />
                    {team.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          {linkedTeams.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Equipe padrão</p>
                <Select value={defaultTeamId} onValueChange={setDefaultTeamId} disabled={!canOperate || saving}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Escolha a equipe padrão" /></SelectTrigger>
                  <SelectContent>{linkedTeams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Distribuição</p>
                <Select value={distributionMode} onValueChange={(value) => setDistributionMode(value as ChannelDistributionMode)} disabled={!canOperate || saving || linkedTeams.length < 2}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Sempre a equipe padrão</SelectItem>
                    <SelectItem value="round_robin">Rodízio entre as equipes vinculadas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {saveError ? <p className="text-xs text-destructive">{saveError}</p> : null}
          <div className="flex justify-end">
            <GuardedButton onClick={handleSave} loading={saving} disabled={saving || !defaultTeamId} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
              Salvar roteamento
            </GuardedButton>
          </div>
        </div>
      )}
    </div>
  );
}

// Achado real em produção: o QR chega como data URI de imagem (`data:image/png;base64,...`), não
// como texto pra copiar — renderizar como `<span>{qrCode}</span>` mostrava só o base64 bruto,
// impossível de escanear. Mesmo padrão já usado em
// app/workspaces/[workspaceId]/onboarding/page.tsx (`QrPreview`).
function QrPreview({ value }: { value: string }) {
  const looksLikeImage = value.startsWith("data:image") || value.startsWith("http://") || value.startsWith("https://");
  return (
    <div className="rounded-xl border border-border bg-background p-4 text-center">
      {looksLikeImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="QR Code para conectar WhatsApp" className="mx-auto h-56 w-56 rounded-lg bg-white object-contain p-2" />
      ) : (
        <div className="mx-auto flex min-h-40 max-w-sm items-center justify-center rounded-lg border border-dashed border-border bg-muted/35 px-4 py-6 text-sm text-muted-foreground">
          Código de pareamento recebido. Copie pelo fluxo do WhatsApp quando solicitado.
        </div>
      )}
    </div>
  );
}
