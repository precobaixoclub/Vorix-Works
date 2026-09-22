import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AddSubscriptionItemInput,
  AddSubscriptionItemResult,
  BillingProviderFailure,
  BillingProviderPort,
  CancelSubscriptionInput,
  ChangeSubscriptionInput,
  ChangeSubscriptionResult,
  CreateCheckoutInput,
  CreateCheckoutResult,
  CreateCustomerPortalInput,
  CreateCustomerPortalResult,
  CreateSubscriptionInput,
  CreateSubscriptionResult,
  GetPaymentMethodInput,
  GetPaymentMethodResult,
  HandleWebhookInput,
  HandleWebhookResult,
  RemoveSubscriptionItemInput,
  ResumeSubscriptionInput,
  UpdateSubscriptionItemQuantityInput,
} from "../../application/ports/billing-provider.port.js";

/** Um valor fixo (env, comportamento histórico) OU uma closure resolvida a cada chamada — usada
 * pela tela de admin "Mercado Pago" (`billing-provider-settings.usecases.ts`) pra ler a credencial
 * configurada em runtime, sem restart. O provider faz seu próprio cache com TTL (ver
 * `CREDENTIAL_CACHE_TTL_MS` abaixo) — mesmo padrão já usado por `OpenAiImageProviderAdapter`. */
type CredentialSource = string | (() => Promise<string | undefined>);

export type MercadoPagoBillingProviderOptions = {
  /** `undefined` = Mercado Pago não está configurado — todo método devolve `not_configured`,
   * mesmo padrão de `StripeBillingProvider` sem `secretKey`. Em test mode, este é o Access Token
   * de TEST (`TEST-...`), nunca live (`APP_USR-...`) sem autorização explícita. */
  accessToken?: CredentialSource;
  /** Chave de assinatura de webhook (aba "Webhooks" de "Tuas integrações", NUNCA o access token —
   * são dois segredos diferentes no Mercado Pago). */
  webhookSecret?: CredentialSource;
  /** URL pública que o Mercado Pago chama com notificações (`notification_url` em cada
   * preapproval) — precisa ser o host da API (`https://api.vorixworks.com/webhooks/billing/mercadopago`),
   * nunca o host do site (diferente do `back_url`, que é pra onde o NAVEGADOR volta). */
  notificationUrl?: CredentialSource;
  /** Injeção pra teste — nunca usado em produção real (default: `fetch` global do Node 20+). */
  fetchImpl?: typeof fetch;
};

const NOT_CONFIGURED: BillingProviderFailure = { ok: false, kind: "not_configured", message: "Mercado Pago não está configurado (MERCADOPAGO_ACCESS_TOKEN ausente)." };
const API_BASE = "https://api.mercadopago.com";
/** Mesmo TTL de `OpenAiImageProviderAdapter` — a tela de admin "Mercado Pago" documenta "efeito em
 * até 60 segundos", nunca instantâneo (evita 1 SELECT por chamada de API). */
const CREDENTIAL_CACHE_TTL_MS = 60_000;

type PreapprovalMetadata = { tenantId: string; planVersionId: string; billingInterval: string };

function encodeExternalReference(metadata: PreapprovalMetadata): string {
  return JSON.stringify(metadata);
}

function decodeExternalReference(externalReference: string | undefined): PreapprovalMetadata | undefined {
  if (!externalReference) return undefined;
  try {
    const parsed = JSON.parse(externalReference) as Partial<PreapprovalMetadata>;
    if (!parsed.tenantId || !parsed.planVersionId) return undefined;
    return { tenantId: parsed.tenantId, planVersionId: parsed.planVersionId, billingInterval: parsed.billingInterval ?? "monthly" };
  } catch {
    return undefined;
  }
}

