import type { ProductEventRepositoryPort, RecordProductEventInput } from "../ports/product-event-repository.port.js";
import type { ProductEventName } from "../../domain/product-analytics/product-analytics.model.js";

export type ProductAnalyticsUseCaseDeps = {
  productEventRepository: ProductEventRepositoryPort;
  /** Kill switch (`PRODUCT_ANALYTICS_ENABLED`) — quando `false`, todo registro é um no-op
   * silencioso. Nunca afeta a operação principal (seção 25). */
  enabled: boolean;
  /** Observabilidade (seção 25): `product_event_write_failed`. Nunca lança — só loga. `undefined`
   * = sem logger configurado (nunca bloqueia). */
  onWriteFailed?: (input: { eventName: ProductEventName; error: unknown }) => void;
};

/** Chaves com formato/nome que sugerem dado sensível — nunca aceitas em `properties`, mesmo que
 * um chamador esqueça a disciplina de instrumentação (seção 10/11: defesa em profundidade, não a
 * única linha de defesa — a primeira é nunca passar isso pra cá). */
const FORBIDDEN_PROPERTY_KEY_PATTERN = /email|phone|telefone|cpf|cnpj|password|senha|token|secret|prompt|message|mensagem|content|conteudo|conteúdo/i;
const MAX_PROPERTY_STRING_LENGTH = 200;
const MAX_PROPERTY_KEYS = 20;

/** Nunca lança — poda properties fora do vocabulário mínimo esperado em vez de rejeitar o evento
 * inteiro (rejeitar destruiria visibilidade do funil por causa de uma property extra). */
function sanitizeProperties(properties: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!properties) return {};
  const entries = Object.entries(properties).slice(0, MAX_PROPERTY_KEYS);
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (FORBIDDEN_PROPERTY_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string") {
      sanitized[key] = value.length > MAX_PROPERTY_STRING_LENGTH ? value.slice(0, MAX_PROPERTY_STRING_LENGTH) : value;
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      sanitized[key] = value;
    }
    // objetos/arrays aninhados são deliberadamente descartados — "não transformar properties em
    // dumping de objetos do domínio" (seção 11).
  }
  return sanitized;
}

/**
 * Registra um evento de produto — NUNCA lança pro chamador (seção 25: "negócio continua sendo
 * criado, mensagem continua sendo enviada, checkout continua funcionando" mesmo se isto falhar).
 * `enabled=false` é um no-op silencioso, não um erro.
 */
export async function recordProductEvent(deps: ProductAnalyticsUseCaseDeps, input: RecordProductEventInput): Promise<void> {
  if (!deps.enabled) return;
  try {
    await deps.productEventRepository.record({ ...input, properties: sanitizeProperties(input.properties) });
  } catch (error) {
    deps.onWriteFailed?.({ eventName: input.eventName, error });
  }
}

export type RecordFirstEventInput = {
  eventName: ProductEventName;
  tenantId: string;
  workspaceId: string;
  source: RecordProductEventInput["source"];
  userId?: string;
  sessionId?: string;
  properties?: Record<string, unknown>;
};

/** Só grava o `ProductEvent` na PRIMEIRA vez que `(workspaceId, eventName)` ocorre — chamadas
 * seguintes são idempotentes no-op (nunca 500 eventos pro mesmo marco, seção 8). Também nunca
 * lança. */
export async function recordFirstEvent(deps: ProductAnalyticsUseCaseDeps, input: RecordFirstEventInput): Promise<void> {
  if (!deps.enabled) return;
  try {
    const isFirst = await deps.productEventRepository.markFirstOccurrence({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      eventName: input.eventName,
    });
    if (!isFirst) return;
    await deps.productEventRepository.record({
      eventName: input.eventName,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      sessionId: input.sessionId,
      source: input.source,
      properties: sanitizeProperties(input.properties),
    });
  } catch (error) {
    deps.onWriteFailed?.({ eventName: input.eventName, error });
  }
}
