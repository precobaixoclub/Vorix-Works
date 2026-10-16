/**
 * Vorix Meetings — inteligência sobre a reunião (puro, sem I/O): modelos de resumo, nomes e
 * estatísticas de quem falou, palavras monitoradas e regra de "reunião externa" da gravação
 * automática.
 */

import type { MeetingTranscriptSegment } from "./meeting.model.js";

// ── Modelos de resumo ────────────────────────────────────────────────────────────────────────

export const MEETING_SUMMARY_TEMPLATES = ["general", "sales", "internal", "one_on_one", "interview", "support"] as const;
export type MeetingSummaryTemplate = (typeof MEETING_SUMMARY_TEMPLATES)[number];

export type MeetingTemplateDefinition = {
  key: MeetingSummaryTemplate;
  label: string;
  description: string;
  /** Seções extras que a IA preenche (além do resumo/decisões/tarefas padrão). */
  sections: readonly { title: string; instruction: string }[];
};

export const MEETING_TEMPLATE_DEFINITIONS: Readonly<Record<MeetingSummaryTemplate, MeetingTemplateDefinition>> = {
  general: { key: "general", label: "Geral", description: "Resumo, decisões, tarefas e próximos passos.", sections: [] },
  sales: {
    key: "sales",
    label: "Vendas (BANT)",
    description: "Qualificação da oportunidade: orçamento, decisor, necessidade e prazo.",
    sections: [
      { title: "Orçamento (Budget)", instruction: "Valores, faixa de investimento ou restrições de orçamento citados pelo cliente." },
      { title: "Decisor (Authority)", instruction: "Quem decide, quem influencia e como é o processo de aprovação." },
      { title: "Necessidade (Need)", instruction: "Dores, problemas e objetivos que o cliente quer resolver." },
      { title: "Prazo (Timeline)", instruction: "Quando o cliente quer começar/decidir e eventos que pressionam o prazo." },
      { title: "Concorrentes citados", instruction: "Outras soluções ou fornecedores mencionados e o que foi dito sobre eles." },
      { title: "Sinais de compra e próximos passos comerciais", instruction: "Interesse explícito, pedidos de proposta, demonstração ou contrato." },
    ],
  },
  internal: {
    key: "internal",
    label: "Reunião interna",
    description: "Andamento, bloqueios e responsáveis do time.",
    sections: [
      { title: "Andamento", instruction: "Status de cada frente/projeto discutido." },
      { title: "Bloqueios", instruction: "O que está travando o trabalho e quem pode destravar." },
    ],
  },
  one_on_one: {
    key: "one_on_one",
    label: "1:1 (líder e liderado)",
    description: "Feedback, metas e desenvolvimento.",
    sections: [
      { title: "Feedback", instruction: "Feedbacks dados e recebidos, positivos e de melhoria." },
      { title: "Metas e desenvolvimento", instruction: "Objetivos, planos de desenvolvimento e apoio combinados." },
      { title: "Bem-estar e preocupações", instruction: "Preocupações pessoais ou profissionais que a pessoa trouxe (sem julgamentos)." },
    ],
  },
  interview: {
    key: "interview",
    label: "Entrevista de emprego",
    description: "Pontos fortes, pontos de atenção e próximos passos do processo.",
    sections: [
      { title: "Experiência relevante", instruction: "Experiências e resultados que o candidato descreveu." },
      { title: "Pontos fortes", instruction: "Pontos fortes evidenciados na conversa." },
      { title: "Pontos de atenção", instruction: "Lacunas ou dúvidas que surgiram. Nunca faça julgamento sobre características pessoais protegidas." },
      { title: "Expectativas do candidato", instruction: "Pretensão, disponibilidade e expectativas citadas." },
    ],
  },
  support: {
    key: "support",
    label: "Atendimento / suporte",
    description: "Problema, causa, solução e satisfação do cliente.",
    sections: [
      { title: "Problema relatado", instruction: "O que o cliente relatou, com detalhes técnicos citados." },
      { title: "Causa identificada", instruction: "Causa raiz, se foi identificada na conversa." },
      { title: "Solução ou encaminhamento", instruction: "O que foi feito ou combinado para resolver." },
      { title: "Satisfação do cliente", instruction: "Como o cliente reagiu ao final (só o que foi dito)." },
    ],
  },
};

