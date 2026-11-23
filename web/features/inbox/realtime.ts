/**
 * Regras puras do tempo real da Caixa de entrada (Reorganização de UX — Fase 6).
 *
 * Bug real corrigido: o SSE revalidava `["inbox-conversations", ws, filtro]` (3 partes), mas as
 * listas são guardadas pelo SWR com 4 partes (`[..., filtro, contactId]`, `contactId` normalmente
 * `undefined`). O `stableHash` do SWR inclui `undefined` na chave, então os dois nunca coincidiam:
 * eventos de mensagem NÃO atualizavam a lista (ela só mudava no polling de 30s). Agora a
 * revalidação usa um *matcher* por prefixo, que pega toda lista daquele workspace.
 *
 * Também: rajadas de eventos (um álbum de 10 fotos = 10 eventos) disparavam 10 buscas de lista,
 * mensagens e eventos — consumindo o mesmo limite de leituras por minuto do usuário (120/min por
 * padrão no servidor, todas as leituras no mesmo balde). Agora a revalidação é agrupada.
 */

/** Chave SWR de QUALQUER lista de conversas deste workspace (todos os filtros/contatos). */
export function isConversationListKey(key: unknown, workspaceId: string): boolean {
  return Array.isArray(key) && key[0] === "inbox-conversations" && key[1] === workspaceId;
}

/** Chave SWR das mensagens (qualquer página/limite carregado) de uma conversa. */
export function isConversationMessagesKey(key: unknown, workspaceId: string, conversationId: string): boolean {
  return Array.isArray(key) && key[0] === "inbox-conversation-messages" && key[1] === workspaceId && key[2] === conversationId;
}

/**
 * Junta chamadas próximas numa só: a primeira agenda, as seguintes dentro da janela só são
 * absorvidas. Garante no máximo 1 execução por janela, sempre DEPOIS da última mudança chegar
 * (nunca perde um evento: o que chega durante a espera é coberto pela execução agendada).
 */
type Timers = { set: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>; clear: (handle: ReturnType<typeof setTimeout>) => void };
// Funções intermediárias de propósito: chamar `setTimeout` como método de outro objeto (`timers.set`)
// dá "Illegal invocation" no navegador.
const DEFAULT_TIMERS: Timers = { set: (callback, ms) => setTimeout(callback, ms), clear: (handle) => clearTimeout(handle) };

export function createCoalescer(run: () => void, windowMs: number, timers: Timers = DEFAULT_TIMERS) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule() {
      if (pending !== undefined) return;
      pending = timers.set(() => {
        pending = undefined;
        run();
      }, windowMs);
    },
    cancel() {
      if (pending !== undefined) timers.clear(pending);
      pending = undefined;
    },
    get scheduled() {
      return pending !== undefined;
    },
  };
}

/** Espera antes de reconectar: 5s, 10s, 20s, 40s… até 60s. Volta a 5s quando conecta. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(60_000, 5_000 * 2 ** Math.max(0, attempt));
}

/** Janela para agrupar eventos de tempo real antes de buscar de novo. */
export const REALTIME_COALESCE_MS = 700;

// ------------------------------------------------------------------ saúde do tempo real

/**
 * Enquanto o SSE está conectado, mudanças chegam por ele (e cada (re)conexão busca o estado
 * atual), então o polling vira só uma rede de segurança e pode ser bem mais espaçado. Se o SSE
 * cai, volta o intervalo curto de antes.
 */
const healthy = new Map<string, boolean>();
const listeners = new Set<() => void>();

export function setRealtimeHealthy(workspaceId: string, value: boolean): void {
  if (healthy.get(workspaceId) === value) return;
  healthy.set(workspaceId, value);
  for (const listener of listeners) listener();
}

export function isRealtimeHealthy(workspaceId: string): boolean {
  return healthy.get(workspaceId) === true;
}

export function subscribeRealtimeHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Intervalo de polling de segurança: curto sem tempo real, longo com ele saudável. */
export function fallbackInterval(baseMs: number, realtimeHealthy: boolean): number {
  return realtimeHealthy ? Math.max(baseMs, 90_000) : baseMs;
}
