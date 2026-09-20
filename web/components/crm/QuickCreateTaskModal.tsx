"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPicker } from "@/components/UserPicker";
import { createTask } from "@/features/crm/api";
import { TASK_TYPE_LABEL } from "@/features/crm/presentation";
import { quickDueDate, QUICK_DUE_SHORTCUTS, type TaskDealChoice } from "@/features/crm/task-scheduling";
import type { Task, TaskType } from "@/features/crm/types";

/** Jornada Comercial Fase 3, itens 5/10/20 — "próxima ação"/tarefa criada sem sair de onde o
 * usuário já está (conversa, DealDetailModal ou Contact 360). Contato já vem definido; o negócio é
 * resolvido por `resolveTaskDealChoice` (nunca escolhido em silêncio quando há mais de um aberto —
 * ver `dealChoice`). Reusado pelos 3 pontos de entrada para nunca duplicar esta lógica (item 28). */
export function QuickCreateTaskModal({
  workspaceId,
  contactId,
  dealChoice,
  defaultOwnerUserId,
  title: modalTitle = "Nova próxima ação",
  onClose,
  onCreated,
}: {
  workspaceId: string;
  contactId?: string;
  dealChoice: TaskDealChoice;
  defaultOwnerUserId?: string;
  title?: string;
  onClose: () => void;
  onCreated: (task: Task) => void | Promise<void>;
}) {
  const [type, setType] = useState<TaskType>("follow_up");
  const [taskTitle, setTaskTitle] = useState(TASK_TYPE_LABEL.follow_up);
  const [titleTouched, setTitleTouched] = useState(false);
  const [dueAt, setDueAt] = useState("");
  const [selectedDealId, setSelectedDealId] = useState(dealChoice.mode === "auto" ? dealChoice.dealId : "");
  const [ownerUserId, setOwnerUserId] = useState(defaultOwnerUserId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function handleTypeChange(nextType: TaskType) {
    setType(nextType);
    // Título "inteligente" (item 12) — só troca sozinho enquanto o usuário não editou manualmente;
    // uma vez editado, nunca mais sobrescreve o que ele digitou.
    if (!titleTouched) setTaskTitle(TASK_TYPE_LABEL[nextType]);
  }

  async function handleSubmit() {
    if (!taskTitle.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const dealId = dealChoice.mode === "auto" ? dealChoice.dealId : dealChoice.mode === "choose" ? selectedDealId || undefined : undefined;
      const task = await createTask({
        workspaceId,
        contactId,
        dealId,
        type,
        title: taskTitle.trim(),
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        ownerUserId: ownerUserId || undefined,
      });
      await onCreated(task);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a tarefa.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={modalTitle} onClose={onClose}>
      <div className="space-y-3">
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}

        <div>
          <Label htmlFor="quick-task-type">Tipo</Label>
          <Select value={type} onValueChange={(value) => handleTypeChange(value as TaskType)}>
            <SelectTrigger id="quick-task-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((item) => <SelectItem key={item} value={item}>{TASK_TYPE_LABEL[item]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="quick-task-due">Quando</Label>
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {QUICK_DUE_SHORTCUTS.map((shortcut) => (
              <Button key={shortcut.id} type="button" variant="secondary" size="sm" onClick={() => setDueAt(quickDueDate(shortcut.id, dueAt))}>
                {shortcut.label}
              </Button>
            ))}
          </div>
          <Input id="quick-task-due" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        </div>

        <div>
          <Label htmlFor="quick-task-title">Título</Label>
          <Input id="quick-task-title" value={taskTitle} onChange={(event) => { setTaskTitle(event.target.value); setTitleTouched(true); }} />
        </div>

        <div>
          <Label>Responsável</Label>
          <UserPicker workspaceId={workspaceId} value={ownerUserId} onValueChange={setOwnerUserId} extraOption={{ value: "", label: "Sem responsável" }} />
        </div>

        {dealChoice.mode === "choose" ? (
          <div>
            <Label htmlFor="quick-task-deal">Relacionar esta tarefa a qual negócio?</Label>
            <Select value={selectedDealId || "none"} onValueChange={(value) => setSelectedDealId(value === "none" ? "" : value)}>
              <SelectTrigger id="quick-task-deal"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem negócio</SelectItem>
                {dealChoice.options.map((option) => <SelectItem key={option.id} value={option.id}>{option.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={handleSubmit} loading={busy} disabled={!taskTitle.trim() || busy}>Criar</Button>
        </div>
      </div>
    </Modal>
  );
}
