import { createHash, randomBytes } from "node:crypto";
import {
  computeTalkAnalytics,
  findKeywordHits,
  formatTimestamp,
  isMeetingSummaryTemplate,
  MEETING_TEMPLATE_DEFINITIONS,
  normalizeKeywordTerms,
  speakerDisplayName,
  type AutoRecordMode,
  type MeetingKeywordHit,
  type MeetingKeywordTracker,
  type MeetingSummaryTemplate,
  type MeetingTalkAnalytics,
} from "../../domain/meetings/meeting-intelligence.js";
import { hasPermission } from "../../domain/identity/identity.model.js";
import { meetingUsagePeriod, type MeetingDetail, type MeetingTranscriptSegment } from "../../domain/meetings/meeting.model.js";
import type {
  MeetingClipRecord,
  MeetingCommentRecord,
  MeetingFollowUpDraft,
  MeetingInsightsRepositoryPort,
  MeetingQuestionRecord,
  MeetingShareRecord,
  MeetingTenantSettings,
  MeetingUserPreferences,
} from "../ports/meeting-insights-repository.port.js";
import { MeetingError, MEETING_PLAYBACK_URL_TTL_SECONDS, requireVisibleMeeting, type MeetingActor, type MeetingUseCaseDeps } from "./meeting-use-cases.js";

/**
 * Vorix Meetings — inteligência e colaboração sobre a reunião: modelos de resumo, nomes dos
 * falantes, estatísticas de fala, "pergunte à reunião", follow-up (e-mail/WhatsApp), vínculo com o
 * CRM e tarefas, compartilhamento por link, exportação, trechos, comentários, palavras monitoradas,
 * preferências e exclusão definitiva (LGPD).
 *
 * CRM e WhatsApp entram por PORTS (o Meetings continua sem importar `crm`/`inbox`): quem compõe a
 * API liga os adapters quando o tenant também tem essas soluções.
 */

export type MeetingAiPort = {
  answerQuestion(input: {
    tenantId: string;
    workspaceId: string;
    question: string;
    language: string;
    sources: { meetingId: string; title: string; date?: string; segments: { startMs: number; speaker?: string; text: string }[] }[];
    idempotencyKey: string;
  }): Promise<{ ok: true; answer: MeetingQuestionRecord["answer"] } | { ok: false; category: string; message: string }>;
  generateFollowUp(input: {
    tenantId: string;
    workspaceId: string;
    title: string;
    language: string;
    recipientName?: string;
    senderName?: string;
    executiveSummary: string;
    decisions: string[];
    nextSteps: string[];
    tasks: { description: string; owner?: string; dueDate?: string }[];
    idempotencyKey: string;
  }): Promise<{ ok: true; draft: Omit<MeetingFollowUpDraft, "generatedAt"> } | { ok: false; category: string; message: string }>;
};

export type MeetingCrmContact = { id: string; name: string; company?: string; whatsappPhone?: string };
export type MeetingCrmDeal = { id: string; title: string; valueCents: number; currency: string; won: boolean; lost: boolean };

export type MeetingCrmPort = {
  searchContacts(input: { tenantId: string; workspaceId: string; query: string; limit: number }): Promise<MeetingCrmContact[]>;
  getContact(input: { tenantId: string; workspaceId: string; contactId: string }): Promise<MeetingCrmContact | undefined>;
  listDeals(input: { tenantId: string; workspaceId: string; contactId: string }): Promise<MeetingCrmDeal[]>;
  getDeal(input: { tenantId: string; workspaceId: string; dealId: string }): Promise<(MeetingCrmDeal & { contactId?: string }) | undefined>;
  createTask(input: { tenantId: string; workspaceId: string; title: string; description?: string; dueAt?: string; ownerUserId?: string; contactId?: string; dealId?: string }): Promise<{ taskId: string }>;
};

export type MeetingMessagingPort = {
  /** O tenant tem o Vorix Conversas liberado (o envio usa os números de lá). */
  isAvailable(tenantId: string): Promise<boolean>;
  listWhatsAppChannels(input: { tenantId: string; workspaceId: string }): Promise<{ id: string; label: string }[]>;
  sendWhatsApp(input: { tenantId: string; workspaceId: string; connectionId: string; phone: string; contactName?: string; body: string; userId: string }): Promise<{ conversationId: string }>;
};

export type MeetingIntelligenceDeps = MeetingUseCaseDeps & {
  insights: MeetingInsightsRepositoryPort;
  ai?: MeetingAiPort;
  crm?: MeetingCrmPort;
  messaging?: MeetingMessagingPort;
  /** Base pública do site para montar o link compartilhado (ex.: https://app.vorixworks.com). */
  publicAppUrl: string;
};

const cleanText = (value: string | undefined, max: number) => value?.trim().slice(0, max) || undefined;

function analysisOf(meeting: MeetingDetail) {
  return meeting.lastCompletedAnalysis?.result ?? meeting.latestAnalysis?.result;
}

// ── Painel de inteligência ───────────────────────────────────────────────────────────────────

export type MeetingInsightsView = {
  summaryTemplate: MeetingSummaryTemplate;
  templates: { key: MeetingSummaryTemplate; label: string; description: string }[];
  speakers: { key: string; displayName: string; renamed: boolean }[];
  talk: MeetingTalkAnalytics;
  keywordHits: MeetingKeywordHit[];
  clips: MeetingClipRecord[];
  comments: MeetingCommentRecord[];
  shares: MeetingShareRecord[];
  followUp?: MeetingFollowUpDraft;
  crm: { contact?: MeetingCrmContact; deal?: MeetingCrmDeal; available: boolean; suggestions: MeetingCrmContact[] };
  crmTasks: Record<string, string>;
  questions: MeetingQuestionRecord[];
  whatsAppAvailable: boolean;
  aiAvailable: boolean;
};

