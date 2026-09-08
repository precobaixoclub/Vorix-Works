"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/Spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { cancelTask, completeTask, createTask } from "@/features/crm/api";
import { useTasks } from "@/features/crm/hooks";
import type { Task, TaskStatus, TaskType } from "@/features/crm/types";
import { formatDateTime } from "@/lib/format";

const TYPE_LABEL: Record<TaskType, string> = {
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  reuniao: "Reunião",
  enviar_proposta: "Enviar proposta",
  follow_up: "Follow-up",
  personalizada: "Personalizada",
};

const STATUS_LABEL: Record<TaskStatus, string> = { pending: "Pendente", done: "Concluída", cancelled: "Cancelada" };
const STATUS_VARIANT: Record<TaskStatus, "secondary" | "default" | "outline"> = { pending: "secondary", done: "default", cancelled: "outline" };

export default function TasksPage() {
  const workspace = useCurrentWorkspace();
  const [statusFilter, setStatusFilter] = useState<TaskStatus>("pending");
  const { data: tasks, error, isLoading, mutate } = useTasks(workspace.id, { status: statusFilter });

  const [createOpen, setCreateOpen] = useState(false);
  const [type, setType] = useState<TaskType>("ligacao");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [actingId, setActingId] = useState<string | undefined>();

  async function handleCreate() {
    setBusy(true);
    try {
      await createTask({ workspaceId: workspace.id, type, title: title.trim(), description: description.trim() || undefined, dueAt: dueAt || undefined });
      setCreateOpen(false);
      setTitle("");
      setDescription("");
      setDueAt("");
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete(task: Task) {
    setActingId(task.id);
    try {
      await completeTask(task.id, workspace.id);
      await mutate();
    } finally {
      setActingId(undefined);
    }
  }

  async function handleCancel(task: Task) {
    setActingId(task.id);
    try {
      await cancelTask(task.id, workspace.id);
      await mutate();
    } finally {
      setActingId(undefined);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Tarefas"
        description="Próximos passos — ligar, enviar proposta, fazer follow-up."
        actions={<Button onClick={() => setCreateOpen(true)}>Nova tarefa</Button>}
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as TaskStatus)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["pending", "done", "cancelled"] as const).map((status) => <SelectItem key={status} value={status}>{STATUS_LABEL[status]}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="p-0">
          {isLoading ? <div className="flex justify-center py-14"><Spinner /></div> : null}
          {error ? <div className="p-5"><ErrorState error={error} onRetry={() => mutate()} /></div> : null}
          {!isLoading && !error && tasks && tasks.length === 0 ? (
            <div className="p-5"><EmptyState title="Nenhuma tarefa" description="Tarefas pendentes aparecem aqui." /></div>
          ) : null}
          {tasks && tasks.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium text-foreground">{task.title}</TableCell>
                    <TableCell className="text-muted-foreground">{TYPE_LABEL[task.type]}</TableCell>
                    <TableCell className="text-muted-foreground">{task.dueAt ? formatDateTime(task.dueAt) : "—"}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[task.status]}>{STATUS_LABEL[task.status]}</Badge></TableCell>
                    <TableCell className="text-right">
                      {task.status === "pending" ? (
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => handleComplete(task)} loading={actingId === task.id}>Concluir</Button>
                          <Button variant="ghost" onClick={() => handleCancel(task)} disabled={actingId === task.id}>Cancelar</Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardBody>
      </Card>

      {createOpen ? (
        <Modal title="Nova tarefa" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="task-type">Tipo</Label>
              <Select value={type} onValueChange={(value) => setType(value as TaskType)}>
                <SelectTrigger id="task-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABEL) as TaskType[]).map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="task-title">Título</Label>
              <Input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Ligar para confirmar reunião" />
            </div>
            <div>
              <Label htmlFor="task-due">Prazo (opcional)</Label>
              <Input id="task-due" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="task-description">Descrição (opcional)</Label>
              <Textarea id="task-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>Cancelar</Button>
              <Button onClick={handleCreate} loading={busy} disabled={!title.trim() || busy}>Criar</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