export function isMeetingSummaryTemplate(value: unknown): value is MeetingSummaryTemplate {
  return typeof value === "string" && (MEETING_SUMMARY_TEMPLATES as readonly string[]).includes(value);
}

// ── Quem falou ───────────────────────────────────────────────────────────────────────────────

/** "SPEAKER_00" (pyannote) → "Falante 1". Qualquer outra chave é exibida como está. */
export function defaultSpeakerLabel(speakerKey: string): string {
  const match = /^SPEAKER_(\d+)$/i.exec(speakerKey.trim());
  return match ? `Falante ${Number(match[1]) + 1}` : speakerKey;
}

export function speakerDisplayName(speakerKey: string | undefined, names: ReadonlyMap<string, string>): string | undefined {
  if (!speakerKey) return undefined;
  return names.get(speakerKey) ?? defaultSpeakerLabel(speakerKey);
}

export type SpeakerStats = {
  speaker: string;
  displayName: string;
  talkMs: number;
  /** Fração do tempo total de fala (0–1). */
  share: number;
  turns: number;
  longestMonologueMs: number;
  questions: number;
  wordsPerMinute: number;
};

export type MeetingTalkAnalytics = {
  hasSpeakers: boolean;
  totalTalkMs: number;
  speakers: SpeakerStats[];
  /** Quantas vezes a palavra passou de uma pessoa para outra. */
  speakerSwitches: number;
  longestMonologue?: { speaker: string; displayName: string; startMs: number; durationMs: number };
  questions: number;
};

const QUESTION_PATTERN = /\?\s*$|\?\s+\S/;

/**
 * Estatísticas de fala a partir dos segmentos com falante. Monólogo = falas consecutivas da MESMA
 * pessoa (pausas curtas entre segmentos não quebram o monólogo).
 */
export function computeTalkAnalytics(segments: readonly MeetingTranscriptSegment[], names: ReadonlyMap<string, string> = new Map()): MeetingTalkAnalytics {
  const withSpeaker = segments.filter((segment) => segment.speaker);
  const questionsTotal = segments.filter((segment) => QUESTION_PATTERN.test(segment.text)).length;
  if (!withSpeaker.length) return { hasSpeakers: false, totalTalkMs: segments.reduce((sum, s) => sum + Math.max(0, s.endMs - s.startMs), 0), speakers: [], speakerSwitches: 0, questions: questionsTotal };

  const stats = new Map<string, { talkMs: number; turns: number; longest: number; questions: number; words: number }>();
  let switches = 0;
  let current: { speaker: string; startMs: number; endMs: number } | undefined;
  let longest: MeetingTalkAnalytics["longestMonologue"];
  const closeRun = () => {
    if (!current) return;
    const duration = current.endMs - current.startMs;
    const entry = stats.get(current.speaker)!;
    entry.longest = Math.max(entry.longest, duration);
    if (!longest || duration > longest.durationMs) longest = { speaker: current.speaker, displayName: speakerDisplayName(current.speaker, names)!, startMs: current.startMs, durationMs: duration };
  };
  for (const segment of [...withSpeaker].sort((a, b) => a.startMs - b.startMs)) {
    const speaker = segment.speaker!;
    const entry = stats.get(speaker) ?? { talkMs: 0, turns: 0, longest: 0, questions: 0, words: 0 };
    stats.set(speaker, entry);
    entry.talkMs += Math.max(0, segment.endMs - segment.startMs);
    entry.words += segment.text.split(/\s+/).filter(Boolean).length;
    if (QUESTION_PATTERN.test(segment.text)) entry.questions += 1;
    if (current && current.speaker === speaker) {
      current.endMs = Math.max(current.endMs, segment.endMs);
    } else {
      if (current) switches += 1;
      closeRun();
      current = { speaker, startMs: segment.startMs, endMs: segment.endMs };
      entry.turns += 1;
    }
  }
  closeRun();
  const totalTalkMs = [...stats.values()].reduce((sum, entry) => sum + entry.talkMs, 0);
  const speakers = [...stats.entries()]
    .map(([speaker, entry]): SpeakerStats => ({
      speaker,
      displayName: speakerDisplayName(speaker, names)!,
      talkMs: entry.talkMs,
      share: totalTalkMs ? entry.talkMs / totalTalkMs : 0,
      turns: entry.turns,
      longestMonologueMs: entry.longest,
      questions: entry.questions,
      wordsPerMinute: entry.talkMs ? Math.round(entry.words / (entry.talkMs / 60_000)) : 0,
    }))
    .sort((a, b) => b.talkMs - a.talkMs);
  return { hasSpeakers: true, totalTalkMs, speakers, speakerSwitches: switches, ...(longest ? { longestMonologue: longest } : {}), questions: questionsTotal };
}

