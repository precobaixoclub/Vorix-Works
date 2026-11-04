import { DEFAULT_MEETING_TRANSCRIPTION_ENGINE, type MeetingTranscriptionEngine, type TranscriptionResult } from "../../domain/meetings/meeting.model.js";
import { MeetingJobError, type TranscriptionEnginePort } from "./meeting-processing.js";

export const TRANSCRIPTION_ENGINE_LABEL: Record<MeetingTranscriptionEngine, string> = {
  LOCAL_FASTER_WHISPER: "Local otimizado",
  LOCAL_WHISPER_CPP: "Local econômico",
  OPENAI_OPTIONAL: "OpenAI",
};

/**
 * Motor efetivo de cada transcrição: o escolhido no painel administrativo (lido a cada job, então
 * trocar no painel vale para a próxima reunião sem reiniciar o worker). Sem configuração legível,
 * usa o local otimizado — nunca cai sozinho para a OpenAI.
 */
export class ConfiguredTranscriptionEngine implements TranscriptionEnginePort {
  constructor(private readonly deps: { selected: () => Promise<MeetingTranscriptionEngine>; engines: Partial<Record<MeetingTranscriptionEngine, TranscriptionEnginePort>> }) {}

  async transcribe(input: { wavPath: string; language?: string; timeoutMs: number }): Promise<TranscriptionResult> {
    const engine = await this.deps.selected().catch(() => DEFAULT_MEETING_TRANSCRIPTION_ENGINE);
    const implementation = this.deps.engines[engine];
    if (!implementation) throw new MeetingJobError(`O motor de transcrição "${TRANSCRIPTION_ENGINE_LABEL[engine]}" não está instalado neste servidor. Escolha outro no painel administrativo e tente novamente.`, false);
    return implementation.transcribe(input);
  }
}
