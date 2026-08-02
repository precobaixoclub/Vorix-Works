import { formatDateTime } from "@/lib/format";
import { ACTION_LABEL, INTENT_LABEL, STATE_LABEL } from "../labels";
import type { ConversationTurn } from "../group-turns";

/**
 * Um turno completo — Sprint 06 (Fase 6): a mensagem do usuário + a decisão do sistema, nunca uma
 * resposta de IA fingida. "Arthur decidiu consultar Knowledge." é literalmente `systemMessageText`
 * do backend, não um texto inventado no frontend — mas o detalhamento da decisão (intenção,
 * confiança, ação, estado, motivo) fica atrás de um `<details>` recolhido por padrão: é informação
 * real de auditoria, só que técnica demais pra ficar sempre exposta a quem só quer conversar.
 */
export function TurnBubble({ turn }: { turn: ConversationTurn }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <div className="max-w-lg rounded-2xl bg-accent px-4 py-2.5 text-sm text-white">
          <p className="whitespace-pre-wrap">{turn.userMessageContent}</p>
          <p className="mt-1 text-[11px] text-white/70">{formatDateTime(turn.userMessageCreatedAt)}</p>
        </div>
      </div>

      {turn.decision ? (
        <div className="flex justify-start">
          <div className="max-w-lg rounded-2xl border border-border bg-surface-raised px-4 py-3 text-sm">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">Vorix</p>
            {turn.systemMessageText ? <p className="mt-1 text-ink">{turn.systemMessageText}</p> : null}

            <details className="group mt-2">
              <summary className="cursor-pointer select-none text-xs text-ink-muted hover:text-ink">Ver detalhes técnicos</summary>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                {turn.intent ? (
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5">
                    Intenção: {INTENT_LABEL[turn.intent.type]} ({Math.round(turn.intent.confidence * 100)}%)
                  </span>
                ) : null}
                <span className="rounded-full bg-surface-sunken px-2 py-0.5">Ação: {ACTION_LABEL[turn.decision.action]}</span>
                {turn.state ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">Estado: {STATE_LABEL[turn.state]}</span> : null}
              </div>
              <p className="mt-2 text-xs text-ink-faint">{turn.decision.reason}</p>
            </details>
          </div>
        </div>
      ) : null}
    </div>
  );
}
