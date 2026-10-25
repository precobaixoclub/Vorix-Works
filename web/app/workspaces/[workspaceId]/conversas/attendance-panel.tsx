"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useInboxConversationAttendances } from "@/features/inbox/hooks";
import { CSAT_LABELS, DISTRIBUTION_LABELS, formatDuration, selectableClosureTypes } from "@/features/inbox/attendance-labels";
import type { InboxAttendance, InboxAttendanceAssignment, InboxClosureType, InboxTenantMember } from "@/features/inbox/types";

/**
 * Ciclo de atendimento na tela de Conversas: modal de finalizar (tipo + subtipo obrigatórios,
 * pesquisa conforme canal e papel), rótulos dos marcos da timeline e o histórico de atendimentos.
 * Todo texto aqui é gerado a partir dos dados estruturados do backend — nunca o contrário.
 */

/** Como a pesquisa aparece no modal: `forced` = canal ligado e quem finaliza não pode dispensar;
 * `optional` = gerente/administrador, marcada por padrão; `off` = canal desligado ou não se aplica. */
export type CsatCloseMode = "off" | "forced" | "optional";

export type AttendanceCloseChoice = { closureTypeId: string; closureSubtypeId: string; closureNote?: string; sendCsat?: boolean };

export function AttendanceCloseModal({ closureTypes, csatMode, busy, canConfigure, workspaceId, onCancel, onConfirm }: {
  closureTypes: readonly InboxClosureType[];
  csatMode: CsatCloseMode;
  busy: boolean;
  canConfigure: boolean;
  workspaceId: string;
  onCancel: () => void;
  onConfirm: (choice: AttendanceCloseChoice) => void | Promise<void>;
}) {
  const types = useMemo(() => selectableClosureTypes(closureTypes), [closureTypes]);
  const [typeId, setTypeId] = useState<string | undefined>();
  const [subtypeId, setSubtypeId] = useState<string | undefined>();
  const [note, setNote] = useState("");
  const [sendCsat, setSendCsat] = useState(true);
  const selectedType = types.find((type) => type.id === typeId);
  const canSubmit = Boolean(selectedType && subtypeId && selectedType.subtypes.some((subtype) => subtype.id === subtypeId));

  return (
    <Modal title="Finalizar atendimento" onClose={() => { if (!busy) onCancel(); }}>
      <div className="space-y-4">
        {types.length === 0 ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
            Nenhum tipo de finalização ativo com subtipo.{" "}
            {canConfigure ? (
              <Link className="font-medium text-primary underline-offset-2 hover:underline" href={`/workspaces/${workspaceId}/settings/attendance`}>Configurar tipos de finalização</Link>
            ) : "Peça a um gerente ou administrador para configurar."}
          </div>
        ) : (
          <>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-foreground">Tipo de finalização</legend>
              <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de finalização">
                {types.map((type) => (
                  <button key={type.id} type="button" role="radio" aria-checked={typeId === type.id}
                    onClick={() => { setTypeId(type.id); setSubtypeId(type.subtypes.length === 1 ? type.subtypes[0].id : undefined); }}
                    className={cn("rounded-lg border px-3 py-2 text-left text-sm transition-colors", typeId === type.id ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border hover:bg-muted")}>
                    {type.name}
                  </button>
                ))}
              </div>
            </fieldset>
            {selectedType ? (
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium text-foreground">Subtipo</legend>
                <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Subtipo de finalização">
                  {selectedType.subtypes.map((subtype) => (
                    <button key={subtype.id} type="button" role="radio" aria-checked={subtypeId === subtype.id} onClick={() => setSubtypeId(subtype.id)}
                      className={cn("rounded-lg border px-3 py-2 text-left text-sm transition-colors", subtypeId === subtype.id ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border hover:bg-muted")}>
                      {subtype.name}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <div className="space-y-1.5">
              <label htmlFor="closure-note" className="text-sm font-medium text-foreground">Observação (opcional)</label>
              <Textarea id="closure-note" rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Só a equipe vê. Não é enviada ao cliente." />
            </div>
          </>
        )}

        {csatMode === "forced" ? (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">O cliente vai receber a pesquisa de satisfação (nota de 1 a 5), configurada neste canal.</p>
        ) : csatMode === "optional" ? (
          <label className="flex items-start gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm text-foreground">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={sendCsat} onChange={(event) => setSendCsat(event.target.checked)} />
            <span>
              Enviar pesquisa de satisfação
              <span className="block text-xs text-muted-foreground">Ligada neste canal. Desmarcar dispensa a pesquisa só neste atendimento (fica registrado quem dispensou).</span>
            </span>
          </label>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button
            onClick={() => {
              if (!canSubmit || !typeId || !subtypeId) return;
              void onConfirm({ closureTypeId: typeId, closureSubtypeId: subtypeId, closureNote: note.trim() || undefined, ...(csatMode === "optional" ? { sendCsat } : {}) });
            }}
            loading={busy}
            disabled={busy || !canSubmit}
          >
            Finalizar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const dateTime = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "--");
const liveSeconds = (fromIso: string, toIso?: string) => Math.max(0, Math.round(((toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso)) / 1000));

/** Histórico de atendimentos dentro do painel de contexto da conversa. */
export function AttendanceHistorySection({ workspaceId, conversationId, members, currentUserId }: {
  workspaceId: string;
  conversationId: string;
  members: readonly InboxTenantMember[];
  currentUserId: string | undefined;
}) {
  const { data, isLoading } = useInboxConversationAttendances(workspaceId, conversationId);
  const [expanded, setExpanded] = useState<string | undefined>();
  const attendances = data?.attendances ?? [];
  const who = (userId: string | undefined) => {
    if (!userId) return "Sem responsável";
    if (userId === "system") return "Vorix";
    if (userId === currentUserId) return "Você";
    return members.find((member) => member.userId === userId)?.name ?? "Usuário removido";
  };
  if (isLoading && !data) return null;
  if (!attendances.length) return null;

  return (
    <section className="mb-4">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <History className="h-3 w-3" aria-hidden="true" /> Atendimentos ({attendances.length})
      </p>
      <div className="space-y-1.5">
        {attendances.map((attendance) => {
          const open = expanded === attendance.id || (expanded === undefined && attendance.status === "open");
          return (
            <div key={attendance.id} className="rounded-lg border border-border bg-muted/20 text-xs">
              <button type="button" className="flex w-full items-center gap-2 px-2.5 py-2 text-left" onClick={() => setExpanded(open ? "" : attendance.id)} aria-expanded={open}>
                {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="font-semibold text-foreground">#{attendance.number}</span>
                <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", attendance.status === "open" ? "bg-primary/10 text-primary dark:text-primary-glow" : "bg-muted text-muted-foreground")}>
                  {attendance.status === "open" ? "Em andamento" : "Finalizado"}
                </span>
                <span className="ml-auto truncate text-muted-foreground">{dateTime(attendance.openedAt)}</span>
              </button>
              {open ? <AttendanceDetails attendance={attendance} who={who} /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AttendanceDetails({ attendance, who }: { attendance: InboxAttendance; who: (userId: string | undefined) => string }) {
  const resolution = attendance.resolutionSeconds ?? (attendance.status === "open" ? liveSeconds(attendance.openedAt) : undefined);
  return (
    <div className="space-y-2 border-t border-border/60 px-2.5 py-2">
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1">
        <dt className="text-muted-foreground">Aberto</dt><dd className="text-right text-foreground">{dateTime(attendance.openedAt)}</dd>
        <dt className="text-muted-foreground">Finalizado</dt><dd className="text-right text-foreground">{dateTime(attendance.closedAt)}</dd>
        <dt className="text-muted-foreground">{attendance.status === "open" ? "Tempo até agora" : "Tempo de resolução"}</dt><dd className="text-right text-foreground">{formatDuration(resolution)}</dd>
        <dt className="text-muted-foreground">Distribuição</dt><dd className="text-right text-foreground">{attendance.distributionRule ? DISTRIBUTION_LABELS[attendance.distributionRule] ?? attendance.distributionRule : "--"}</dd>
        {attendance.closureTypeName ? (<><dt className="text-muted-foreground">Finalização</dt><dd className="text-right text-foreground">{attendance.closureTypeName}{attendance.closureSubtypeName ? ` > ${attendance.closureSubtypeName}` : ""}</dd></>) : null}
        {attendance.csatStatus ? (<><dt className="text-muted-foreground">Pesquisa</dt><dd className="text-right text-foreground">{attendance.csatStatus === "waived" ? `Dispensada por ${who(attendance.csatWaivedBy)}` : CSAT_LABELS[attendance.csatStatus]}{attendance.csatScore ? ` · nota ${attendance.csatScore}/5` : ""}</dd></>) : null}
      </dl>
      {attendance.closureNote ? <p className="rounded bg-muted/50 px-2 py-1 text-muted-foreground">{attendance.closureNote}</p> : null}
      {attendance.assignments.length ? (
        <div>
          <p className="mb-1 font-medium text-foreground">Responsáveis</p>
          <ol className="space-y-1">
            {attendance.assignments.map((assignment) => <AssignmentRow key={assignment.id} assignment={assignment} who={who} />)}
          </ol>
        </div>
      ) : <p className="text-muted-foreground">Ainda sem responsável.</p>}
    </div>
  );
}

const END_REASON_LABELS: Record<NonNullable<InboxAttendanceAssignment["endReason"]>, string> = {
  transferred: "transferiu",
  reassigned: "reatribuído",
  unassigned: "liberou",
  attendance_closed: "finalizado",
};

function AssignmentRow({ assignment, who }: { assignment: InboxAttendanceAssignment; who: (userId: string | undefined) => string }) {
  const firstResponse = assignment.firstResponseSeconds ?? (assignment.firstResponseAt ? liveSeconds(assignment.startedAt, assignment.firstResponseAt) : undefined);
  const holding = assignment.holdingSeconds ?? liveSeconds(assignment.startedAt, assignment.endedAt);
  return (
    <li className="rounded border border-border/60 bg-card px-2 py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-foreground">{who(assignment.userId)}</span>
        <span className="shrink-0 text-muted-foreground">{dateTime(assignment.startedAt)}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted-foreground">
        <span>1ª resposta: {firstResponse !== undefined ? formatDuration(firstResponse) : assignment.endedAt ? "não respondeu" : "aguardando"}</span>
        <span>Posse: {formatDuration(holding)}</span>
        {assignment.endReason ? <span>{assignment.endReason === "transferred" ? `Transferiu para ${who(assignment.transferredToUserId)}` : END_REASON_LABELS[assignment.endReason]}</span> : null}
      </div>
    </li>
  );
}
