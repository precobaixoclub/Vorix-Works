import { hasPermission, type TenantRole } from "../../domain/identity/identity.model.js";
import { normalizePhoneNumber } from "../../domain/inbox/inbox.model.js";
import type { MessagingProvider } from "../ports/messaging-provider.port.js";
import type { MessagingConnectionRepositoryPort } from "../ports/messaging-connection-repository.port.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";
import { interpretRejection } from "../creative-engine/feedback-interpretation.js";
import {
  approvalAckText,
  approvalCode,
  approvalRequestText,
  matchPendingRequest,
  parseApprovalReply,
  phoneDigits,
  type ApprovalDecision,
  type ApprovalTimeoutPolicy,
} from "./whatsapp-approval.js";

/**
 * Aprovação de publicações pelo WhatsApp — orquestração.
 * - CONTA: um número (conexão de qualquer espaço de trabalho da conta) envia os pedidos de todas as marcas.
 * - MARCA: exige aprovação? quem aprova (usuário + WhatsApp)? sem resposta até o horário: não publica ou publica.
 * Publicação criada numa marca que exige aprovação nasce "aguardando aprovação" (o motor de publicação já
 * barra o envio sem aprovação). A API envia o pedido; o worker de Conversas só captura a resposta do
 * aprovador (sem criar conversa no atendimento); a API aplica a decisão na publicação da marca certa.
 */

export type ApprovalSettings = { tenantId: string; enabled: boolean; connectionId?: string; updatedAt?: string };
/** Reprovação com motivo: refazer a arte com base no motivo e reenviar (`redo`) ou devolver a ideia ao Bolsão (`return`). */
export type ApprovalRejectPolicy = "redo" | "return";
export type ApprovalRule = { tenantId: string; workspaceId: string; enabled: boolean; approverUserId?: string; approverPhone?: string; onTimeout: ApprovalTimeoutPolicy; onReject: ApprovalRejectPolicy; enabledAt?: string; updatedAt?: string };
/** Até quantas vezes a mesma ideia é refeita depois de reprovada; depois volta ao Bolsão. */
export const MAX_REDO_ATTEMPTS = 2;
export type ApprovalRequestStatus = "pending" | "sent" | "decided" | "applied" | "expired" | "failed";
export type ApprovalRequest = {
  id: string; tenantId: string; workspaceId: string; publicationId: string; code: string; connectionId: string; approverPhone: string; approverUserId?: string;
  status: ApprovalRequestStatus; decision?: ApprovalDecision; reason?: string; detail?: string; createdAt: string; sentAt?: string; decidedAt?: string; appliedAt?: string;
};
export type ApprovalMember = { userId: string; name: string; email?: string; role: TenantRole };

export interface WhatsappApprovalRepositoryPort {
  getSettings(tenantId: string): Promise<ApprovalSettings | undefined>;
  saveSettings(input: { tenantId: string; enabled: boolean; connectionId?: string; updatedBy: string }): Promise<ApprovalSettings>;
  listRules(tenantId: string): Promise<ApprovalRule[]>;
  getRule(tenantId: string, workspaceId: string): Promise<ApprovalRule | undefined>;
  saveRule(input: Omit<ApprovalRule, "enabledAt" | "updatedAt"> & { updatedBy: string }): Promise<ApprovalRule>;
  /** A publicação é uma versão refeita? (número da refação + motivo que a originou) — vai no texto do pedido. */
  findRedoByResult?(publicationId: string): Promise<{ attempt: number; reason: string; changes?: string } | undefined>;
  /** Refações que falharam e ainda não foram avisadas ao aprovador (com o pedido original para saber para quem). */
  listFailedRedosToNotify?(limit: number): Promise<Array<{ id: string; workspaceId: string; detail?: string; connectionId: string; approverPhone: string }>>;
  markRedoNotified?(id: string): Promise<void>;
  listMembers(tenantId: string): Promise<ApprovalMember[]>;
  /** Publicações aguardando aprovação em marcas com a regra ligada e ainda sem pedido. */
  listPublicationsToRequest(limit: number): Promise<Array<{ tenantId: string; workspaceId: string; publicationId: string }>>;
  createRequest(input: Omit<ApprovalRequest, "status" | "createdAt"> & { status?: ApprovalRequestStatus }): Promise<ApprovalRequest | undefined>;
  updateRequest(id: string, patch: Partial<Pick<ApprovalRequest, "status" | "decision" | "reason" | "detail" | "sentAt" | "decidedAt" | "appliedAt">>): Promise<void>;
  /** Marca a decisão só se o pedido ainda estiver aberto (`sent`) — corrida com o prazo nunca decide duas vezes. */
  decideRequest(id: string, decision: ApprovalDecision, reason: string | undefined, at: string): Promise<boolean>;
  listOpenByPhone(connectionId: string, approverPhone: string): Promise<ApprovalRequest[]>;
  listByStatus(status: ApprovalRequestStatus, limit: number): Promise<ApprovalRequest[]>;
  listRecent(tenantId: string, limit: number): Promise<ApprovalRequest[]>;
  /** Mensagens que o SISTEMA mandou ao aprovador — o eco delas (fromMe) não vira conversa de atendimento. */
  recordOutbound(connectionId: string, externalMessageIds: string[], requestId?: string): Promise<void>;
  isApprovalOutbound(connectionId: string, externalMessageId: string): Promise<boolean>;
  /** Pedido que uma mensagem enviada representa (imagem/texto do pedido) — para a resposta citando a mensagem. */
  requestForOutbound(connectionId: string, externalMessageId: string): Promise<ApprovalRequest | undefined>;
  /** O telefone é de um aprovador configurado para pedidos enviados por esta conexão? */
  isApproverPhone(connectionId: string, phone: string): Promise<boolean>;
  /** Houve pedido/mensagem de aprovação por esta conexão no último minuto (eco ainda pode estar a caminho)? */
  hasRecentApprovalActivity(connectionId: string): Promise<boolean>;
}

