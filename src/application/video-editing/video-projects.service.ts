/**
 * "Criar vídeo com IA" — lado da API. Cria projetos e versões (que entram na fila do worker),
 * pede alterações por conversa, cancela, aprova e lista com URLs de prévia. Nenhum processamento
 * pesado acontece aqui: o worker de vídeo faz planejamento, render e Quality Gate.
 *
 * Segurança: todo material precisa ser uma chave de storage do PRÓPRIO workspace (upload ou
 * Biblioteca). Limites por cliente: versões ativas simultâneas e versões por dia.
 */

import { randomUUID } from "node:crypto";
import type { VideoAspect } from "../../domain/video-editing/video-edit-plan.js";
import { validateVideoEditDraftStructure, type VideoEditDraft } from "../ai-gateway/schemas/video-edit-draft.v1.js";
import type { VideoMaterialRole, VideoProject, VideoProjectMaterial, VideoProjectRepositoryPort, VideoProjectScope, VideoProjectSettings, VideoVersion } from "../ports/video-project-repository.port.js";

export class VideoProjectError extends Error {
  constructor(readonly code: "DISABLED" | "INVALID" | "NOT_FOUND" | "LIMIT" | "CONFLICT", message: string) {
    super(message);
    this.name = "VideoProjectError";
  }
}

export type VideoLimits = { maxActivePerWorkspace: number; maxVersionsPerDay: number; maxMaterials: number; maxVideos: number; maxRequestChars: number };
export const DEFAULT_VIDEO_LIMITS: VideoLimits = { maxActivePerWorkspace: 2, maxVersionsPerDay: 20, maxMaterials: 12, maxVideos: 4, maxRequestChars: 1500 };

export type VideoProjectsServiceDeps = {
  repository: VideoProjectRepositoryPort;
  /** Feature flag por workspace (ativação gradual). */
  isEnabled: (scope: VideoProjectScope) => boolean | Promise<boolean>;
  /** Dono da chave de storage (`classifyObjectKeyOwner`). */
  keyOwner: (objectKey: string) => { tenantId: string; workspaceId?: string } | undefined;
  /** URL → chave do storage (aceita URL assinada). */
  urlToKey: (url: string) => string | undefined;
  /** URL de prévia/uso para uma chave (assinada quando o storage é privado). */
  previewUrl: (objectKey: string) => string;
  musicLibraryAvailable: boolean;
  limits?: Partial<VideoLimits>;
  now?: () => Date;
  idGenerator?: (prefix: string) => string;
};

export type CreateVideoProjectInput = {
  scope: VideoProjectScope;
  userId: string;
  title?: string;
  aspect: VideoAspect;
  request: string;
  settings: VideoProjectSettings;
  materials: { url: string; role?: VideoMaterialRole; label?: string }[];
  /**
   * Rascunho pronto do diretor criativo do piloto automático (Codex): o worker não chama a IA paga,
   * só valida e monta o plano. Exige `settings.origin` (a pauta do Bolsão de onde veio).
   */
  presetDraft?: unknown;
};

