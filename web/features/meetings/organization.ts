import { LIVE_MEETING_STATUSES, type MeetingActionItem, type MeetingDetail, type MeetingListFilters, type MeetingListItem, type MeetingStatus } from "./types";

/**
 * Reorganização de UX — Fase 9 (Reuniões). Regras puras da nova organização: visões da biblioteca de
 * gravações, panorama da Visão geral, andamento do processamento, seções do detalhe e suporte à
 * gravação pelo microfone. Tudo derivado dos dados que a API JÁ devolve — nada é inventado.
 */

// --------------------------------------------------------------------------- Biblioteca (Gravações)

export type LibraryViewKey = "todas" | "gravadas" | "transcritas" | "analisadas" | "agendadas" | "falhas";

export type LibraryView = {
  key: LibraryViewKey;
  label: string;
  /** Filtros enviados à API (os mesmos que a Central já aceitava). */
  filters: MeetingListFilters;
  /** Refinamento local quando a API não tem o filtro (análise disponível vem em cada item). */
  only?: (item: MeetingListItem) => boolean;
  empty: string;
};

export const LIBRARY_VIEWS: readonly LibraryView[] = [
  { key: "todas", label: "Todas", filters: {}, empty: "Nenhuma reunião ainda. Grave uma reunião, envie um arquivo ou agende pela Agenda." },
  { key: "gravadas", label: "Gravadas", filters: { hasRecording: true }, empty: "Nenhuma gravação ainda. Grave uma reunião ou envie um arquivo." },
  { key: "transcritas", label: "Com transcrição", filters: { hasTranscript: true }, empty: "Nenhuma transcrição pronta ainda. Ela sai alguns minutos depois da gravação." },
  { key: "analisadas", label: "Com análise da IA", filters: { hasTranscript: true }, only: (item) => item.hasAnalysis, empty: "Nenhuma análise pronta ainda. A IA resume a reunião depois da transcrição." },
  { key: "agendadas", label: "Agendadas", filters: { status: "scheduled" }, empty: "Nenhuma reunião agendada. Agende pela Agenda ou crie uma nova reunião." },
  { key: "falhas", label: "Com falha", filters: { status: "failed" }, empty: "Nenhuma reunião com falha." },
];

/** `?visao=` → visão da biblioteca (valor desconhecido abre "Todas"). */
export function libraryView(param: string | null | undefined): LibraryView {
  return LIBRARY_VIEWS.find((view) => view.key === param) ?? LIBRARY_VIEWS[0]!;
}

export type Availability = {
  /** "live": gravando agora; "available": arquivo pronto; "none": não há arquivo. */
  recording: "live" | "available" | "none";
  recordingLabel: string;
  transcriptLabel: string;
  analysisLabel: string;
  /** Reunião só agendada (ainda não aconteceu ou não foi gravada). */
  scheduledOnly: boolean;
};

const TRANSCRIPT_SHORT: Record<NonNullable<MeetingListItem["transcriptStatus"]>, string> = { queued: "Na fila", running: "Transcrevendo", completed: "Pronta", failed: "Falhou" };

/** O que o registro realmente tem — uma reunião sem arquivo nunca aparece como "gravada". */
export function meetingAvailability(item: Pick<MeetingListItem, "status" | "hasRecording" | "transcriptStatus" | "hasAnalysis">): Availability {
  const live = item.status === "recording" || item.status === "waiting_admission" || item.status === "starting" || item.status === "queued";
  const recording = item.hasRecording ? "available" : live ? "live" : "none";
  return {
    recording,
    recordingLabel: recording === "available" ? "Gravação disponível" : recording === "live" ? "Gravação em andamento" : item.status === "scheduled" ? "Ainda não gravada" : "Sem gravação",
    transcriptLabel: item.transcriptStatus ? `Transcrição: ${TRANSCRIPT_SHORT[item.transcriptStatus]}` : "Sem transcrição",
    analysisLabel: item.hasAnalysis ? "Análise disponível" : "Sem análise",
    scheduledOnly: item.status === "scheduled" && !item.hasRecording,
  };
}

// --------------------------------------------------------------------------- Visão geral

const PROCESSING: readonly MeetingStatus[] = ["processing", "transcribing", "analyzing"];

