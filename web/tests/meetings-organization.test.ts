import { describe, expect, it } from "vitest";
import { activeGlobalItem, buildGlobalNavigation } from "@/components/global-navigation";
import { upcomingMeetings } from "@/features/home/model";
import {
  DETAIL_SECTIONS, LIBRARY_VIEWS, detailSectionsFor, groupActionItems, libraryView, meetingAvailability, meetingsOverview, microphoneSupport, processingSteps, resolveDetailSection,
} from "@/features/meetings/organization";
import type { MeetingDetail, MeetingListItem } from "@/features/meetings/types";
import { MEETINGS_MAX_RETRIES, shouldRetryMeetingsRequest } from "@/features/meetings/swr-retry";
import { ApiError } from "@/lib/api-error";

const NOW = new Date("2026-11-23T12:00:00");
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

function item(over: Partial<MeetingListItem> = {}): MeetingListItem {
  return {
    id: "m", workspaceId: "ws", ownerUserId: "u", createdByUserId: "u", title: "Reunião", source: "calendar", status: "scheduled", timezone: "America/Sao_Paulo",
    statusChangedAt: at(-1), createdAt: at(-48), updatedAt: at(-1), participantCount: 0, participants: [], hasRecording: false, recordingBytes: 0, hasAnalysis: false, ...over,
  };
}

function detail(over: Partial<MeetingDetail> = {}): MeetingDetail {
  const { participantCount: _p, hasRecording: _h, recordingBytes: _b, hasAnalysis: _a, transcriptStatus: _t, ...base } = item();
  return { ...base, participants: [], recordings: [], ...over } as MeetingDetail;
}
const file = { id: "r1", kind: "original" as const, mimeType: "audio/webm", bytes: 1000, checksumSha256: "x", status: "available" as const, createdAt: at(-2) };

describe("Reuniões — menu (Fase 9)", () => {
  const meetings = buildGlobalNavigation(["meetings"]).find((area) => area.key === "meetings")!;

  it("quatro destinos de trabalho e um bloco de configurações, sem itens duplicados", () => {
    expect(meetings.items.filter((entry) => entry.section === "Reuniões").map((entry) => entry.label)).toEqual(["Visão geral", "Agenda", "Gravações", "Análises"]);
    expect(meetings.items.filter((entry) => entry.section === "Configurações").map((entry) => entry.label)).toEqual(["Preferências", "Agenda e integrações", "Contas de gravação"]);
    expect(new Set(meetings.items.map((entry) => entry.href)).size).toBe(meetings.items.length);
    expect(meetings.items.some((entry) => entry.href === "/meetings/recordings")).toBe(false);
  });

  it("o endereço antigo /meetings/recordings acende Gravações; detalhe de reunião também", () => {
    expect(activeGlobalItem("/workspaces/ws/meetings/recordings", "/workspaces/ws", meetings)).toBe("/meetings/central");
    expect(activeGlobalItem("/workspaces/ws/meetings/central/m-1", "/workspaces/ws", meetings)).toBe("/meetings/central");
    expect(activeGlobalItem("/workspaces/ws/meetings/ask", "/workspaces/ws", meetings)).toBe("/meetings/ask");
  });

  it("Configurações ganha Reuniões só quando a conta tem Reuniões", () => {
    const settingsOf = (solutions: Parameters<typeof buildGlobalNavigation>[0]) => buildGlobalNavigation(solutions).find((area) => area.key === "settings")!.items.map((entry) => entry.href);
    expect(settingsOf(["meetings"])).toEqual(["/settings", "/meetings/settings"]);
    expect(settingsOf(["conversations"])).not.toContain("/meetings/settings");
  });
});

