import type { CreateTaskInput, ListTasksFilter, TaskRepositoryPort, UpdateTaskInput } from "../ports/task-repository.port.js";
import type { TimelineEventRepositoryPort } from "../ports/timeline-event-repository.port.js";
import type { Task } from "../../domain/crm/crm.model.js";

export type TaskUseCaseDeps = {
  taskRepository: TaskRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
};

/** Guard de tenant/workspace — nunca 403, sempre 404. */
export async function mustTaskBelongToTenantAndWorkspace(deps: TaskUseCaseDeps, taskId: string, tenantId: string, workspaceId: string): Promise<Task> {
  const task = await deps.taskRepository.getById(taskId);
  if (!task || task.tenantId !== tenantId || task.workspaceId !== workspaceId) {
    throw new Error(`TASK_NOT_FOUND: tarefa "${taskId}" não existe.`);
  }
  return task;
}

export async function createTask(deps: TaskUseCaseDeps, input: CreateTaskInput): Promise<Task> {
  const task = await deps.taskRepository.create(input);
  await deps.timelineEventRepository.record({
    tenantId: task.tenantId,
    workspaceId: task.workspaceId,
    entityType: "task",
    entityId: task.id,
    eventType: "task_created",
    actorType: "user",
    payload: { type: task.type, contactId: task.contactId, dealId: task.dealId },
  });
  return task;
}

export async function listTasks(deps: TaskUseCaseDeps, filter: ListTasksFilter): Promise<Task[]> {
  return deps.taskRepository.listByWorkspace(filter);
}

export async function getTask(deps: TaskUseCaseDeps, input: { taskId: string; tenantId: string; workspaceId: string }): Promise<Task> {
  return mustTaskBelongToTenantAndWorkspace(deps, input.taskId, input.tenantId, input.workspaceId);
}

export async function updateTask(deps: TaskUseCaseDeps, input: { taskId: string; tenantId: string; workspaceId: string; patch: UpdateTaskInput }): Promise<Task> {
  await mustTaskBelongToTenantAndWorkspace(deps, input.taskId, input.tenantId, input.workspaceId);
  return deps.taskRepository.update(input.taskId, input.patch);
}

export async function completeTask(deps: TaskUseCaseDeps, input: { taskId: string; tenantId: string; workspaceId: string }): Promise<Task> {
  await mustTaskBelongToTenantAndWorkspace(deps, input.taskId, input.tenantId, input.workspaceId);
  const task = await deps.taskRepository.setStatus(input.taskId, "done", new Date().toISOString());
  await deps.timelineEventRepository.record({
    tenantId: task.tenantId,
    workspaceId: task.workspaceId,
    entityType: "task",
    entityId: task.id,
    eventType: "task_completed",
    actorType: "user",
    payload: {},
  });
  return task;
}

export async function cancelTask(deps: TaskUseCaseDeps, input: { taskId: string; tenantId: string; workspaceId: string }): Promise<Task> {
  await mustTaskBelongToTenantAndWorkspace(deps, input.taskId, input.tenantId, input.workspaceId);
  const task = await deps.taskRepository.setStatus(input.taskId, "cancelled", null);
  await deps.timelineEventRepository.record({
    tenantId: task.tenantId,
    workspaceId: task.workspaceId,
    entityType: "task",
    entityId: task.id,
    eventType: "task_cancelled",
    actorType: "user",
    payload: {},
  });
  return task;
}