const ACTIVE = new Set(["queued", "planning", "rendering", "verifying"]);
const VIDEO_EXT = /\.(mp4|mov)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const CONTENT_TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export class VideoProjectsService {
  private readonly limits: VideoLimits;
  private readonly now: () => Date;
  private readonly id: (prefix: string) => string;

  constructor(private readonly deps: VideoProjectsServiceDeps) {
    this.limits = { ...DEFAULT_VIDEO_LIMITS, ...deps.limits };
    this.now = deps.now ?? (() => new Date());
    this.id = deps.idGenerator ?? ((prefix) => `${prefix}-${randomUUID()}`);
  }

  async status(scope: VideoProjectScope) {
    return { enabled: await this.deps.isEnabled(scope), musicLibraryAvailable: this.deps.musicLibraryAvailable, limits: this.limits };
  }

  private async assertEnabled(scope: VideoProjectScope) {
    if (!(await this.deps.isEnabled(scope))) throw new VideoProjectError("DISABLED", "Criar vídeo com IA ainda não está habilitado para este espaço de trabalho.");
  }

  private async assertQuota(scope: VideoProjectScope) {
    if ((await this.deps.repository.countActive(scope)) >= this.limits.maxActivePerWorkspace) throw new VideoProjectError("LIMIT", `Já existem ${this.limits.maxActivePerWorkspace} vídeos em produção neste espaço. Aguarde terminar.`);
    const since = new Date(this.now().getTime() - 24 * 3600 * 1000);
    if ((await this.deps.repository.countCreatedSince(scope, since)) >= this.limits.maxVersionsPerDay) throw new VideoProjectError("LIMIT", `Limite de ${this.limits.maxVersionsPerDay} vídeos por dia atingido neste espaço.`);
  }

  private request(text: string): string {
    const trimmed = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
    if (trimmed.length < 8) throw new VideoProjectError("INVALID", "Descreva o vídeo que você quer (pelo menos uma frase).");
    if (trimmed.length > this.limits.maxRequestChars) throw new VideoProjectError("INVALID", `Pedido acima de ${this.limits.maxRequestChars} caracteres.`);
    return trimmed;
  }

  async create(input: CreateVideoProjectInput): Promise<{ project: VideoProject; version: VideoVersion }> {
    await this.assertEnabled(input.scope);
    const request = this.request(input.request);
    if (input.materials.length === 0) throw new VideoProjectError("INVALID", "Envie pelo menos um vídeo ou imagem.");
    if (input.materials.length > this.limits.maxMaterials) throw new VideoProjectError("INVALID", `No máximo ${this.limits.maxMaterials} materiais por vídeo.`);
    if (input.settings.targetDurationSeconds !== undefined && (input.settings.targetDurationSeconds < 5 || input.settings.targetDurationSeconds > 90)) throw new VideoProjectError("INVALID", "Duração entre 5 e 90 segundos.");
    if (input.settings.music && !this.deps.musicLibraryAvailable) throw new VideoProjectError("INVALID", "Trilha sonora ainda não está disponível.");
    let presetDraft: VideoEditDraft | undefined;
    if (input.presetDraft !== undefined || input.settings.origin) {
      if (input.settings.origin?.kind !== "editorial_pilot" || !input.settings.origin.ideaId) throw new VideoProjectError("INVALID", "Rascunho pronto só para o piloto automático (pauta do Bolsão).");
    }
    if (input.presetDraft !== undefined) {
      const structure = validateVideoEditDraftStructure(input.presetDraft);
      if (!structure.valid) throw new VideoProjectError("INVALID", `Rascunho inválido: ${structure.errors.slice(0, 3).join("; ")}`);
      presetDraft = structure.data;
    }

    const seen = new Set<string>();
    const materials: VideoProjectMaterial[] = input.materials.map((material, index) => {
      const key = this.deps.urlToKey(material.url);
      const owner = key ? this.deps.keyOwner(key) : undefined;
      if (!key || !owner || owner.tenantId !== input.scope.tenantId || owner.workspaceId !== input.scope.workspaceId) throw new VideoProjectError("INVALID", `Material ${index + 1} não pertence a este espaço de trabalho.`);
      if (seen.has(key)) throw new VideoProjectError("INVALID", `Material ${index + 1} repetido.`);
      seen.add(key);
      const kind = VIDEO_EXT.test(key) ? "video" : IMAGE_EXT.test(key) ? "image" : undefined;
      if (!kind) throw new VideoProjectError("INVALID", `Material ${index + 1}: use MP4, MOV, JPEG, PNG ou WEBP.`);
      const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
      const role: VideoMaterialRole = material.role ?? (kind === "video" ? "footage" : "product_photo");
      if (kind === "video" && !["footage", "screen_recording"].includes(role)) throw new VideoProjectError("INVALID", `Material ${index + 1}: vídeo precisa ser gravação ou gravação de tela.`);
      if (kind === "image" && !["product_photo", "screenshot", "reference", "generated"].includes(role)) throw new VideoProjectError("INVALID", `Material ${index + 1}: imagem precisa ser produto, captura de tela, referência ou imagem gerada.`);
      return { id: `M${index + 1}`, objectKey: key, kind, role, ...(material.label ? { label: material.label.slice(0, 80) } : {}), contentType: CONTENT_TYPES[extension]! };
    });
    if (materials.filter((m) => m.kind === "video").length > this.limits.maxVideos) throw new VideoProjectError("INVALID", `No máximo ${this.limits.maxVideos} vídeos por projeto.`);
    await this.assertQuota(input.scope);

    const now = this.now().toISOString();
    const project: VideoProject = {
      id: this.id("vproj"),
      ...input.scope,
      title: (input.title?.trim() || request.slice(0, 60)).slice(0, 120),
      mode: materials.some((m) => m.kind === "video") ? "edit_footage" : "images_ad",
      aspect: input.aspect,
      settings: input.settings,
      materials,
      transcripts: {},
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
    };
    const version: VideoVersion = { id: this.id("vver"), projectId: project.id, ...input.scope, number: 1, request, status: "queued", progress: 0, warnings: [], attempts: 0, maxAttempts: 2, cancelRequested: false, createdBy: input.userId, createdAt: now, updatedAt: now, ...(presetDraft ? { draft: presetDraft } : {}) };
    await this.deps.repository.createProject(project, version);
    return { project, version };
  }

  /** Pedido de alteração por conversa: nova versão a partir da última versão pronta. */
  async revise(input: { scope: VideoProjectScope; userId: string; projectId: string; request: string; fromVersionId?: string }): Promise<VideoVersion> {
    await this.assertEnabled(input.scope);
    const request = this.request(input.request);
    const project = await this.deps.repository.getProject(input.scope, input.projectId);
    if (!project) throw new VideoProjectError("NOT_FOUND", "Projeto de vídeo não encontrado.");
    if (project.settings.origin) throw new VideoProjectError("CONFLICT", "Vídeo do piloto automático: a alteração é pedida na aprovação pelo WhatsApp.");
    const versions = await this.deps.repository.listVersions(input.scope, project.id);
    if (versions.some((v) => ["queued", "planning", "rendering", "verifying"].includes(v.status))) throw new VideoProjectError("CONFLICT", "Já existe uma versão em produção neste vídeo. Aguarde terminar.");
    const base = input.fromVersionId ? versions.find((v) => v.id === input.fromVersionId) : versions.find((v) => v.plan && v.draft && ["ready_for_review", "needs_revision", "approved"].includes(v.status));
    if (!base?.plan || !base.draft) throw new VideoProjectError("CONFLICT", "Ainda não há uma versão pronta para alterar.");
    await this.assertQuota(input.scope);
    const now = this.now().toISOString();
    return this.deps.repository.addVersion({ id: this.id("vver"), projectId: project.id, ...input.scope, parentVersionId: base.id, request, status: "queued", progress: 0, warnings: [], attempts: 0, maxAttempts: 2, cancelRequested: false, createdBy: input.userId, createdAt: now, updatedAt: now });
  }

  /**
   * Nova versão do piloto (refação pelo motivo da reprovação ou correção da revisão visual), com o
   * rascunho pronto revisado. O worker confere o escopo do motivo contra a versão de origem.
   */
  async reviseWithDraft(input: { scope: VideoProjectScope; userId: string; projectId: string; fromVersionId: string; reason: string; draft: unknown }): Promise<VideoVersion> {
    await this.assertEnabled(input.scope);
    const reason = this.request(input.reason);
    const project = await this.deps.repository.getProject(input.scope, input.projectId);
    if (!project || project.settings.origin?.kind !== "editorial_pilot") throw new VideoProjectError("NOT_FOUND", "Projeto do piloto não encontrado.");
    const versions = await this.deps.repository.listVersions(input.scope, project.id);
    if (versions.some((v) => ACTIVE.has(v.status))) throw new VideoProjectError("CONFLICT", "Já existe uma versão em produção neste vídeo.");
    const base = versions.find((v) => v.id === input.fromVersionId);
    // Versão só de transcrição (aguardando o rascunho): a nova não tem origem a respeitar.
    const transcriptOnly = base?.stage === "awaiting_draft" && !base.plan;
    if (!base || (!base.plan && !transcriptOnly)) throw new VideoProjectError("CONFLICT", "A versão de origem não tem plano.");
    const structure = validateVideoEditDraftStructure(input.draft);
    if (!structure.valid) throw new VideoProjectError("INVALID", `Rascunho inválido: ${structure.errors.slice(0, 3).join("; ")}`);
    await this.assertQuota(input.scope);
    const now = this.now().toISOString();
    return this.deps.repository.addVersion({ id: this.id("vver"), projectId: project.id, ...input.scope, parentVersionId: transcriptOnly ? undefined : base.id, request: reason, status: "queued", progress: 0, warnings: [], attempts: 0, maxAttempts: 2, cancelRequested: false, createdBy: input.userId, createdAt: now, updatedAt: now, draft: structure.data });
  }

  /** Versão do piloto, com o plano (para a revisão visual e a refação no servidor). */
  async pilotVersion(scope: VideoProjectScope, versionId: string) {
    const version = await this.deps.repository.getVersion(scope, versionId);
    if (!version) throw new VideoProjectError("NOT_FOUND", "Versão não encontrada.");
    const project = await this.deps.repository.getProject(scope, version.projectId);
    if (project?.settings.origin?.kind !== "editorial_pilot") throw new VideoProjectError("NOT_FOUND", "Versão não é do piloto.");
    return { version, project };
  }

  async cancel(scope: VideoProjectScope, versionId: string) {
    const version = await this.deps.repository.requestCancel(scope, versionId);
    if (!version) throw new VideoProjectError("NOT_FOUND", "Versão não encontrada.");
    return this.present(version);
  }

  async approve(scope: VideoProjectScope, versionId: string, userId: string) {
    const version = await this.deps.repository.approve(scope, versionId, userId, this.now());
    if (!version) throw new VideoProjectError("CONFLICT", "Só uma versão pronta para revisão pode ser aprovada.");
    return this.present(version);
  }

  async list(scope: VideoProjectScope) {
    const projects = await this.deps.repository.listProjects(scope, 30);
    return Promise.all(projects.map(async (project) => {
      const versions = await this.deps.repository.listVersions(scope, project.id);
      return { ...this.presentProject(project), latest: versions[0] ? this.present(versions[0]) : undefined, versions: versions.length };
    }));
  }

  async get(scope: VideoProjectScope, projectId: string) {
    const project = await this.deps.repository.getProject(scope, projectId);
    if (!project) throw new VideoProjectError("NOT_FOUND", "Projeto de vídeo não encontrado.");
    const versions = await this.deps.repository.listVersions(scope, project.id);
    return { ...this.presentProject(project), versions: versions.map((v) => this.present(v)) };
  }

  private presentProject(project: VideoProject) {
    return { id: project.id, title: project.title, mode: project.mode, aspect: project.aspect, settings: project.settings, materials: project.materials.map((m) => ({ id: m.id, kind: m.kind, role: m.role, label: m.label, url: this.deps.previewUrl(m.objectKey) })), createdAt: project.createdAt };
  }

  /** Para a interface: sem plano interno; com URLs de prévia e o resultado do Quality Gate. */
  present(version: VideoVersion) {
    return {
      id: version.id,
      number: version.number,
      request: version.request,
      status: version.status,
      stage: version.stage,
      progress: version.progress,
      message: version.message,
      error: version.error,
      warnings: version.warnings,
      gate: version.gate ? { status: version.gate.status, failures: version.gate.failures, checks: version.gate.checks } : undefined,
      strategy: version.plan?.strategy,
      durationSeconds: version.plan?.durationSeconds,
      rationale: version.draft?.rationale,
      videoUrl: version.outputKey ? this.deps.previewUrl(version.outputKey) : undefined,
      posterUrl: version.posterKey ? this.deps.previewUrl(version.posterKey) : undefined,
      usage: version.usage ? { calls: version.usage.calls, costUsd: Math.round(version.usage.costUsd * 10000) / 10000 } : undefined,
      approvedAt: version.approvedAt,
      createdAt: version.createdAt,
    };
  }
}
