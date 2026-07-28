import type { ZunoEventName, ZunoEventRecorderPort } from "../events/zuno-event.contract.js";
import type { ClaraKnowledgePort } from "./clara-knowledge.port.js";
import type { ClaraLoggerPort } from "./clara-log.contract.js";
import type { ClaraKnowledgeRepositoryPort } from "./clara-repository.port.js";
import type {
  ClaraAuditMetadata,
  ClaraContextRequest,
  ClaraContextResponse,
  ClaraCreateKnowledgeInput,
  ClaraDeleteKnowledgeInput,
  ClaraIdGenerator,
  ClaraKnowledgeActor,
  ClaraKnowledgeModule,
  ClaraKnowledgePayload,
  ClaraKnowledgeQuery,
  ClaraKnowledgeRecord,
  ClaraKnowledgeSearchQuery,
  ClaraKnowledgeVersion,
  ClaraUpdateKnowledgeInput,
} from "./clara.types.js";

export type ClaraKnowledgeCenterDependencies = {
  repository: ClaraKnowledgeRepositoryPort;
  logger?: ClaraLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: ClaraIdGenerator;
  now?: () => Date;
};

class SequentialClaraIdGenerator implements ClaraIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopClaraLogger implements ClaraLoggerPort {
  async record(): Promise<void> {
    return undefined;
  }
}

class NoopEventRecorder implements ZunoEventRecorderPort {
  async record(): Promise<void> {
    return undefined;
  }
}

