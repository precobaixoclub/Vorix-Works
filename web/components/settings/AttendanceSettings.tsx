"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, ListChecks, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Spinner } from "@/components/Spinner";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import {
  createInboxClosureSubtype,
  createInboxClosureType,
  deleteInboxClosureSubtype,
  deleteInboxClosureType,
  reorderInboxClosureSubtypes,
  reorderInboxClosureTypes,
  updateInboxClosureSubtype,
  updateInboxClosureType,
} from "@/features/inbox/api";
import { useInboxClosureTypes } from "@/features/inbox/hooks";
import type { InboxClosureSubtype, InboxClosureType } from "@/features/inbox/types";
import { canManageTenant } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { SlaSettings } from "@/components/settings/SlaSettings";

const message = (cause: unknown) => (cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : "Não foi possível salvar. Tente novamente.");

const swap = <T,>(items: readonly T[], index: number, delta: number): T[] => {
  const next = [...items];
  const target = index + delta;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

/** Configurações > Atendimento > Tipos de finalização. Todos leem; gerente/administrador editam. */
export default function AttendanceSettings() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const canEdit = canManageTenant(state.status === "authenticated" ? state.role : undefined);
  const { data, error, isLoading, mutate } = useInboxClosureTypes(workspace.id);
  const [newType, setNewType] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ type: InboxClosureType; subtype?: InboxClosureSubtype }>();
  const types = data?.closureTypes ?? [];

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      await mutate();
      if (success) toast.success(success);
    } catch (cause) {
      toast.error("Não foi possível salvar.", { description: message(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function addType() {
    const name = newType.trim();
    if (!name) return;
    await run(() => createInboxClosureType(workspace.id, name), "Tipo criado. Agora cadastre os subtipos.");
    setNewType("");
  }

  return (
    <SettingsShell active="attendance" title="Atendimento" description="Como os atendimentos de Conversas são finalizados e medidos.">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <SlaSettings workspaceId={workspace.id} />
        <Card>
          <CardBody className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><ListChecks className="h-4 w-4 text-primary dark:text-primary-glow" /> Tipos de finalização</p>
            <p className="text-sm text-muted-foreground">
              Ao finalizar um atendimento, o atendente escolhe obrigatoriamente um tipo e um subtipo. Só aparecem tipos ativos com pelo menos um subtipo ativo.
              Excluir não apaga o histórico: atendimentos antigos guardam o nome escolhido na época.
              A pesquisa de satisfação ao finalizar é ligada por canal, em <Link className="text-primary underline-offset-2 hover:underline" href={`/workspaces/${workspace.id}/conversas`}>Conversas &gt; Canais</Link>.
            </p>
            {!canEdit ? <p className="text-xs text-muted-foreground">Só gerentes e administradores podem alterar.</p> : null}
          </CardBody>
        </Card>

        {isLoading && !data ? (
          <div className="flex justify-center py-12"><Spinner className="h-6 w-6 text-primary" /></div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : (
          <>
            {types.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhum tipo cadastrado. Sem tipos, não é possível finalizar atendimentos.</p> : null}
            {types.map((type, index) => (
              <ClosureTypeCard
                key={type.id}
                workspaceId={workspace.id}
                type={type}
                canEdit={canEdit}
                busy={busy}
                isFirst={index === 0}
                isLast={index === types.length - 1}
                run={run}
                onMove={(delta) => void run(() => reorderInboxClosureTypes(workspace.id, swap(types, index, delta).map((item) => item.id)))}
                onDelete={(subtype) => setPendingDelete({ type, subtype })}
              />
            ))}
            {canEdit ? (
              <div className="flex gap-2">
                <Input placeholder="Novo tipo (ex.: Venda perdida)" maxLength={80} value={newType} onChange={(event) => setNewType(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addType(); } }} aria-label="Nome do novo tipo de finalização" />
                <Button onClick={() => void addType()} disabled={busy || !newType.trim()}><Plus className="h-4 w-4" /> Adicionar tipo</Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete?.subtype ? `Excluir o subtipo "${pendingDelete.subtype.name}"?` : `Excluir o tipo "${pendingDelete?.type.name ?? ""}"?`}
        description={pendingDelete?.subtype
          ? "Ele deixa de aparecer na finalização. Atendimentos já finalizados com ele continuam no histórico."
          : "O tipo e todos os subtipos deixam de aparecer na finalização. Atendimentos já finalizados com eles continuam no histórico. Para só esconder por um tempo, desative em vez de excluir."}
        confirmLabel="Excluir"
        variant="danger"
        busy={busy}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={() => {
          const target = pendingDelete;
          if (!target) return;
          void run(() => (target.subtype ? deleteInboxClosureSubtype(workspace.id, target.type.id, target.subtype.id) : deleteInboxClosureType(workspace.id, target.type.id)), "Excluído.").then(() => setPendingDelete(undefined));
        }}
      />
    </SettingsShell>
  );
}

function ClosureTypeCard({ workspaceId, type, canEdit, busy, isFirst, isLast, run, onMove, onDelete }: {
  workspaceId: string;
  type: InboxClosureType;
  canEdit: boolean;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  run: (action: () => Promise<unknown>, success?: string) => Promise<void>;
  onMove: (delta: number) => void;
  onDelete: (subtype?: InboxClosureSubtype) => void;
}) {
  const [newSubtype, setNewSubtype] = useState("");
  const activeSubtypes = type.subtypes.filter((subtype) => subtype.isActive).length;
  const selectable = type.isActive && activeSubtypes > 0;

  async function addSubtype() {
    const name = newSubtype.trim();
    if (!name) return;
    await run(() => createInboxClosureSubtype(workspaceId, type.id, name));
    setNewSubtype("");
  }

  return (
    <Card className={cn(!type.isActive && "opacity-75")}>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <EditableName
            value={type.name}
            canEdit={canEdit}
            busy={busy}
            className="text-base font-medium"
            label="Nome do tipo"
            onSave={(name) => run(() => updateInboxClosureType(workspaceId, type.id, { name }))}
          />
          {!selectable ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{type.isActive ? "Sem subtipo ativo — não aparece na finalização" : "Desativado"}</span> : null}
          <div className="ml-auto flex items-center gap-1">
            <label className="mr-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              Ativo
              <Switch checked={type.isActive} disabled={!canEdit || busy} onCheckedChange={(isActive) => void run(() => updateInboxClosureType(workspaceId, type.id, { isActive }))} aria-label={`Ativar ${type.name}`} />
            </label>
            {canEdit ? (
              <>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy || isFirst} onClick={() => onMove(-1)} aria-label={`Subir ${type.name}`}><ArrowUp className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy || isLast} onClick={() => onMove(1)} aria-label={`Descer ${type.name}`}><ArrowDown className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy} onClick={() => onDelete()} aria-label={`Excluir ${type.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
              </>
            ) : null}
          </div>
        </div>

        <ul className="space-y-1.5">
          {type.subtypes.map((subtype, index) => (
            <li key={subtype.id} className={cn("flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-1.5", !subtype.isActive && "opacity-70")}>
              <EditableName
                value={subtype.name}
                canEdit={canEdit}
                busy={busy}
                className="text-sm"
                label="Nome do subtipo"
                onSave={(name) => run(() => updateInboxClosureSubtype(workspaceId, type.id, subtype.id, { name }))}
              />
              <div className="ml-auto flex items-center gap-1">
                <Switch checked={subtype.isActive} disabled={!canEdit || busy} onCheckedChange={(isActive) => void run(() => updateInboxClosureSubtype(workspaceId, type.id, subtype.id, { isActive }))} aria-label={`Ativar ${subtype.name}`} />
                {canEdit ? (
                  <>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy || index === 0} onClick={() => void run(() => reorderInboxClosureSubtypes(workspaceId, type.id, swap(type.subtypes, index, -1).map((item) => item.id)))} aria-label={`Subir ${subtype.name}`}><ArrowUp className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy || index === type.subtypes.length - 1} onClick={() => void run(() => reorderInboxClosureSubtypes(workspaceId, type.id, swap(type.subtypes, index, 1).map((item) => item.id)))} aria-label={`Descer ${subtype.name}`}><ArrowDown className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy} onClick={() => onDelete(subtype)} aria-label={`Excluir ${subtype.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
          {type.subtypes.length === 0 ? <li className="text-sm text-muted-foreground">Nenhum subtipo. Cadastre pelo menos um para este tipo aparecer na finalização.</li> : null}
        </ul>

        {canEdit ? (
          <div className="flex gap-2">
            <Input className="h-8" placeholder="Novo subtipo" maxLength={80} value={newSubtype} onChange={(event) => setNewSubtype(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addSubtype(); } }} aria-label={`Novo subtipo de ${type.name}`} />
            <Button variant="secondary" size="sm" onClick={() => void addSubtype()} disabled={busy || !newSubtype.trim()}><Plus className="h-3.5 w-3.5" /> Subtipo</Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function EditableName({ value, canEdit, busy, className, label, onSave }: {
  value: string;
  canEdit: boolean;
  busy: boolean;
  className?: string;
  label: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <span className={cn("inline-flex min-w-0 items-center gap-1 text-foreground", className)}>
        <span className="truncate">{value}</span>
        {canEdit ? (
          <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => { setDraft(value); setEditing(true); }} aria-label={`Renomear ${value}`}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </span>
    );
  }
  const save = async () => {
    const name = draft.trim();
    if (name && name !== value) await onSave(name);
    setEditing(false);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <Input autoFocus className="h-8 w-56" maxLength={80} value={draft} aria-label={label} onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void save(); } if (event.key === "Escape") setEditing(false); }} />
      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy || !draft.trim()} onClick={() => void save()} aria-label="Salvar nome"><Check className="h-3.5 w-3.5" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(false)} aria-label="Cancelar"><X className="h-3.5 w-3.5" /></Button>
    </span>
  );
}
