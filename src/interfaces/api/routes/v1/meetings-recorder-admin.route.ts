import type { FastifyInstance } from "fastify";
import { disableRecorderBot, provisionRecorderBot, requestRecorderBotHealthCheck, type RecorderBotAdminDeps } from "../../../../application/meetings/recorder-bot-admin.js";
import { AppError } from "../../http/app-error.js";
import { requirePlatformAdmin } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const BOT_PARAMS = { type: "object", required: ["botId"], properties: { botId: { type: "string", minLength: 1, maxLength: 100 } } } as const;
const BOT_BODY = {
  type: "object",
  required: ["id", "label", "googleEmail"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1, maxLength: 100 },
    label: { type: "string", minLength: 1, maxLength: 120 },
    googleEmail: { type: "string", minLength: 3, maxLength: 320 },
    displayName: { type: "string", minLength: 1, maxLength: 120 },
  },
} as const;
const SESSION_BODY = {
  type: "object",
  required: ["storageState"],
  additionalProperties: false,
  properties: { storageState: { type: "object", required: ["cookies"], properties: { cookies: { type: "array" }, origins: { type: "array" } }, additionalProperties: true } },
} as const;

export async function registerMeetingsRecorderAdminRoutes(app: FastifyInstance, deps: RecorderBotAdminDeps): Promise<void> {
  app.get("/admin/meetings/recorder-bots", async (request) => {
    requirePlatformAdmin(request);
    return successEnvelope({ bots: await deps.repository.listRecorderBots() }, request.id);
  });

  app.post("/admin/meetings/recorder-bots", { schema: { body: BOT_BODY }, config: { readOnlyGuard: true } }, async (request, reply) => {
    requirePlatformAdmin(request);
    try {
      const bot = await provisionRecorderBot(deps, request.body as { id: string; label: string; googleEmail: string; displayName?: string });
      reply.code(201);
      return successEnvelope(bot, request.id);
    } catch (error) { translate(error); }
  });

  app.put("/admin/meetings/recorder-bots/:botId/session", { schema: { params: BOT_PARAMS, body: SESSION_BODY }, config: { readOnlyGuard: true } }, async (request) => {
    requirePlatformAdmin(request);
    const { botId } = request.params as { botId: string };
    const { storageState } = request.body as { storageState: unknown };
    try {
      const current = (await deps.repository.listRecorderBots()).find((bot) => bot.id === botId);
      if (!current) throw new Error("RECORDER_BOT_NOT_FOUND");
      return successEnvelope(await provisionRecorderBot(deps, { id: current.id, label: current.label, googleEmail: current.googleEmail, displayName: current.displayName, storageState }), request.id);
    } catch (error) { translate(error); }
  });

  app.post("/admin/meetings/recorder-bots/:botId/health-check", { schema: { params: BOT_PARAMS }, config: { readOnlyGuard: true } }, async (request, reply) => {
    requirePlatformAdmin(request);
    const { botId } = request.params as { botId: string };
    try {
      const bot = await requestRecorderBotHealthCheck(deps, botId);
      reply.code(202);
      return successEnvelope(bot, request.id);
    } catch (error) { translate(error); }
  });

  app.post("/admin/meetings/recorder-bots/:botId/disable", { schema: { params: BOT_PARAMS }, config: { readOnlyGuard: true } }, async (request) => {
    requirePlatformAdmin(request);
    const { botId } = request.params as { botId: string };
    try { return successEnvelope(await disableRecorderBot(deps, botId), request.id); }
    catch (error) { translate(error); }
  });
}

function translate(error: unknown): never {
  const code = error instanceof Error ? error.message : "RECORDER_BOT_ERROR";
  const statusCode = code.includes("NOT_FOUND") ? 404 : code.includes("BUSY") ? 409 : 400;
  throw new AppError({ code, message: recorderMessage(code), statusCode, recoverable: statusCode === 409 });
}

function recorderMessage(code: string): string {
  if (code === "RECORDER_BOT_SESSION_REQUIRED") return "Provisione uma sessao Google antes de testar o bot.";
  if (code.includes("BUSY")) return "O bot esta ocupado em uma gravacao.";
  if (code.includes("NOT_FOUND")) return "Bot de gravacao nao encontrado.";
  return "Os dados do bot ou da sessao Google sao invalidos.";
}
