import type { FastifyInstance } from "fastify";
import type { EditorialIdeaRepositoryPort } from "../../../../application/ports/editorial-idea-repository.port.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import {
  buildEditorialCalendar,
  buildEditorialGenerationBrief,
  EDITORIAL_IDEA_STATUSES,
  EditorialPackError,
  isGeneratableFormat,
  isIsoDate,
  nextManualExternalId,
  normalizeCreativePrompt,
  parseEditorialPack,
  parseManualEditorialIdea,
  type EditorialIdeaContent,
  type EditorialIdeaStatus,
} from "../../../../domain/editorial/editorial-idea.model.js";
import { classifyObjectKeyOwner, isObjectUrlSigningConfigured, parseOwnedObjectUrl, stripObjectUrlSignature } from "../../../../shared/utils/object-url-signing.js";
import { buildEditorialTemplateCsv, editorialCsvToPack } from "../../../../domain/editorial/editorial-spreadsheet.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { assertWorkspaceBelongsToTenant } from "./workspace-ownership.js";

export type EditorialIdeasRoutesDeps = {
  editorialIdeaRepository: EditorialIdeaRepositoryPort;
  workspaceRepository: WorkspaceRepositoryPort;
  now?: () => Date;
};

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1, maxLength: 80 } } } as const;

const IMPORT_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "pack"],
  additionalProperties: false,
  properties: { workspaceId: { type: "string", minLength: 1 }, pack: { type: "object" } },
} as const;

const IMPORT_SHEET_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "csv"],
  additionalProperties: false,
  properties: { workspaceId: { type: "string", minLength: 1 }, csv: { type: "string", minLength: 1, maxLength: 5_000_000 } },
} as const;

const UPDATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    status: { type: "string", enum: [...EDITORIAL_IDEA_STATUSES] },
    scheduledDate: { anyOf: [{ type: "string", minLength: 10, maxLength: 10 }, { type: "null" }] },
    executionRunId: { anyOf: [{ type: "string", minLength: 1, maxLength: 120 }, { type: "null" }] },
    creativePrompt: { anyOf: [{ type: "string", maxLength: 8000 }, { type: "null" }] },
  },
} as const;

const CALENDAR_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    startDate: { type: "string", minLength: 10, maxLength: 10 },
    days: { type: "integer", minimum: 7, maximum: 92 },
  },
} as const;

const MANUAL_IDEA_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "idea"],
  additionalProperties: false,
  properties: { workspaceId: { type: "string", minLength: 1 }, idea: { type: "object" } },
} as const;

function packMessage(error: unknown): never {
  if (error instanceof EditorialPackError) throw new ValidationError(error.message.replace(/^EDITORIAL_PACK_INVALID:\s*/, ""));
  throw error;
}

/**
 * Imagens de referência só podem ser arquivos do storage DESTE workspace (enviados pela tela). Ficam
 * gravadas sem assinatura: a resposta JSON autenticada assina na hora para o navegador.
 */
function ownReferenceImages(content: EditorialIdeaContent, tenantId: string, workspaceId: string): EditorialIdeaContent {
  if (!content.referenceImages?.length || !isObjectUrlSigningConfigured()) return content;
  const referenceImages = content.referenceImages.map((url) => {
    const parsed = parseOwnedObjectUrl(url);
    const owner = parsed ? classifyObjectKeyOwner(parsed.key) : undefined;
    if (!owner || owner.kind !== "workspace" || owner.tenantId !== tenantId || owner.workspaceId !== workspaceId) {
      throw new ValidationError("Imagem de referência inválida: envie a imagem pelo botão da própria ideia.");
    }
    return stripObjectUrlSignature(url);
  });
  return { ...content, referenceImages };
}

