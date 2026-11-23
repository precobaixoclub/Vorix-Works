"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, ChevronRight, Lock, Plus, RotateCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavIcon, type NavIconId } from "@/components/NavIcon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ATTENTION_BADGE_LABEL, relativeTime, type ActivityItem, type AttentionItem, type CreateOption, type HomeModule, type QuickLink } from "@/features/home/model";
import { cn } from "@/lib/utils";

/** Blocos visuais do Início (Fase 3) — um só vocabulário visual para as cinco áreas. */

export const MODULE_META: Record<HomeModule, { label: string; icon: NavIconId }> = {
  conversations: { label: "Conversas", icon: "conversas" },
  sales: { label: "Vendas", icon: "deals" },
  marketing: { label: "Marketing", icon: "marketing" },
  meetings: { label: "Reuniões", icon: "meetings" },
  site: { label: "Meu site", icon: "site" },
};

const panelClass = "rounded-2xl border border-border/70 bg-card shadow-sm";
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45";

export function HomePanel({ title, description, action, children, className, testId }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  const id = `home-${title.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className={cn(panelClass, "min-w-0 p-4 sm:p-5", className)} data-testid={testId}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-[15px] font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------------------------- Resumo

export type SummaryCardState =
  | { kind: "loading" }
  | { kind: "error"; onRetry: () => void }
  | { kind: "no_permission" }
  | { kind: "unavailable"; message: string }
  | { kind: "setup"; message: string; actionLabel?: string; actionHref?: string }
  | { kind: "value"; value: number; hint?: string; tone?: "attention" | "critical" };

export type SummaryCardProps = { id: string; module: HomeModule; label: string; href: string; state: SummaryCardState };

export function SummaryCard({ base, card }: { base: string; card: SummaryCardProps }) {
  const meta = MODULE_META[card.module];
  const { state } = card;
  const header = (
    <div className="flex items-start justify-between gap-2">
      <span className="min-w-0 text-xs font-medium leading-snug text-muted-foreground">{card.label}</span>
      <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground [&_svg]:h-[15px] [&_svg]:w-[15px]">
        <NavIcon id={meta.icon} />
      </span>
    </div>
  );
  const shell = "flex min-h-[112px] min-w-0 flex-col justify-between gap-2 rounded-2xl border border-border/70 bg-card p-3.5 shadow-sm sm:p-4";

  if (state.kind === "value") {
    return (
      <Link
        href={`${base}${card.href}`}
        data-summary={card.id}
        className={cn(shell, focusRing, "group transition-colors hover:border-solution/45 hover:bg-surface-2/40", state.tone === "critical" && "border-destructive/35", state.tone === "attention" && "border-warning/40")}
      >
        {header}
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-2xl font-semibold tabular-nums text-foreground sm:text-[26px]">
            {state.value.toLocaleString("pt-BR")}
            {state.tone ? <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", state.tone === "critical" ? "bg-destructive" : "bg-warning")} /> : null}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{state.hint ?? meta.label}</p>
        </div>
      </Link>
    );
  }

  return (
    <div className={shell} data-summary={card.id} data-state={state.kind}>
      {header}
      {state.kind === "loading" ? (
        <div className="space-y-2" aria-label="Carregando">
          <Skeleton className="h-7 w-14" />
          <Skeleton className="h-3 w-24" />
        </div>
      ) : state.kind === "error" ? (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground"><AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" /> Não foi possível carregar</p>
          <button type="button" onClick={state.onRetry} className={cn("mt-1.5 inline-flex min-h-[32px] items-center gap-1.5 rounded-md text-xs font-semibold text-primary hover:underline dark:text-primary-glow", focusRing)}>
            <RotateCw className="h-3.5 w-3.5" /> Tentar de novo
          </button>
        </div>
      ) : state.kind === "no_permission" ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Seu perfil não tem acesso a este indicador.</p>
      ) : state.kind === "unavailable" ? (
        <p className="text-xs text-muted-foreground">{state.message}</p>
      ) : (
        <div className="min-w-0">
          <p className="line-clamp-2 text-xs text-muted-foreground">{state.message}</p>
          {state.actionHref && state.actionLabel ? (
            <Link href={`${base}${state.actionHref}`} className={cn("mt-1.5 inline-flex min-h-[32px] items-center gap-1 text-xs font-semibold text-primary hover:underline dark:text-primary-glow", focusRing)}>
              {state.actionLabel} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------- Atenção

export type ModuleLoadIssue = { module: HomeModule; onRetry: () => void };

export function AttentionList({
  base,
  items,
  loading,
  issues,
  now,
  busyId,
  onAction,
}: {
  base: string;
  items: readonly AttentionItem[];
  loading: boolean;
  issues: readonly ModuleLoadIssue[];
  now: Date;
  busyId?: string;
  onAction: (kind: NonNullable<AttentionItem["action"]>["kind"] | NonNullable<AttentionItem["secondary"]>["kind"], id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, 7);
  return (
    <div className="space-y-2">
      {issues.map((issue) => (
        <div key={issue.module} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground" data-issue={issue.module}>
          <span className="flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5 text-destructive" /> Não foi possível carregar as pendências de {MODULE_META[issue.module].label}.</span>
          <button type="button" onClick={issue.onRetry} className={cn("inline-flex min-h-[32px] items-center gap-1 font-semibold text-primary hover:underline dark:text-primary-glow", focusRing)}><RotateCw className="h-3.5 w-3.5" /> Tentar de novo</button>
        </div>
      ))}

      {items.length === 0 && loading ? (
        <div className="space-y-3 py-1" aria-label="Carregando pendências">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-3/5" /><Skeleton className="h-3 w-2/5" /></div>
            </div>
          ))}
        </div>
      ) : null}

      {items.length === 0 && !loading ? (
        <div className="flex items-center gap-3 rounded-xl bg-muted/35 px-3 py-3" data-testid="attention-empty">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-status-active-bg text-status-active"><CheckCircle2 className="h-4 w-4" /></span>
          <div>
            <p className="text-sm font-medium text-foreground">Tudo em dia</p>
            <p className="text-xs text-muted-foreground">{issues.length ? "Nada pendente nas áreas que carregaram." : "Nenhuma pendência precisa de você agora."}</p>
          </div>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="divide-y divide-border/60" data-testid="attention-list">
          {visible.map((item) => {
            const meta = MODULE_META[item.module];
            return (
              <li key={item.id} className="flex min-w-0 flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center" data-attention={item.id}>
                <Link href={`${base}${item.href}`} className={cn("-mx-1.5 flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 transition-colors hover:bg-muted/50", focusRing)}>
                  <span aria-hidden="true" className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&_svg]:h-4 [&_svg]:w-4", item.badge === "failed" || item.badge === "overdue" || item.badge === "sla" || item.badge === "disconnected" ? "bg-destructive/10 text-destructive" : item.badge === "urgent" ? "bg-warning/12 text-warning" : "bg-muted/70 text-muted-foreground")}>
                    <NavIcon id={meta.icon} />
                  </span>
                  <span className="min-w-0 flex-1">
                    {/* No celular o título quebra em até 2 linhas (nada cortado no meio); no desktop, 1 linha. */}
                    <span className="flex min-w-0 items-start gap-2">
                      <span className="line-clamp-2 min-w-0 text-sm font-medium leading-snug text-foreground sm:line-clamp-1">{item.title}</span>
                      {item.badge ? <span className={cn("mt-px shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold", item.badge === "urgent" ? "bg-warning/15 text-warning" : "bg-destructive/12 text-destructive")}>{ATTENTION_BADGE_LABEL[item.badge]}</span> : null}
                    </span>
                    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      <span className="shrink-0">{meta.label}</span>
                      {item.at ? <><span aria-hidden="true">·</span><span className="shrink-0">{relativeTime(item.at, now)}</span></> : null}
                      {item.context ? <><span aria-hidden="true" className="hidden sm:inline">·</span><span className="line-clamp-2 w-full min-w-0 sm:w-auto sm:flex-1 sm:truncate">{item.context}</span></> : null}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                </Link>
                {item.action ? (
                  <div className="flex shrink-0 gap-1.5 pl-12 sm:pl-0">
                    {item.secondary ? (
                      <button type="button" disabled={Boolean(busyId)} onClick={() => onAction(item.secondary!.kind, item.secondary!.id)} className={cn("min-h-[36px] rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50", focusRing)}>
                        Descartar
                      </button>
                    ) : null}
                    <button type="button" disabled={Boolean(busyId)} onClick={() => onAction(item.action!.kind, item.action!.id)} className={cn("min-h-[36px] rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50", focusRing)}>
                      {busyId === item.action.id ? "Salvando…" : item.action.kind === "complete_task" ? "Concluir" : "Aplicar"}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {items.length > 7 ? (
        <button type="button" onClick={() => setShowAll((current) => !current)} className={cn("min-h-[36px] text-xs font-semibold text-primary hover:underline dark:text-primary-glow", focusRing)}>
          {showAll ? "Mostrar menos" : `Ver todas as ${items.length} pendências`}
        </button>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------------- Atividade

export function ActivityList({ base, items, loading, now }: { base: string; items: readonly ActivityItem[]; loading: boolean; now: Date }) {
  if (items.length === 0 && loading) {
    return <div className="space-y-2.5">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-9 w-full" />)}</div>;
  }
  if (items.length === 0) {
    return <p className="rounded-xl bg-muted/35 px-3 py-3 text-xs text-muted-foreground" data-testid="activity-empty">Nenhuma atividade registrada nos últimos 7 dias.</p>;
  }
  return (
    <ol className="space-y-0.5" data-testid="activity-list">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={`${base}${item.href}`} className={cn("-mx-1.5 flex min-h-[44px] min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted/50", focusRing)}>
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5"><NavIcon id={MODULE_META[item.module].icon} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">{item.title}</span>
              {item.context ? <span className="block truncate text-xs text-muted-foreground">{item.context}</span> : null}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(item.at, now)}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

// ----------------------------------------------------------------------------- Acessos rápidos

export function QuickLinkGrid({ base, links }: { base: string; links: readonly QuickLink[] }) {
  if (links.length === 0) return <p className="text-xs text-muted-foreground">Nenhum atalho disponível para o seu perfil.</p>;
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="quick-links">
      {links.map((link) => (
        <Link key={link.key} href={`${base}${link.href}`} className={cn("flex min-h-[48px] min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-background px-2.5 text-[13px] font-medium text-foreground transition-colors hover:border-solution/45 hover:bg-muted/40", focusRing)}>
          <span aria-hidden="true" className="shrink-0 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4"><NavIcon id={link.icon} /></span>
          <span className="min-w-0 leading-tight">{link.label}</span>
        </Link>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------------- + Criar

export function CreateMenu({ base, options }: { base: string; options: readonly CreateOption[] }) {
  const [open, setOpen] = useState(false);
  if (options.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="home-create" className={cn("inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 dark:bg-primary-glow dark:text-background", focusRing)}>
          <Plus className="h-4 w-4" /> Criar
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(18rem,calc(100vw-1.5rem))] p-1.5" data-testid="home-create-menu">
        <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Criar</p>
        {options.map((option) => (
          <Link key={option.key} href={`${base}${option.href}`} onClick={() => setOpen(false)} data-create={option.key} className={cn("flex min-h-[44px] items-center gap-3 rounded-lg px-2 transition-colors hover:bg-muted", focusRing)}>
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-foreground [&_svg]:h-4 [&_svg]:w-4"><NavIcon id={option.icon} /></span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{option.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{option.description}</span>
            </span>
          </Link>
        ))}
      </PopoverContent>
    </Popover>
  );
}
