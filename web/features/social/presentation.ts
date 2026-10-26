/**
 * Regras de apresentação do Social Publishing — puras (sem React), testadas em `tests/social-*.test.ts`.
 * A UI nunca decide o que a rede suporta: tudo vem das capabilities devolvidas pela API.
 */
import type {
  SocialAccountView,
  SocialComposeRequest,
  SocialComposerAccount,
  SocialComposerFormat,
  SocialConnectionStatus,
  SocialDestinationAction,
  SocialDestinationState,
  SocialLatePolicy,
  SocialMediaItem,
  SocialNetwork,
  SocialNetworkAvailability,
  SocialPostFormat,
  SocialPostState,
  SocialPostView,
} from "./types";

export type Tone = "emerald" | "sky" | "amber" | "rose" | "violet" | "neutral";

export const NETWORK_LABEL: Record<SocialNetwork, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };
export const NETWORK_TONE: Record<SocialNetwork, Tone> = { instagram: "rose", facebook: "sky", tiktok: "violet" };

/** Classes do vocabulário fechado de acentos do design system (nunca hex solto). */
export const TONE_CLASS: Record<Tone, { badge: string; dot: string; soft: string }> = {
  emerald: { badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", soft: "bg-emerald-500/10" },
  sky: { badge: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400", dot: "bg-sky-500", soft: "bg-sky-500/10" },
  amber: { badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400", dot: "bg-amber-500", soft: "bg-amber-500/10" },
  rose: { badge: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400", dot: "bg-rose-500", soft: "bg-rose-500/10" },
  violet: { badge: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400", dot: "bg-violet-500", soft: "bg-violet-500/10" },
  neutral: { badge: "border-border bg-muted text-muted-foreground", dot: "bg-muted-foreground", soft: "bg-muted" },
};

export const POST_STATE_META: Record<SocialPostState, { label: string; tone: Tone }> = {
  DRAFT: { label: "Rascunho", tone: "neutral" },
  AWAITING_APPROVAL: { label: "Aguardando aprovação", tone: "amber" },
  SCHEDULED: { label: "Agendado", tone: "sky" },
  PUBLISHING: { label: "Publicando", tone: "violet" },
  PUBLISHED: { label: "Publicado", tone: "emerald" },
  PARTIAL_SUCCESS: { label: "Parcial", tone: "amber" },
  FAILED: { label: "Falhou", tone: "rose" },
  RECONCILIATION_REQUIRED: { label: "Confirmação pendente", tone: "amber" },
  WAITING_REAUTH: { label: "Aguardando reconexão", tone: "amber" },
  CANCELLED: { label: "Cancelado", tone: "neutral" },
};

export const DESTINATION_STATE_META: Record<SocialDestinationState, { label: string; tone: Tone }> = {
  DRAFT: { label: "Rascunho", tone: "neutral" },
  AWAITING_APPROVAL: { label: "Aguardando aprovação", tone: "amber" },
  SCHEDULED: { label: "Agendado", tone: "sky" },
  PUBLISHING: { label: "Publicando", tone: "violet" },
  PUBLISHED: { label: "Publicado", tone: "emerald" },
  FAILED: { label: "Falhou", tone: "rose" },
  RECONCILIATION_REQUIRED: { label: "Confirmação de publicação pendente", tone: "amber" },
  WAITING_REAUTH: { label: "Aguardando reconexão", tone: "amber" },
  AWAITING_CONFIRMATION: { label: "Atrasada — confirme", tone: "amber" },
  PAUSED: { label: "Pausada", tone: "neutral" },
  CANCELLED: { label: "Cancelado", tone: "neutral" },
  SKIPPED: { label: "Não publicada (atrasada)", tone: "neutral" },
};

export function destinationStatusLine(network: SocialNetwork, state: SocialDestinationState): string {
  if (state === "WAITING_REAUTH") return `Aguardando reconexão do ${NETWORK_LABEL[network]}`;
  return `${NETWORK_LABEL[network]} — ${DESTINATION_STATE_META[state].label}`;
}

/** Rótulo das ações por destino — sempre nomeando a rede (ex.: "Tentar novamente no TikTok"). */
export function destinationActionLabel(action: SocialDestinationAction, network: SocialNetwork): string {
  const label = NETWORK_LABEL[network];
  switch (action) {
    case "retry": return `Tentar novamente no ${label}`;
    case "cancel": return `Cancelar no ${label}`;
    case "confirm_late": return "Publicar mesmo atrasada";
    case "skip_late": return "Não publicar";
    case "reconnect": return `Reconectar ${label}`;
    case "resolve_unknown": return "Confirmar se saiu";
  }
}

/** Permissão exigida por ação (o backend valida de verdade; a UI só não oferece o que não pode). */
export const ACTION_PERMISSION: Record<SocialDestinationAction | "publish_now" | "schedule" | "cancel_post" | "reschedule" | "connect" | "manage_accounts" | "settings", string> = {
  retry: "marketing:social_publish",
  cancel: "marketing:social_schedule",
  confirm_late: "marketing:social_publish",
  skip_late: "marketing:social_publish",
  reconnect: "marketing:social_connect",
  resolve_unknown: "marketing:social_publish",
  publish_now: "marketing:social_publish",
  schedule: "marketing:social_schedule",
  cancel_post: "marketing:social_schedule",
  reschedule: "marketing:social_schedule",
  connect: "marketing:social_connect",
  manage_accounts: "marketing:social_manage_accounts",
  settings: "marketing:social_manage_provider",
};

export function allowedActions(actions: readonly SocialDestinationAction[], can: (permission: string) => boolean): SocialDestinationAction[] {
  return actions.filter((action) => can(ACTION_PERMISSION[action]));
}

// ---------- Integrações ----------

export type IntegrationCardModel = {
  network: SocialNetwork;
  state: "connected" | "attention" | "disconnected" | "unavailable";
  headline: string;
  message?: string;
  accounts: SocialAccountView[];
  primaryAction?: "connect" | "reconnect";
  waitingPublications: number;
};

const ATTENTION: readonly SocialConnectionStatus[] = ["REAUTH_REQUIRED", "CHECKPOINT_REQUIRED", "TEMPORARY_ERROR", "DISABLED"];

export function integrationCard(network: SocialNetwork, accounts: readonly SocialAccountView[], availability: SocialNetworkAvailability | undefined): IntegrationCardModel {
  const mine = accounts.filter((account) => account.network === network && account.status !== "DISCONNECTED");
  const waitingPublications = accounts.filter((account) => account.network === network).reduce((sum, account) => sum + account.waitingPublications, 0);
  const label = NETWORK_LABEL[network];
  if (mine.length === 0) {
    const disconnected = accounts.find((account) => account.network === network);
    if (!availability?.canConnect) return { network, state: "unavailable", headline: "Indisponível", message: availability?.message ?? `A publicação no ${label} ainda não está liberada para a sua conta.`, accounts: [], waitingPublications };
    return { network, state: "disconnected", headline: "Não conectado", message: disconnected ? `Conecte novamente para voltar a publicar no ${label}.` : `Conecte sua conta para publicar no ${label}.`, accounts: [], primaryAction: "connect", waitingPublications };
  }
  const problem = mine.find((account) => ATTENTION.includes(account.status));
  if (problem) {
    const needsReconnect = problem.needsReconnect;
    return { network, state: "attention", headline: problem.statusLabel, message: needsReconnect ? "Sua conta precisa ser reconectada." : problem.problem ?? `O ${label} está instável para esta conta.`, accounts: mine, ...(needsReconnect && availability?.canConnect !== false ? { primaryAction: "reconnect" as const } : {}), waitingPublications };
  }
  return { network, state: "connected", headline: "Conectado", accounts: mine, waitingPublications };
}

export function waitingLabel(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count === 1 ? "1 publicação aguardando reconexão" : `${count} publicações aguardando reconexão`;
}

export function accountName(account: { username?: string; displayName?: string }): string {
  if (account.username) return `@${account.username.replace(/^@/, "")}`;
  return account.displayName ?? "Conta conectada";
}

// ---------- Composer ----------

export type NetworkChoice = {
  network: SocialNetwork;
  accounts: SocialComposerAccount[];
  selectable: boolean;
  /** Motivo de estar desabilitada (sempre explicado, nunca só escondido). */
  reason?: string;
  cta?: { label: string; href: string };
};

export function networkChoices(options: readonly SocialComposerAccount[], workspaceId: string): NetworkChoice[] {
  return (["instagram", "facebook", "tiktok"] as const).map((network) => {
    const accounts = options.filter((option) => option.network === network);
    const label = NETWORK_LABEL[network];
    const integrations = `/workspaces/${workspaceId}/social/integrations`;
    if (accounts.length === 0) return { network, accounts, selectable: false, reason: `Nenhuma conta do ${label} conectada.`, cta: { label: `Conectar ${label}`, href: integrations } };
    if (!accounts.some((account) => account.publishable)) return { network, accounts, selectable: false, reason: accounts[0]?.warning ?? `A conta do ${label} precisa de atenção.`, cta: { label: `Reconectar ${label}`, href: integrations } };
    return { network, accounts, selectable: true };
  });
}

export function mediaShape(media: readonly SocialMediaItem[]): "none" | "image" | "images" | "video" | "mixed" {
  if (media.length === 0) return "none";
  const videos = media.filter((item) => item.kind === "video").length;
  if (videos === 0) return media.length === 1 ? "image" : "images";
  return videos === media.length && media.length === 1 ? "video" : "mixed";
}

/** Só formatos que a conta suporta E que combinam com a mídia escolhida. */
export function compatibleFormats(account: SocialComposerAccount, media: readonly SocialMediaItem[]): SocialComposerFormat[] {
  const kinds = new Set(media.map((item) => item.kind));
  return account.formats.filter((format) => {
    if (media.length === 0) return true;
    if (media.length > format.maxItems) return false;
    if ([...kinds].some((kind) => !format.kinds.includes(kind))) return false;
    if (format.format === "carousel" && media.length < 2) return false;
    return true;
  });
}

const FORMAT_PREFERENCE: Record<ReturnType<typeof mediaShape>, readonly SocialPostFormat[]> = {
  none: ["feed_image", "photo_post", "short_video"],
  image: ["feed_image", "photo_post", "story_image"],
  images: ["carousel", "photo_post"],
  video: ["reel", "short_video", "feed_video", "story_video"],
  mixed: ["carousel"],
};

export function defaultFormat(account: SocialComposerAccount, media: readonly SocialMediaItem[]): SocialPostFormat | undefined {
  const compatible = compatibleFormats(account, media).map((format) => format.format);
  return FORMAT_PREFERENCE[mediaShape(media)].find((format) => compatible.includes(format)) ?? compatible[0];
}

export function formatSupportsCaption(format: SocialComposerFormat | undefined): boolean {
  return !!format && format.maxCaptionLength > 0;
}

/** Proporção do preview: o formato da rede manda; sem mídia, um padrão do formato. */
export function previewAspect(format: SocialPostFormat | undefined, media: readonly SocialMediaItem[]): string {
  if (format === "story_image" || format === "story_video" || format === "reel" || format === "short_video") return "9 / 16";
  const first = media[0];
  if (first?.width && first.height) {
    const ratio = first.width / first.height;
    // Feed do Instagram/Facebook enquadra entre 4:5 e 1.91:1.
    if (ratio < 0.8) return "4 / 5";
    if (ratio > 1.91) return "1.91 / 1";
    return `${first.width} / ${first.height}`;
  }
  return format === "photo_post" ? "3 / 4" : "1 / 1";
}

export function splitHashtags(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((tag) => tag.trim().replace(/^#+/, "")).filter((tag) => /^[\p{L}\p{N}_]+$/u.test(tag)))].slice(0, 30);
}

export type ComposerDraft = {
  caption: string;
  hashtags: string;
  media: SocialMediaItem[];
  destinations: { accountId: string; network: SocialNetwork; format?: SocialPostFormat; customize: boolean; caption: string; hashtags: string }[];
  when: { mode: "now" } | { mode: "schedule"; date: string; time: string; timezone: string };
  sourceExecutionRunId?: string;
};

export function buildComposeRequest(workspaceId: string, draft: ComposerDraft, idempotencyKey: string): SocialComposeRequest {
  return {
    workspaceId,
    idempotencyKey,
    base: { caption: draft.caption, hashtags: splitHashtags(draft.hashtags), media: draft.media },
    destinations: draft.destinations.filter((destination) => destination.format).map((destination) => ({
      accountId: destination.accountId,
      format: destination.format!,
      ...(destination.customize ? { caption: destination.caption, hashtags: splitHashtags(destination.hashtags) } : {}),
    })),
    when: draft.when.mode === "now" ? { mode: "now" } : { mode: "schedule", localDateTime: `${draft.when.date}T${draft.when.time}`, timezone: draft.when.timezone },
    ...(draft.sourceExecutionRunId ? { source: { executionRunId: draft.sourceExecutionRunId } } : {}),
  };
}

/** O que impede publicar/agendar AGORA (antes de chamar a API). */
export function composerBlockers(draft: ComposerDraft, now: Date = new Date()): string[] {
  const blockers: string[] = [];
  if (draft.destinations.length === 0) blockers.push("Escolha ao menos uma rede.");
  if (draft.destinations.some((destination) => !destination.format)) blockers.push("Escolha o formato de cada rede.");
  if (draft.media.length === 0) blockers.push("Adicione uma imagem ou vídeo.");
  if (draft.when.mode === "schedule") {
    if (!draft.when.date || !draft.when.time) blockers.push("Informe data e hora do agendamento.");
    else if (zonedToUtc(`${draft.when.date}T${draft.when.time}`, draft.when.timezone).getTime() < now.getTime()) blockers.push("Escolha um horário no futuro.");
  }
  return blockers;
}

// ---------- Fuso horário ----------

/** Converte "AAAA-MM-DDTHH:mm" no fuso informado para o instante UTC. */
export function zonedToUtc(localDateTime: string, timezone: string): Date {
  const [datePart, timePart = "00:00"] = localDateTime.split("T");
  const [year, month, day] = datePart!.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const guess = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const offset = (instant: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - instant;
  };
  let utc = guess - offset(guess);
  utc = guess - offset(utc);
  return new Date(utc);
}

/** Dia (AAAA-MM-DD) de um instante no fuso informado. */
export function dayKey(iso: string, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatDateTime(iso: string | undefined, timezone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Valores de data/hora (inputs) para "daqui a N minutos" no fuso do workspace. */
export function localInputsIn(timezone: string, from: Date): { date: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(from).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// ---------- Calendário ----------

export function postAnchor(post: SocialPostView): string {
  return post.scheduledAt ?? post.destinations.find((destination) => destination.publishedAt)?.publishedAt ?? post.createdAt;
}

export function groupPostsByDay(posts: readonly SocialPostView[], timezone: string): Map<string, SocialPostView[]> {
  const groups = new Map<string, SocialPostView[]>();
  for (const post of [...posts].sort((left, right) => postAnchor(left).localeCompare(postAnchor(right)))) {
    const key = dayKey(postAnchor(post), timezone);
    groups.set(key, [...(groups.get(key) ?? []), post]);
  }
  return groups;
}

/** Semanas (domingo a sábado) do mês, com dias de fora como `undefined`. */
export function monthGrid(year: number, month: number): (string | undefined)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | undefined)[] = Array.from({ length: first.getUTCDay() }, () => undefined);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(undefined);
  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
}

/** Resumo por rede para o cartão do calendário (ex.: Instagram ✓ · TikTok ✕). */
export function destinationSummary(post: SocialPostView): { network: SocialNetwork; tone: Tone; label: string }[] {
  return post.destinations.map((destination) => ({ network: destination.network, tone: DESTINATION_STATE_META[destination.state].tone, label: destinationStatusLine(destination.network, destination.state) }));
}

export function postTitle(post: SocialPostView): string {
  const caption = post.destinations.find((destination) => destination.caption.trim())?.caption.trim();
  if (!caption) return "Publicação sem legenda";
  return caption.length > 70 ? `${caption.slice(0, 69)}…` : caption;
}

// ---------- Política de atraso ----------

export const LATE_POLICY_OPTIONS: { value: SocialLatePolicy["whenLate"]; label: string; description: string }[] = [
  { value: "PUBLISH_ON_RECONNECT", label: "Publicar assim que reconectar", description: "As publicações saem em sequência, uma de cada vez, logo após a reconexão." },
  { value: "ASK_CONFIRMATION", label: "Pedir confirmação", description: "Você decide, publicação por publicação, se ainda faz sentido publicar." },
  { value: "SKIP", label: "Não publicar se estiver atrasada", description: "Publicações que passaram do horário são marcadas como não publicadas." },
];
