"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/Button";
import { DetailBlock } from "@/components/DetailModal";
import { Input, MoneyInput } from "@/components/Field";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useContacts } from "@/features/crm/hooks";
import { centsFromCurrencyInput, currencyInputFromCents } from "@/features/crm/presentation";
import type { Deal } from "@/features/crm/types";
import { listDealParticipants, removeDealParticipant, setDealCustomFields, upsertDealParticipant } from "@/features/sales/api";
import { useCustomFields } from "@/features/sales/hooks";
import { PARTICIPANT_ROLE_LABEL } from "@/features/sales/presentation";
import type { DealCustomField, ParticipantRole } from "@/features/sales/types";
import { cn } from "@/lib/utils";

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : undefined);

/** Campos personalizados da oportunidade (definidos pela empresa) — salva campo a campo. */
export function DealCustomFieldsBlock({ workspaceId, deal, onSaved }: { workspaceId: string; deal: Deal; onSaved: () => void | Promise<void> }) {
  const { data: fields } = useCustomFields(workspaceId);
  if (!fields || fields.length === 0) return null;
  const values = deal.customFields ?? {};
  async function save(key: string, value: unknown) {
    try {
      await setDealCustomFields(deal.id, workspaceId, { [key]: value === "" ? null : value });
      await onSaved();
    } catch (cause) {
      toast.error("Não foi possível salvar o campo", { description: errorMessage(cause) });
    }
  }
  return (
    <DetailBlock label="Campos personalizados">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => <CustomFieldInput key={field.id} field={field} value={values[field.key]} onSave={(value) => save(field.key, value)} />)}
      </div>
    </DetailBlock>
  );
}

function CustomFieldInput({ field, value, onSave }: { field: DealCustomField; value: unknown; onSave: (value: unknown) => void }) {
  const [text, setText] = useState(field.fieldType === "currency" && typeof value === "number" ? currencyInputFromCents(value) : value === undefined || value === null ? "" : String(value));
  const label = <span className="text-[11px] text-muted-foreground">{field.label}</span>;
  if (field.fieldType === "boolean") return <label className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">{label}<Switch checked={value === true} onCheckedChange={(checked) => onSave(checked)} /></label>;
  if (field.fieldType === "select") {
    return (
      <label className="block">{label}
        <Select value={typeof value === "string" ? value : ""} onValueChange={(next) => onSave(next)}>
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>{field.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
        </Select>
      </label>
    );
  }
  if (field.fieldType === "multi_select") {
    const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
    return (
      <div>{label}
        <div className="mt-1 flex flex-wrap gap-1.5">
          {field.options.map((option) => (
            <button key={option} type="button" onClick={() => { const next = new Set(selected); if (next.has(option)) next.delete(option); else next.add(option); onSave([...next]); }} className={cn("rounded-full border px-2.5 py-0.5 text-xs", selected.has(option) ? "border-primary bg-primary/10" : "border-border text-muted-foreground")}>{option}</button>
          ))}
        </div>
      </div>
    );
  }
  const commit = () => {
    if (field.fieldType === "number") onSave(text.trim() ? Number(text.replace(",", ".")) : "");
    else if (field.fieldType === "currency") onSave(text.trim() ? centsFromCurrencyInput(text) : "");
    else onSave(text.trim());
  };
  return (
    <label className="block">{label}
      {field.fieldType === "currency" ? (
        <MoneyInput value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} />
      ) : (
        <Input type={field.fieldType === "date" ? "date" : "text"} inputMode={field.fieldType === "number" ? "decimal" : undefined} value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} />
      )}
    </label>
  );
}

/** Comitê de compra: outros contatos envolvidos e seus papéis (opcional). */
export function DealParticipantsBlock({ workspaceId, deal }: { workspaceId: string; deal: Deal }) {
  const { data: participants, mutate } = useSWR(["deal-participants", workspaceId, deal.id], () => listDealParticipants(deal.id, workspaceId));
  const { data: contacts } = useContacts(workspaceId);
  const [contactId, setContactId] = useState("");
  const [role, setRole] = useState<ParticipantRole>("decision_maker");
  const name = (id: string) => contacts?.find((contact) => contact.id === id)?.name ?? "Contato";
  return (
    <DetailBlock label="Participantes da decisão">
      <div className="space-y-1.5">
        {(participants ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nenhum participante além do contato principal.</p> : null}
        {(participants ?? []).map((participant) => (
          <div key={participant.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-1.5 text-sm">
            <span>{name(participant.contactId)} <span className="text-xs text-muted-foreground">· {PARTICIPANT_ROLE_LABEL[participant.role]}</span></span>
            <Button variant="ghost" size="icon" aria-label="Remover participante" onClick={() => removeDealParticipant(deal.id, participant.contactId, workspaceId).then(() => mutate())}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_160px_auto]">
        <SearchableCombo items={(contacts ?? []).filter((contact) => contact.id !== deal.contactId).map((contact) => ({ id: contact.id, label: contact.company ? `${contact.name} · ${contact.company}` : contact.name }))} value={contactId} onValueChange={setContactId} placeholder="Adicionar contato" searchPlaceholder="Buscar contato..." />
        <Select value={role} onValueChange={(value) => setRole(value as ParticipantRole)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(PARTICIPANT_ROLE_LABEL) as ParticipantRole[]).map((key) => <SelectItem key={key} value={key}>{PARTICIPANT_ROLE_LABEL[key]}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="secondary" disabled={!contactId} onClick={() => upsertDealParticipant(deal.id, contactId, workspaceId, role).then(() => { setContactId(""); return mutate(); }).catch((cause) => toast.error("Não foi possível adicionar", { description: errorMessage(cause) }))}>Adicionar</Button>
      </div>
    </DetailBlock>
  );
}
