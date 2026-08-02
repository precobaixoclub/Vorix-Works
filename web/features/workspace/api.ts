import { apiClient } from "@/lib/api-client";
import type { Workspace, WorkspaceStatus } from "./types";

/**
 * Única porta de entrada para dados de Workspace — todos reais, contra a API da Sprint 03
 * (`GET/POST /v1/workspaces`, `GET/PATCH /v1/workspaces/:id`, `POST /v1/workspaces/:id/{activate,
 * deactivate,archive}`). Diferente de Chat/Assets/Campaigns/Knowledge/Calendar (que ainda usam
 * dados simulados nesta sprint — ver `features/.../data.ts`), Workspace já tem backend real.
 */
export async function listWorkspaces(status?: WorkspaceStatus): Promise<Workspace[]> {
  const query = status ? `?status=${status}` : "";
  return apiClient.get<Workspace[]>(`/v1/workspaces${query}`);
}

export async function getWorkspace(id: string): Promise<Workspace> {
  return apiClient.get<Workspace>(`/v1/workspaces/${id}`);
}

export async function createWorkspace(input: { name: string; kind?: string }): Promise<Workspace> {
  return apiClient.post<Workspace>("/v1/workspaces", input);
}

export async function updateWorkspace(id: string, patch: { name?: string; kind?: string }): Promise<Workspace> {
  return apiClient.patch<Workspace>(`/v1/workspaces/${id}`, patch);
}

export async function activateWorkspace(id: string): Promise<Workspace> {
  return apiClient.post<Workspace>(`/v1/workspaces/${id}/activate`);
}

export async function deactivateWorkspace(id: string): Promise<Workspace> {
  return apiClient.post<Workspace>(`/v1/workspaces/${id}/deactivate`);
}

export async function archiveWorkspace(id: string): Promise<Workspace> {
  return apiClient.post<Workspace>(`/v1/workspaces/${id}/archive`);
}