/** Hoje no fuso de São Paulo (AAAA-MM-DD): o calendário editorial é da equipe, não do servidor. */
function todayInSaoPaulo(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Bolsão de pautas editoriais. Cada rota confirma que o workspace pertence ao tenant de quem pede
 * (outro tenant = 404) e o repositório sempre filtra pelo workspace: uma pauta nunca aparece nem
 * muda fora do workspace dela. Nada aqui gera ou publica conteúdo — `brief` só devolve o pedido que
 * a própria pessoa envia ao motor criativo pela rota de sempre da Produção.
 */
export async function registerEditorialIdeasRoutes(app: FastifyInstance, deps: EditorialIdeasRoutesDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());

  app.get("/editorial-ideas", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:read");
    const { workspaceId } = request.query as { workspaceId: string };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    return successEnvelope(await deps.editorialIdeaRepository.listByWorkspace(workspaceId), request.id);
  });

  app.post("/editorial-ideas/import", { bodyLimit: 5_000_000, schema: { body: IMPORT_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:update");
    const { workspaceId, pack } = request.body as { workspaceId: string; pack: unknown };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    let ideas;
    try {
      ideas = parseEditorialPack(pack);
    } catch (error) {
      if (error instanceof EditorialPackError) throw new ValidationError(error.message);
      throw error;
    }
    const result = await deps.editorialIdeaRepository.importMany({ tenantId: principal.tenantId, workspaceId, ideas });
    return successEnvelope({ ...result, total: ideas.length }, request.id);
  });

  // Modelo de planilha (CSV) no padrão Vorix: baixar, preencher (inclusive com outra IA) e importar.
  app.get("/editorial-ideas/template", async (request, reply) => {
    requirePermission(request, "asset:read");
    return reply
      .header("content-disposition", 'attachment; filename="modelo-bolsao-vorix.csv"')
      .type("text/csv; charset=utf-8")
      .send(buildEditorialTemplateCsv());
  });

  // Importar a planilha preenchida. O CSV vira pacote e passa pela MESMA validação do import JSON:
  // ou importa tudo, ou falha apontando a primeira pauta/coluna com problema (nunca importa metade).
  app.post("/editorial-ideas/import-spreadsheet", { bodyLimit: 6_000_000, schema: { body: IMPORT_SHEET_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:update");
    const { workspaceId, csv } = request.body as { workspaceId: string; csv: string };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    let ideas;
    try {
      ideas = parseEditorialPack(editorialCsvToPack(csv));
    } catch (error) {
      if (error instanceof EditorialPackError) throw new ValidationError(error.message.replace(/^EDITORIAL_PACK_INVALID:\s*/, ""));
      throw error;
    }
    const result = await deps.editorialIdeaRepository.importMany({ tenantId: principal.tenantId, workspaceId, ideas });
    return successEnvelope({ ...result, total: ideas.length }, request.id);
  });

  // Cadastro manual de UMA ideia pela tela. Código automático (IDEIA-001…), estado "Disponível".
  app.post("/editorial-ideas", { schema: { body: MANUAL_IDEA_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:update");
    const { workspaceId, idea } = request.body as { workspaceId: string; idea: unknown };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    const existing = await deps.editorialIdeaRepository.listByWorkspace(workspaceId);
    const externalId = nextManualExternalId(existing.map((item) => item.externalId));
    let content: EditorialIdeaContent;
    try {
      content = parseManualEditorialIdea(idea, externalId);
    } catch (error) {
      packMessage(error);
    }
    content = ownReferenceImages(content, principal.tenantId, workspaceId);
    await deps.editorialIdeaRepository.importMany({ tenantId: principal.tenantId, workspaceId, ideas: [content] });
    const created = (await deps.editorialIdeaRepository.listByWorkspace(workspaceId)).find((item) => item.externalId === externalId);
    if (!created) throw new ValidationError("Não foi possível cadastrar a ideia. Tente de novo.");
    return successEnvelope(created, request.id);
  });

  // Edição do conteúdo pela tela (mesmas regras do cadastro manual). Código, estado e data ficam.
  app.put("/editorial-ideas/:id", { schema: { params: ID_PARAMS_SCHEMA, body: MANUAL_IDEA_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:update");
    const { id } = request.params as { id: string };
    const { workspaceId, idea } = request.body as { workspaceId: string; idea: unknown };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    const current = await deps.editorialIdeaRepository.get(workspaceId, id);
    if (!current) throw new NotFoundError("Pauta não encontrada neste workspace.");
    let content: EditorialIdeaContent;
    try {
      content = parseManualEditorialIdea(idea, current.externalId);
    } catch (error) {
      packMessage(error);
    }
    const { externalId: _externalId, suggestedDate: _suggested, ...patch } = ownReferenceImages(content, principal.tenantId, workspaceId);
    const updated = await deps.editorialIdeaRepository.replaceContent(workspaceId, id, patch);
    if (!updated) throw new NotFoundError("Pauta não encontrada neste workspace.");
    return successEnvelope(updated, request.id);
  });

  app.delete("/editorial-ideas/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:update");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    if (!(await deps.editorialIdeaRepository.delete(workspaceId, id))) throw new NotFoundError("Pauta não encontrada neste workspace.");
    return successEnvelope({ deleted: true }, request.id);
  });

  app.patch("/editorial-ideas/:id", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:update");
    const { id } = request.params as { id: string };
    const { workspaceId, status, scheduledDate, executionRunId, creativePrompt } = request.body as { workspaceId: string; status?: EditorialIdeaStatus; scheduledDate?: string | null; executionRunId?: string | null; creativePrompt?: string | null };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    if (typeof scheduledDate === "string" && !isIsoDate(scheduledDate)) throw new ValidationError("Data do calendário inválida (use AAAA-MM-DD).");
    // Enviar `null` ou string vazia remove o prompt; uma string é validada/aparada antes de gravar.
    let creativePromptPatch: string | null | undefined;
    if (creativePrompt !== undefined) {
      try {
        creativePromptPatch = creativePrompt === null ? null : (normalizeCreativePrompt(creativePrompt) ?? null);
      } catch (error) {
        throw new ValidationError(error instanceof EditorialPackError ? error.message.replace(/^EDITORIAL_PACK_INVALID:\s*/, "") : "Prompt criativo inválido.");
      }
    }
    const updated = await deps.editorialIdeaRepository.update(workspaceId, id, {
      ...(status ? { status } : {}),
      ...(scheduledDate !== undefined ? { scheduledDate } : {}),
      ...(executionRunId !== undefined ? { executionRunId } : {}),
      ...(creativePromptPatch !== undefined ? { creativePrompt: creativePromptPatch } : {}),
    });
    if (!updated) throw new NotFoundError("Pauta não encontrada neste workspace.");
    return successEnvelope(updated, request.id);
  });

  app.post("/editorial-ideas/calendar", { schema: { body: CALENDAR_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:update");
    const { workspaceId, startDate, days } = request.body as { workspaceId: string; startDate?: string; days?: number };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    const start = startDate ?? todayInSaoPaulo(now());
    if (!isIsoDate(start)) throw new ValidationError("Data inicial inválida (use AAAA-MM-DD).");
    const ideas = await deps.editorialIdeaRepository.listByWorkspace(workspaceId);
    const assignments = buildEditorialCalendar(ideas, { startDate: start, days: days ?? 30 });
    for (const assignment of assignments) await deps.editorialIdeaRepository.update(workspaceId, assignment.ideaId, { scheduledDate: assignment.date });
    return successEnvelope({ startDate: start, scheduled: assignments.length, ideas: await deps.editorialIdeaRepository.listByWorkspace(workspaceId) }, request.id);
  });

  app.get("/editorial-ideas/:id/brief", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "asset:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: principal.tenantId, workspaceId });
    const idea = await deps.editorialIdeaRepository.get(workspaceId, id);
    if (!idea) throw new NotFoundError("Pauta não encontrada neste workspace.");
    if (!isGeneratableFormat(idea.format)) throw new ValidationError("Pautas de vídeo seguem para produção manual; o motor de ideias gera imagem única e carrossel.");
    return successEnvelope(buildEditorialGenerationBrief(idea), request.id);
  });
}
