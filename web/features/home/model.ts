import type { NavIconId } from "@/components/NavIcon";
import type { CommerceOrder } from "@/features/commerce/api";
import type { CommercialSuggestion, Proposal, Task } from "@/features/crm/types";
import { isTaskOverdue } from "@/features/crm/presentation";
import type { DashboardAttendance } from "@/features/dashboard/api";
import type { InboxConversation, MessagingConnection } from "@/features/inbox/types";
import type { MeetingListItem } from "@/features/meetings/types";
import type { SocialPostView } from "@/features/social/types";
import type { SolutionKey } from "@/lib/solutions";

/**
 * Início unificado do workspace (Reorganização de UX — Fase 3). Regras PURAS: o que aparece, em que
 * ordem e com qual prioridade. Nada aqui inventa número ou evento — tudo vem dos endpoints que as
 * ferramentas já usam; prioridade só existe quando o próprio dado traz a regra (tarefa atrasada por
 * `isTaskOverdue`, SLA vencido pelo backend, falha de publicação, conversa marcada como urgente,
 * canal desconectado).
 */

export type HomeModule = "conversations" | "sales" | "marketing" | "meetings" | "site";
export type Can = (permission: string) => boolean;

/** Estado de um bloco do Início — nunca "0" quando o dado não existe. */
export type ModuleAccess = "hidden" | "no_permission" | "visible";

const MODULE_SOLUTION: Record<HomeModule, SolutionKey> = { conversations: "conversations", sales: "conversations", marketing: "marketing", meetings: "meetings", site: "site" };
const MODULE_PERMISSION: Record<HomeModule, string> = { conversations: "inbox:read", sales: "deal:read", marketing: "marketing:social_read", meetings: "meeting:read", site: "order:read" };

/** `hidden` = ferramenta não contratada (o bloco nem aparece); `no_permission` = contratada, mas o
 * perfil da pessoa não lê aquele dado (aparece explicado, sem buscar nada). */
export function moduleAccess(module: HomeModule, available: readonly SolutionKey[], can: Can): ModuleAccess {
  if (!available.includes(MODULE_SOLUTION[module])) return "hidden";
  return can(MODULE_PERMISSION[module]) ? "visible" : "no_permission";
}

// ---------------------------------------------------------------------------------------- Criar

export type CreateOption = { key: string; label: string; description: string; href: string; icon: NavIconId };

/** Opções do "+ Criar": só o que a conta tem e o perfil pode criar. Cada uma abre a tela onde a
 * criação acontece (nenhum formulário novo). */
export function createOptions(available: readonly SolutionKey[], can: Can): CreateOption[] {
  const has = (key: SolutionKey) => available.includes(key);
  const options: CreateOption[] = [];
  if (has("marketing")) {
    // Fase 4: cada opção abre direto o fluxo certo de "Criar conteúdo".
    options.push({ key: "content", label: "Conteúdo com IA", description: "Criar arte e legenda com a IA", href: "/create?modo=ia", icon: "create" });
    options.push({ key: "idea", label: "Ideia de conteúdo", description: "Guardar no Bolsão de ideias", href: "/ideias?nova=1", icon: "ideas" });
    if (can("marketing:social_publish") || can("marketing:social_schedule")) options.push({ key: "post", label: "Publicação pronta", description: "Enviar mídia e publicar ou agendar", href: "/create?modo=pronto", icon: "publish" });
  }
  if (has("conversations")) {
    if (can("deal:manage")) options.push({ key: "deal", label: "Oportunidade", description: "Abrir no funil de vendas", href: "/deals", icon: "deals" });
    if (can("proposal:manage")) options.push({ key: "proposal", label: "Proposta", description: "Montar uma proposta comercial", href: "/proposals", icon: "proposals" });
    if (can("task:manage")) options.push({ key: "task", label: "Tarefa", description: "Agendar um próximo passo", href: "/tasks", icon: "tasks" });
    if (can("contact:manage")) options.push({ key: "contact", label: "Contato", description: "Cadastrar um cliente", href: "/contacts", icon: "contacts" });
  }
  if (has("meetings") && can("meeting:create")) options.push({ key: "meeting", label: "Reunião", description: "Agendar e gravar", href: "/meetings/agenda", icon: "meetings" });
  if (can("product:manage") && (has("conversations") || has("site"))) options.push({ key: "product", label: "Produto", description: "Cadastrar no catálogo", href: has("conversations") ? "/products" : "/site/products", icon: "products" });
  return options;
}

