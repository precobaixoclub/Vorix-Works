import type { Task, TaskStatus, TaskType } from "../../domain/crm/crm.model.js";

export type CreateTaskInput = {
  tenantId: string;
  workspaceId: string;
  contactId?: string;
  dealId?: string;
  type: TaskType;
  title: string;
  description?: string;
  dueAt?: string;
  ownerUserId?: string;
  teamId?: string;
};

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, "tenantId" | "workspaceId">>;

export type ListTasksFilter = {
  tenantId: string;
  workspaceId: string;
  contactId?: string;
  dealId?: string;
  ownerUserId?: string;
  teamId?: string;
  status?: TaskStatus;
  cursor?: string;
  limit?: number;
};

export type TaskRepositoryPort = {
  create(input: CreateTaskInput): Promise<Task>;
  getById(id: string): Promise<Task | undefined>;
  listByWorkspace(filter: ListTasksFilter): Promise<Task[]>;
  update(id: string, input: UpdateTaskInput): Promise<Task>;
  setStatus(id: string, status: TaskStatus, completedAt: string | null): Promise<Task>;
};