export async function getMeetingInsights(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string }): Promise<MeetingInsightsView> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const [record, names, segments, trackers, clips, comments, shares, crmTasks, questions] = await Promise.all([
    deps.insights.getInsights({ tenantId: actor.tenantId, meetingId: meeting.id }),
    deps.insights.listSpeakerNames({ tenantId: actor.tenantId, meetingId: meeting.id }),
    deps.repository.getTranscriptSegments({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id }),
    deps.insights.listKeywordTrackers({ tenantId: actor.tenantId, workspaceId: input.workspaceId }),
    deps.insights.listClips({ tenantId: actor.tenantId, meetingId: meeting.id }),
    deps.insights.listComments({ tenantId: actor.tenantId, meetingId: meeting.id }),
    deps.insights.listShares({ tenantId: actor.tenantId, meetingId: meeting.id }),
    deps.insights.actionItemCrmTasks({ tenantId: actor.tenantId, meetingId: meeting.id }),
    deps.insights.listQuestions({ tenantId: actor.tenantId, meetingId: meeting.id, userId: actor.userId, limit: 20 }),
  ]);
  const speakerKeys = [...new Set(segments.map((segment) => segment.speaker).filter((speaker): speaker is string => !!speaker))];
  const preferences = record ? undefined : await deps.insights.getUserPreferences({ tenantId: actor.tenantId, userId: meeting.ownerUserId });

  let contact: MeetingCrmContact | undefined;
  let deal: MeetingCrmDeal | undefined;
  let suggestions: MeetingCrmContact[] = [];
  if (deps.crm) {
    try {
      if (record?.crmContactId) contact = await deps.crm.getContact({ tenantId: actor.tenantId, workspaceId: input.workspaceId, contactId: record.crmContactId });
      if (record?.crmDealId) deal = await deps.crm.getDeal({ tenantId: actor.tenantId, workspaceId: input.workspaceId, dealId: record.crmDealId });
      if (!contact) suggestions = await suggestCrmContacts(deps, actor, input.workspaceId, meeting);
    } catch {
      // CRM indisponível nunca derruba a tela da reunião.
    }
  }
  return {
    summaryTemplate: record?.summaryTemplate ?? preferences?.defaultTemplate ?? "general",
    templates: Object.values(MEETING_TEMPLATE_DEFINITIONS).map(({ key, label, description }) => ({ key, label, description })),
    speakers: speakerKeys.map((key) => ({ key, displayName: speakerDisplayName(key, names)!, renamed: names.has(key) })),
    talk: computeTalkAnalytics(segments, names),
    keywordHits: findKeywordHits(segments, trackers),
    clips,
    comments,
    shares,
    ...(record?.followUp ? { followUp: record.followUp } : {}),
    crm: { ...(contact ? { contact } : {}), ...(deal ? { deal } : {}), available: !!deps.crm, suggestions },
    crmTasks: Object.fromEntries(crmTasks),
    questions,
    whatsAppAvailable: deps.messaging ? await deps.messaging.isAvailable(actor.tenantId).catch(() => false) : false,
    aiAvailable: !!deps.ai,
  };
}

/** Sugestões de contato do CRM pelo nome (ou parte do e-mail) dos participantes. */
async function suggestCrmContacts(deps: MeetingIntelligenceDeps, actor: MeetingActor, workspaceId: string, meeting: MeetingDetail): Promise<MeetingCrmContact[]> {
  if (!deps.crm) return [];
  const queries = [...new Set(meeting.participants
    .filter((participant) => !participant.userId)
    .map((participant) => participant.name?.trim() || participant.email?.split("@")[0]?.replace(/[._-]+/g, " ").trim())
    .filter((query): query is string => !!query && query.length >= 3))].slice(0, 5);
  const found = new Map<string, MeetingCrmContact>();
  for (const query of queries) {
    for (const contact of await deps.crm.searchContacts({ tenantId: actor.tenantId, workspaceId, query, limit: 3 })) found.set(contact.id, contact);
  }
  return [...found.values()].slice(0, 6);
}

// ── Modelo de resumo e falantes ──────────────────────────────────────────────────────────────

export async function setMeetingSummaryTemplate(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; template: string; reanalyze?: boolean }): Promise<{ template: MeetingSummaryTemplate; reanalysisQueued: boolean }> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  if (!isMeetingSummaryTemplate(input.template)) throw new MeetingError("MEETING_INVALID_INPUT", "Modelo de resumo inválido.");
  await deps.insights.upsertInsights({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, patch: { summaryTemplate: input.template } });
  let reanalysisQueued = false;
  if (input.reanalyze && meeting.transcript?.status === "completed") {
    if (!hasPermission(actor.role, "meeting:analyze")) throw new MeetingError("MEETING_INVALID_INPUT", "Seu papel não permite gerar uma nova análise.");
    const queued = await deps.repository.enqueueAnalysis({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id });
    if (!queued.alreadyActive) await deps.repository.reopenForReprocessing({ tenantId: actor.tenantId, meetingId: meeting.id, status: "analyzing" });
    reanalysisQueued = true;
  }
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "meeting.template_set", details: { template: input.template, reanalysisQueued } });
  return { template: input.template, reanalysisQueued };
}

