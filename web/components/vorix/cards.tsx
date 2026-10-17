"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cards do Vorix Design System 2.0 — um padrão por função (nunca um card próprio por tela):
 * MetricCard (número forte + label + contexto + comparação/mini-tendência), ActionCard (atalho com
 * CTA), StatusChip (estado com tom fechado) e EntityCard (registro resumido).
 */

export type MetricAccent = "neutral" | "solution" | "ai" | "positive" | "negative";

function Sparkline({ values }: { values: readonly number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${28 - ((value - min) / span) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-7 w-20" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  delta,
  trend,
  icon,
  accent = "neutral",
  className,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  /** Comparação opcional (ex.: "+12% vs mês anterior"). `positive` decide a cor. */
  delta?: { label: string; positive: boolean };
  trend?: readonly number[];
  icon?: ReactNode;
  accent?: MetricAccent;
  className?: string;
}) {
  const accentText = { neutral: "text-foreground", solution: "text-solution", ai: "vorix-ai-text", positive: "text-success", negative: "text-destructive" }[accent];
  return (
    <div className={cn("relative min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card px-4 py-3.5 shadow-[var(--shadow-xs)]", className)}>
      {accent === "solution" || accent === "ai" ? (
        <div aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0 top-0 h-px", accent === "ai" ? "bg-gradient-to-r from-transparent via-ai/70 to-transparent" : "bg-gradient-to-r from-transparent via-solution/70 to-transparent")} />
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        {icon ? <span className="shrink-0 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</span> : null}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <p className={cn("vorix-display truncate text-2xl font-semibold tabular-nums", accentText)}>{value}</p>
        {trend ? <span className={accent === "ai" ? "text-ai" : "text-solution"}><Sparkline values={trend} /></span> : null}
      </div>
      {delta || hint ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {delta ? (
            <span className={cn("inline-flex items-center gap-0.5 font-medium", delta.positive ? "text-success" : "text-destructive")}>
              {delta.positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {delta.label}
            </span>
          ) : null}
          {hint ? <span className="min-w-0 truncate">{hint}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

export function MetricGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>;
}

export function ActionCard({ icon, title, description, href, onClick, cta = "Abrir", tone = "solution" }: { icon: ReactNode; title: string; description?: string; href?: string; onClick?: () => void; cta?: string; tone?: "solution" | "ai" }) {
  const body = (
    <>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border [&_svg]:h-5 [&_svg]:w-5", tone === "ai" ? "border-ai/30 bg-ai/10 text-ai" : "border-solution/25 bg-solution/10 text-solution")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        {description ? <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span> : null}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-solution opacity-80 transition-opacity group-hover:opacity-100">{cta}<ArrowRight className="h-3.5 w-3.5" /></span>
    </>
  );
  const className = "group flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-left shadow-[var(--shadow-xs)] transition-[border-color,background-color] duration-150 hover:border-solution/40 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45";
  if (href) return <Link href={href} className={className}>{body}</Link>;
  return <button type="button" onClick={onClick} className={className}>{body}</button>;
}

export type StatusTone = "active" | "pending" | "success" | "warning" | "error" | "neutral" | "ai" | "recording" | "info";

const STATUS_TONE: Record<StatusTone, string> = {
  active: "border-solution/30 bg-solution/12 text-solution",
  pending: "border-warning/30 bg-warning/10 text-warning",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-surface-2 text-text-secondary",
  ai: "border-ai/30 bg-ai/10 text-ai",
  recording: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-info/30 bg-info/10 text-info",
};

/** Chip de status com tom de vocabulário fechado. `live` = ponto pulsando suave (gravação ao vivo). */
export function StatusChip({ tone, children, live, className }: { tone: StatusTone; children: ReactNode; live?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[tone], className)}>
      {live || tone === "recording" ? <span aria-hidden="true" className="vorix-live-dot h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export function EntityCard({ title, subtitle, meta, status, onClick, className }: { title: string; subtitle?: ReactNode; meta?: ReactNode; status?: ReactNode; onClick?: () => void; className?: string }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={cn("block w-full rounded-xl border border-border/70 bg-card px-4 py-3 text-left transition-colors hover:border-border hover:bg-surface-2", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">{title}</p>
        {status}
      </div>
      {subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      {meta ? <div className="mt-2 text-xs text-text-secondary">{meta}</div> : null}
    </Tag>
  );
}
