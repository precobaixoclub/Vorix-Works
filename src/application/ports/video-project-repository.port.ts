/**
 * Projetos e versões do "Criar vídeo com IA". A fila do worker são as versões em `queued`.
 * Toda leitura/escrita pela API é escopada por tenant + workspace; o worker opera por id da versão
 * reservada (lease).
 */

import type { VideoAspect, VideoEditMode, VideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";
import type { VideoEditDraft } from "../ai-gateway/schemas/video-edit-draft.v1.js";
import type { Transcript } from "../video-editing/transcript-tools.js";

export type VideoMaterialKind = "video" | "image";
/** `generated` = imagem conceitual criada por IA (nunca produto nem tela). */
export type VideoMaterialRole = "footage" | "screen_recording" | "product_photo" | "screenshot" | "reference" | "generated" | "generated_motion";

export type VideoProjectMaterial = {
  /** "M1", "M2"… — o id que a IA enxerga. */
  id: string;
  /** Chave no storage, sempre com o prefixo `<tenant>/<workspace>/`. */
  objectKey: string;
  kind: VideoMaterialKind;
  role: VideoMaterialRole;
  label?: string;
  contentType: string;
};

export type VideoProjectSettings = {
  targetDurationSeconds?: number;
  editing: "dinamico" | "elegante" | "direto";
  transitions: "suaves" | "moderadas" | "marcantes";
  captions: boolean;
  music: boolean;
  /** Projeto aberto pelo piloto automático a partir de uma pauta do Bolsão: toda versão traz o rascunho pronto. */
  origin?: { kind: "editorial_pilot"; ideaId: string; externalId?: string };
};

export type VideoProject = {
  id: string;
  tenantId: string;
  workspaceId: string;
  title: string;
  mode: VideoEditMode;
  aspect: VideoAspect;
  settings: VideoProjectSettings;
  materials: VideoProjectMaterial[];
  transcripts: Record<string, Transcript>;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export const VIDEO_VERSION_STATUSES = ["queued", "planning", "rendering", "verifying", "ready_for_review", "needs_revision", "approved", "failed", "cancelled"] as const;
export type VideoVersionStatus = (typeof VIDEO_VERSION_STATUSES)[number];
export const ACTIVE_VIDEO_STATUSES: readonly VideoVersionStatus[] = ["queued", "planning", "rendering", "verifying"];

export type VideoVersion = {
  id: string;
  projectId: string;
  tenantId: string;
  workspaceId: string;
  number: number;
  parentVersionId?: string;
  request: string;
  status: VideoVersionStatus;
  stage?: string;
  progress: number;
  message?: string;
  draft?: VideoEditDraft;
  plan?: VideoEditPlan;
  gate?: { status: string; failures: string[]; checks: { id: string; label: string; status: string; detail: string }[] };
  warnings: string[];
  usage?: { calls: number; inputTokens: number; outputTokens: number; costUsd: number; model?: string };
  error?: string;
  outputKey?: string;
  posterKey?: string;
  outputSizeBytes?: number;
  renderMs?: number;
  attempts: number;
  maxAttempts: number;
  cancelRequested: boolean;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type VideoVersionPatch = Partial<Pick<VideoVersion, "status" | "stage" | "progress" | "message" | "draft" | "plan" | "gate" | "warnings" | "usage" | "error" | "outputKey" | "posterKey" | "outputSizeBytes" | "renderMs">>;

export type VideoProjectScope = { tenantId: string; workspaceId: string };

export interface VideoProjectRepositoryPort {
  createProject(project: VideoProject, firstVersion: VideoVersion): Promise<void>;
  getProject(scope: VideoProjectScope, projectId: string): Promise<VideoProject | undefined>;
  listProjects(scope: VideoProjectScope, limit: number): Promise<VideoProject[]>;
  saveTranscripts(projectId: string, transcripts: Record<string, Transcript>): Promise<void>;
  /** Cria a próxima versão (número = maior + 1). */
  addVersion(version: Omit<VideoVersion, "number">): Promise<VideoVersion>;
  getVersion(scope: VideoProjectScope, versionId: string): Promise<VideoVersion | undefined>;
  listVersions(scope: VideoProjectScope, projectId: string): Promise<VideoVersion[]>;
  latestStrategies(scope: VideoProjectScope, limit: number): Promise<string[]>;
  /** Versões ativas do workspace e criadas desde `since` (limites por cliente). */
  countActive(scope: VideoProjectScope): Promise<number>;
  countCreatedSince(scope: VideoProjectScope, since: Date): Promise<number>;
  requestCancel(scope: VideoProjectScope, versionId: string): Promise<VideoVersion | undefined>;
  approve(scope: VideoProjectScope, versionId: string, userId: string, at: Date): Promise<VideoVersion | undefined>;

  // ---- worker ----
  /** Reserva a próxima versão (ou retoma uma com lease vencido). Só uma renderização ativa por vez no ambiente. */
  claimNext(input: { workerId: string; leaseMs: number }): Promise<{ version: VideoVersion; project: VideoProject } | undefined>;
  /** Renova o lease; devolve `alive=false` se outro worker assumiu, e se há pedido de cancelamento. */
  heartbeat(input: { versionId: string; workerId: string; leaseMs: number }): Promise<{ alive: boolean; cancelRequested: boolean }>;
  update(input: { versionId: string; workerId: string; patch: VideoVersionPatch }): Promise<boolean>;
  /** Libera a versão: volta para a fila (retentativa) ou termina. */
  release(input: { versionId: string; workerId: string; patch: VideoVersionPatch & { status: VideoVersionStatus } }): Promise<boolean>;
}