export async function renameMeetingSpeaker(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; speakerKey: string; displayName: string }): Promise<void> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const segments = await deps.repository.getTranscriptSegments({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id });
  if (!segments.some((segment) => segment.speaker === input.speakerKey)) throw new MeetingError("MEETING_NOT_FOUND", "Falante não encontrado nesta transcrição.");
  const displayName = cleanText(input.displayName, 80);
  await deps.insights.setSpeakerName({ tenantId: actor.tenantId, meetingId: meeting.id, speakerKey: input.speakerKey, displayName: displayName ?? null, userId: actor.userId });
}

/** Segmentos com o nome de exibição do falante aplicado (para IA, exportação e link público). */
async function namedSegments(deps: MeetingIntelligenceDeps, tenantId: string, workspaceId: string, meetingId: string): Promise<MeetingTranscriptSegment[]> {
  const [segments, names] = await Promise.all([
    deps.repository.getTranscriptSegments({ tenantId, workspaceId, meetingId }),
    deps.insights.listSpeakerNames({ tenantId, meetingId }),
  ]);
  return segments.map((segment) => (segment.speaker ? { ...segment, speaker: speakerDisplayName(segment.speaker, names) } : segment));
}

// ── Pergunte à reunião ───────────────────────────────────────────────────────────────────────

const MAX_QUESTION_CHARS = 500;

export async function askMeetings(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId?: string; question: string }): Promise<MeetingQuestionRecord> {
  if (!deps.ai) throw new MeetingError("MEETING_STORAGE_UNAVAILABLE", "A inteligência artificial não está disponível neste ambiente.");
  const question = cleanText(input.question, MAX_QUESTION_CHARS);
  if (!question || question.length < 3) throw new MeetingError("MEETING_INVALID_INPUT", "Escreva a sua pergunta.");

  let sources: Parameters<MeetingAiPort["answerQuestion"]>[0]["sources"];
  let language = "pt";
  if (input.meetingId) {
    const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
    if (meeting.transcript?.status !== "completed") throw new MeetingError("MEETING_INVALID_INPUT", "A transcrição desta reunião ainda não está pronta.");
    language = meeting.transcript.language ?? "pt";
    const segments = await namedSegments(deps, actor.tenantId, input.workspaceId, meeting.id);
    sources = [{ meetingId: meeting.id, title: meeting.title, ...(meeting.scheduledStartAt ? { date: meeting.scheduledStartAt.slice(0, 10) } : {}), segments: segments.map(({ startMs, speaker, text }) => ({ startMs, ...(speaker ? { speaker } : {}), text })) }];
  } else {
    const visibleTo = hasPermission(actor.role, "meeting:read_all") ? undefined : actor.userId;
    const hits = await deps.insights.searchSegments({ tenantId: actor.tenantId, workspaceId: input.workspaceId, ...(visibleTo ? { visibleToUserId: visibleTo } : {}), query: question, limit: 40 });
    if (!hits.length) {
      return deps.insights.saveQuestion({ id: deps.idGenerator("mqa"), tenantId: actor.tenantId, workspaceId: input.workspaceId, userId: actor.userId, question, answer: { answer: "Não encontrei nada sobre isso nas transcrições das suas reuniões.", found: false, citations: [] }, creditsCharged: 0 });
    }
    const byMeeting = new Map<string, NonNullable<typeof sources>[number]>();
    for (const hit of hits) {
      const source = byMeeting.get(hit.meetingId) ?? { meetingId: hit.meetingId, title: hit.title, ...(hit.scheduledStartAt ? { date: hit.scheduledStartAt.slice(0, 10) } : {}), segments: [] };
      source.segments.push({ startMs: hit.segment.startMs, ...(hit.segment.speaker ? { speaker: hit.segment.speaker } : {}), text: hit.segment.text });
      byMeeting.set(hit.meetingId, source);
    }
    sources = [...byMeeting.values()];
  }

  const id = deps.idGenerator("mqa");
  const outcome = await deps.ai.answerQuestion({ tenantId: actor.tenantId, workspaceId: input.workspaceId, question, language, sources, idempotencyKey: `meeting_question_answer:${id}` });
  if (!outcome.ok) {
    if (outcome.category === "quota_exceeded") throw new MeetingError("MEETING_STORAGE_LIMIT_REACHED", "Seus créditos de IA acabaram. Recarregue para continuar perguntando.");
    throw new MeetingError("MEETING_STORAGE_UNAVAILABLE", "Não foi possível responder agora. Tente de novo em instantes.");
  }
  const creditsCharged = await deps.repository.operationCreditsCost("meeting_question_answer");
  const saved = await deps.insights.saveQuestion({ id, tenantId: actor.tenantId, workspaceId: input.workspaceId, ...(input.meetingId ? { meetingId: input.meetingId } : {}), userId: actor.userId, question, answer: outcome.answer, creditsCharged });
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, ...(input.meetingId ? { meetingId: input.meetingId } : {}), actorUserId: actor.userId, action: "meeting.question_asked", details: { scope: input.meetingId ? "meeting" : "all", sources: sources.length, creditsCharged } });
  return saved;
}

export async function listMeetingQuestions(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId?: string }): Promise<MeetingQuestionRecord[]> {
  if (input.meetingId) await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  return deps.insights.listQuestions({ tenantId: actor.tenantId, ...(input.meetingId ? { meetingId: input.meetingId } : {}), userId: actor.userId, limit: 30 });
}

