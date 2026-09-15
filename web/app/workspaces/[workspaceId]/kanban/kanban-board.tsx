"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Clock, GripVertical, Pin, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { GuardedButton } from "@/components/GuardedButton";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/Spinner";
import { useAuth } from "@/contexts/auth-context";
import { canManageTenant, canOperateWorkspace, RBAC_COPY } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import {
  createKanbanPhase,
  deleteKanbanPhase,
  ensureKanbanConversationPhaseStates,
  listInboxConversations,
  moveConversationPhase,
  reorderKanbanPhases,
  updateKanbanPhase,
} from "@/features/inbox/api";
import { useConversationsServiceTime, useInboxMembers, useInboxRealtime, useKanbanPhases } from "@/features/inbox/hooks";
import type { InboxConversation, InboxTenantMember, KanbanPhaseType, TeamKanbanPhase } from "@/features/inbox/types";
import type { Team } from "@/features/identity/types";
import { ConversationListItem } from "../conversas/inbox-tab";

const BOARD_STATUSES = new Set(["open", "pending"]);

/**
 * Board Kanban de UMA equipe — quadro estilo Trello (réplica adaptada do CMDesk, pedido explícito
 * do usuário). Nunca lista conversas resolvidas/arquivadas (`BOARD_STATUSES`) — o board é só
 * atendimento em curso. O card é o MESMO `ConversationListItem` da caixa de entrada (nunca um card
 * próprio), só ganhando `phaseOptions`/`onMoveToPhase` — caminho sem drag para mobile/touch.
 */
