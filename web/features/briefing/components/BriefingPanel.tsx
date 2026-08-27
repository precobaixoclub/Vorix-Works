import { Button } from "@/components/Button";
import type { BriefingQuestionDto, BriefingSummaryDto, PreparedCommandSummaryDto } from "../types";

/**
 * Painel de Briefing — Sprint 07 (Fase 14), estendido na Sprint 08 (Fase 21) com uma nota
 * discreta sobre uso de IA. Nunca um formulário rígido: mostra o que já foi entendido, o que
 * falta, ambiguidades e sugestões pendentes de confirmação, e a pergunta atual com opções quando
 * existirem. Toda ação (responder opção, confirmar, corrigir, cancelar) vira uma mensagem NORMAL
 * via `onSend` — nunca chama um endpoint de status diretamente.
 *
 * A nota de IA é deliberadamente mínima — nunca nome de modelo, tokens, prompt ou confidence
 * numérica (Fase 21: "a UI não deve virar um chat genérico de IA"; "a UI não deve depender de IA
 * para funcionar" — por isso o painel funciona idêntico quando `aiAssisted`/`aiFallbackUsed` são
 * `undefined`, o caso comum com o Gateway desligado).
 */
export function BriefingPanel({
  summary,
  nextQuestion,
  confirmationRequired,
  preparedCommandSummary,
  aiAssisted,
  aiFallbackUsed,
  onSend,
  disabled,
}: {
  summary?: BriefingSummaryDto;
  nextQuestion?: BriefingQuestionDto;
  confirmationRequired?: boolean;
  preparedCommandSummary?: PreparedCommandSummaryDto;
  aiAssisted?: boolean;
  aiFallbackUsed?: boolean;
  onSend: (content: string) => void;
  disabled?: boolean;
}) {
  if (!summary && !nextQuestion && !preparedCommandSummary) return null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-border bg-surface-raised p-4 text-sm">
      {aiAssisted ? <p className="text-xs text-ink-faint">✦ O Vorix identificou algumas informações adicionais na sua mensagem.</p> : null}
      {aiFallbackUsed ? <p className="text-xs text-ink-faint">Seguindo com as perguntas de sempre — sem problema.</p> : null}

      {summary ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Já entendido</p>
          {summary.knownFields.length === 0 ? (
            <p className="mt-1 text-ink-faint">Nada ainda.</p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {summary.knownFields.map((field) => (
                <li
                  key={field.fieldKey}
                  className={`rounded-full px-2.5 py-1 text-xs ${
                    field.requiresConfirmation && !field.confirmedByUser ? "bg-amber-100 text-amber-900" : "bg-surface-sunken text-ink"
                  }`}
                >
                  <span className="font-medium">{field.label}:</span> {field.value}
                  {field.requiresConfirmation && !field.confirmedByUser ? " (sugestão, confirme)" : ""}
                </li>
              ))}
            </ul>
          )}

          {summary.ambiguousFields.length > 0 ? (
            <p className="mt-2 text-xs text-amber-700">Ambíguo: {summary.ambiguousFields.join(", ")} — pode esclarecer?</p>
          ) : null}
        </div>
      ) : null}

      {nextQuestion ? (
        <div>
          <p className="text-ink">{nextQuestion.text}</p>
          {nextQuestion.reason ? <p className="mt-0.5 text-xs text-ink-faint">{nextQuestion.reason}</p> : null}
          {nextQuestion.options && nextQuestion.options.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {nextQuestion.options.map((option) => (
                <Button key={option} variant="secondary" disabled={disabled} onClick={() => onSend(option)}>
                  {option}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {confirmationRequired ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button disabled={disabled} onClick={() => onSend("sim")}>
            Confirmar
          </Button>
          <Button variant="secondary" disabled={disabled} onClick={() => onSend("cancelar")}>
            Cancelar
          </Button>
          <p className="w-full text-xs text-ink-faint">Para corrigir algo, descreva o que quer mudar na próxima mensagem. Nenhum conteúdo foi gerado ainda.</p>
        </div>
      ) : null}

      {preparedCommandSummary ? (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-primary">
          Comando preparado (revisão {preparedCommandSummary.briefingRevision}, {preparedCommandSummary.fieldCount} campo(s)). Nenhum conteúdo foi gerado
          ainda — a execução real fica para uma sprint futura.
        </p>
      ) : null}
    </div>
  );
}