// ── Follow-up ────────────────────────────────────────────────────────────────────────────────

export async function generateMeetingFollowUp(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; recipientName?: string; senderName?: string }): Promise<MeetingFollowUpDraft> {
  if (!deps.ai) throw new MeetingError("MEETING_STORAGE_UNAVAILABLE", "A inteligência artificial não está disponível neste ambiente.");
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const analysis = analysisOf(meeting);
  if (!analysis) throw new MeetingError("MEETING_INVALID_INPUT", "Gere o resumo da reunião antes do follow-up.");
  const outcome = await deps.ai.generateFollowUp({
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    title: meeting.title,
    language: meeting.transcript?.language ?? "pt",
    ...(cleanText(input.recipientName, 80) ? { recipientName: cleanText(input.recipientName, 80) } : {}),
    ...(cleanText(input.senderName, 80) ? { senderName: cleanText(input.senderName, 80) } : {}),
    executiveSummary: analysis.executiveSummary,
    decisions: analysis.decisions,
    nextSteps: analysis.nextSteps,
    tasks: analysis.actionItems,
    idempotencyKey: `meeting_follow_up:${deps.idGenerator("mfu")}`,
  });
  if (!outcome.ok) {
    if (outcome.category === "quota_exceeded") throw new MeetingError("MEETING_STORAGE_LIMIT_REACHED", "Seus créditos de IA acabaram. Recarregue para gerar o follow-up.");
    throw new MeetingError("MEETING_STORAGE_UNAVAILABLE", "Não foi possível gerar o follow-up agora. Tente de novo em instantes.");
  }
  const draft: MeetingFollowUpDraft = { ...outcome.draft, generatedAt: deps.now().toISOString() };
  await deps.insights.upsertInsights({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, patch: { followUp: draft } });
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "meeting.follow_up_generated" });
  return draft;
}

export async function sendMeetingFollowUpWhatsApp(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; connectionId: string; phone?: string; contactId?: string; message: string }): Promise<{ conversationId: string }> {
  if (!deps.messaging || !(await deps.messaging.isAvailable(actor.tenantId))) throw new MeetingError("MEETING_STORAGE_UNAVAILABLE", "O Vorix Conversas não está disponível para esta conta.");
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const body = cleanText(input.message, 4000);
  if (!body) throw new MeetingError("MEETING_INVALID_INPUT", "Escreva a mensagem.");
  let phone = input.phone?.trim();
  let contactName: string | undefined;
  if (!phone && input.contactId && deps.crm) {
    const contact = await deps.crm.getContact({ tenantId: actor.tenantId, workspaceId: input.workspaceId, contactId: input.contactId });
    phone = contact?.whatsappPhone;
    contactName = contact?.name;
  }
  if (!phone) throw new MeetingError("MEETING_INVALID_INPUT", "Informe o WhatsApp do destinatário.");
  const result = await deps.messaging.sendWhatsApp({ tenantId: actor.tenantId, workspaceId: input.workspaceId, connectionId: input.connectionId, phone, ...(contactName ? { contactName } : {}), body, userId: actor.userId });
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "meeting.follow_up_sent_whatsapp", details: { conversationId: result.conversationId } });
  return result;
}

// ── CRM ──────────────────────────────────────────────────────────────────────────────────────

export async function linkMeetingToCrm(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; contactId?: string | null; dealId?: string | null }): Promise<{ contact?: MeetingCrmContact; deal?: MeetingCrmDeal }> {
  if (!deps.crm) throw new MeetingError("MEETING_STORAGE_UNAVAILABLE", "O CRM não está disponível para esta conta.");
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  let contact: MeetingCrmContact | undefined;
  let deal: (MeetingCrmDeal & { contactId?: string }) | undefined;
  if (input.contactId) {
    contact = await deps.crm.getContact({ tenantId: actor.tenantId, workspaceId: input.workspaceId, contactId: input.contactId });
    if (!contact) throw new MeetingError("MEETING_NOT_FOUND", "Contato não encontrado.");
  }
  if (input.dealId) {
    deal = await deps.crm.getDeal({ tenantId: actor.tenantId, workspaceId: input.workspaceId, dealId: input.dealId });
    if (!deal) throw new MeetingError("MEETING_NOT_FOUND", "Oportunidade não encontrada.");
    if (contact && deal.contactId && deal.contactId !== contact.id) throw new MeetingError("MEETING_INVALID_INPUT", "Esta oportunidade é de outro contato.");
  }
  await deps.insights.upsertInsights({
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    meetingId: meeting.id,
    patch: { ...(input.contactId !== undefined ? { crmContactId: input.contactId ?? null } : {}), ...(input.dealId !== undefined ? { crmDealId: input.dealId ?? null } : {}) },
  });
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "meeting.crm_linked", details: { contactId: input.contactId ?? null, dealId: input.dealId ?? null } });
  return { ...(contact ? { contact } : {}), ...(deal ? { deal } : {}) };
}

export async function searchMeetingCrm(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; query?: string; contactId?: string }): Promise<{ contacts: MeetingCrmContact[]; deals: MeetingCrmDeal[] }> {
  if (!deps.crm) return { contacts: [], deals: [] };
  const contacts = input.query?.trim() ? await deps.crm.searchContacts({ tenantId: actor.tenantId, workspaceId: input.workspaceId, query: input.query.trim().slice(0, 80), limit: 10 }) : [];
  const deals = input.contactId ? await deps.crm.listDeals({ tenantId: actor.tenantId, workspaceId: input.workspaceId, contactId: input.contactId }) : [];
  return { contacts, deals };
}