export function KanbanBoard({ workspaceId, teamId, teams }: { workspaceId: string; teamId: string; teams: readonly Team[] }) {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.role : undefined;
  const currentUserId = state.status === "authenticated" ? state.user.id : undefined;
  const canOperate = canOperateWorkspace(role);
  const canManage = canManageTenant(role);

  const { data: phasesData, error: phasesError, isLoading: phasesLoading, mutate: mutatePhases } = useKanbanPhases(workspaceId, teamId);
  const {
    data: conversationsData,
    error: conversationsError,
    isLoading: conversationsLoading,
    mutate: mutateConversations,
  } = useSWR(["kanban-conversations", workspaceId], () => listInboxConversations(workspaceId, "all"), { refreshInterval: 30_000 });
  const { data: membersData } = useInboxMembers(workspaceId);

  useInboxRealtime(workspaceId, undefined);

  const phases = useMemo(() => [...(phasesData?.phases ?? [])].sort((a, b) => a.orderIndex - b.orderIndex), [phasesData]);

  const teamConversations = useMemo(
    () => (conversationsData?.conversations ?? []).filter((conversation) => conversation.currentTeamId === teamId && BOARD_STATUSES.has(conversation.status)),
    [conversationsData, teamId],
  );

  const conversationIds = useMemo(() => teamConversations.map((conversation) => conversation.id), [teamConversations]);
  const conversationIdsKey = conversationIds.join(",");

  // Conversas recém-roteadas pra equipe (ou de antes desta funcionalidade) ainda não têm
  // `currentPhaseId` — chamada idempotente, sempre antes de desenhar as colunas de verdade.
  const ensuredKeyRef = useRef<string>("");
  const [ensuring, setEnsuring] = useState(false);
  useEffect(() => {
    const pending = teamConversations.filter((conversation) => !conversation.currentPhaseId);
    if (pending.length === 0 || phases.length === 0) return;
    const key = pending.map((conversation) => conversation.id).join(",");
    if (ensuredKeyRef.current === key) return;
    ensuredKeyRef.current = key;
    setEnsuring(true);
    ensureKanbanConversationPhaseStates(workspaceId, teamId, pending.map((conversation) => conversation.id))
      .then(() => mutateConversations())
      .catch(() => {
        // Best-effort — se falhar, a próxima revalidação (polling/SSE) tenta de novo; o board
        // continua utilizável mostrando essas conversas na coluna de fallback (ver `phaseKeyFor`).
      })
      .finally(() => setEnsuring(false));
  }, [teamConversations, phases.length, workspaceId, teamId, mutateConversations]);

  const { data: serviceTimeData, mutate: mutateServiceTime } = useConversationsServiceTime(workspaceId, teamId, conversationIds);
  const serviceTimeByConversation = useMemo(() => {
    const map = new Map<string, { totalSeconds: number; currentPhaseStartedAt?: string; isRunning: boolean }>();
    for (const entry of serviceTimeData?.serviceTime ?? []) map.set(entry.conversationId, entry);
    return map;
  }, [serviceTimeData]);

  const membersList = membersData?.members ?? [];

  const firstPhaseId = phases.find((phase) => phase.isDefaultFirst)?.id ?? phases[0]?.id;
  function phaseKeyFor(conversation: InboxConversation): string {
    if (conversation.currentPhaseId && phases.some((phase) => phase.id === conversation.currentPhaseId)) return conversation.currentPhaseId;
    return firstPhaseId ?? "";
  }

  const conversationsByPhase = useMemo(() => {
    const map = new Map<string, InboxConversation[]>();
    for (const phase of phases) map.set(phase.id, []);
    for (const conversation of teamConversations) {
      const key = phaseKeyFor(conversation);
      if (!key) continue;
      const bucket = map.get(key);
      if (bucket) bucket.push(conversation);
      else map.set(key, [conversation]);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamConversations, phases]);

  const [phaseManagerOpen, setPhaseManagerOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function handleMoveToPhase(conversationId: string, phaseId: string) {
    if (!canOperate) return;
    const previous = conversationsData;
    // Otimista: a UI reflete a troca antes da resposta do servidor confirmar — reconciliado pela
    // revalidação (`mutateConversations()`) logo em seguida, ou revertido se a chamada falhar.
    void mutateConversations(
      (current) =>
        current
          ? { conversations: current.conversations.map((c) => (c.id === conversationId ? { ...c, currentPhaseId: phaseId } : c)) }
          : current,
      { revalidate: false },
    );
    try {
      await moveConversationPhase(workspaceId, teamId, conversationId, phaseId);
    } catch {
      void mutateConversations(previous, { revalidate: false });
    } finally {
      void mutateConversations();
      void mutateServiceTime();
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const conversationId = String(event.active.id);
    const overPhaseId = event.over?.id ? String(event.over.id) : undefined;
    if (!overPhaseId) return;
    const conversation = teamConversations.find((c) => c.id === conversationId);
    if (!conversation || phaseKeyFor(conversation) === overPhaseId) return;
    void handleMoveToPhase(conversationId, overPhaseId);
  }

  if (phasesLoading || conversationsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  if (phasesError) return <ErrorState error={phasesError} onRetry={() => mutatePhases()} />;
  if (conversationsError) return <ErrorState error={conversationsError} onRetry={() => mutateConversations()} />;

  if (phases.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden="true">🗂️</span>}
        title="Sem fases configuradas"
        description="Esta equipe ainda não tem fases no quadro. Configure as colunas para começar."
        action={
          <GuardedButton allowed={canManage} blockedReason={RBAC_COPY.manageTenant} onClick={() => setPhaseManagerOpen(true)}>
            Configurar fases
          </GuardedButton>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {teamConversations.length} conversa{teamConversations.length === 1 ? "" : "s"} em atendimento{ensuring ? " · organizando fases..." : ""}
        </p>
        <GuardedButton
          allowed={canManage}
          blockedReason={RBAC_COPY.manageTenant}
          variant="secondary"
          size="sm"
          onClick={() => setPhaseManagerOpen(true)}
        >
          <Settings2 className="h-4 w-4" /> Fases
        </GuardedButton>
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {phases.map((phase) => (
            <KanbanColumn
              key={phase.id}
              workspaceId={workspaceId}
              phase={phase}
              phases={phases}
              conversations={conversationsByPhase.get(phase.id) ?? []}
              members={membersList}
              teams={teams}
              currentUserId={currentUserId}
              canOperate={canOperate}
              serviceTimeByConversation={serviceTimeByConversation}
              onMoveToPhase={handleMoveToPhase}
              onConversationChanged={() => mutateConversations()}
            />
          ))}
        </div>
      </DndContext>

      {phaseManagerOpen ? (
        <PhaseManagerModal
          workspaceId={workspaceId}
          teamId={teamId}
          phases={phases}
          onClose={() => setPhaseManagerOpen(false)}
          onChanged={() => mutatePhases()}
        />
      ) : null}
    </div>
  );
}

function KanbanColumn({
  workspaceId,
  phase,
  phases,
  conversations,
  members,
  teams,
  currentUserId,
  canOperate,
  serviceTimeByConversation,
  onMoveToPhase,
  onConversationChanged,
}: {
  workspaceId: string;
  phase: TeamKanbanPhase;
  phases: readonly TeamKanbanPhase[];
  conversations: readonly InboxConversation[];
  members: readonly InboxTenantMember[];
  teams: readonly Team[];
  currentUserId: string | undefined;
  canOperate: boolean;
  serviceTimeByConversation: Map<string, { totalSeconds: number; currentPhaseStartedAt?: string; isRunning: boolean }>;
  onMoveToPhase: (conversationId: string, phaseId: string) => void;
  onConversationChanged: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: phase.id });
  const otherPhases = phases.filter((p) => p.id !== phase.id);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full w-72 shrink-0 flex-col rounded-xl border border-border bg-surface-sunken/60 transition-colors",
        isOver && "border-primary/60 bg-primary/5",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", phase.phaseType === "PAUSED" ? "bg-amber-500" : "bg-emerald-500")} />
          <p className="truncate text-sm font-semibold text-foreground">{phase.name}</p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">{conversations.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">Nenhuma conversa nesta fase.</p>
        ) : (
          conversations.map((conversation) => (
            <KanbanCard
              key={conversation.id}
              workspaceId={workspaceId}
              conversation={conversation}
              currentUserId={currentUserId}
              members={members}
              teams={teams}
              canOperate={canOperate}
              phaseOptions={otherPhases}
              serviceTime={serviceTimeByConversation.get(conversation.id)}
              onMoveToPhase={(phaseId) => onMoveToPhase(conversation.id, phaseId)}
              onConversationChanged={onConversationChanged}
            />
          ))
        )}
      </div>
    </div>
  );
}