/**
 * `MercadoPagoBillingProvider` — Pricing/Capacity Etapa C. Implementação REAL do
 * `BillingProviderPort` pra Mercado Pago, mesmo papel arquitetural de `StripeBillingProvider`
 * (nunca uma interface nova — auditoria aprovada em `docs/vorix-billing-mercadopago-audit.md`).
 *
 * Diferença estrutural do Mercado Pago (não é bug, é o modelo real do provider, confirmado por
 * pesquisa na documentação oficial): uma `preapproval` cobra um `transaction_amount` ÚNICO e fixo
 * por ciclo — não existe "subscription item com quantidade" nativo. Por isso `addSubscriptionItem`/
 * `removeSubscriptionItem`/`updateSubscriptionItemQuantity` aqui NUNCA criam itens de linha de
 * verdade no Mercado Pago — eles só empurram o `transaction_amount` TOTAL (já calculado por
 * `capacity.model.ts` no caso de uso chamador, nunca recalculado aqui) via `PUT /preapproval/{id}`.
 * `subscription_items`/quantidades continuam existindo só no NOSSO banco (rastro comercial
 * interno), nunca no Mercado Pago.
 */
export class MercadoPagoBillingProvider implements BillingProviderPort {
  readonly providerId = "mercadopago";
  readonly supportsNativeScheduledCancellation = false;
  private readonly accessTokenSource?: CredentialSource;
  private readonly webhookSecretSource?: CredentialSource;
  private readonly notificationUrlSource?: CredentialSource;
  private readonly fetchImpl: typeof fetch;
  private accessTokenCache: { value?: string; at: number } = { at: 0 };
  private webhookSecretCache: { value?: string; at: number } = { at: 0 };
  private notificationUrlCache: { value?: string; at: number } = { at: 0 };

