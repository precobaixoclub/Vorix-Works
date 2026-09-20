"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Input } from "@/components/Field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { updateTask } from "@/features/crm/api";
import { quickDueDate, QUICK_DUE_SHORTCUTS, toDatetimeLocalValue } from "@/features/crm/task-scheduling";
import type { Task } from "@/features/crm/types";

/** Jornada Comercial Fase 3, item 16 — reagendar sempre atualiza a MESMA Task (`PATCH /tasks/:id`,
 * já suportado pelo backend existente; nenhuma extensão de schema precisou ser criada), nunca cria
 * uma segunda tarefa. Reusado em Conversas/DealDetailModal/Contact 360/Tarefas — nenhuma lógica
 * duplicada (item 28). */
export function RescheduleTaskPopover({
  task,
  workspaceId,
  onRescheduled,
  trigger,
}: {
  task: Task;
  workspaceId: string;
  onRescheduled: (task: Task) => void | Promise<void>;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [dueAt, setDueAt] = useState(() => toDatetimeLocalValue(task.dueAt));
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!dueAt) return;
    setBusy(true);
    try {
      const updated = await updateTask(task.id, workspaceId, { dueAt: new Date(dueAt).toISOString() });
      await onRescheduled(updated);
      setOpen(false);
    } catch (cause) {
      // Item 37 do pedido — nunca esconder erro só no frontend (ex.: 403 de RBAC) atrás de um
      // "nada aconteceu"; o popover continua aberto com o valor editado, pronto pra tentar de novo.
      toast.error("Não foi possível reagendar", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDueAt(toDatetimeLocalValue(task.dueAt));
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2" onClick={(event) => event.stopPropagation()}>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Reagendar</p>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_DUE_SHORTCUTS.map((shortcut) => (
            <Button key={shortcut.id} type="button" variant="secondary" size="sm" onClick={() => setDueAt(quickDueDate(shortcut.id, dueAt))}>
              {shortcut.label}
            </Button>
          ))}
        </div>
        <Input aria-label="Nova data e horário" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        <Button className="w-full" size="sm" onClick={handleSave} loading={busy} disabled={!dueAt || busy}>Salvar</Button>
      </PopoverContent>
    </Popover>
  );
}