function KanbanCard({
  workspaceId,
  conversation,
  currentUserId,
  members,
  teams,
  canOperate,
  phaseOptions,
  serviceTime,
  onMoveToPhase,
  onConversationChanged,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  currentUserId: string | undefined;
  members: readonly InboxTenantMember[];
  teams: readonly Team[];
  canOperate: boolean;
  phaseOptions: readonly TeamKanbanPhase[];
  serviceTime: { totalSeconds: number; currentPhaseStartedAt?: string; isRunning: boolean } | undefined;
  onMoveToPhase: (phaseId: string) => void;
  onConversationChanged: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: conversation.id, disabled: !canOperate });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("group/kanban-card relative border-b border-border/40 last:border-b-0", isDragging && "z-10 opacity-60")}
    >
      {canOperate ? (
        <button
          type="button"
          {...listeners}
          {...attributes}
          aria-label="Arrastar para outra fase"
          className="absolute left-0.5 top-1/2 z-10 flex h-6 w-4 -translate-y-1/2 cursor-grab items-center justify-center text-muted-foreground opacity-0 transition-opacity group-hover/kanban-card:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <div className={canOperate ? "pl-4" : undefined}>
        <ConversationListItem
          workspaceId={workspaceId}
          conversation={conversation}
          selected={false}
          currentUserId={currentUserId}
          members={members ?? []}
          teams={teams}
          onSelect={() => window.open(`/workspaces/${workspaceId}/conversas?conversationId=${conversation.id}`, "_blank")}
          onConversationChanged={onConversationChanged}
          phaseOptions={phaseOptions}
          onMoveToPhase={onMoveToPhase}
        />
      </div>
      {conversation.isPinned ? <Pin className="absolute right-2 top-2 h-3 w-3 text-primary" aria-label="Fixado" /> : null}
      {serviceTime ? <LiveServiceBadge serviceTime={serviceTime} /> : null}
    </div>
  );
}

/** Badge "cronômetro rodando" (seção 5.3 do guia) — o backend NUNCA é consultado a cada segundo;
 * só devolve `totalSeconds` (soma das entradas RUNNING já fechadas) + `isRunning`. Este componente
 * incrementa visualmente em memória enquanto `isRunning`, resincronizando sempre que `serviceTime`
 * mudar (nova resposta do polling de 60s) — nunca o contrário. */