/** Tarefa da reunião vira tarefa REAL do CRM (decisão humana explícita, um clique). */
export async function createCrmTaskFromActionItem(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; itemId: string; dueAt?: string; ownerUserId?: string }): Promise<{ taskId: string }> {
  if (!deps.crm) throw new MeetingError("MEETING_STORAGE_UNAVAILABLE", "O CRM não está disponível para esta conta.");
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const existing = await deps.insights.actionItemCrmTasks({ tenantId: actor.tenantId, meetingId: meeting.id });
  const already = existing.get(input.itemId);
  if (already) return { taskId: already };
  const item = (meeting.lastCompletedAnalysis?.actionItems ?? meeting.latestAnalysis?.actionItems ?? []).find((candidate) => candidate.id === input.itemId);
  if (!item) throw new MeetingError("MEETING_NOT_FOUND", "Item não encontrado.");
  if (item.status === "dismissed") throw new MeetingError("MEETING_INVALID_INPUT", "Este item foi descartado.");
  if (input.dueAt && Number.isNaN(Date.parse(input.dueAt))) throw new MeetingError("MEETING_INVALID_INPUT", "Prazo inválido.");
  const record = await deps.insights.getInsights({ tenantId: actor.tenantId, meetingId: meeting.id });
  const details = [`Da reunião "${meeting.title}"${item.sourceTimestampMs !== undefined ? ` (em ${formatTimestamp(item.sourceTimestampMs)})` : ""}.`, item.assigneeName ? `Responsável citado: ${item.assigneeName}.` : "", item.dueDate ? `Prazo citado: ${item.dueDate}.` : ""].filter(Boolean).join(" ");
  const { taskId } = await deps.crm.createTask({
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    title: item.description.slice(0, 200),
    description: details,
    ...(input.dueAt ? { dueAt: new Date(input.dueAt).toISOString() } : {}),
    ownerUserId: input.ownerUserId ?? actor.userId,
    ...(record?.crmContactId ? { contactId: record.crmContactId } : {}),
    ...(record?.crmDealId ? { dealId: record.crmDealId } : {}),
  });
  await deps.insights.setActionItemCrmTask({ tenantId: actor.tenantId, meetingId: meeting.id, itemId: item.id, crmTaskId: taskId });
  if (item.status === "suggested") await deps.repository.decideActionItem({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, itemId: item.id, status: "confirmed", actorUserId: actor.userId });
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "action_item.crm_task_created", details: { itemId: item.id, taskId } });
  return { taskId };
}

// ── Compartilhamento por link e exportação ───────────────────────────────────────────────────

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createMeetingShare(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; includeTranscript: boolean; includeRecording: boolean; expiresInDays?: number }): Promise<{ share: MeetingShareRecord; url: string }> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const days = input.expiresInDays === undefined ? 30 : input.expiresInDays;
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new MeetingError("MEETING_INVALID_INPUT", "Validade inválida (0 a 365 dias; 0 = sem validade).");
  const token = randomBytes(24).toString("base64url");
  const share = await deps.insights.createShare({
    id: deps.idGenerator("mshare"),
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    meetingId: meeting.id,
    tokenHash: hashToken(token),
    includeTranscript: input.includeTranscript,
    includeRecording: input.includeRecording,
    ...(days > 0 ? { expiresAt: new Date(deps.now().getTime() + days * 86_400_000).toISOString() } : {}),
    createdBy: actor.userId,
  });
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "meeting.share_created", details: { shareId: share.id, includeTranscript: input.includeTranscript, includeRecording: input.includeRecording, expiresInDays: days } });
  // O token só existe AGORA (o banco guarda o hash): quem cria copia o link.
  return { share, url: `${deps.publicAppUrl.replace(/\/+$/, "")}/r/${token}` };
}

export async function revokeMeetingShare(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; shareId: string }): Promise<void> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const revoked = await deps.insights.revokeShare({ tenantId: actor.tenantId, meetingId: meeting.id, shareId: input.shareId });
  if (!revoked) throw new MeetingError("MEETING_NOT_FOUND", "Link não encontrado ou já desativado.");
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "meeting.share_revoked", details: { shareId: input.shareId } });
}

export type SharedMeetingView = {
  title: string;
  date?: string;
  durationSeconds?: number;
  summary?: { executiveSummary: string; decisions: string[]; nextSteps: string[]; actionItems: { description: string; owner?: string; dueDate?: string }[]; topics: string[]; templateSections?: { title: string; content: string }[] };
  transcript?: { startMs: number; speaker?: string; text: string }[];
  recording?: { url: string; mimeType: string };
  expiresAt?: string;
};