export type ApprovalPostView = {
  state: string; scheduledAt?: string; timezone?: string; caption?: string; networks: string[];
  media: Array<{ url: string; kind: string; mimeType?: string }>;
  /**
   * SOMENTE APROVAÇÃO: o pedido registra a decisão humana e NUNCA agenda nem publica — aprovar não chama
   * `posts.approve`, reprovar não dispara refação automática (que publicaria) e sem resposta não há prazo.
   */
  approvalOnly?: { ideaTitle?: string; production?: string; durationSeconds?: number; concept?: string; sha256?: string };
};

export type WhatsappApprovalServiceDeps = {
  repository: WhatsappApprovalRepositoryPort;
  connections: MessagingConnectionRepositoryPort;
  workspaces: WorkspaceRepositoryPort;
  provider?: MessagingProvider;
  /** Publicação não aprovada (reprovada ou sem resposta): a ideia de origem volta para o Bolsão. */
  onNotApproved?: (input: { tenantId: string; workspaceId: string; publicationId: string }) => Promise<void>;
  /**
   * Reprovada com motivo numa marca que refaz: agenda a refação (o piloto refaz e reenvia para aprovação).
   * Devolve `queued: false` quando o limite de refações da ideia foi atingido (a ideia volta ao Bolsão).
   */
  onRejectedForRedo?: (input: { tenantId: string; workspaceId: string; publicationId: string; reason: string }) => Promise<{ queued: boolean; attempt?: number }>;
  /**
   * Publicação que foi ao ar em todas as redes: a ideia de origem fica "feita" (publicada) na hora — sem
   * esperar a conciliação do piloto (que só roda perto das 12h/19h). Devolve quantas ideias mudaram.
   */
  completePublishedIdeas?: () => Promise<number>;
  /** Decisão de um pedido "somente aprovação": registrada na execução de origem (sem publicar nada). */
  onApprovalOnlyDecision?: (input: { tenantId: string; workspaceId: string; publicationId: string; decision: "approve" | "reject"; reason?: string; reviewerUserId: string }) => Promise<void>;
  posts: {
    get(input: { tenantId: string; workspaceId: string; postId: string }): Promise<ApprovalPostView>;
    approve(input: { tenantId: string; workspaceId: string; postId: string; actor: { userId: string; role: TenantRole } }): Promise<unknown>;
    cancel(input: { tenantId: string; workspaceId: string; postId: string; actor: { userId: string; role: TenantRole } }): Promise<unknown>;
  };
  /** Bytes de uma mídia da publicação (URL do próprio armazenamento). */
  loadMedia(url: string): Promise<{ data: Buffer; mimeType: string }>;
  /** Link assinado para assistir a uma mídia (vídeo grande demais para anexar no WhatsApp). */
  mediaLink?: (url: string) => string;
  /** Maior vídeo anexado direto no WhatsApp (padrão 15 MB); acima disso vai o link. */
  maxVideoBytes?: number;
  idGenerator: () => string;
  now?: () => Date;
  log?: (message: string, extra?: Record<string, unknown>) => void;
};