  constructor(options: MercadoPagoBillingProviderOptions) {
    this.accessTokenSource = options.accessToken;
    this.webhookSecretSource = options.webhookSecret;
    this.notificationUrlSource = options.notificationUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Resolve um `CredentialSource` — string fixa devolvida direto (sem cache, é síncrono por
   * natureza); closure (tela de admin) resolvida com cache de `CREDENTIAL_CACHE_TTL_MS`, nunca uma
   * consulta por chamada de API. */
  private async resolveCredential(source: CredentialSource | undefined, cache: { value?: string; at: number }): Promise<string | undefined> {
    if (typeof source !== "function") return source;
    const now = Date.now();
    if (now - cache.at > CREDENTIAL_CACHE_TTL_MS) {
      cache.value = await source();
      cache.at = now;
    }
    return cache.value;
  }

  private resolveAccessToken(): Promise<string | undefined> {
    return this.resolveCredential(this.accessTokenSource, this.accessTokenCache);
  }

  private resolveWebhookSecret(): Promise<string | undefined> {
    return this.resolveCredential(this.webhookSecretSource, this.webhookSecretCache);
  }

  private resolveNotificationUrl(): Promise<string | undefined> {
    return this.resolveCredential(this.notificationUrlSource, this.notificationUrlCache);
  }

  private async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<{ ok: true; data: T } | BillingProviderFailure> {
    const accessToken = await this.resolveAccessToken();
    if (!accessToken) return NOT_CONFIGURED;
    try {
      const response = await this.fetchImpl(`${API_BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await response.json().catch(() => undefined)) as (T & { message?: string; error?: string }) | undefined;
      if (!response.ok) {
        return { ok: false, kind: response.status === 404 ? "not_found" : "invalid_request", message: json?.message ?? json?.error ?? `Mercado Pago respondeu ${response.status}.` };
      }
      return { ok: true, data: json as T };
    } catch (error) {
      return { ok: false, kind: "provider_unavailable", message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Nunca calcula o valor — `input.amount`/`input.currency` já vêm prontos do caso de uso
   * chamador (`capacity.model.ts`), conforme seção 4/9 do pedido. */
  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult | BillingProviderFailure> {
    if (input.amount === undefined || !input.currency) {
      return { ok: false, kind: "invalid_request", message: "Mercado Pago exige amount/currency calculados pelo chamador — nenhum catálogo de preço nativo." };
    }
    const notificationUrl = await this.resolveNotificationUrl();
    const result = await this.request<{ id: string; init_point: string }>("POST", "/preapproval", {
      reason: "Assinatura Vorix",
      external_reference: encodeExternalReference({ tenantId: input.tenantId, planVersionId: input.planVersionId, billingInterval: input.billingInterval }),
      payer_email: input.customerEmail,
      back_url: input.successUrl,
      notification_url: notificationUrl,
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: input.amount, currency_id: input.currency },
      status: "pending",
    });
    if (!result.ok) return result;
    if (!result.data.init_point) return { ok: false, kind: "provider_unavailable", message: "Mercado Pago não devolveu um init_point de checkout." };
    return { ok: true, checkoutUrl: result.data.init_point, providerSessionId: result.data.id };
  }

  /** Nunca usado pelos casos de uso hoje (fluxo real é sempre via checkout/`init_point`, nunca
   * criação direta server-to-server) — mantido honesto: falha explícita em vez de fingir suporte. */
  async createSubscription(_input: CreateSubscriptionInput): Promise<CreateSubscriptionResult | BillingProviderFailure> {
    return { ok: false, kind: "invalid_request", message: "Mercado Pago não cria assinatura diretamente sem autorização do pagador — use createCheckout." };
  }

  /** Troca de plano/adicional — nunca troca "item", sempre reescreve o `transaction_amount` total
   * (já recalculado pelo chamador). */
  async changeSubscription(input: ChangeSubscriptionInput): Promise<ChangeSubscriptionResult | BillingProviderFailure> {
    if (input.amount === undefined || !input.currency) {
      return { ok: false, kind: "invalid_request", message: "Mercado Pago exige amount/currency recalculados pelo chamador para atualizar a assinatura." };
    }
    const result = await this.request<{ status: string }>("PUT", `/preapproval/${input.providerSubscriptionId}`, {
      auto_recurring: { transaction_amount: input.amount, currency_id: input.currency },
    });
    if (!result.ok) return result;
    return { ok: true, status: result.data.status };
  }

  /**
   * `atPeriodEnd:true` nunca é suportado nativamente (seção 3 da auditoria) — o caso de uso
   * chamador já sabe disso (`supportsNativeScheduledCancellation:false`) e só chama isto com
   * `atPeriodEnd:false` quando o período realmente terminou (via o scheduler de pendências).
   */
  async cancelSubscription(input: CancelSubscriptionInput): Promise<{ ok: true } | BillingProviderFailure> {
    if (input.atPeriodEnd) {
      return { ok: false, kind: "invalid_request", message: "Mercado Pago não agenda cancelamento nativamente — o chamador deve usar subscription_pending_changes." };
    }
    const result = await this.request<{ status: string }>("PUT", `/preapproval/${input.providerSubscriptionId}`, { status: "cancelled" });
    if (!result.ok) return result;
    return { ok: true };
  }

  async resumeSubscription(input: ResumeSubscriptionInput): Promise<{ ok: true } | BillingProviderFailure> {
    const result = await this.request<{ status: string }>("PUT", `/preapproval/${input.providerSubscriptionId}`, { status: "authorized" });
    if (!result.ok) return result;
    return { ok: true };
  }

  /** Nunca cria um item de linha de verdade — só empurra o novo total. `providerItemId` devolvido
   * é sintético (nunca existe no Mercado Pago) só para preencher `SubscriptionItem.providerItemId`
   * sem quebrar o shape já existente; `removeSubscriptionItem`/`updateSubscriptionItemQuantity`
   * abaixo o ignoram, usando sempre `providerSubscriptionId` pra saber qual preapproval atualizar. */
  async addSubscriptionItem(input: AddSubscriptionItemInput): Promise<AddSubscriptionItemResult | BillingProviderFailure> {
    if (input.amount === undefined || !input.currency) {
      return { ok: false, kind: "invalid_request", message: "Mercado Pago exige o total recalculado pelo chamador para refletir um adicional." };
    }
    const result = await this.request<{ status: string }>("PUT", `/preapproval/${input.providerSubscriptionId}`, {
      auto_recurring: { transaction_amount: input.amount, currency_id: input.currency },
    });
    if (!result.ok) return result;
    return { ok: true, providerItemId: `mercadopago-virtual-item-${input.providerSubscriptionId}` };
  }

  async removeSubscriptionItem(input: RemoveSubscriptionItemInput): Promise<{ ok: true } | BillingProviderFailure> {
    if (!input.providerSubscriptionId || input.amount === undefined || !input.currency) {
      return { ok: false, kind: "invalid_request", message: "Mercado Pago exige providerSubscriptionId + total recalculado para refletir a remoção de um adicional." };
    }
    const result = await this.request<{ status: string }>("PUT", `/preapproval/${input.providerSubscriptionId}`, {
      auto_recurring: { transaction_amount: input.amount, currency_id: input.currency },
    });
    if (!result.ok) return result;
    return { ok: true };
  }

  async updateSubscriptionItemQuantity(input: UpdateSubscriptionItemQuantityInput): Promise<{ ok: true } | BillingProviderFailure> {
    if (!input.providerSubscriptionId || input.amount === undefined || !input.currency) {
      return { ok: false, kind: "invalid_request", message: "Mercado Pago exige providerSubscriptionId + total recalculado para refletir a mudança de quantidade." };
    }
    const result = await this.request<{ status: string }>("PUT", `/preapproval/${input.providerSubscriptionId}`, {
      auto_recurring: { transaction_amount: input.amount, currency_id: input.currency },
    });
    if (!result.ok) return result;
    return { ok: true };
  }

  /** Mercado Pago não expõe "meio de pagamento salvo do assinante" pela API de preapproval do
   * jeito que o Stripe expõe `paymentMethods.list` — devolve `undefined` explicitamente (nunca
   * inventa um cartão fake), a UI trata isso como "sem forma de pagamento visível aqui". */
  async getPaymentMethod(_input: GetPaymentMethodInput): Promise<GetPaymentMethodResult | BillingProviderFailure> {
    return { ok: true, paymentMethod: undefined };
  }

  /** Decisão de produto (seção 5 da auditoria, aprovada): Mercado Pago não tem um portal
   * hospedado equivalente ao Stripe Billing Portal — o assinante gerencia o cartão dentro do
   * própria conta/app Mercado Pago dele, nunca por uma URL que o Vorix gera. Falha explícita e
   * clara, nunca uma URL inventada. */
  async createCustomerPortal(_input: CreateCustomerPortalInput): Promise<CreateCustomerPortalResult | BillingProviderFailure> {
    return { ok: false, kind: "not_configured", message: "Mercado Pago não oferece um portal de pagamento hospedado — gerencie a forma de pagamento pela sua própria conta Mercado Pago, ou use 'Regularizar pagamento' no Vorix." };
  }

  /**
   * Verificação real de assinatura (`x-signature`: `ts=...,v1=...`), manifest
   * `id:{dataId};request-id:{requestId};ts:{ts};` (segmentos OMITIDOS, nunca em branco, quando
   * ausentes; `dataId` sempre minúsculo) — algoritmo documentado oficialmente, HMAC-SHA256 hex
   * contra `webhookSecret` (segredo de webhook, NUNCA o access token — dois segredos distintos).
   * Notificação do Mercado Pago é sempre "fina" (só `type`+`data.id`) — busca o recurso completo
   * via GET antes de normalizar pro `BillingWebhookEvent` canônico.
   */
  async handleWebhook(input: HandleWebhookInput): Promise<HandleWebhookResult | BillingProviderFailure> {
    const [accessToken, webhookSecret] = await Promise.all([this.resolveAccessToken(), this.resolveWebhookSecret()]);
    if (!accessToken || !webhookSecret) return NOT_CONFIGURED;

    let notification: { type?: string; action?: string; data?: { id?: string } };
    try {
      notification = JSON.parse(input.rawBody.toString("utf8"));
    } catch {
      return { ok: false, kind: "invalid_request", message: "Corpo do webhook Mercado Pago não é JSON válido." };
    }
    const dataId = notification.data?.id;
    if (!dataId) return { ok: false, kind: "invalid_request", message: "Notificação Mercado Pago sem data.id." };

    const signatureHeader = Array.isArray(input.signatureHeader) ? input.signatureHeader[0] : input.signatureHeader;
    if (!signatureHeader) return { ok: false, kind: "signature_invalid", message: "Cabeçalho x-signature ausente." };
    const parts = Object.fromEntries(signatureHeader.split(",").map((pair) => pair.trim().split("=") as [string, string]));
    const ts = parts.ts;
    const v1 = parts.v1;
    if (!ts || !v1) return { ok: false, kind: "signature_invalid", message: "x-signature sem ts/v1." };

    const requestId = Array.isArray(input.requestIdHeader) ? input.requestIdHeader[0] : input.requestIdHeader;
    const manifestParts: string[] = [];
    manifestParts.push(`id:${dataId.toLowerCase()};`);
    if (requestId) manifestParts.push(`request-id:${requestId};`);
    manifestParts.push(`ts:${ts};`);
    const manifest = manifestParts.join("");

    const expected = createHmac("sha256", webhookSecret).update(manifest).digest("hex");
    const expectedBuffer = Buffer.from(expected, "utf8");
    const actualBuffer = Buffer.from(v1, "utf8");
    if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
      return { ok: false, kind: "signature_invalid", message: "Assinatura x-signature do Mercado Pago não confere." };
    }

    const topic = notification.type ?? notification.action;
    if (topic === "subscription_preapproval") {
      const result = await this.request<{ id: string; status: string; external_reference?: string; payer_email?: string }>("GET", `/preapproval/${dataId}`);
      if (!result.ok) return result;
      const metadata = decodeExternalReference(result.data.external_reference);
      // Vocabulário canônico já usado por `webhook-use-cases.ts` (pré-existente, nomeado como o
      // Stripe historicamente chamou — nunca renomeado nesta rodada pra não quebrar o Stripe já
      // testado; o adapter é quem traduz o topic NATIVO do Mercado Pago pra esse vocabulário
      // comum, seção 21 do pedido: "somente adapter conhece semântica específica do provider").
      const eventType = result.data.status === "cancelled" ? "customer.subscription.deleted" : metadata ? "checkout.session.completed" : "customer.subscription.updated";
      return {
        ok: true,
        event: {
          providerEventId: `mercadopago-${topic}-${dataId}-${result.data.status}`,
          eventType,
          providerSubscriptionId: result.data.id,
          data: { ...result.data, metadata, cancel_at_period_end: false },
        },
      };
    }

    if (topic === "payment") {
      const result = await this.request<{ id: string; status: string; transaction_amount?: number; currency_id?: string; date_approved?: string }>("GET", `/v1/payments/${dataId}`);
      if (!result.ok) return result;
      const succeeded = result.data.status === "approved";
      return {
        ok: true,
        event: {
          providerEventId: `mercadopago-payment-${dataId}`,
          eventType: succeeded ? "invoice.payment_succeeded" : "invoice.payment_failed",
          data: {
            id: String(result.data.id),
            amount_paid: succeeded ? result.data.transaction_amount : undefined,
            amount_due: result.data.transaction_amount,
            currency: result.data.currency_id,
          },
        },
      };
    }

    return { ok: true, event: { providerEventId: `mercadopago-${topic}-${dataId}`, eventType: `mercadopago.${topic ?? "unknown"}`, data: {} } };
  }
}