function LiveServiceBadge({ serviceTime }: { serviceTime: { totalSeconds: number; currentPhaseStartedAt?: string; isRunning: boolean } }) {
  const [liveSeconds, setLiveSeconds] = useState(serviceTime.totalSeconds);

  useEffect(() => {
    setLiveSeconds(serviceTime.totalSeconds);
    if (!serviceTime.isRunning || !serviceTime.currentPhaseStartedAt) return;
    const startedAtMs = new Date(serviceTime.currentPhaseStartedAt).getTime();
    const tick = () => setLiveSeconds(serviceTime.totalSeconds + Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [serviceTime]);

  return (
    <div className="flex items-center gap-1 px-3 pb-2 text-[11px] tabular-nums text-muted-foreground">
      <Clock className={cn("h-3 w-3", serviceTime.isRunning && "text-emerald-600")} />
      {formatDuration(liveSeconds)}
    </div>
  );
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

const PHASE_TYPE_LABEL: Record<KanbanPhaseType, string> = { RUNNING: "Conta tempo de atendimento", PAUSED: "Não conta tempo (pausa)" };

/** Gestão de fases (criar/editar/excluir/reordenar) — reordenação por botões sobe/desce em vez de
 * um segundo `DndContext` dentro do modal: o guia pede drag-and-drop para MOVER CARDS entre fases
 * (a operação de alto volume), não para reordenar as poucas colunas em si — botões são mais simples
 * e igualmente utilizáveis para uma lista curta. */
function PhaseManagerModal({
  workspaceId,
  teamId,
  phases,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  teamId: string;
  phases: readonly TeamKanbanPhase[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [phaseType, setPhaseType] = useState<KanbanPhaseType>("RUNNING");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = useState<TeamKanbanPhase | undefined>();

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await createKanbanPhase(workspaceId, teamId, name.trim(), phaseType);
      setName("");
      setPhaseType("RUNNING");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a fase.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetDefaultFirst(phase: TeamKanbanPhase) {
    setBusy(true);
    setError(undefined);
    try {
      await updateKanbanPhase(workspaceId, teamId, phase.id, { isDefaultFirst: true });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a fase.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTogglePhaseType(phase: TeamKanbanPhase) {
    setBusy(true);
    setError(undefined);
    try {
      await updateKanbanPhase(workspaceId, teamId, phase.id, { phaseType: phase.phaseType === "RUNNING" ? "PAUSED" : "RUNNING" });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a fase.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReorder(phaseId: string, direction: -1 | 1) {
    const index = phases.findIndex((p) => p.id === phaseId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= phases.length) return;
    const reordered = [...phases];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    setBusy(true);
    setError(undefined);
    try {
      await reorderKanbanPhases(workspaceId, teamId, reordered.map((p) => p.id));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível reordenar as fases.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteKanbanPhase(workspaceId, teamId, pendingDelete.id);
      setPendingDelete(undefined);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a fase.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Fases do quadro" onClose={onClose} maxWidthClass="sm:max-w-lg">
      <div className="flex flex-col gap-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-col gap-2">
          {phases.map((phase, index) => (
            <div key={phase.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <div className="flex flex-col">
                <button type="button" disabled={busy || index === 0} onClick={() => handleReorder(phase.id, -1)} className="text-muted-foreground disabled:opacity-30">
                  ▲
                </button>
                <button type="button" disabled={busy || index === phases.length - 1} onClick={() => handleReorder(phase.id, 1)} className="text-muted-foreground disabled:opacity-30">
                  ▼
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {phase.name} {phase.isDefaultFirst ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">(fase inicial)</span> : null}
                </p>
                <button type="button" disabled={busy} onClick={() => handleTogglePhaseType(phase)} className="text-left text-xs text-muted-foreground hover:underline">
                  {PHASE_TYPE_LABEL[phase.phaseType]}
                </button>
              </div>
              {!phase.isDefaultFirst ? (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => handleSetDefaultFirst(phase)}>
                  Tornar inicial
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" disabled={busy || phases.length <= 1} onClick={() => setPendingDelete(phase)}>
                Excluir
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-end gap-2 border-t border-border/60 pt-4">
          <div className="flex-1">
            <Label htmlFor="new-phase-name">Nova fase</Label>
            <Input id="new-phase-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Em atendimento" disabled={busy} />
          </div>
          <Select value={phaseType} onValueChange={(value) => setPhaseType(value as KanbanPhaseType)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="RUNNING">Conta tempo</SelectItem>
              <SelectItem value="PAUSED">Não conta tempo</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleCreate} disabled={busy || !name.trim()}>
            <Plus className="h-4 w-4" /> Criar
          </Button>
        </div>
      </div>

      {pendingDelete ? (
        <ConfirmDialog
          open
          variant="danger"
          busy={busy}
          title="Excluir fase"
          description={`As conversas em "${pendingDelete.name}" serão movidas para outra fase automaticamente. Esta ação não pode ser desfeita.`}
          confirmLabel="Excluir"
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(undefined)}
        />
      ) : null}
    </Modal>
  );
}