// --------------------------------------------------------------------------------- Acessos rápidos

export type QuickLink = { key: string; label: string; href: string; icon: NavIconId };

export function quickLinks(available: readonly SolutionKey[], can: Can): QuickLink[] {
  const has = (key: SolutionKey) => available.includes(key);
  const links: QuickLink[] = [];
  if (has("conversations") && can("inbox:read")) links.push({ key: "conversas", label: "Abrir conversas", href: "/conversas", icon: "conversas" });
  if (has("conversations") && can("deal:read")) links.push({ key: "deals", label: "Oportunidades", href: "/deals", icon: "deals" });
  if (has("marketing")) links.push({ key: "create", label: "Criar conteúdo", href: "/create", icon: "create" });
  if (has("marketing") && can("marketing:social_read")) links.push({ key: "calendar", label: "Calendário", href: "/calendar", icon: "calendar" });
  if (has("site")) links.push({ key: "site", label: "Editor do site", href: "/site", icon: "site" });
  if (has("meetings") && can("meeting:read")) links.push({ key: "meetings", label: "Reuniões", href: "/meetings/central", icon: "meetings" });
  return links;
}

// -------------------------------------------------------------------------------- Precisa de atenção

/** Só os selos que o próprio dado sustenta. */
export type AttentionBadge = "overdue" | "failed" | "sla" | "urgent" | "disconnected";
export const ATTENTION_BADGE_LABEL: Record<AttentionBadge, string> = { overdue: "Atrasada", failed: "Falhou", sla: "SLA vencido", urgent: "Urgente", disconnected: "Desconectado" };

export type AttentionItem = {
  id: string;
  module: HomeModule;
  title: string;
  context?: string;
  /** Relativo ao workspace. */
  href: string;
  at?: string;
  badge?: AttentionBadge;
  /** Ações que já existiam no Início (concluir tarefa, aplicar/descartar sugestão). */
  action?: { kind: "complete_task" | "accept_suggestion"; id: string };
  secondary?: { kind: "dismiss_suggestion"; id: string };
};

const BADGE_WEIGHT: Record<AttentionBadge, number> = { failed: 0, disconnected: 1, sla: 2, overdue: 3, urgent: 4 };

/** Com selo primeiro (pela gravidade), depois o mais antigo esperando primeiro. Sem duplicatas. */
export function sortAttention(items: readonly AttentionItem[]): AttentionItem[] {
  const seen = new Set<string>();
  return items
    .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
    .sort((a, b) => {
      const wa = a.badge ? BADGE_WEIGHT[a.badge] : 10;
      const wb = b.badge ? BADGE_WEIGHT[b.badge] : 10;
      if (wa !== wb) return wa - wb;
      return (a.at ?? "9999").localeCompare(b.at ?? "9999");
    });
}

export function conversationAttention(input: { conversations?: readonly InboxConversation[]; connections?: readonly MessagingConnection[]; attendance?: DashboardAttendance }): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const connection of input.connections ?? []) {
    if (["disconnected", "logged_out", "requires_repair", "error"].includes(connection.status)) {
      items.push({ id: `connection-${connection.id}`, module: "conversations", title: `Canal "${connection.displayName}" desconectado`, context: "Mensagens desse número não chegam até reconectar.", href: "/conversas", badge: "disconnected" });
    }
  }
  if (input.attendance?.sla.configured && input.attendance.sla.openBreached > 0) {
    const count = input.attendance.sla.openBreached;
    items.push({ id: "sla-breached", module: "conversations", title: count === 1 ? "1 atendimento com prazo de resposta vencido" : `${count} atendimentos com prazo de resposta vencido`, href: "/conversas", badge: "sla" });
  }
  // Conversas com mensagem do cliente ainda não lida: o cliente está esperando alguém do time.
  const waiting = (input.conversations ?? []).filter((conversation) => conversation.unreadCount > 0 && conversation.status !== "resolved");
  for (const conversation of waiting.slice(0, 5)) {
    const who = conversation.contactName ?? conversation.groupName ?? conversation.contactPhone ?? "Cliente";
    items.push({
      id: `conversation-${conversation.id}`,
      module: "conversations",
      title: `${who} aguardando resposta`,
      context: conversation.unreadCount === 1 ? "1 mensagem nova" : `${conversation.unreadCount} mensagens novas`,
      href: `/conversas?conversation=${encodeURIComponent(conversation.id)}`,
      at: conversation.lastMessageAt,
      ...(conversation.isUrgent ? { badge: "urgent" as const } : {}),
    });
  }
  return items;
}