/** Margem antes do horário agendado em que o prazo de resposta se encerra. */
const TIMEOUT_MARGIN_MS = 90_000;

function formatWhen(iso: string | undefined, timezone = "America/Sao_Paulo"): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}/${get("month")} às ${get("hour")}:${get("minute")}`;
}

export function canonicalApprovalPhone(raw: string): string {
  return phoneDigits(normalizePhoneNumber(raw));
}

/**
 * Formas em que o WhatsApp pode ter o número: celulares brasileiros fora de SP/RJ costumam estar registrados
 * SEM o 9 extra (confirmado em produção: a forma com o 9 falhou com "no LID found" e a sem o 9 entregou).
 */
export function whatsappPhoneVariants(phone: string): string[] {
  const digits = phoneDigits(phone);
  const withNine = /^55(\d{2})9([6-9]\d{7})$/.exec(digits);
  if (withNine) return [digits, `55${withNine[1]}${withNine[2]}`];
  const withoutNine = /^55(\d{2})([6-9]\d{7})$/.exec(digits);
  if (withoutNine) return [digits, `55${withoutNine[1]}9${withoutNine[2]}`];
  return [digits];
}

const UNKNOWN_NUMBER = /no LID found|not on whatsapp|not registered|not a whatsapp|invalid jid|no such user/i;

/** Envia ao aprovador tentando as formas do número (a preferida primeiro); devolve a forma que funcionou. */
export async function deliverToApprover(phone: string, send: (to: string) => Promise<unknown>, preferred?: string): Promise<string> {
  const variants = whatsappPhoneVariants(phone);
  const ordered = preferred && variants.includes(preferred) ? [preferred, ...variants.filter((item) => item !== preferred)] : variants;
  let lastError: unknown;
  for (const to of ordered) {
    try {
      await send(to);
      return to;
    } catch (error) {
      lastError = error;
      if (!UNKNOWN_NUMBER.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
  throw lastError;
}

export class WhatsappApprovalService {
  constructor(private readonly deps: WhatsappApprovalServiceDeps) {}

  private now() { return this.deps.now?.() ?? new Date(); }

  // ------------------------------------------------------------------ configuração

  async overview(tenantId: string) {
    const [settings, rules, members, workspaces] = await Promise.all([
      this.deps.repository.getSettings(tenantId), this.deps.repository.listRules(tenantId), this.deps.repository.listMembers(tenantId), this.deps.workspaces.listByTenant(tenantId),
    ]);
    const connections = (await Promise.all(workspaces.map((workspace) => this.deps.connections.listByWorkspace({ tenantId, workspaceId: workspace.id }).catch(() => []))))
      .flat().filter((connection) => connection.provider === "wuzapi")
      .map((connection) => ({ id: connection.id, workspaceId: connection.workspaceId, workspaceName: workspaces.find((workspace) => workspace.id === connection.workspaceId)?.name, displayName: connection.displayName, phoneNumber: connection.phoneNumber, status: connection.status }));
    return {
      settings: settings ?? { tenantId, enabled: false },
      connections,
      workspaces: workspaces.filter((workspace) => workspace.status !== "archived").map((workspace) => ({ id: workspace.id, name: workspace.name, rule: rules.find((rule) => rule.workspaceId === workspace.id) ?? { tenantId, workspaceId: workspace.id, enabled: false, onTimeout: "skip" as const, onReject: "redo" as const } })),
      approvers: members.filter((member) => hasPermission(member.role, "publication:approve")).map(({ userId, name, email }) => ({ userId, name, email })),
      recent: await this.deps.repository.listRecent(tenantId, 15),
    };
  }

  async saveSettings(input: { tenantId: string; enabled: boolean; connectionId?: string; actorUserId: string }) {
    if (input.enabled && !input.connectionId) throw new Error("WHATSAPP_APPROVAL_CONNECTION_REQUIRED: escolha o número que envia os pedidos de aprovação.");
    if (input.connectionId) {
      const connection = await this.deps.connections.getById(input.connectionId);
      if (!connection || connection.tenantId !== input.tenantId || connection.provider !== "wuzapi") throw new Error("WHATSAPP_APPROVAL_CONNECTION_INVALID: esse número não pertence a esta conta.");
    }
    return this.deps.repository.saveSettings({ tenantId: input.tenantId, enabled: input.enabled, connectionId: input.connectionId, updatedBy: input.actorUserId });
  }

  async saveRule(input: { tenantId: string; workspaceId: string; enabled: boolean; approverUserId?: string; approverPhone?: string; onTimeout: ApprovalTimeoutPolicy; onReject?: ApprovalRejectPolicy; actorUserId: string }) {
    const workspace = await this.deps.workspaces.getById(input.workspaceId);
    if (!workspace || workspace.tenantId !== input.tenantId) throw new Error("WHATSAPP_APPROVAL_WORKSPACE_INVALID: espaço de trabalho não encontrado nesta conta.");
    let approverPhone: string | undefined;
    if (input.approverPhone?.trim()) {
      try { approverPhone = canonicalApprovalPhone(input.approverPhone); } catch { throw new Error("WHATSAPP_APPROVAL_PHONE_INVALID: WhatsApp do aprovador inválido (use DDD + número)."); }
    }
    if (input.enabled) {
      if (!input.approverUserId || !approverPhone) throw new Error("WHATSAPP_APPROVAL_APPROVER_REQUIRED: informe quem aprova e o WhatsApp dele.");
      const member = (await this.deps.repository.listMembers(input.tenantId)).find((item) => item.userId === input.approverUserId);
      if (!member || !hasPermission(member.role, "publication:approve")) throw new Error("WHATSAPP_APPROVAL_APPROVER_INVALID: essa pessoa não tem permissão para aprovar publicações.");
    }
    const onReject = input.onReject ?? (await this.deps.repository.getRule(input.tenantId, input.workspaceId))?.onReject ?? "redo";
    return this.deps.repository.saveRule({ tenantId: input.tenantId, workspaceId: input.workspaceId, enabled: input.enabled, approverUserId: input.approverUserId, approverPhone, onTimeout: input.onTimeout, onReject, updatedBy: input.actorUserId });
  }

  /** A marca exige aprovação pelo WhatsApp? (usado ao criar a publicação). */
  async requiresApproval(input: { tenantId: string; workspaceId: string }): Promise<boolean> {
    const [settings, rule] = await Promise.all([this.deps.repository.getSettings(input.tenantId), this.deps.repository.getRule(input.tenantId, input.workspaceId)]);
    return Boolean(settings?.enabled && settings.connectionId && rule?.enabled && rule.approverPhone && rule.approverUserId);
  }

  async sendTest(input: { tenantId: string; workspaceId: string }) {
    const settings = await this.deps.repository.getSettings(input.tenantId);
    const rule = await this.deps.repository.getRule(input.tenantId, input.workspaceId);
    if (!settings?.connectionId) throw new Error("WHATSAPP_APPROVAL_CONNECTION_REQUIRED: escolha e salve o número que envia os pedidos.");
    if (!rule?.approverPhone) throw new Error("WHATSAPP_APPROVAL_APPROVER_REQUIRED: salve o WhatsApp de quem aprova esta marca.");
    const workspace = await this.deps.workspaces.getById(input.workspaceId);
    await this.sendText(settings.connectionId, rule.approverPhone, approvalAckText.test(workspace?.name ?? "marca"));
    return { sent: true };
  }

  // ------------------------------------------------------------------ envio

  private async session(connectionId: string) {
    const connection = await this.deps.connections.getById(connectionId);
    if (!connection?.externalSessionId) throw new Error("conexão do WhatsApp indisponível");
    if (!this.deps.provider) throw new Error("envio de WhatsApp indisponível neste servidor");
    return { connection, provider: this.deps.provider, session: connection.externalSessionId };
  }

  /** Forma do número que o WhatsApp aceitou por último (por aprovador), para não errar a cada envio. */
  private readonly deliverable = new Map<string, string>();

  /** Envia para o aprovador; se o WhatsApp não conhece o número nessa forma, tenta a outra (com/sem o 9). */
  private async deliver(connectionId: string, phone: string, send: (to: string) => Promise<{ externalMessageId?: string } | void>, requestId?: string) {
    let result: { externalMessageId?: string } | void = undefined;
    this.deliverable.set(phone, await deliverToApprover(phone, async (to) => { result = await send(to); }, this.deliverable.get(phone)));
    const id = (result as { externalMessageId?: string } | undefined)?.externalMessageId;
    if (id) await this.deps.repository.recordOutbound(connectionId, [id], requestId).catch(() => undefined);
  }

  private async sendText(connectionId: string, phone: string, body: string) {
    const { provider, session } = await this.session(connectionId);
    await this.deliver(connectionId, phone, (to) => provider.sendText({ externalSessionId: session, to, body }));
  }

  /** Envia os pedidos das publicações que aguardam aprovação (até 10 por rodada). */
  async dispatchPending(): Promise<number> {
    let sent = 0;
    for (const item of await this.deps.repository.listPublicationsToRequest(10)) {
      const [settings, rule, workspace] = await Promise.all([
        this.deps.repository.getSettings(item.tenantId), this.deps.repository.getRule(item.tenantId, item.workspaceId), this.deps.workspaces.getById(item.workspaceId),
      ]);
      if (!settings?.connectionId || !rule?.approverPhone) continue;
      const request = await this.deps.repository.createRequest({
        id: this.deps.idGenerator(), tenantId: item.tenantId, workspaceId: item.workspaceId, publicationId: item.publicationId, code: approvalCode(),
        connectionId: settings.connectionId, approverPhone: rule.approverPhone, approverUserId: rule.approverUserId,
      });
      if (!request) continue; // outro processo criou o pedido desta publicação
      try {
        const post = await this.deps.posts.get({ tenantId: item.tenantId, workspaceId: item.workspaceId, postId: item.publicationId });
        const { provider, session } = await this.session(settings.connectionId);
        const images = post.media.filter((media) => media.kind === "image").slice(0, 10);
        for (const media of images) {
          const file = await this.deps.loadMedia(media.url);
          const mediaUrl = `data:${file.mimeType};base64,${file.data.toString("base64")}`;
          await this.deliver(settings.connectionId, rule.approverPhone, (to) => provider.sendImage({ externalSessionId: session, to, mediaUrl }), request.id);
        }
        // Vídeo (Reels): o MESMO arquivo que será publicado. Anexado quando cabe; senão (ou se o envio
        // falhar por tamanho/formato), vai um link assinado para assistir — nunca outra versão.
        const video = post.media.find((media) => media.kind === "video");
        let videoLink: string | undefined;
        if (video) {
          const file = await this.deps.loadMedia(video.url);
          let attached = false;
          if (file.data.length <= (this.deps.maxVideoBytes ?? 15 * 1024 * 1024)) {
            const mediaUrl = `data:video/mp4;base64,${file.data.toString("base64")}`;
            try {
              await this.deliver(settings.connectionId, rule.approverPhone, (to) => provider.sendVideo({ externalSessionId: session, to, mediaUrl }), request.id);
              attached = true;
            } catch (error) {
              this.deps.log?.("whatsapp approval: vídeo não anexado, segue o link", { publicationId: item.publicationId, detail: error instanceof Error ? error.message.slice(0, 200) : String(error) });
            }
          }
          if (!attached) {
            videoLink = this.deps.mediaLink?.(video.url);
            if (!videoLink) throw new Error("vídeo grande demais para o WhatsApp e sem link de prévia");
          }
        }
        // Outro pedido já aguardando este aprovador: "1" sozinho seria ambíguo — a mensagem já orienta com o código.
        const othersOpen = (await this.deps.repository.listOpenByPhone(settings.connectionId, rule.approverPhone)).some((open) => open.id !== request.id);
        const redo = await this.deps.repository.findRedoByResult?.(item.publicationId).catch(() => undefined);
        const text = approvalRequestText({ brand: workspace?.name ?? "marca", code: request.code, networks: post.networks, when: formatWhen(post.scheduledAt, post.timezone), caption: post.caption, screens: images.length, withCode: othersOpen, ...(video ? { video: { ...(videoLink ? { link: videoLink } : {}) } } : {}), ...(redo ? { redo: { ...redo, max: MAX_REDO_ATTEMPTS } } : {}), ...(post.approvalOnly ? { approvalOnly: post.approvalOnly } : {}) });
        await this.deliver(settings.connectionId, rule.approverPhone, (to) => provider.sendText({ externalSessionId: session, to, body: text }), request.id);
        await this.deps.repository.updateRequest(request.id, { status: "sent", sentAt: this.now().toISOString() });
        sent += 1;
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 300) : String(error);
        await this.deps.repository.updateRequest(request.id, { status: "failed", detail });
        this.deps.log?.("whatsapp approval: falha ao enviar o pedido", { publicationId: item.publicationId, detail });
      }
    }
    return sent;
  }

  // ------------------------------------------------------------------ decisão

  private async actorFor(request: ApprovalRequest): Promise<{ userId: string; role: TenantRole }> {
    const member = (await this.deps.repository.listMembers(request.tenantId)).find((item) => item.userId === request.approverUserId);
    if (!member || !hasPermission(member.role, "publication:approve")) throw new Error("o aprovador não tem mais permissão para aprovar publicações");
    return { userId: member.userId, role: member.role };
  }

  private async brand(request: ApprovalRequest) {
    return (await this.deps.workspaces.getById(request.workspaceId))?.name ?? "marca";
  }

  /** Aplica as decisões recebidas pelo WhatsApp na publicação da marca certa. */
  private async returnIdea(request: ApprovalRequest) {
    await this.deps.onNotApproved?.({ tenantId: request.tenantId, workspaceId: request.workspaceId, publicationId: request.publicationId })
      .catch((error) => this.deps.log?.(`ideia não voltou ao Bolsão (${request.publicationId}): ${error instanceof Error ? error.message : error}`));
  }

  /**
   * Reprovada: com motivo e a marca configurada para refazer, agenda a refação (a ideia não volta ao Bolsão).
   * Sem motivo, marca que devolve, limite atingido ou falha ao agendar: a ideia volta ao Bolsão.
   * Devolve o resultado da tentativa de refação (undefined = nem tentou).
   */
  private async redoOrReturn(request: ApprovalRequest): Promise<{ queued: boolean; attempt?: number; declined?: boolean } | undefined> {
    const reason = request.reason?.trim();
    // "Não quero postar isso" não é pedido de ajuste: devolve ao Bolsão sem gastar uma refação.
    if (reason && interpretRejection(reason).noRedo) {
      await this.returnIdea(request);
      return { queued: false, declined: true };
    }
    const rule = reason && this.deps.onRejectedForRedo ? await this.deps.repository.getRule(request.tenantId, request.workspaceId) : undefined;
    if (reason && rule && rule.onReject !== "return") {
      const result = await this.deps.onRejectedForRedo!({ tenantId: request.tenantId, workspaceId: request.workspaceId, publicationId: request.publicationId, reason })
        .catch((error) => { this.deps.log?.(`refação não agendada (${request.publicationId}): ${error instanceof Error ? error.message : error}`); return undefined; });
      if (result?.queued) return result;
      await this.returnIdea(request);
      return result;
    }
    await this.returnIdea(request);
    return undefined;
  }

  async applyDecisions(): Promise<number> {
    let applied = 0;
    for (const request of await this.deps.repository.listByStatus("decided", 20)) {
      const brand = await this.brand(request);
      const key = { tenantId: request.tenantId, workspaceId: request.workspaceId, postId: request.publicationId };
      try {
        const actor = await this.actorFor(request);
        const post = await this.deps.posts.get(key);
        if (post.state !== "AWAITING_APPROVAL") throw new Error("a publicação não está mais aguardando aprovação");
        if (post.approvalOnly) {
          const decision = request.decision === "approve" ? "approve" : "reject";
          await this.deps.onApprovalOnlyDecision?.({ ...key, publicationId: request.publicationId, decision, ...(request.reason ? { reason: request.reason } : {}), reviewerUserId: actor.userId });
          // O post era só o veículo do pedido: encerrado sem publicar (o arquivo aprovado fica na execução de origem).
          await this.deps.posts.cancel({ ...key, actor });
          await this.sendText(request.connectionId, request.approverPhone, decision === "approve" ? approvalAckText.approvedOnly(brand) : approvalAckText.rejectedOnly(brand, request.reason)).catch(() => undefined);
          await this.deps.repository.updateRequest(request.id, { status: "applied", appliedAt: this.now().toISOString(), detail: `somente aprovação: ${decision === "approve" ? "aprovado" : "reprovado"} pela pessoa; nada foi agendado nem publicado${post.approvalOnly.sha256 ? ` · sha256 ${post.approvalOnly.sha256.slice(0, 16)}` : ""}` });
          applied += 1;
          continue;
        }
        if (request.decision === "approve") {
          await this.deps.posts.approve({ ...key, actor });
          await this.sendText(request.connectionId, request.approverPhone, approvalAckText.approved(brand, formatWhen(post.scheduledAt, post.timezone))).catch(() => undefined);
        } else {
          await this.deps.posts.cancel({ ...key, actor });
          const redo = await this.redoOrReturn(request);
          const ack = redo?.queued ? approvalAckText.redoQueued(brand, request.reason ?? "", redo.attempt ?? 1, MAX_REDO_ATTEMPTS)
            : redo?.declined ? approvalAckText.declined(brand, request.reason)
            : redo ? approvalAckText.redoLimit(brand, request.reason, MAX_REDO_ATTEMPTS) : approvalAckText.rejected(brand, request.reason);
          await this.sendText(request.connectionId, request.approverPhone, ack).catch(() => undefined);
        }
        await this.deps.repository.updateRequest(request.id, { status: "applied", appliedAt: this.now().toISOString() });
        applied += 1;
      } catch (error) {
        const detail = error instanceof Error ? error.message.replace(/^[A-Z_]+:\s*/, "").slice(0, 300) : String(error);
        await this.deps.repository.updateRequest(request.id, { status: "failed", detail });
        await this.sendText(request.connectionId, request.approverPhone, approvalAckText.failed(brand, detail)).catch(() => undefined);
      }
    }
    return applied;
  }

  /** Prazo: pedido sem resposta perto do horário agendado → segue a regra da marca (não publica / publica). */
  async expireDue(): Promise<number> {
    let expired = 0;
    for (const request of await this.deps.repository.listByStatus("sent", 50)) {
      const key = { tenantId: request.tenantId, workspaceId: request.workspaceId, postId: request.publicationId };
      let post: ApprovalPostView;
      try { post = await this.deps.posts.get(key); } catch { await this.deps.repository.updateRequest(request.id, { status: "expired", detail: "publicação não encontrada" }); continue; }
      if (post.state !== "AWAITING_APPROVAL") {
        await this.deps.repository.updateRequest(request.id, { status: "expired", detail: `publicação mudou para ${post.state} fora do WhatsApp` });
        continue;
      }
      if (post.approvalOnly) continue;
      if (!post.scheduledAt || Date.parse(post.scheduledAt) - this.now().getTime() > TIMEOUT_MARGIN_MS) continue;
      const rule = await this.deps.repository.getRule(request.tenantId, request.workspaceId);
      const brand = await this.brand(request);
      const when = formatWhen(post.scheduledAt, post.timezone);
      try {
        const actor = await this.actorFor(request);
        if (rule?.onTimeout === "publish") {
          await this.deps.posts.approve({ ...key, actor });
          await this.sendText(request.connectionId, request.approverPhone, approvalAckText.expiredPublish(brand, when)).catch(() => undefined);
        } else {
          await this.deps.posts.cancel({ ...key, actor });
          await this.returnIdea(request);
          await this.sendText(request.connectionId, request.approverPhone, approvalAckText.expiredSkip(brand, when)).catch(() => undefined);
        }
        await this.deps.repository.updateRequest(request.id, { status: "expired", appliedAt: this.now().toISOString(), detail: rule?.onTimeout === "publish" ? "sem resposta: publicada pela regra da marca" : "sem resposta: não publicada" });
        expired += 1;
      } catch (error) {
        await this.deps.repository.updateRequest(request.id, { status: "failed", detail: error instanceof Error ? error.message.slice(0, 300) : String(error) });
      }
    }
    return expired;
  }

  async tick() {
    const sent = await this.dispatchPending();
    const applied = await this.applyDecisions();
    const expired = await this.expireDue();
    const completed = await (this.deps.completePublishedIdeas?.() ?? Promise.resolve(0))
      .catch((error) => { this.deps.log?.(`ideias publicadas não marcadas como feitas: ${error instanceof Error ? error.message : error}`); return 0; });
    const redoFailures = await this.notifyFailedRedos()
      .catch((error) => { this.deps.log?.(`aviso de refação não enviado: ${error instanceof Error ? error.message : error}`); return 0; });
    return { sent, applied, expired, completed, redoFailures };
  }

  /** Refação que não deu certo (Quality Gate, Codex indisponível…): avisa o aprovador uma vez; a ideia já está no Bolsão. */
  async notifyFailedRedos(): Promise<number> {
    const failed = await this.deps.repository.listFailedRedosToNotify?.(10) ?? [];
    for (const redo of failed) {
      const brand = (await this.deps.workspaces.getById(redo.workspaceId))?.name ?? "marca";
      await this.sendText(redo.connectionId, redo.approverPhone, approvalAckText.redoFailed(brand, redo.detail)).catch(() => undefined);
      await this.deps.repository.markRedoNotified?.(redo.id);
    }
    return failed.length;
  }
}

/**
 * Captura a resposta do aprovador no worker de Conversas, ANTES de virar conversa de atendimento.
 * Devolve `handled: false` quando a mensagem não é resposta de aprovação (segue o fluxo normal).
 */
export async function captureApprovalReply(
  repository: Pick<WhatsappApprovalRepositoryPort, "listOpenByPhone" | "decideRequest"> & Partial<Pick<WhatsappApprovalRepositoryPort, "requestForOutbound">>,
  input: { connectionId: string; fromPhone: string | undefined; text: string | undefined; isGroup: boolean; fromMe: boolean; quotedExternalMessageId?: string; now?: Date },
): Promise<{ handled: boolean; reply?: string; requestId?: string }> {
  if (input.isGroup || input.fromMe || !input.fromPhone) return { handled: false };
  const parsed = parseApprovalReply(input.text);
  if (!parsed) return { handled: false };
  let phone: string;
  try { phone = canonicalApprovalPhone(input.fromPhone); } catch { return { handled: false }; }
  const open = await repository.listOpenByPhone(input.connectionId, phone);
  // Resposta citando a imagem/texto de um pedido ("Responder" no WhatsApp): vale para aquele pedido, sem código.
  const quoted = !parsed.code && input.quotedExternalMessageId && repository.requestForOutbound
    ? await repository.requestForOutbound(input.connectionId, input.quotedExternalMessageId).catch(() => undefined)
    : undefined;
  if (quoted && quoted.approverPhone === phone) {
    if (!open.some((request) => request.id === quoted.id)) return { handled: true, reply: approvalAckText.late(quoted.code) };
    if (parsed.unclear) return { handled: true, reply: approvalAckText.unclear(quoted.code) };
    const decided = await repository.decideRequest(quoted.id, parsed.decision, parsed.reason, (input.now ?? new Date()).toISOString());
    return decided ? { handled: true, requestId: quoted.id } : { handled: true, reply: approvalAckText.late(quoted.code) };
  }
  const match = matchPendingRequest(open, parsed);
  if (!match) return { handled: false };
  if ("ambiguous" in match) return { handled: true, reply: approvalAckText.ambiguous(match.ambiguous) };
  if ("unknownCode" in match) return { handled: true, reply: approvalAckText.unknownCode(match.unknownCode) };
  // "Pode refazer", "Ok, mas…": nunca aprova sem certeza — pergunta de novo.
  if (parsed.unclear) return { handled: true, reply: approvalAckText.unclear(match.request.code) };
  const decided = await repository.decideRequest(match.request.id, parsed.decision, parsed.reason, (input.now ?? new Date()).toISOString());
  return decided ? { handled: true, requestId: match.request.id } : { handled: true, reply: approvalAckText.late(match.request.code) };
}

/**
 * Eco (fromMe) de uma mensagem que o SISTEMA mandou ao aprovador? Então não entra nas Conversas — senão o
 * chat mostraria só metade (os pedidos, sem as respostas, que também não entram). O eco pode chegar antes
 * de o id ser gravado: num chat de aprovador, confere de novo depois de uma pausa curta. Mensagem que a
 * equipe digita no celular para o aprovador continua indo para as Conversas.
 */
export async function isApprovalEcho(
  repository: Pick<WhatsappApprovalRepositoryPort, "isApprovalOutbound" | "isApproverPhone" | "hasRecentApprovalActivity">,
  input: { connectionId: string; externalMessageId: string; chatPhone: string | undefined; fromMe: boolean; isGroup: boolean; waitMs?: number },
): Promise<boolean> {
  if (!input.fromMe || input.isGroup || !input.externalMessageId) return false;
  if (await repository.isApprovalOutbound(input.connectionId, input.externalMessageId)) return true;
  let phone: string | undefined;
  try { phone = input.chatPhone ? canonicalApprovalPhone(input.chatPhone) : undefined; } catch { phone = undefined; }
  // O eco pode vir só com o identificador interno do WhatsApp (LID), sem telefone: então vale a atividade recente.
  const approverChat = phone ? await repository.isApproverPhone(input.connectionId, phone) : false;
  if (!approverChat && !(await repository.hasRecentApprovalActivity(input.connectionId))) return false;
  await new Promise((resolve) => setTimeout(resolve, input.waitMs ?? 2_500));
  return repository.isApprovalOutbound(input.connectionId, input.externalMessageId);
}
