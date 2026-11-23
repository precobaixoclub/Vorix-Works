"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, CalendarDays, ImageIcon, Lightbulb, Loader2, Search } from "lucide-react";
import { Button } from "@/components/Button";
import { Skeleton } from "@/components/ui/skeleton";
import { EDITORIAL_FORMAT_LABEL, updateEditorialIdea, type EditorialIdea } from "@/features/editorial-ideas/api";
import { startIdeaProduction } from "@/features/editorial-ideas/produce";
import { extractExecutionRunFailure, waitForExecutionRunTerminal } from "@/features/production-line/api";
import { cn } from "@/lib/utils";
import { editorialDateLabel, pickableIdeas } from "./picker-model";

/**
 * "Criar com IA › Começar de uma ideia do Bolsão" (Fase 4). Escolhe uma ideia pendente e cria o
 * post com ela pelo MESMO caminho do Bolsão (`startIdeaProduction`): prompt, roteiro, legenda e
 * imagens de referência da ideia são preservados. Acompanha a criação e leva à Revisão.
 */
export function IdeaPicker({ workspaceId, ideas, loading, error, creativeEngineEnabled, onChanged, initialSelectedId }: { workspaceId: string; ideas: readonly EditorialIdea[] | undefined; loading: boolean; error: boolean; creativeEngineEnabled: boolean; onChanged: () => void; initialSelectedId?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // Fase 5: "Criar com esta ideia" (Calendário/Bolsão) chega com `?ideia=` e a ideia já vem escolhida.
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSelectedId);
  const [producing, setProducing] = useState<string | undefined>();
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | undefined>();
  const visible = useMemo(() => pickableIdeas(ideas ?? [], query), [ideas, query]);
  const selected = visible.find((idea) => idea.id === selectedId) ?? (ideas ?? []).find((idea) => idea.id === selectedId);
  const inProduction = (ideas ?? []).filter((idea) => idea.status === "in_production").length;
  const toReview = (ideas ?? []).filter((idea) => idea.status === "produced").length;
  const base = `/workspaces/${workspaceId}`;

  async function produce(idea: EditorialIdea) {
    if (producing) return;
    setProducing(idea.id);
    setMessage(undefined);
    try {
      const run = await startIdeaProduction(workspaceId, idea);
      onChanged();
      const detail = await waitForExecutionRunTerminal(workspaceId, run.executionRunId);
      if (detail.run.state === "failed") {
        // Mesmo comportamento do Bolsão: falhou, a ideia volta a ficar disponível.
        await updateEditorialIdea(workspaceId, idea.id, { status: "available", executionRunId: null }).catch(() => undefined);
        onChanged();
        setMessage({ tone: "error", text: extractExecutionRunFailure(detail).message || "A criação falhou. A ideia continua disponível para tentar de novo." });
        return;
      }
      router.push(detail.run.state === "completed" || detail.run.state === "waiting_for_approval" ? `${base}/review` : `${base}/production`);
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Não foi possível criar o post com esta ideia." });
    } finally {
      setProducing(undefined);
    }
  }

  return (
    <section aria-labelledby="idea-picker-title" className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5" data-testid="idea-picker">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="idea-picker-title" className="flex items-center gap-2 text-[15px] font-semibold text-foreground"><Lightbulb className="h-4 w-4 text-amber-500" /> Começar de uma ideia do Bolsão</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">A IA usa o prompt, o roteiro e as imagens de referência da ideia.</p>
        </div>
        <Link href={`${base}/ideias`} className="inline-flex min-h-[36px] items-center gap-1 text-xs font-semibold text-primary hover:underline dark:text-primary-glow">Abrir o Bolsão <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>

      {inProduction || toReview ? (
        <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="idea-picker-status">
          {inProduction ? <Link href={`${base}/production`} className="hover:text-foreground hover:underline">{inProduction} em produção</Link> : null}
          {toReview ? <Link href={`${base}/review`} className="hover:text-foreground hover:underline">{toReview} pronta(s) para revisar</Link> : null}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl bg-muted/50 px-3 py-3 text-sm text-muted-foreground">Não foi possível carregar o Bolsão agora. Você ainda pode descrever uma nova ideia abaixo.</p>
      ) : loading && !ideas ? (
        <div className="space-y-2">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-12 w-full" />)}</div>
      ) : (ideas ?? []).every((idea) => idea.status !== "available") ? (
        <p className="rounded-xl bg-muted/50 px-3 py-3 text-sm text-muted-foreground" data-testid="idea-picker-empty">Nenhuma ideia pendente no Bolsão. Descreva uma nova ideia abaixo ou cadastre ideias no Bolsão.</p>
      ) : (
        <>
          <label className="mb-2 flex h-[44px] items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-ring/45">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="sr-only">Buscar ideia</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ideia pelo título ou tema" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </label>
          <ul className="max-h-[300px] space-y-1 overflow-y-auto overscroll-contain pr-1" role="listbox" aria-label="Ideias pendentes">
            {visible.length === 0 ? <li className="px-2 py-3 text-xs text-muted-foreground">Nenhuma ideia pendente com esse termo.</li> : null}
            {visible.map((idea) => {
              const date = editorialDateLabel(idea);
              const isSelected = idea.id === selectedId;
              return (
                <li key={idea.id} role="option" aria-selected={isSelected}>
                  <button type="button" data-idea={idea.id} onClick={() => setSelectedId(isSelected ? undefined : idea.id)} className={cn("flex min-h-[48px] w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors", isSelected ? "border-solution/60 bg-solution/10" : "border-transparent hover:bg-muted/60")}>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-medium text-foreground sm:line-clamp-1">{idea.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{EDITORIAL_FORMAT_LABEL[idea.format]}</span>
                        {idea.category ? <span>· {idea.category}</span> : null}
                        {date ? <span className="inline-flex items-center gap-1">· <CalendarDays className="h-3 w-3" /> data editorial {date}</span> : null}
                        {idea.referenceImages?.length ? <span className="inline-flex items-center gap-1">· <ImageIcon className="h-3 w-3" /> {idea.referenceImages.length} ref.</span> : null}
                        {idea.priority === "high" ? <span className="font-semibold text-amber-600 dark:text-amber-400">· prioridade</span> : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {selected ? (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-background p-3" data-testid="idea-picker-selected">
          <p className="text-sm font-semibold text-foreground">{selected.title}</p>
          {selected.keyMessage ? <p className="line-clamp-3 text-xs text-muted-foreground">{selected.keyMessage}</p> : null}
          {selected.referenceImages?.length ? (
            <div className="flex gap-1.5">{selected.referenceImages.slice(0, 5).map((url) => <img key={url} src={url} alt="" className="h-12 w-12 rounded-md object-cover" />)}</div>
          ) : null}
          {!creativeEngineEnabled ? <p className="text-xs text-muted-foreground">A geração visual ainda não está habilitada para este espaço de trabalho.</p> : null}
          {producing === selected.id ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Criando o post com esta ideia… isso leva alguns minutos. Você pode sair: ela continua em produção.</p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={Boolean(producing)} onClick={() => setSelectedId(undefined)}>Cancelar</Button>
            <Button disabled={!creativeEngineEnabled || Boolean(producing) || selected.status !== "available"} loading={producing === selected.id} onClick={() => void produce(selected)} data-testid="idea-picker-produce">
              Criar com esta ideia
            </Button>
          </div>
        </div>
      ) : null}

      {message ? <p className={cn("mt-3 rounded-xl px-3 py-2 text-sm", message.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")} role="alert">{message.text}</p> : null}
    </section>
  );
}
