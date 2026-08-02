"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorState } from "@/components/ErrorState";
import { Spinner } from "@/components/Spinner";
import { ConversationComposer } from "@/features/conversation/components/ConversationComposer";
import { TurnBubble } from "@/features/conversation/components/TurnBubble";
import { sendMessage } from "@/features/conversation/api";
import { useConversationHistory } from "@/features/conversation/hooks";
import { groupEventsIntoTurns } from "@/features/conversation/group-turns";
import type { SendMessageResult } from "@/features/conversation/types";
import { BriefingPanel } from "@/features/briefing/components/BriefingPanel";

const EXAMPLE_MESSAGES = [
  "Quero criar uma campanha para vender um produto novo",
  "Preciso de um post para o Instagram sobre uma promoção",
  "Me ajuda a planejar o conteúdo do mês",
] as const;

/**
 * Thread de uma conversa — Sprint 06 (Fase 6), estendida na Sprint 07 (Fase 14) com o painel de
 * Briefing. Cada mensagem enviada mostra intenção + decisão + estado (nunca uma resposta de IA —
 * "ainda sem resposta de IA", PROMPT 06). O histórico completo vem de
 * `GET /v1/conversations/:id/history` (o log de eventos), agrupado em turnos pela própria UI
 * (`groupEventsIntoTurns`) — o backend nunca modela "mensagem" como entidade própria.
 *
 * O painel de Briefing (pergunta atual, campos já entendidos, confirmação) vem da resposta VIVA de
 * `sendMessage` (não do histórico — os eventos de Briefing guardam só ids/chaves para auditoria,
 * nunca o texto completo da pergunta/resumo, ver `dto.ts`) e fica em estado local, substituído a
 * cada novo turno.
 */
export default function ConversationThreadPage() {
  const params = useParams<{ workspaceId: string; conversationId: string }>();
  const { data: events, isLoading, error, mutate } = useConversationHistory(params.workspaceId, params.conversationId);
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<SendMessageResult | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  const turns = groupEventsIntoTurns(events ?? []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns.length]);

  async function handleSend(content: string) {
    setSending(true);
    try {
      const result = await sendMessage(params.workspaceId, params.conversationId, content);
      setLastResult(result.briefingSummary || result.nextQuestion || result.preparedCommandSummary ? result : undefined);
      await mutate();
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {isLoading ? (
            <div className="flex justify-center py-14">
              <Spinner />
            </div>
          ) : error ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : turns.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-14 text-center">
              <p className="text-sm text-ink-muted">Envie a primeira mensagem para começar esta conversa. Não sabe por onde começar? Tente:</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
                {EXAMPLE_MESSAGES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    disabled={sending}
                    onClick={() => handleSend(example)}
                    className="rounded-full border border-border bg-surface-raised px-3.5 py-2 text-left text-sm text-ink transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-60"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn) => <TurnBubble key={turn.id} turn={turn} />)
          )}
        </div>
      </div>
      {lastResult ? (
        <div className="mx-auto w-full max-w-2xl px-6 pb-2">
          <BriefingPanel
            summary={lastResult.briefingSummary}
            nextQuestion={lastResult.nextQuestion}
            confirmationRequired={lastResult.confirmationRequired}
            preparedCommandSummary={lastResult.preparedCommandSummary}
            aiAssisted={lastResult.aiAssisted}
            aiFallbackUsed={lastResult.aiFallbackUsed}
            onSend={handleSend}
            disabled={sending}
          />
        </div>
      ) : null}
      <div className="mx-auto w-full max-w-2xl">
        <ConversationComposer onSend={handleSend} disabled={sending} />
      </div>
    </>
  );
}