describe("biblioteca de gravações", () => {
  it("visões por ?visao=, com fallback para Todas", () => {
    expect(LIBRARY_VIEWS.map((view) => view.key)).toEqual(["todas", "gravadas", "transcritas", "analisadas", "agendadas", "falhas"]);
    expect(libraryView("gravadas").filters).toEqual({ hasRecording: true });
    expect(libraryView("agendadas").filters).toEqual({ status: "scheduled" });
    expect(libraryView("qualquer-coisa").key).toBe("todas");
    expect(libraryView(null).key).toBe("todas");
    const analyzed = libraryView("analisadas");
    expect([item({ hasAnalysis: true }), item({ hasAnalysis: false })].filter(analyzed.only!)).toHaveLength(1);
  });

  it("agendada sem arquivo nunca aparece como gravada", () => {
    expect(meetingAvailability(item())).toMatchObject({ recording: "none", recordingLabel: "Ainda não gravada", scheduledOnly: true });
    expect(meetingAvailability(item({ status: "recording" }))).toMatchObject({ recording: "live", scheduledOnly: false });
    expect(meetingAvailability(item({ status: "completed", hasRecording: true, transcriptStatus: "completed", hasAnalysis: true }))).toMatchObject({ recording: "available", transcriptLabel: "Transcrição: Pronta", analysisLabel: "Análise disponível" });
    expect(meetingAvailability(item({ status: "completed", source: "upload", hasRecording: false }))).toMatchObject({ recording: "none", recordingLabel: "Sem gravação" });
  });
});

describe("visão geral", () => {
  const list = [
    item({ id: "past", scheduledStartAt: at(-3) }),
    item({ id: "later", scheduledStartAt: at(30) }),
    item({ id: "soon", scheduledStartAt: at(2) }),
    item({ id: "rec", status: "recording" }),
    item({ id: "proc", status: "transcribing", hasRecording: true, transcriptStatus: "running" }),
    item({ id: "wait", status: "completed", hasRecording: true, transcriptStatus: "completed", hasAnalysis: false, statusChangedAt: at(-5) }),
    item({ id: "done", status: "completed", hasRecording: true, transcriptStatus: "completed", hasAnalysis: true, statusChangedAt: at(-2) }),
    item({ id: "fail", status: "failed", statusChangedAt: at(-1) }),
  ];
  const overview = meetingsOverview(list, NOW);

  it("próximas na ordem, só do futuro, com a mesma regra do Início", () => {
    expect(overview.upcoming.map((meeting) => meeting.id)).toEqual(["soon", "later"]);
    expect(overview.upcoming.map((meeting) => meeting.id)).toEqual(upcomingMeetings(list, NOW).map((meeting) => meeting.id));
    expect(overview.todayCount).toBe(1);
  });

  it("separa gravando, processando, aguardando análise e atividade recente", () => {
    expect(overview.recordingNow.map((meeting) => meeting.id)).toEqual(["rec"]);
    expect(overview.processing.map((meeting) => meeting.id)).toEqual(["proc"]);
    expect(overview.awaitingAnalysis.map((meeting) => meeting.id)).toEqual(["wait"]);
    expect(overview.recent.map((meeting) => meeting.id)).toEqual(["fail", "done", "wait"]);
    expect(meetingsOverview(undefined, NOW)).toMatchObject({ upcoming: [], recent: [], todayCount: 0 });
  });
});

describe("andamento do processamento", () => {
  const state = (meeting: MeetingDetail) => processingSteps(meeting).map((step) => `${step.key}:${step.state}`);

  it("agendada: nada feito ainda", () => {
    expect(state(detail())).toEqual(["recording:todo", "transcript:todo", "analysis:todo"]);
  });
  it("gravando agora", () => {
    expect(state(detail({ status: "recording" }))).toEqual(["recording:current", "transcript:todo", "analysis:todo"]);
  });
  it("transcrição na fila e falha de transcrição", () => {
    const transcript = { id: "t", segmentCount: 0, attempts: 1 };
    expect(state(detail({ status: "processing", recordings: [file], transcript: { ...transcript, status: "queued" } }))).toEqual(["recording:done", "transcript:current", "analysis:todo"]);
    expect(state(detail({ status: "failed", recordings: [file], transcript: { ...transcript, status: "failed" } }))).toEqual(["recording:done", "transcript:failed", "analysis:todo"]);
  });
  it("análise pronta, sem créditos ou com falha", () => {
    const transcript = { id: "t", status: "completed" as const, segmentCount: 12, attempts: 1 };
    const result = { executiveSummary: "s", topics: [], decisions: [], actionItems: [], nextSteps: [], risks: [], objections: [], openQuestions: [] };
    expect(state(detail({ status: "completed", recordings: [file], transcript, latestAnalysis: { id: "a", status: "completed", result, creditsCharged: 1, createdAt: at(-1) } }))).toEqual(["recording:done", "transcript:done", "analysis:done"]);
    expect(state(detail({ status: "completed", recordings: [file], transcript, latestAnalysis: { id: "a", status: "blocked_no_credits", creditsCharged: 0, createdAt: at(-1) } }))).toContain("analysis:blocked");
    expect(state(detail({ status: "completed", recordings: [file], transcript, latestAnalysis: { id: "a", status: "failed", creditsCharged: 0, createdAt: at(-1) } }))).toContain("analysis:failed");
  });
  it("falha antes de existir arquivo", () => {
    expect(state(detail({ status: "failed", failureMessage: "O organizador não admitiu o gravador." }))).toEqual(["recording:failed", "transcript:todo", "analysis:todo"]);
  });
});

