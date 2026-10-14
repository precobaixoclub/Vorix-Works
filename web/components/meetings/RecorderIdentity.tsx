"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, UserRound, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { setMeetingHumanIdentity } from "@/features/meetings/api";
import { useRecorderEligibility } from "@/features/meetings/hooks";
import { HUMAN_IDENTITY_SOURCE_LABEL, RECORDER_ACCOUNT_ACTION_REASONS, type MeetingDetail, type RecordingRequestResult } from "@/features/meetings/types";
import { ApiError } from "@/lib/api-client";

export const HUMAN_IDENTITY_QUESTION = "Qual conta Google você utilizará para participar desta reunião?";

export const recorderAccountsHref = (workspaceId: string) => `/workspaces/${workspaceId}/meetings/recorder-accounts`;

/** Campo "Conta que você usará na reunião" — sugestões conhecidas da pessoa ou digitação livre. */
export function HumanIdentityField({ id, value, onChange, suggestions, autoFocus }: { id: string; value: string; onChange: (value: string) => void; suggestions: readonly string[]; autoFocus?: boolean }) {
  return (
    <div>
      <Label htmlFor={id}>Conta que você usará na reunião</Label>
      <Input id={id} type="email" value={value} onChange={(event) => onChange(event.target.value)} placeholder="voce@suaempresa.com" autoFocus={autoFocus} autoComplete="email" />
      {suggestions.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((email) => (
            <button
              key={email}
              type="button"
              onClick={() => onChange(email)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${value.trim().toLowerCase() === email ? "border-primary bg-primary/10 text-foreground" : "border-border/60 text-muted-foreground hover:bg-muted/50"}`}
            >
              {email}
            </button>
          ))}
        </div>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">É a conta Google com que você entra no Meet. Ela nunca será usada como conta de gravação desta reunião.</p>
    </div>
  );
}

/** Pergunta da identidade antes de gravar ("Gravar agora" / reunião sem identidade conhecida). */
export function HumanIdentityDialog({ suggestions, initial, busy, onSubmit, onClose, submitLabel = "Gravar" }: { suggestions: readonly string[]; initial?: string; busy: boolean; onSubmit: (email: string) => void; onClose: () => void; submitLabel?: string }) {
  const [value, setValue] = useState(initial ?? suggestions[0] ?? "");
  return (
    <Modal title="Antes de gravar" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">{initial ? `Você participará desta reunião usando a conta ${initial}? Confirme ou informe outra conta.` : HUMAN_IDENTITY_QUESTION}</p>
        <HumanIdentityField id="human-identity" value={value} onChange={setValue} suggestions={suggestions} autoFocus />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={() => onSubmit(value)} loading={busy} disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())}>{submitLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Aviso de uma recusa de gravação, com o CTA certo quando a solução é mexer nas contas. */
export function announceRecordingRefusal(result: Extract<RecordingRequestResult, { ok: false }>, workspaceId: string, navigate: (href: string) => void, title = "A gravação não começou") {
  const needsAccounts = RECORDER_ACCOUNT_ACTION_REASONS.includes(result.reason);
  toast.warning(title, {
    description: result.message,
    ...(needsAccounts ? { action: { label: "Conectar outra conta de gravação", onClick: () => navigate(recorderAccountsHref(workspaceId)) } } : {}),
  });
}

/**
 * Detalhe da reunião: separa "Conta que você usará na reunião" (pessoa) de "Conta usada para
 * gravação" (escolhida automaticamente), com o aviso antecipado do agendamento.
 */
export function RecorderIdentityPanel({ meeting, workspaceId, canEdit, onChanged }: { meeting: MeetingDetail; workspaceId: string; canEdit: boolean; onChanged: () => void }) {
  const editable = meeting.status === "scheduled" && Boolean(meeting.meetingUrl);
  const eligibility = useRecorderEligibility(workspaceId, meeting.id, editable);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(email: string) {
    setBusy(true);
    try {
      await setMeetingHumanIdentity(workspaceId, meeting.id, email);
      toast.success("Conta atualizada");
      setEditing(false);
      await Promise.all([eligibility.mutate(), onChanged()]);
    } catch (cause) {
      toast.error("Não foi possível salvar", { description: cause instanceof ApiError || cause instanceof Error ? cause.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  if (!editable && !meeting.humanJoinAccountEmail && !meeting.botAccountId) return null;
  const warning = eligibility.data?.warning;
  return (
    <Card className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-start gap-2">
          <UserRound className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Conta que você usará na reunião</p>
            <p className="truncate text-sm text-foreground">{meeting.humanJoinAccountEmail ?? "Não informada"}</p>
            {meeting.humanJoinIdentitySource && meeting.humanJoinAccountEmail ? <p className="text-xs text-muted-foreground">{HUMAN_IDENTITY_SOURCE_LABEL[meeting.humanJoinIdentitySource]}</p> : null}
            {editable && canEdit ? <button type="button" className="mt-1 text-xs font-medium text-primary underline dark:text-primary-glow" onClick={() => setEditing(true)}>{meeting.humanJoinAccountEmail ? "Corrigir" : "Informar"}</button> : null}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Video className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Conta usada para gravação</p>
            <p className="text-sm text-foreground">{meeting.botAccountId ? "Reservada automaticamente para esta reunião" : "Escolhida automaticamente na hora da gravação"}</p>
            {editable && eligibility.data ? <p className="text-xs text-muted-foreground tabular-nums">{eligibility.data.meetingEligibleCapacity} conta(s) livres e elegíveis para esta reunião</p> : null}
          </div>
        </div>
      </div>
      {editable && warning ? (
        <div className="flex flex-wrap items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">{warning.message}</p>
          {warning.code === "HUMAN_IDENTITY_REQUIRED" ? (
            canEdit ? <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Informar conta</Button> : null
          ) : (
            <Link href={recorderAccountsHref(workspaceId)} className="text-sm font-medium underline">Conectar outra conta de gravação</Link>
          )}
        </div>
      ) : null}
      {editing ? <HumanIdentityDialog suggestions={eligibility.data?.knownHumanEmails ?? []} initial={meeting.humanJoinAccountEmail} busy={busy} onSubmit={save} onClose={() => setEditing(false)} submitLabel="Salvar" /> : null}
    </Card>
  );
}