export function salesAttention(input: { tasks?: readonly Task[]; proposalsViewed?: readonly Proposal[]; suggestions?: readonly CommercialSuggestion[]; dealsWithoutNextAction?: number; now: Date }): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const task of (input.tasks ?? []).filter((candidate) => isTaskOverdue(candidate, input.now)).slice(0, 5)) {
    items.push({ id: `task-${task.id}`, module: "sales", title: task.title, context: "Tarefa comercial atrasada", href: "/tasks?visao=atrasadas", at: task.dueAt, badge: "overdue", action: { kind: "complete_task", id: task.id } });
  }
  for (const proposal of (input.proposalsViewed ?? []).slice(0, 3)) {
    items.push({ id: `proposal-${proposal.id}`, module: "sales", title: `Proposta "${proposal.title}" vista pelo cliente`, context: "Aguardando seu acompanhamento", href: `/proposals?proposal=${encodeURIComponent(proposal.id)}`, at: proposal.lastViewedAt ?? proposal.viewedAt });
  }
  if ((input.dealsWithoutNextAction ?? 0) > 0) {
    const count = input.dealsWithoutNextAction!;
    items.push({ id: "deals-without-next-action", module: "sales", title: count === 1 ? "1 oportunidade sem próxima atividade" : `${count} oportunidades sem próxima atividade`, context: "Defina o próximo passo para não esfriar.", href: "/deals" });
  }
  for (const suggestion of (input.suggestions ?? []).slice(0, 3)) {
    items.push({ id: `suggestion-${suggestion.id}`, module: "sales", title: suggestion.title, context: suggestion.rationale, href: "/deals", action: { kind: "accept_suggestion", id: suggestion.id }, secondary: { kind: "dismiss_suggestion", id: suggestion.id } });
  }
  return items;
}

const FAILED_POST_STATES = new Set(["FAILED", "PARTIAL_SUCCESS", "RECONCILIATION_REQUIRED", "WAITING_REAUTH"]);

function postLabel(post: SocialPostView): string {
  const caption = post.destinations.find((destination) => destination.caption.trim())?.caption.trim();
  if (!caption) return "Publicação";
  const firstLine = caption.split("\n")[0]!;
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
}

function postNetworks(post: SocialPostView): string {
  const names: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn" };
  return [...new Set(post.destinations.map((destination) => names[destination.network] ?? destination.network))].join(" · ");
}

export function socialAttention(posts: readonly SocialPostView[] | undefined): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const post of posts ?? []) {
    const href = `/calendar?post=${encodeURIComponent(post.id)}`;
    if (FAILED_POST_STATES.has(post.state)) {
      const problem = post.destinations.find((destination) => destination.problem)?.problem;
      const lastAttempt = post.destinations.map((destination) => destination.lastAttemptAt).filter((value): value is string => Boolean(value)).sort().pop();
      items.push({ id: `post-${post.id}`, module: "marketing", title: `Falha ao publicar: ${postLabel(post)}`, context: problem ?? postNetworks(post), href, at: lastAttempt ?? post.scheduledAt ?? post.createdAt, badge: "failed" });
    } else if (post.state === "AWAITING_APPROVAL") {
      items.push({ id: `post-${post.id}`, module: "marketing", title: `Aguardando aprovação: ${postLabel(post)}`, context: postNetworks(post), href, at: post.scheduledAt ?? post.createdAt });
    }
  }
  return items;
}

const DAY = 24 * 60 * 60 * 1000;

export function meetingsAttention(meetings: readonly MeetingListItem[] | undefined, now: Date): AttentionItem[] {
  // Reunião agendada nas próximas 24 h: hora de se preparar.
  return upcomingMeetings(meetings, now)
    .filter((meeting) => new Date(meeting.scheduledStartAt!).getTime() - now.getTime() <= DAY)
    .slice(0, 3)
    .map((meeting) => ({ id: `meeting-${meeting.id}`, module: "meetings" as const, title: `Reunião: ${meeting.title}`, context: meeting.participantCount ? `${meeting.participantCount} participante(s)` : undefined, href: `/meetings/central/${encodeURIComponent(meeting.id)}`, at: meeting.scheduledStartAt }));
}