export type MeetingsOverview = {
  /** Agendadas a partir de agora, da mais próxima para a mais distante. */
  upcoming: MeetingListItem[];
  /** Quantas das próximas são hoje (dia local). */
  todayCount: number;
  /** Gravando ou se preparando para gravar. */
  recordingNow: MeetingListItem[];
  /** Gravação terminada, transcrição/análise em andamento. */
  processing: MeetingListItem[];
  /** Transcrição pronta e análise ainda não disponível. */
  awaitingAnalysis: MeetingListItem[];
  /** Concluídas e com falha, das mais recentes para as mais antigas. */
  recent: MeetingListItem[];
};

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Panorama montado a partir da MESMA lista da Visão geral (nenhuma consulta extra). */
export function meetingsOverview(items: readonly MeetingListItem[] | undefined, now: Date, limits = { upcoming: 5, recent: 6 }): MeetingsOverview {
  const list = items ?? [];
  const upcomingAll = list
    .filter((meeting) => meeting.status === "scheduled" && meeting.scheduledStartAt && Date.parse(meeting.scheduledStartAt) >= now.getTime())
    .sort((a, b) => Date.parse(a.scheduledStartAt!) - Date.parse(b.scheduledStartAt!));
  const recordingNow = list.filter((meeting) => LIVE_MEETING_STATUSES.includes(meeting.status) && !PROCESSING.includes(meeting.status));
  const processing = list.filter((meeting) => PROCESSING.includes(meeting.status) || meeting.transcriptStatus === "queued" || meeting.transcriptStatus === "running");
  const awaitingAnalysis = list.filter((meeting) => meeting.transcriptStatus === "completed" && !meeting.hasAnalysis && meeting.status !== "analyzing" && meeting.status !== "failed");
  const recent = list
    .filter((meeting) => meeting.status === "completed" || meeting.status === "failed")
    .sort((a, b) => Date.parse(b.statusChangedAt) - Date.parse(a.statusChangedAt))
    .slice(0, limits.recent);
  return {
    upcoming: upcomingAll.slice(0, limits.upcoming),
    todayCount: upcomingAll.filter((meeting) => sameLocalDay(new Date(meeting.scheduledStartAt!), now)).length,
    recordingNow,
    processing: processing.filter((meeting) => !recordingNow.includes(meeting)),
    awaitingAnalysis,
    recent,
  };
}

// --------------------------------------------------------------------------- Andamento do processamento

export type StepState = "done" | "current" | "todo" | "failed" | "blocked";
export type ProcessingStep = { key: "recording" | "transcript" | "analysis"; label: string; state: StepState; detail: string };

/** Gravação → Transcrição → Análise, com o estado REAL de cada etapa. */
export function processingSteps(meeting: Pick<MeetingDetail, "status" | "recordings" | "transcript" | "latestAnalysis" | "lastCompletedAnalysis" | "failureMessage">): ProcessingStep[] {
  const hasFile = meeting.recordings.some((recording) => recording.status === "available");
  const live = ["queued", "starting", "waiting_admission", "recording"].includes(meeting.status);
  const recording: ProcessingStep = hasFile
    ? { key: "recording", label: "Gravação", state: "done", detail: "Arquivo salvo" }
    : live
      ? { key: "recording", label: "Gravação", state: "current", detail: meeting.status === "recording" ? "Gravando agora" : "Preparando o gravador" }
      : meeting.status === "failed" && !meeting.transcript
        ? { key: "recording", label: "Gravação", state: "failed", detail: meeting.failureMessage ?? "A gravação não foi concluída" }
        : { key: "recording", label: "Gravação", state: "todo", detail: meeting.status === "scheduled" ? "Ainda não gravada" : "Sem gravação" };

  const transcriptState = meeting.transcript?.status;
  const transcript: ProcessingStep = !meeting.transcript
    ? { key: "transcript", label: "Transcrição", state: "todo", detail: hasFile ? "Aguardando início" : "Depende da gravação" }
    : transcriptState === "completed"
      ? { key: "transcript", label: "Transcrição", state: "done", detail: `${meeting.transcript.segmentCount} ${meeting.transcript.segmentCount === 1 ? "trecho" : "trechos"}` }
      : transcriptState === "failed"
        ? { key: "transcript", label: "Transcrição", state: "failed", detail: "Falhou — a gravação continua salva" }
        : { key: "transcript", label: "Transcrição", state: "current", detail: transcriptState === "queued" ? "Na fila" : "Transcrevendo" };

  const latest = meeting.latestAnalysis;
  const shown = latest?.result ? latest : meeting.lastCompletedAnalysis?.result ? meeting.lastCompletedAnalysis : latest;
  const analysis: ProcessingStep = shown?.result
    ? { key: "analysis", label: "Análise da IA", state: "done", detail: "Resumo disponível" }
    : latest?.status === "blocked_no_credits"
      ? { key: "analysis", label: "Análise da IA", state: "blocked", detail: "Sem créditos de IA" }
      : latest?.status === "failed"
        ? { key: "analysis", label: "Análise da IA", state: "failed", detail: "A análise falhou" }
        : meeting.status === "analyzing"
          ? { key: "analysis", label: "Análise da IA", state: "current", detail: "Gerando o resumo" }
          : { key: "analysis", label: "Análise da IA", state: "todo", detail: transcriptState === "completed" ? "Aguardando análise" : "Depende da transcrição" };

  return [recording, transcript, analysis];
}