export class ClaraKnowledgeCenter implements ClaraKnowledgePort {
  private readonly repository: ClaraKnowledgeRepositoryPort;
  private readonly logger: ClaraLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: ClaraIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: ClaraKnowledgeCenterDependencies) {
    this.repository = dependencies.repository;
    this.logger = dependencies.logger ?? new NoopClaraLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialClaraIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async create<TModule extends ClaraKnowledgeModule>(input: ClaraCreateKnowledgeInput<TModule>): Promise<ClaraKnowledgeRecord<TModule>> {
    validateCreateInput(input);
    const timestamp = this.timestamp();
    const recordId = this.idGenerator.create("knowledge");
    const version = this.createVersion(1, input.payload, input.audit, "Registro criado.");
    const record: ClaraKnowledgeRecord<TModule> = {
      id: recordId,
      module: input.module,
      clientId: input.payload.clientId,
      title: input.title,
      status: "active",
      currentVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      payload: clone(input.payload),
      versions: [version],
      history: [
        {
          id: this.idGenerator.create("knowledge-history"),
          occurredAt: timestamp,
          action: "created",
          actor: input.audit.actor,
          reason: input.audit.reason,
          version: 1,
          changeSummary: "Registro criado.",
        },
      ],
      tags: normalizeTags([...(input.tags ?? []), ...(input.payload.keywords ?? [])]),
    };

    await this.repository.save(record);
    await this.log("KnowledgeCreated", "Conhecimento cadastrado na Clara.", input.audit.actor, record);
    await this.log("KnowledgeVersionCreated", "Versão 1 criada pela Clara.", input.audit.actor, record, { version: 1 });
    await this.emit("KnowledgeCreated", record, input.audit.actor, { version: 1 });
    await this.emit("KnowledgeVersionCreated", record, input.audit.actor, { version: 1 });
    return clone(record);
  }

  async update<TModule extends ClaraKnowledgeModule>(input: ClaraUpdateKnowledgeInput<TModule>): Promise<ClaraKnowledgeRecord<TModule>> {
    validateAudit(input.audit);
    const existing = await this.requireRecord(input.id);
    if (existing.status === "deleted") {
      throw new Error(`Registro ${input.id} está excluído e não pode ser atualizado.`);
    }

    const timestamp = this.timestamp();
    const nextVersion = existing.currentVersion + 1;
    const nextPayload = {
      ...existing.payload,
      ...input.patch,
    } as ClaraKnowledgePayload;
    const changeSummary = summarizePatch(input.patch, input.title, input.tags);
    const version = this.createVersion(nextVersion, nextPayload, input.audit, changeSummary);
    const updated: ClaraKnowledgeRecord = {
      ...existing,
      title: input.title ?? existing.title,
      updatedAt: timestamp,
      currentVersion: nextVersion,
      payload: clone(nextPayload),
      versions: [...existing.versions, version],
      history: [
        ...existing.history,
        {
          id: this.idGenerator.create("knowledge-history"),
          occurredAt: timestamp,
          action: "updated",
          actor: input.audit.actor,
          reason: input.audit.reason,
          version: nextVersion,
          changeSummary,
        },
      ],
      tags: normalizeTags(input.tags ?? [...existing.tags, ...(nextPayload.keywords ?? [])]),
    };

    await this.repository.save(updated);
    await this.log("KnowledgeUpdated", "Conhecimento atualizado na Clara.", input.audit.actor, updated, { changeSummary });
    await this.log("KnowledgeVersionCreated", `Versão ${nextVersion} criada pela Clara.`, input.audit.actor, updated, { version: nextVersion });
    await this.emit("KnowledgeUpdated", updated, input.audit.actor, { version: nextVersion, changeSummary });
    await this.emit("KnowledgeVersionCreated", updated, input.audit.actor, { version: nextVersion });
    return clone(updated as ClaraKnowledgeRecord<TModule>);
  }

  async remove(input: ClaraDeleteKnowledgeInput): Promise<ClaraKnowledgeRecord> {
    validateAudit(input.audit);
    const existing = await this.requireRecord(input.id);
    if (existing.status === "deleted") return clone(existing);

    const timestamp = this.timestamp();
    const nextVersion = existing.currentVersion + 1;
    const changeSummary = "Registro removido logicamente.";
    const version = this.createVersion(nextVersion, existing.payload, input.audit, changeSummary);
    const deleted: ClaraKnowledgeRecord = {
      ...existing,
      status: "deleted",
      deletedAt: timestamp,
      updatedAt: timestamp,
      currentVersion: nextVersion,
      versions: [...existing.versions, version],
      history: [
        ...existing.history,
        {
          id: this.idGenerator.create("knowledge-history"),
          occurredAt: timestamp,
          action: "deleted",
          actor: input.audit.actor,
          reason: input.audit.reason,
          version: nextVersion,
          changeSummary,
        },
      ],
    };

    await this.repository.save(deleted);
    await this.log("KnowledgeDeleted", "Conhecimento removido na Clara.", input.audit.actor, deleted);
    await this.log("KnowledgeVersionCreated", `Versão ${nextVersion} criada pela Clara.`, input.audit.actor, deleted, { version: nextVersion });
    await this.emit("KnowledgeDeleted", deleted, input.audit.actor, { version: nextVersion });
    await this.emit("KnowledgeVersionCreated", deleted, input.audit.actor, { version: nextVersion });
    return clone(deleted);
  }

  async get(query: ClaraKnowledgeQuery): Promise<ClaraKnowledgeRecord | undefined> {
    const records = await this.list({ ...query, limit: 1 });
    return records[0];
  }

  async list(query: ClaraKnowledgeQuery): Promise<ClaraKnowledgeRecord[]> {
    // O repositório já devolve cópias seguras para mutação (ver InMemory/LocalJson
    // ClaraKnowledgeRepository) — clonar de novo aqui só duplicaria o custo sem ganho de segurança,
    // já que applyQuery apenas filtra/corta a lista, sem mutar nenhum registro.
    const records = await this.repository.list();
    return applyQuery(records, query);
  }

  async search(query: ClaraKnowledgeSearchQuery): Promise<ClaraKnowledgeRecord[]> {
    await this.log("KnowledgeSearched", "Pesquisa realizada na Clara.", undefined, undefined, { query });
    const records = await this.repository.search(query);
    return applyQuery(records, query);
  }

  async getVersion(id: string, version: number): Promise<ClaraKnowledgeVersion | undefined> {
    const record = await this.repository.findById(id);
    return clone(record?.versions.find((candidate) => candidate.version === version));
  }

  async requestContext(request: ClaraContextRequest): Promise<ClaraContextResponse> {
    validateRequester(request.requester);
    await this.log("KnowledgeRequested", "Contexto solicitado à Clara.", request.requester, undefined, {
      clientId: request.clientId,
      modules: request.modules,
      scope: request.scope,
      reason: request.reason,
    });
    await this.emit("KnowledgeRequested", undefined, request.requester, {
      clientId: request.clientId,
      modules: request.modules,
      scope: request.scope,
      reason: request.reason,
    });

    const records = await this.list({
      clientId: request.clientId,
      status: "active",
      brandId: request.scope?.brandId,
      campaignId: request.scope?.campaignId,
      productId: request.scope?.productId,
      serviceId: request.scope?.serviceId,
      publicationId: request.scope?.publicationId,
      workflowId: request.scope?.workflowId,
    });
    const allowedModules = new Set(request.modules ?? allModules());
    const filtered = records.filter((record) => allowedModules.has(record.module));
    const response: ClaraContextResponse = {
      clientId: request.clientId,
      deliveredAt: this.timestamp(),
      modules: groupByModule(filtered),
      records: filtered,
    };

    await this.log("KnowledgeDelivered", "Contexto entregue pela Clara.", request.requester, undefined, {
      clientId: request.clientId,
      totalRecords: filtered.length,
      modules: Array.from(allowedModules),
    });
    await this.emit("KnowledgeDelivered", undefined, request.requester, {
      clientId: request.clientId,
      totalRecords: filtered.length,
      modules: Array.from(allowedModules),
    });
    return clone(response);
  }

  private createVersion<TPayload extends ClaraKnowledgePayload>(
    version: number,
    payload: TPayload,
    audit: ClaraAuditMetadata,
    changeSummary: string,
  ): ClaraKnowledgeVersion<TPayload> {
    validateAudit(audit);
    return {
      version,
      createdAt: this.timestamp(),
      createdBy: audit.actor,
      reason: audit.reason,
      payload: clone(payload),
      changeSummary,
    };
  }

  private async requireRecord(id: string): Promise<ClaraKnowledgeRecord> {
    const record = await this.repository.findById(id);
    if (!record) throw new Error(`Conhecimento ${id} não encontrado na Clara.`);
    return record;
  }

  private async log(
    action: Parameters<ClaraLoggerPort["record"]>[0]["action"],
    message: string,
    actor?: ClaraKnowledgeActor,
    record?: ClaraKnowledgeRecord,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("clara-log"),
      occurredAt: this.timestamp(),
      action,
      message,
      actor,
      recordId: record?.id,
      clientId: record?.clientId,
      module: record?.module,
      version: record?.currentVersion,
      metadata,
    });
  }

  private async emit(
    name: ZunoEventName,
    record?: ClaraKnowledgeRecord,
    actor?: ClaraKnowledgeActor,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      payload: {
        source: "clara",
        actor,
        recordId: record?.id,
        clientId: record?.clientId,
        module: record?.module,
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateCreateInput(input: ClaraCreateKnowledgeInput): void {
  if (!input.title?.trim()) throw new Error("title é obrigatório para cadastrar conhecimento na Clara.");
  if (!input.module) throw new Error("module é obrigatório para cadastrar conhecimento na Clara.");
  if (!input.payload?.clientId?.trim()) throw new Error("payload.clientId é obrigatório.");
  validateAudit(input.audit);
}

function validateAudit(audit: ClaraAuditMetadata): void {
  if (!audit?.actor) throw new Error("audit.actor é obrigatório.");
  validateRequester(audit.actor);
}

function validateRequester(actor: ClaraKnowledgeActor): void {
  if (!actor?.id?.trim()) throw new Error("actor.id é obrigatório.");
  if (!actor.type) throw new Error("actor.type é obrigatório.");
}

function applyQuery(records: ClaraKnowledgeRecord[], query: ClaraKnowledgeQuery): ClaraKnowledgeRecord[] {
  const status = query.status ?? "active";
  const filtered = records.filter((record) => {
    if (query.id && record.id !== query.id) return false;
    if (query.clientId && record.clientId !== query.clientId) return false;
    if (query.module && record.module !== query.module) return false;
    if (query.brandId && record.payload.brandId !== query.brandId) return false;
    if (query.campaignId && record.payload.campaignId !== query.campaignId) return false;
    if (query.publicationId && record.payload.publicationId !== query.publicationId) return false;
    if (query.productId && record.payload.productId !== query.productId) return false;
    if (query.serviceId && record.payload.serviceId !== query.serviceId) return false;
    if (query.workflowId && record.payload.workflowId !== query.workflowId) return false;
    if (status !== "all" && record.status !== status) return false;
    return true;
  });

  return typeof query.limit === "number" ? filtered.slice(0, query.limit) : filtered;
}

function groupByModule(records: ClaraKnowledgeRecord[]): ClaraContextResponse["modules"] {
  return records.reduce<ClaraContextResponse["modules"]>((modules, record) => {
    const current = modules[record.module] ?? [];
    modules[record.module] = [...current, record] as never;
    return modules;
  }, {});
}

function summarizePatch(patch: Record<string, unknown>, title?: string, tags?: string[]): string {
  const changed = Object.keys(patch);
  if (title) changed.push("title");
  if (tags) changed.push("tags");
  return changed.length ? `Campos alterados: ${changed.join(", ")}.` : "Atualização sem alteração explícita de campos.";
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)));
}

function allModules(): ClaraKnowledgeModule[] {
  return [
    "BrandContext",
    "BusinessContext",
    "AudienceContext",
    "ProductContext",
    "CampaignContext",
    "ContentContext",
    "IdentityContext",
    "PublishingContext",
    "AIContext",
    "WorkflowContext",
    "FutureContext",
    "MarketingContext",
    "LearningContext",
    "CompetitionContext",
    "PlaybookContext",
    "EditorialLibraryContext",
  ];
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}

export function createClaraKnowledgeCenter(dependencies: ClaraKnowledgeCenterDependencies): ClaraKnowledgeCenter {
  return new ClaraKnowledgeCenter(dependencies);
}