/** Página pública do link (sem login). Token inválido/expirado/revogado = "não encontrado". */
export async function getSharedMeeting(deps: MeetingIntelligenceDeps, input: { token: string }): Promise<SharedMeetingView> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(input.token)) throw new MeetingError("MEETING_NOT_FOUND", "Link inválido ou expirado.");
  const share = await deps.insights.consumeShareByTokenHash({ tokenHash: hashToken(input.token), now: deps.now() });
  if (!share) throw new MeetingError("MEETING_NOT_FOUND", "Link inválido ou expirado.");
  const meeting = await deps.repository.getDetail({ tenantId: share.tenantId, workspaceId: share.workspaceId, meetingId: share.meetingId });
  if (!meeting) throw new MeetingError("MEETING_NOT_FOUND", "Link inválido ou expirado.");
  const analysis = analysisOf(meeting);
  const view: SharedMeetingView = {
    title: meeting.title,
    ...(meeting.scheduledStartAt ? { date: meeting.scheduledStartAt } : { date: meeting.createdAt }),
    ...(meeting.durationSeconds ? { durationSeconds: meeting.durationSeconds } : {}),
    ...(analysis ? { summary: { executiveSummary: analysis.executiveSummary, decisions: analysis.decisions, nextSteps: analysis.nextSteps, actionItems: analysis.actionItems, topics: analysis.topics, ...(analysis.templateSections?.length ? { templateSections: analysis.templateSections } : {}) } } : {}),
    ...(share.expiresAt ? { expiresAt: share.expiresAt } : {}),
  };
  if (share.includeTranscript) view.transcript = (await namedSegments(deps, share.tenantId, share.workspaceId, meeting.id)).map(({ startMs, speaker, text }) => ({ startMs, ...(speaker ? { speaker } : {}), text }));
  if (share.includeRecording) {
    const recording = meeting.recordings.find((item) => item.status === "available");
    const url = recording ? deps.media.signedReadUrl(recording.storageKey, MEETING_PLAYBACK_URL_TTL_SECONDS) : undefined;
    if (recording && url) view.recording = { url, mimeType: recording.mimeType };
  }
  await deps.repository.audit({ tenantId: share.tenantId, workspaceId: share.workspaceId, meetingId: meeting.id, action: "meeting.share_viewed", details: { shareId: share.id } });
  return view;
}

/** Exportação em Markdown (resumo + seções do modelo + tarefas + transcrição). */
export async function exportMeetingMarkdown(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; includeTranscript: boolean }): Promise<{ fileName: string; content: string }> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const analysis = analysisOf(meeting);
  const when = new Date(meeting.scheduledStartAt ?? meeting.createdAt).toLocaleString("pt-BR", { timeZone: meeting.timezone || "America/Sao_Paulo" });
  const list = (items: readonly string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "_Nada registrado._");
  const parts = [`# ${meeting.title}`, "", `**Data:** ${when}`, meeting.participants.length ? `**Participantes:** ${meeting.participants.map((participant) => participant.name || participant.email).filter(Boolean).join(", ")}` : "", ""];
  if (analysis) {
    parts.push("## Resumo", "", analysis.executiveSummary, "");
    for (const section of analysis.templateSections ?? []) parts.push(`## ${section.title}`, "", section.content, "");
    parts.push("## Decisões", "", list(analysis.decisions), "", "## Tarefas", "", list(analysis.actionItems.map((item) => `${item.description}${item.owner ? ` — ${item.owner}` : ""}${item.dueDate ? ` (prazo: ${item.dueDate})` : ""}`)), "", "## Próximos passos", "", list(analysis.nextSteps), "");
    if (analysis.openQuestions.length) parts.push("## Perguntas em aberto", "", list(analysis.openQuestions), "");
  }
  if (input.includeTranscript) {
    const segments = await namedSegments(deps, actor.tenantId, input.workspaceId, meeting.id);
    parts.push("## Transcrição", "", ...segments.map((segment) => `**[${formatTimestamp(segment.startMs)}]${segment.speaker ? ` ${segment.speaker}:` : ""}** ${segment.text}`), "");
  }
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, actorUserId: actor.userId, action: "meeting.exported", details: { format: "md", includeTranscript: input.includeTranscript } });
  const slug = meeting.title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "reuniao";
  return { fileName: `${slug}.md`, content: parts.filter((part, index, all) => !(part === "" && all[index - 1] === "")).join("\n") };
}

// ── Trechos e comentários ────────────────────────────────────────────────────────────────────

export async function createMeetingClip(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; startMs: number; endMs: number; title: string; note?: string }): Promise<MeetingClipRecord> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const title = cleanText(input.title, 120);
  if (!title) throw new MeetingError("MEETING_INVALID_INPUT", "Dê um nome ao trecho.");
  if (!Number.isInteger(input.startMs) || !Number.isInteger(input.endMs) || input.startMs < 0 || input.endMs <= input.startMs) throw new MeetingError("MEETING_INVALID_INPUT", "O fim do trecho precisa ser depois do início.");
  const note = cleanText(input.note, 1000);
  return deps.insights.createClip({ id: deps.idGenerator("mclip"), tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, startMs: input.startMs, endMs: input.endMs, title, ...(note ? { note } : {}), createdBy: actor.userId, createdAt: deps.now().toISOString() });
}

export async function deleteMeetingClip(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; clipId: string }): Promise<void> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  // Mesma regra dos comentários: cada pessoa apaga o próprio trecho; gestão apaga qualquer um.
  if (!hasPermission(actor.role, "meeting:read_all")) {
    const clip = (await deps.insights.listClips({ tenantId: actor.tenantId, meetingId: meeting.id })).find((item) => item.id === input.clipId);
    if (!clip || clip.createdBy !== actor.userId) throw new MeetingError("MEETING_NOT_FOUND", "Trecho não encontrado.");
  }
  if (!(await deps.insights.deleteClip({ tenantId: actor.tenantId, meetingId: meeting.id, clipId: input.clipId }))) throw new MeetingError("MEETING_NOT_FOUND", "Trecho não encontrado.");
}