describe("detalhe da reunião", () => {
  it("reunião só agendada não mostra seções que dependem de gravação ou transcrição", () => {
    const values = detailSectionsFor(detail()).map((section) => section.value);
    expect(values).toEqual(["overview", "participants", "recording", "crm", "technical"]);
  });
  it("com gravação, todas as seções voltam — as mesmas 13 de antes", () => {
    expect(detailSectionsFor(detail({ recordings: [file] }))).toHaveLength(13);
    expect(DETAIL_SECTIONS.map((section) => section.value).sort()).toEqual(["actions", "ask", "clips", "crm", "followup", "overview", "participants", "recording", "share", "speakers", "summary", "technical", "transcript"]);
  });
  it("?secao= aceita nomes em português e cai na visão geral quando a seção não se aplica", () => {
    const full = detailSectionsFor(detail({ recordings: [file] }));
    expect(resolveDetailSection("transcricao", full)).toBe("transcript");
    expect(resolveDetailSection("resumo", full)).toBe("summary");
    expect(resolveDetailSection("summary", full)).toBe("summary");
    expect(resolveDetailSection("summary", detailSectionsFor(detail()))).toBe("overview");
    expect(resolveDetailSection(null, full)).toBe("overview");
  });
  it("decisões, tarefas e próximos passos separados", () => {
    const base = { status: "suggested" as const, description: "x" };
    const groups = groupActionItems([{ ...base, id: "1", type: "decision" }, { ...base, id: "2", type: "task" }, { ...base, id: "3", type: "next_step" }, { ...base, id: "4", type: "task" }]);
    expect([groups.decision.length, groups.task.length, groups.next_step.length]).toEqual([1, 2, 1]);
  });
});

describe("gravação pelo microfone", () => {
  it("só oferece gravar quando o navegador consegue", () => {
    expect(microphoneSupport({ MediaRecorder: class {}, mediaDevices: { getUserMedia: () => undefined }, isSecureContext: true })).toEqual({ supported: true });
    expect(microphoneSupport({ mediaDevices: { getUserMedia: () => undefined }, isSecureContext: true }).supported).toBe(false);
    expect(microphoneSupport({ MediaRecorder: class {}, isSecureContext: true }).supported).toBe(false);
    expect(microphoneSupport({ MediaRecorder: class {}, mediaDevices: { getUserMedia: () => undefined }, isSecureContext: false })).toMatchObject({ supported: false, reason: expect.stringContaining("https") });
  });
});

describe("retentativas depois de erro", () => {
  it("404/403 não ficam consultando a API sem fim; rede e servidor tentam no máximo 3 vezes", () => {
    expect(shouldRetryMeetingsRequest(new ApiError("NOT_FOUND", "x", 404, false), 0)).toBe(false);
    expect(shouldRetryMeetingsRequest(new ApiError("FORBIDDEN", "x", 403, false), 0)).toBe(false);
    expect(shouldRetryMeetingsRequest(new ApiError("RATE_LIMITED", "x", 429, true), 0)).toBe(true);
    expect(shouldRetryMeetingsRequest(new ApiError("INTERNAL", "x", 500, true), 0)).toBe(true);
    expect(shouldRetryMeetingsRequest(new ApiError("NETWORK_ERROR", "x", 0, true), MEETINGS_MAX_RETRIES - 1)).toBe(true);
    expect(shouldRetryMeetingsRequest(new ApiError("INTERNAL", "x", 500, true), MEETINGS_MAX_RETRIES)).toBe(false);
  });
});