export function upcomingMeetings(meetings: readonly MeetingListItem[] | undefined, now: Date): MeetingListItem[] {
  return (meetings ?? [])
    .filter((meeting) => meeting.status === "scheduled" && meeting.scheduledStartAt && new Date(meeting.scheduledStartAt).getTime() >= now.getTime())
    .sort((a, b) => a.scheduledStartAt!.localeCompare(b.scheduledStartAt!));
}

export function ordersAttention(paidOrders: readonly CommerceOrder[] | undefined): AttentionItem[] {
  // Pedido pago e ainda não preparado/enviado: alguém precisa separar.
  return (paidOrders ?? []).slice(0, 3).map((order) => ({
    id: `order-${order.id}`,
    module: "site" as const,
    title: `Pedido #${order.number} pago, aguardando preparação`,
    context: order.customerDisplayName,
    href: `/site/pedidos?pedido=${encodeURIComponent(order.id)}`,
    at: order.paidAt ?? order.createdAt,
  }));
}

// ----------------------------------------------------------------------------------- Resumo

export function scheduledPosts(posts: readonly SocialPostView[] | undefined, now: Date): SocialPostView[] {
  return (posts ?? []).filter((post) => post.state === "SCHEDULED" && post.scheduledAt && new Date(post.scheduledAt).getTime() >= now.getTime()).sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
}

export function postsAwaitingApproval(posts: readonly SocialPostView[] | undefined): number {
  return (posts ?? []).filter((post) => post.state === "AWAITING_APPROVAL").length;
}

// ------------------------------------------------------------------------------ Atividade recente

export type ActivityItem = { id: string; module: HomeModule; title: string; context?: string; href: string; at: string };

/** Acontecimentos REAIS já registrados pelas ferramentas (nada de log paralelo): publicação feita,
 * reunião concluída, pedido recebido, proposta aceita. Mais recente primeiro. */
export function buildActivity(input: { posts?: readonly SocialPostView[]; meetings?: readonly MeetingListItem[]; orders?: readonly CommerceOrder[]; proposalsAccepted?: readonly Proposal[]; now: Date; limit?: number }): ActivityItem[] {
  const since = input.now.getTime() - 7 * DAY;
  const items: ActivityItem[] = [];
  for (const post of input.posts ?? []) {
    const published = post.destinations.map((destination) => destination.publishedAt).filter((at): at is string => Boolean(at)).sort().pop();
    if (published && (post.state === "PUBLISHED" || post.state === "PARTIAL_SUCCESS")) items.push({ id: `post-${post.id}`, module: "marketing", title: "Conteúdo publicado", context: `${postLabel(post)} · ${postNetworks(post)}`, href: `/calendar?post=${encodeURIComponent(post.id)}`, at: published });
  }
  for (const meeting of input.meetings ?? []) {
    if (meeting.status === "completed") items.push({ id: `meeting-${meeting.id}`, module: "meetings", title: "Reunião concluída", context: meeting.title, href: `/meetings/central/${encodeURIComponent(meeting.id)}`, at: meeting.recordingEndedAt ?? meeting.statusChangedAt });
  }
  for (const order of input.orders ?? []) {
    items.push({ id: `order-${order.id}`, module: "site", title: `Pedido #${order.number} recebido`, context: order.customerDisplayName, href: `/site/pedidos?pedido=${encodeURIComponent(order.id)}`, at: order.createdAt });
  }
  for (const proposal of input.proposalsAccepted ?? []) {
    const at = proposal.respondedAt ?? proposal.updatedAt;
    items.push({ id: `proposal-${proposal.id}`, module: "sales", title: "Proposta aceita", context: proposal.title, href: `/proposals?proposal=${encodeURIComponent(proposal.id)}`, at });
  }
  return items
    .filter((item) => {
      const time = new Date(item.at).getTime();
      return Number.isFinite(time) && time >= since && time <= input.now.getTime() + 60_000;
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, input.limit ?? 8);
}

// ------------------------------------------------------------------------------------ Cabeçalho

export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function todayLabel(date: Date): string {
  const text = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(date);
  return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
}

/** "agora", "há 5 min", "em 2 h", "ontem", "12/11". */
export function relativeTime(iso: string | undefined, now: Date): string {
  if (!iso) return "";
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "";
  const diff = time - now.getTime();
  const minutes = Math.round(Math.abs(diff) / 60_000);
  const future = diff > 0;
  if (minutes < 1) return "agora";
  if (minutes < 60) return future ? `em ${minutes} min` : `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `em ${hours} h` : `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return future ? "amanhã" : "ontem";
  if (days < 7) return future ? `em ${days} dias` : `há ${days} dias`;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(time));
}