export async function addMeetingComment(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; text: string; atMs?: number }): Promise<MeetingCommentRecord> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  const text = cleanText(input.text, 2000);
  if (!text) throw new MeetingError("MEETING_INVALID_INPUT", "Escreva o comentário.");
  if (input.atMs !== undefined && (!Number.isInteger(input.atMs) || input.atMs < 0)) throw new MeetingError("MEETING_INVALID_INPUT", "Momento inválido.");
  return deps.insights.createComment({ id: deps.idGenerator("mcmt"), tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id, ...(input.atMs !== undefined ? { atMs: input.atMs } : {}), text, userId: actor.userId, createdAt: deps.now().toISOString() });
}

export async function deleteMeetingComment(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; commentId: string }): Promise<void> {
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  // Cada pessoa apaga o próprio comentário; quem vê todas as reuniões (gestão) apaga qualquer um.
  const ownOnly = !hasPermission(actor.role, "meeting:read_all");
  if (!(await deps.insights.deleteComment({ tenantId: actor.tenantId, meetingId: meeting.id, commentId: input.commentId, ...(ownOnly ? { userId: actor.userId } : {}) }))) throw new MeetingError("MEETING_NOT_FOUND", "Comentário não encontrado.");
}

// ── Palavras monitoradas ─────────────────────────────────────────────────────────────────────

export async function listKeywordTrackers(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string }): Promise<MeetingKeywordTracker[]> {
  return deps.insights.listKeywordTrackers({ tenantId: actor.tenantId, workspaceId: input.workspaceId });
}

export async function saveKeywordTracker(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; trackerId?: string; label: string; terms: string[] }): Promise<MeetingKeywordTracker> {
  const label = cleanText(input.label, 60);
  const terms = normalizeKeywordTerms(input.terms);
  if (!label) throw new MeetingError("MEETING_INVALID_INPUT", "Dê um nome ao grupo de palavras.");
  if (!terms.length) throw new MeetingError("MEETING_INVALID_INPUT", "Informe pelo menos uma palavra ou expressão (2 a 60 caracteres).");
  try {
    if (input.trackerId) {
      const updated = await deps.insights.updateKeywordTracker({ tenantId: actor.tenantId, workspaceId: input.workspaceId, trackerId: input.trackerId, label, terms });
      if (!updated) throw new MeetingError("MEETING_NOT_FOUND", "Grupo de palavras não encontrado.");
      return updated;
    }
    return await deps.insights.createKeywordTracker({ id: deps.idGenerator("mkw"), tenantId: actor.tenantId, workspaceId: input.workspaceId, label, terms });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("MEETING_TRACKER_LABEL_TAKEN")) throw new MeetingError("MEETING_INVALID_INPUT", "Já existe um grupo de palavras com este nome.");
    throw error;
  }
}

export async function deleteKeywordTracker(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; trackerId: string }): Promise<void> {
  if (!(await deps.insights.deleteKeywordTracker({ tenantId: actor.tenantId, workspaceId: input.workspaceId, trackerId: input.trackerId }))) throw new MeetingError("MEETING_NOT_FOUND", "Grupo de palavras não encontrado.");
}

/** Visão consolidada: quantas reuniões citaram cada grupo de palavras no período. */
export async function keywordTrackerReport(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; from?: string; to?: string }): Promise<{ trackerId: string; label: string; meetings: number; mentions: number; latest: { meetingId: string; title: string; startMs: number; excerpt: string }[] }[]> {
  const trackers = await deps.insights.listKeywordTrackers({ tenantId: actor.tenantId, workspaceId: input.workspaceId });
  if (!trackers.length) return [];
  const visibleTo = hasPermission(actor.role, "meeting:read_all") ? undefined : actor.userId;
  const { items } = await deps.repository.list({ tenantId: actor.tenantId, workspaceId: input.workspaceId, ...(visibleTo ? { visibleToUserId: visibleTo } : {}), hasTranscript: true, ...(input.from ? { from: input.from } : {}), ...(input.to ? { to: input.to } : {}), limit: 100, offset: 0 });
  const report = new Map(trackers.map((tracker) => [tracker.id, { trackerId: tracker.id, label: tracker.label, meetings: 0, mentions: 0, latest: [] as { meetingId: string; title: string; startMs: number; excerpt: string }[] }]));
  for (const meeting of items) {
    const segments = await deps.repository.getTranscriptSegments({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id });
    for (const hit of findKeywordHits(segments, trackers, 3)) {
      const entry = report.get(hit.trackerId)!;
      entry.meetings += 1;
      entry.mentions += hit.count;
      if (entry.latest.length < 5 && hit.occurrences[0]) entry.latest.push({ meetingId: meeting.id, title: meeting.title, startMs: hit.occurrences[0].startMs, excerpt: hit.occurrences[0].excerpt });
    }
  }
  return [...report.values()];
}

// ── Preferências, aviso de gravação, uso do plano ────────────────────────────────────────────

export async function getMeetingPreferences(deps: MeetingIntelligenceDeps, actor: MeetingActor): Promise<MeetingUserPreferences & { tenant: MeetingTenantSettings }> {
  const [preferences, tenant] = await Promise.all([deps.insights.getUserPreferences({ tenantId: actor.tenantId, userId: actor.userId }), deps.insights.getTenantSettings(actor.tenantId)]);
  return { ...preferences, tenant };
}

