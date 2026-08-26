import type { MetaAdAccountRepositoryPort } from "../ports/meta-ad-account-repository.port.js";
import type { MetaPixel } from "../ports/meta-pixel-repository.port.js";
import type { MetaCapiEventRepositoryPort } from "../ports/meta-capi-event-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import { MetaGraphError, metaGraphRequest } from "../../infrastructure/meta/meta-graph-client.js";
import { type HashablePiiInput, hashPiiFields } from "../../infrastructure/meta/hash-pii.js";
import { resolveMetaAdsAccessToken } from "./resolve-meta-ads-access-token.js";

/**
 * Envio de evento à Conversions API (CAPI) — Fase 4. `user_data` nunca guarda o valor original,
 * só o hash SHA-256 (`hashPiiFields`) — e o log de auditoria (`meta_capi_events`) grava só QUAIS
 * campos foram enviados (`em`, `ph`...), nunca o hash em si, ver `meta-capi-event-repository.port.ts`.
 *
 * `eventTime` é convertido pra segundos Unix aqui — a Marketing API rejeita eventos com mais de 7
 * dias de atraso ou no futuro; quem chama decide o valor, esta função só converte o formato.
 */

export type SendMetaCapiEventInput = {
  tenantId: string;
  workspaceId: string;
  pixel: MetaPixel;
  eventName: string;
  /** ISO 8601 — padrão: agora. */
  eventTime?: string;
  /** Dedup id — usar o MESMO valor de um evento já disparado via Pixel do navegador evita contar
   * a conversão duas vezes (server + browser). */
  eventId?: string;
  actionSource?: "website" | "app" | "phone_call" | "chat" | "email" | "other" | "physical_store" | "system_generated";
  userData: HashablePiiInput;
  customData?: Record<string, unknown>;
  eventSourceUrl?: string;
  /** Código do painel "Testar eventos" do Events Manager — obrigatório só durante testes;
   * eventos de produção nunca devem enviar isto. */
  testEventCode?: string;
};

export type SendMetaCapiEventDeps = {
  adAccountRepository: MetaAdAccountRepositoryPort;
  capiEventRepository: MetaCapiEventRepositoryPort;
  credentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
  fetchImpl?: typeof fetch;
};

export type SendMetaCapiEventResult = { eventsReceived?: number; fbtraceId?: string };

export async function sendMetaCapiEvent(deps: SendMetaCapiEventDeps, input: SendMetaCapiEventInput): Promise<SendMetaCapiEventResult> {
  const adAccount = await deps.adAccountRepository.getById(input.pixel.adAccountId);
  if (!adAccount || adAccount.tenantId !== input.tenantId || adAccount.workspaceId !== input.workspaceId) {
    throw new Error("META_ADS_ACCOUNT_NOT_FOUND: conta de anúncio do pixel não encontrada para este workspace.");
  }

  const accessToken = await resolveMetaAdsAccessToken(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: adAccount.credentialReferenceId });

  const userData = hashPiiFields(input.userData);
  const userDataFields = Object.keys(userData);
  const eventTime = Math.floor((input.eventTime ? new Date(input.eventTime).getTime() : Date.now()) / 1000);
  const actionSource = input.actionSource ?? "website";

  try {
    const response = await metaGraphRequest<{ events_received?: number; fbtrace_id?: string }>(`/${input.pixel.pixelId}/events`, {
      method: "POST",
      accessToken,
      fetchImpl: deps.fetchImpl,
      params: {
        data: [
          {
            event_name: input.eventName,
            event_time: eventTime,
            ...(input.eventId ? { event_id: input.eventId } : {}),
            action_source: actionSource,
            ...(input.eventSourceUrl ? { event_source_url: input.eventSourceUrl } : {}),
            user_data: userData,
            ...(input.customData ? { custom_data: input.customData } : {}),
          },
        ],
        ...(input.testEventCode ? { test_event_code: input.testEventCode } : {}),
      },
    });

    await deps.capiEventRepository.record({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      metaPixelId: input.pixel.id,
      pixelId: input.pixel.pixelId,
      eventName: input.eventName,
      eventTime: new Date(eventTime * 1000).toISOString(),
      eventId: input.eventId,
      actionSource,
      userDataFields,
      customData: input.customData,
      testEventCode: input.testEventCode,
      status: "sent",
      eventsReceived: response.events_received,
      fbtraceId: response.fbtrace_id,
    });

    return { eventsReceived: response.events_received, fbtraceId: response.fbtrace_id };
  } catch (error) {
    const errorMessage = error instanceof MetaGraphError ? error.message : error instanceof Error ? error.message : String(error);
    await deps.capiEventRepository.record({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      metaPixelId: input.pixel.id,
      pixelId: input.pixel.pixelId,
      eventName: input.eventName,
      eventTime: new Date(eventTime * 1000).toISOString(),
      eventId: input.eventId,
      actionSource,
      userDataFields,
      customData: input.customData,
      testEventCode: input.testEventCode,
      status: "failed",
      errorMessage,
    });
    throw error;
  }
}
