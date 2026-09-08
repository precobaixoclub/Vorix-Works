import { getApiBaseUrl } from "./api-error";
import { getAccessToken } from "./auth-token";

/**
 * Trial + Product Analytics — disparo de eventos COMPORTAMENTAIS do lado do cliente (seção 9:
 * "frontend só dispara landing_view/pricing_view/plan_selected/signup_started" — qualquer evento
 * de ESTADO real, tipo `checkout_completed`/`deal_won`, é responsabilidade do backend e nem passa
 * no schema desta rota, ver `product-events.route.ts`). Best-effort SEMPRE: nunca lança, nunca
 * bloqueia navegação, nunca impede a página de funcionar se a API estiver fora — mesmo racional de
 * `recordProductEvent` no backend (analytics nunca pode derrubar a operação real).
 */

const ANONYMOUS_ID_STORAGE_KEY = "vorix_anonymous_id";
const CLIENT_EVENT_NAMES = ["landing_view", "pricing_view", "plan_selected", "signup_started"] as const;
export type ClientProductEventName = (typeof CLIENT_EVENT_NAMES)[number];

/** Nunca fingerprint — só um id aleatório persistido no navegador (seção 8: "nunca fingerprinting
 * invasivo"). Ausente/perdido (aba anônima, storage limpo) é normal: a chamada segue sem
 * `anonymousId`, o backend só não consegue ligar esta visita a um cadastro futuro. */
function getOrCreateAnonymousId(): string | undefined {
  try {
    const existing = window.localStorage.getItem(ANONYMOUS_ID_STORAGE_KEY);
    if (existing) return existing;
    const generated = `anon-${crypto.randomUUID()}`;
    window.localStorage.setItem(ANONYMOUS_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return undefined;
  }
}

export function trackProductEvent(eventName: ClientProductEventName, properties?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const token = getAccessToken();
  const body = JSON.stringify({ eventName, anonymousId: getOrCreateAnonymousId(), properties });
  void fetch(`${getApiBaseUrl()}/v1/product-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
    keepalive: true,
  }).catch(() => {
    // Best-effort: uma falha de rede aqui nunca deve aparecer pro usuário nem ser re-tentada — a
    // próxima visita/evento já cobre a lacuna, e o funil aceita perda pontual de eventos client-side.
  });
}