export async function updateMeetingPreferences(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { autoRecordMode?: AutoRecordMode; defaultTemplate?: string; consentNoticeEnabled?: boolean; consentMessage?: string }): Promise<MeetingUserPreferences & { tenant: MeetingTenantSettings }> {
  if (input.defaultTemplate !== undefined && !isMeetingSummaryTemplate(input.defaultTemplate)) throw new MeetingError("MEETING_INVALID_INPUT", "Modelo de resumo inválido.");
  if (input.autoRecordMode !== undefined && !["off", "all", "external_only"].includes(input.autoRecordMode)) throw new MeetingError("MEETING_INVALID_INPUT", "Modo de gravação automática inválido.");
  if (input.autoRecordMode !== undefined || input.defaultTemplate !== undefined) {
    await deps.insights.setUserPreferences({ tenantId: actor.tenantId, userId: actor.userId, ...(input.autoRecordMode ? { autoRecordMode: input.autoRecordMode } : {}), ...(input.defaultTemplate ? { defaultTemplate: input.defaultTemplate as MeetingSummaryTemplate } : {}) });
  }
  if (input.consentNoticeEnabled !== undefined || input.consentMessage !== undefined) {
    // Aviso de gravação vale para a conta inteira: só quem administra integrações do Meetings altera.
    if (!hasPermission(actor.role, "meeting:manage_integrations")) throw new MeetingError("MEETING_INVALID_INPUT", "Só administradores alteram o aviso de gravação.");
    const message = input.consentMessage !== undefined ? cleanText(input.consentMessage, 500) : undefined;
    if (input.consentMessage !== undefined && !message) throw new MeetingError("MEETING_INVALID_INPUT", "Escreva o aviso de gravação.");
    await deps.insights.setTenantSettings({ tenantId: actor.tenantId, ...(input.consentNoticeEnabled !== undefined ? { consentNoticeEnabled: input.consentNoticeEnabled } : {}), ...(message ? { consentMessage: message } : {}) });
  }
  return getMeetingPreferences(deps, actor);
}

export async function getMeetingsUsage(deps: MeetingIntelligenceDeps, actor: MeetingActor): Promise<{ period: string; minutesUsed: number; minutesLimit: number; storageBytesUsed: number; storageBytesLimit: number; aiAnalyses: number }> {
  const period = meetingUsagePeriod(deps.now());
  const [usage, limits, storageBytesUsed] = await Promise.all([deps.insights.usageForPeriod({ tenantId: actor.tenantId, period }), deps.limitsFor(actor.tenantId), deps.repository.storageBytesInUse(actor.tenantId)]);
  return { period, minutesUsed: Math.round(usage.transcriptionSeconds / 60), minutesLimit: limits.monthlyRecordingMinutes, storageBytesUsed, storageBytesLimit: limits.maxStorageBytes, aiAnalyses: usage.aiAnalyses };
}

/** Limite mensal de minutos do plano (`monthlyRecordingMinutes`, 0 = sem limite). */
export async function assertMinutesAvailable(deps: Pick<MeetingIntelligenceDeps, "insights" | "limitsFor" | "now">, tenantId: string): Promise<void> {
  const limits = await deps.limitsFor(tenantId);
  if (!limits.monthlyRecordingMinutes) return;
  const usage = await deps.insights.usageForPeriod({ tenantId, period: meetingUsagePeriod(deps.now()) });
  if (usage.transcriptionSeconds >= limits.monthlyRecordingMinutes * 60) {
    throw new MeetingError("MEETING_STORAGE_LIMIT_REACHED", `Você usou os ${limits.monthlyRecordingMinutes} minutos de gravação do seu plano neste mês. Amplie o plano ou aguarde o próximo mês.`);
  }
}

// ── LGPD ─────────────────────────────────────────────────────────────────────────────────────

/** Exclusão DEFINITIVA (pedido do titular, LGPD): apaga arquivos, transcrição, análise e tudo
 * ligado à reunião. Diferente da exclusão comum (lógica). Só quem pode excluir reuniões. */
export async function purgeMeetingPermanently(deps: MeetingIntelligenceDeps, actor: MeetingActor, input: { workspaceId: string; meetingId: string; confirmTitle: string }): Promise<void> {
  if (!hasPermission(actor.role, "meeting:delete")) throw new MeetingError("MEETING_NOT_FOUND", "Reunião não encontrada.");
  const meeting = await requireVisibleMeeting(deps, actor, input.workspaceId, input.meetingId);
  if (input.confirmTitle.trim() !== meeting.title.trim()) throw new MeetingError("MEETING_INVALID_INPUT", "Digite o título exato da reunião para confirmar a exclusão definitiva.");
  if (["queued", "starting", "waiting_admission", "recording", "processing", "transcribing", "analyzing"].includes(meeting.status)) throw new MeetingError("MEETING_ACTIVE_CANNOT_DELETE", "Aguarde a gravação terminar de ser processada antes de excluir definitivamente.");
  const keys = await deps.insights.mediaKeys({ tenantId: actor.tenantId, meetingId: meeting.id });
  for (const key of keys) await deps.media.delete(key).catch(() => undefined);
  // A auditoria fica (sem conteúdo da reunião): prova de que a exclusão foi feita e por quem.
  await deps.repository.audit({ tenantId: actor.tenantId, workspaceId: input.workspaceId, actorUserId: actor.userId, action: "meeting.purged_permanently", details: { meetingId: meeting.id, mediaFiles: keys.length } });
  await deps.insights.purgeMeetingPermanently({ tenantId: actor.tenantId, workspaceId: input.workspaceId, meetingId: meeting.id });
}
