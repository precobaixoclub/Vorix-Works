import type { FastifyInstance } from "fastify";
import type { MeetingRepositoryPort } from "../../../../application/ports/meeting-repository.port.js";
import { MEETING_TRANSCRIPTION_ENGINES, type MeetingTranscriptionEngine } from "../../../../domain/meetings/meeting.model.js";
import { ValidationError } from "../../http/app-error.js";
import { requirePlatformAdmin } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

export type MeetingsTranscriptionAdminDeps = {
  repository: MeetingRepositoryPort;
  /** Há chave da OpenAI cadastrada (cofre ou ambiente)? Só informa a tela; nunca devolve a chave. */
  openAiKeyConfigured: () => Promise<boolean>;
  now: () => Date;
};

const UPDATE_BODY = {
  type: "object",
  required: ["engine"],
  additionalProperties: false,
  properties: {
    engine: { type: "string", enum: [...MEETING_TRANSCRIPTION_ENGINES] },
    /** Escolher a OpenAI exige confirmar que ela gera custo externo. */
    acceptExternalCost: { type: "boolean" },
  },
} as const;

/** Painel → Transcrição de reuniões: motor global (local otimizado é o padrão; OpenAI só por escolha explícita). */
export async function registerMeetingsTranscriptionAdminRoutes(app: FastifyInstance, deps: MeetingsTranscriptionAdminDeps): Promise<void> {
  const view = async () => ({ ...(await deps.repository.getTranscriptionSettings()), openAiKeyConfigured: await deps.openAiKeyConfigured().catch(() => false) });

  app.get("/admin/meetings/transcription-settings", async (request) => {
    requirePlatformAdmin(request);
    return successEnvelope(await view(), request.id);
  });

  app.put("/admin/meetings/transcription-settings", { schema: { body: UPDATE_BODY }, config: { readOnlyGuard: true } }, async (request) => {
    const principal = requirePlatformAdmin(request);
    const body = request.body as { engine: MeetingTranscriptionEngine; acceptExternalCost?: boolean };
    if (body.engine === "OPENAI_OPTIONAL" && body.acceptExternalCost !== true) throw new ValidationError("Confirme que a transcrição pela OpenAI gera custo externo por minuto de áudio.");
    await deps.repository.setTranscriptionSettings({ engine: body.engine, updatedBy: principal.userId, now: deps.now() });
    return successEnvelope(await view(), request.id);
  });
}
