/**
 * Ciclo de atendimento do módulo Conversas (migration 0172). Quatro conceitos, nunca misturados:
 * - Contato: a pessoa (`InboxContact`).
 * - Conversa: o histórico PERMANENTE com o contato naquele canal (`InboxConversation`) — nunca
 *   recriada nem apagada a cada atendimento; a timeline é uma só.
 * - Atendimento: um ciclo que abre e fecha DENTRO da conversa (`InboxAttendance`). Cliente que volta
 *   a falar depois de um atendimento finalizado abre um atendimento NOVO na mesma conversa.
 * - Oportunidade comercial: o `Deal` do CRM (outro bounded context).
 *
 * Cada pessoa que recebe o atendimento tem o próprio ciclo de responsabilidade
 * (`InboxAttendanceAssignment`) — o relógio da primeira resposta dela começa quando ELA recebe,
 * nunca na abertura do atendimento. Timestamps são a fonte primária; `*Seconds` é só cache.
 *
 * Mesmo racional de `inbox.model.ts`: sem imports de outros bounded contexts.
 */

export const INBOX_ATTENDANCE_STATUSES = ["open", "closed"] as const;
export type InboxAttendanceStatus = (typeof INBOX_ATTENDANCE_STATUSES)[number];

/** Por que o atendimento abriu. `assignment` = um atendente atribuiu/assumiu uma conversa aberta
 * que ainda não tinha atendimento; `migration` = conversa já em atendimento quando a 0172 rodou. */
export const INBOX_ATTENDANCE_OPEN_REASONS = ["inbound_message", "agent_started", "assignment", "migration", "site_lead"] as const;
export type InboxAttendanceOpenReason = (typeof INBOX_ATTENDANCE_OPEN_REASONS)[number];

/** Regra que decidiu o responsável na abertura — auditoria/testes das regras de distribuição. */
export const INBOX_DISTRIBUTION_RULES = ["last_assignee", "round_robin", "fixed", "team_queue", "queue", "triage", "manual", "agent_started"] as const;
export type InboxDistributionRule = (typeof INBOX_DISTRIBUTION_RULES)[number];

/** Situação da pesquisa de satisfação NAQUELE atendimento (nunca inferida depois). */
export const INBOX_ATTENDANCE_CSAT_STATUSES = ["sent", "disabled_by_channel", "waived", "not_applicable", "failed"] as const;
export type InboxAttendanceCsatStatus = (typeof INBOX_ATTENDANCE_CSAT_STATUSES)[number];

/** O que um atendimento novo faz com o responsável, configurado por canal. `last_assignee` = fica
 * com quem atendeu da última vez (comportamento anterior à 0172); `redistribute` = passa de novo
 * pela regra do canal (triagem, roteamento por equipe e rodízio da equipe). */
export const INBOX_NEW_ATTENDANCE_ASSIGNMENT_MODES = ["last_assignee", "redistribute"] as const;
export type InboxNewAttendanceAssignmentMode = (typeof INBOX_NEW_ATTENDANCE_ASSIGNMENT_MODES)[number];

export type InboxAttendance = {
  id: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  contactId?: string;
  connectionId: string;
  teamId?: string;
  /** "#125" — sequencial por workspace. */
  number: number;
  status: InboxAttendanceStatus;
  openedAt: string;
  /** userId, ou `system` quando aberto por mensagem do cliente. */
  openedBy: string;
  openReason: InboxAttendanceOpenReason;
  distributionRule?: InboxDistributionRule;
  initialAssigneeUserId?: string;
  /** Primeira resposta HUMANA do atendimento (qualquer pessoa). A de cada responsável fica no ciclo. */
  firstResponseAt?: string;
  firstResponseBy?: string;
  closedAt?: string;
  closedBy?: string;
  closureTypeId?: string;
  closureSubtypeId?: string;
  /** Snapshot do nome no momento da finalização — renomear o tipo depois não reescreve o histórico. */
  closureTypeName?: string;
  closureSubtypeName?: string;
  closureNote?: string;
  /** Cache de `closedAt - openedAt`; a fórmula pode mudar, os timestamps continuam. */
  resolutionSeconds?: number;
  csatStatus?: InboxAttendanceCsatStatus;
  csatWaivedBy?: string;
  csatSentAt?: string;
  csatScore?: number;
  csatAnsweredAt?: string;
  reopenedCount: number;
  lastReopenedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Como a pessoa recebeu o atendimento. */
export const INBOX_ASSIGNMENT_SOURCES = ["routing", "triage", "manual", "take_over", "transfer", "agent_started", "last_assignee", "migration"] as const;
export type InboxAssignmentSource = (typeof INBOX_ASSIGNMENT_SOURCES)[number];

/** Por que a pessoa deixou de ser responsável. */
export const INBOX_ASSIGNMENT_END_REASONS = ["transferred", "reassigned", "unassigned", "attendance_closed"] as const;
export type InboxAssignmentEndReason = (typeof INBOX_ASSIGNMENT_END_REASONS)[number];

export type InboxAttendanceAssignment = {
  id: string;
  tenantId: string;
  workspaceId: string;
  attendanceId: string;
  conversationId: string;
  userId: string;
  teamId?: string;
  source: InboxAssignmentSource;
  assignedBy: string;
  startedAt: string;
  firstResponseAt?: string;
  firstResponseMessageId?: string;
  /** Cache de `firstResponseAt - startedAt`. */
  firstResponseSeconds?: number;
  endedAt?: string;
  endReason?: InboxAssignmentEndReason;
  transferredToUserId?: string;
  /** Cache de `endedAt - startedAt` (tempo de posse). */
  holdingSeconds?: number;
  createdAt: string;
};

export type InboxClosureSubtype = {
  id: string;
  tenantId: string;
  workspaceId: string;
  closureTypeId: string;
  name: string;
  position: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InboxClosureType = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  position: number;
  isActive: boolean;
  subtypes: InboxClosureSubtype[];
  createdAt: string;
  updatedAt: string;
};

/** Sugestão inicial — criada uma única vez por workspace e totalmente editável depois. */
export const DEFAULT_CLOSURE_CATALOG: readonly { name: string; subtypes: readonly string[] }[] = [
  { name: "Resolvido", subtypes: ["Dúvida esclarecida", "Venda realizada", "Suporte concluído"] },
  { name: "Não resolvido", subtypes: ["Sem solução disponível", "Fora do escopo", "Cliente desistiu"] },
  { name: "Encaminhado", subtypes: ["Outro setor", "Atendimento presencial", "Parceiro"] },
  { name: "Sem retorno", subtypes: ["Cliente não respondeu", "Contato inválido"] },
];

export const CLOSURE_NAME_MAX_LENGTH = 80;

/** Segundos inteiros entre dois ISO; nunca negativo (relógios de processos diferentes). */
export function secondsBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
}

/** Rótulo "Tipo > Subtipo" — também gravado em `inbox_conversations.closing_reason`, que os
 * relatórios atuais de motivos de encerramento já leem. */
export function closureLabel(typeName: string, subtypeName?: string): string {
  return subtypeName ? `${typeName} > ${subtypeName}` : typeName;
}