// ── Palavras monitoradas ─────────────────────────────────────────────────────────────────────

export type MeetingKeywordTracker = { id: string; label: string; terms: string[] };
export type MeetingKeywordHit = { trackerId: string; label: string; count: number; occurrences: { startMs: number; term: string; speaker?: string; excerpt: string }[] };

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Ocorrências de cada grupo de termos (sem diferenciar acentos/maiúsculas, por palavra inteira). */
export function findKeywordHits(segments: readonly MeetingTranscriptSegment[], trackers: readonly MeetingKeywordTracker[], maxOccurrences = 20): MeetingKeywordHit[] {
  return trackers
    .map((tracker) => {
      const patterns = tracker.terms.map((term) => term.trim()).filter(Boolean).map((term) => ({ term, regex: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(fold(term))}(?=$|[^\\p{L}\\p{N}])`, "giu") }));
      const occurrences: MeetingKeywordHit["occurrences"] = [];
      let count = 0;
      for (const segment of segments) {
        const text = fold(segment.text);
        for (const { term, regex } of patterns) {
          const matches = text.match(regex)?.length ?? 0;
          if (!matches) continue;
          count += matches;
          if (occurrences.length < maxOccurrences) occurrences.push({ startMs: segment.startMs, term, ...(segment.speaker ? { speaker: segment.speaker } : {}), excerpt: segment.text.slice(0, 200) });
        }
      }
      return { trackerId: tracker.id, label: tracker.label, count, occurrences };
    })
    .filter((hit) => hit.count > 0);
}

export function normalizeKeywordTerms(raw: readonly string[]): string[] {
  const byFolded = new Map<string, string>();
  for (const term of raw.map((value) => value.trim().replace(/\s+/g, " ")).filter((value) => value.length >= 2 && value.length <= 60)) {
    if (!byFolded.has(fold(term))) byFolded.set(fold(term), term);
  }
  return [...byFolded.values()].slice(0, 30);
}

// ── Gravação automática ──────────────────────────────────────────────────────────────────────

export const AUTO_RECORD_MODES = ["off", "all", "external_only"] as const;
export type AutoRecordMode = (typeof AUTO_RECORD_MODES)[number];

const PUBLIC_EMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "yahoo.com", "yahoo.com.br", "icloud.com", "uol.com.br", "bol.com.br", "terra.com.br"]);

/** Reunião "externa" = tem participante de outro domínio que o da pessoa (ou qualquer participante
 * quando a pessoa usa e-mail pessoal, em que não há domínio da empresa para comparar). */
export function isExternalMeeting(ownerEmail: string | undefined, participantEmails: readonly (string | undefined)[]): boolean {
  const ownerDomain = ownerEmail?.split("@")[1]?.toLowerCase();
  const others = participantEmails.map((email) => email?.trim().toLowerCase()).filter((email): email is string => !!email && email !== ownerEmail?.toLowerCase());
  if (!others.length) return false;
  if (!ownerDomain || PUBLIC_EMAIL_DOMAINS.has(ownerDomain)) return true;
  return others.some((email) => email.split("@")[1] !== ownerDomain);
}

export function shouldAutoRecord(mode: AutoRecordMode, input: { hasMeetLink: boolean; ownerEmail?: string; participantEmails: readonly (string | undefined)[] }): boolean {
  if (!input.hasMeetLink || mode === "off") return false;
  return mode === "all" || isExternalMeeting(input.ownerEmail, input.participantEmails);
}

// ── Exportação ───────────────────────────────────────────────────────────────────────────────

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