// --------------------------------------------------------------------------- Detalhe da reunião

export type DetailSectionKey = "overview" | "participants" | "recording" | "transcript" | "speakers" | "summary" | "actions" | "ask" | "followup" | "crm" | "clips" | "share" | "technical";

export const DETAIL_SECTIONS: readonly { value: DetailSectionKey; label: string; group: string; needsContent?: boolean }[] = [
  { value: "overview", label: "Visão geral", group: "Reunião" },
  { value: "participants", label: "Participantes", group: "Reunião" },
  { value: "recording", label: "Gravação", group: "Gravação e transcrição" },
  { value: "transcript", label: "Transcrição", group: "Gravação e transcrição", needsContent: true },
  { value: "speakers", label: "Falantes e palavras", group: "Gravação e transcrição", needsContent: true },
  { value: "summary", label: "Resumo", group: "Análise da IA", needsContent: true },
  { value: "actions", label: "Decisões e próximos passos", group: "Análise da IA", needsContent: true },
  { value: "ask", label: "Pergunte à reunião", group: "Análise da IA", needsContent: true },
  { value: "followup", label: "Follow-up", group: "Ações", needsContent: true },
  { value: "crm", label: "CRM", group: "Ações" },
  { value: "clips", label: "Trechos e comentários", group: "Ações", needsContent: true },
  { value: "share", label: "Compartilhar e exportar", group: "Ações", needsContent: true },
  { value: "technical", label: "Informações técnicas", group: "Ações" },
];

/** Nomes antigos/curtos aceitos em `?secao=` (links de fora, Início, notificações). */
const SECTION_ALIASES: Readonly<Record<string, DetailSectionKey>> = { transcricao: "transcript", resumo: "summary", analise: "summary", decisoes: "actions", tarefas: "actions", gravacao: "recording", participantes: "participants", compartilhar: "share" };

/**
 * Seções que fazem sentido para o registro: sem gravação, transcrição nem análise (ex.: reunião só
 * agendada), as seções que dependem desse conteúdo não aparecem — nada de telas vazias.
 */
export function detailSectionsFor(meeting: Pick<MeetingDetail, "recordings" | "transcript" | "latestAnalysis" | "lastCompletedAnalysis">) {
  const hasContent = meeting.recordings.length > 0 || Boolean(meeting.transcript) || Boolean(meeting.latestAnalysis) || Boolean(meeting.lastCompletedAnalysis);
  return DETAIL_SECTIONS.filter((section) => hasContent || !section.needsContent);
}

export function resolveDetailSection(param: string | null | undefined, available: readonly { value: DetailSectionKey }[]): DetailSectionKey {
  const key = (param && (SECTION_ALIASES[param] ?? param)) as DetailSectionKey | undefined;
  return available.some((section) => section.value === key) ? key! : "overview";
}

/** Itens da análise separados por tipo — a IA SUGERE; quem confirma é a pessoa. */
export function groupActionItems(items: readonly MeetingActionItem[]) {
  return {
    decision: items.filter((item) => item.type === "decision"),
    task: items.filter((item) => item.type === "task"),
    next_step: items.filter((item) => item.type === "next_step"),
  };
}

// --------------------------------------------------------------------------- Gravação pelo microfone

export type MicSupport = { supported: true } | { supported: false; reason: string };

/** O navegador grava áudio? Sem MediaRecorder/getUserMedia, o botão não é oferecido. */
export function microphoneSupport(env: { MediaRecorder?: unknown; mediaDevices?: { getUserMedia?: unknown }; isSecureContext?: boolean }): MicSupport {
  if (env.isSecureContext === false) return { supported: false, reason: "A gravação pelo microfone só funciona em conexão segura (https)." };
  if (!env.mediaDevices?.getUserMedia) return { supported: false, reason: "Este navegador não dá acesso ao microfone. Use o Chrome, o Edge, o Firefox ou o Safari atualizado." };
  if (!env.MediaRecorder) return { supported: false, reason: "Este navegador não consegue gravar áudio. Use o Chrome, o Edge, o Firefox ou o Safari atualizado." };
  return { supported: true };
}

export function browserMicrophoneSupport(): MicSupport {
  if (typeof window === "undefined") return { supported: false, reason: "" };
  return microphoneSupport({ MediaRecorder: (window as { MediaRecorder?: unknown }).MediaRecorder, mediaDevices: navigator.mediaDevices, isSecureContext: window.isSecureContext });
}
