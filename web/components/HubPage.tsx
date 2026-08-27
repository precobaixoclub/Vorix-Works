"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';

/**
 * Padrão visual "página de hub" do design system — menu/portal de navegação por cards.
 * Estética editorial refinada, coerente com o design system (verde da
 * marca, Inter, tokens de tema claro/escuro).
 *
 * Uso:
 *   <HubPage
 *     eyebrow="Ferramentas de captura"
 *     eyebrowIcon={Sparkles}
 *     title="Iscas Digitais"
 *     description="..."
 *     items={[{ id, title, tagline, description, icon, route, accent }, ...]}
 *   />
 */

export type HubAccent = 'emerald' | 'amber' | 'violet' | 'sky' | 'rose' | 'primary';

export interface HubItem {
  id: string;
  title: string;
  /** Categoria curta exibida no chip acima do título (ex.: "Avaliação interativa"). */
  tagline: string;
  description: string;
  icon: LucideIcon;
  route: string;
  accent: HubAccent;
}

interface HubPageProps {
  /** Texto do chip no topo do header (ex.: "Ferramentas de captura"). */
  eyebrow?: string;
  eyebrowIcon?: LucideIcon;
  title: string;
  description?: string;
  items: HubItem[];
  /** Colunas máximas do grid. Default 3. */
  columns?: 2 | 3 | 4;
}

const accentStyles: Record<
  HubAccent,
  {
    text: string;
    arrow: string;
    ring: string;
    glow: string;
    chip: string;
    iconWrap: string;
    number: string;
  }
> = {
  emerald: {
    text: 'text-emerald-600 dark:text-emerald-400',
    arrow: 'text-muted-foreground/40 group-hover:text-emerald-600 dark:group-hover:text-emerald-400',
    ring: 'hover:border-emerald-300 dark:hover:border-emerald-500/50',
    glow: 'from-emerald-500/10',
    chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    iconWrap:
      'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
    number: 'text-emerald-100 dark:text-emerald-500/10',
  },
  amber: {
    text: 'text-amber-600 dark:text-amber-400',
    arrow: 'text-muted-foreground/40 group-hover:text-amber-600 dark:group-hover:text-amber-400',
    ring: 'hover:border-amber-300 dark:hover:border-amber-500/50',
    glow: 'from-amber-500/10',
    chip: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    iconWrap:
      'bg-amber-50 text-amber-600 group-hover:bg-amber-500 dark:bg-amber-500/10 dark:text-amber-400',
    number: 'text-amber-100 dark:text-amber-500/10',
  },
  violet: {
    text: 'text-violet-600 dark:text-violet-400',
    arrow: 'text-muted-foreground/40 group-hover:text-violet-600 dark:group-hover:text-violet-400',
    ring: 'hover:border-violet-300 dark:hover:border-violet-500/50',
    glow: 'from-violet-500/10',
    chip: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300',
    iconWrap:
      'bg-violet-50 text-violet-600 group-hover:bg-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
    number: 'text-violet-100 dark:text-violet-500/10',
  },
  sky: {
    text: 'text-sky-600 dark:text-sky-400',
    arrow: 'text-muted-foreground/40 group-hover:text-sky-600 dark:group-hover:text-sky-400',
    ring: 'hover:border-sky-300 dark:hover:border-sky-500/50',
    glow: 'from-sky-500/10',
    chip: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
    iconWrap:
      'bg-sky-50 text-sky-600 group-hover:bg-sky-600 dark:bg-sky-500/10 dark:text-sky-400',
    number: 'text-sky-100 dark:text-sky-500/10',
  },
  rose: {
    text: 'text-rose-600 dark:text-rose-400',
    arrow: 'text-muted-foreground/40 group-hover:text-rose-600 dark:group-hover:text-rose-400',
    ring: 'hover:border-rose-300 dark:hover:border-rose-500/50',
    glow: 'from-rose-500/10',
    chip: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
    iconWrap:
      'bg-rose-50 text-rose-600 group-hover:bg-rose-600 dark:bg-rose-500/10 dark:text-rose-400',
    number: 'text-rose-100 dark:text-rose-500/10',
  },
  primary: {
    text: 'text-primary',
    arrow: 'text-muted-foreground/40 group-hover:text-primary',
    ring: 'hover:border-primary/40',
    glow: 'from-primary/10',
    chip: 'bg-primary/5 text-primary dark:bg-primary/10',
    iconWrap: 'bg-primary/5 text-primary group-hover:bg-primary dark:bg-primary/10',
    number: 'text-primary/10 dark:text-primary/[0.07]',
  },
};

const columnClass: Record<NonNullable<HubPageProps['columns']>, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 xl:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
};

interface HubCardProps {
  item: HubItem;
  /** Número de ordem (1-based) para o algarismo decorativo. */
  order: number;
  onClick: () => void;
  /** CTA do rodapé. Default "Acessar". */
  ctaLabel?: string;
}

/**
 * Card individual do hub. Exportado para hubs "híbridos" (ex.:
 * EmailMarketingHub) que montam o grid próprio ao lado de métricas/listas.
 * Hubs puros devem usar <HubPage>, não este card diretamente.
 */
export function HubCard({ item, order, onClick, ctaLabel = 'Acessar' }: HubCardProps) {
  const Icon = item.icon;
  const a = accentStyles[item.accent];
  const index = String(order).padStart(2, '0');
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-6 text-left',
        'transition-all duration-300 ease-out',
        'hover:-translate-y-1 hover:shadow-[0_12px_32px_-12px_rgba(60,64,67,0.25)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        a.ring
      )}
    >
      {/* Número gigante decorativo */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute -right-2 -top-4 select-none font-semibold leading-none tracking-tighter',
          'text-[5.5rem] transition-transform duration-500 group-hover:-translate-y-1',
          a.number
        )}
      >
        {index}
      </span>

      {/* Glow no hover */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100',
          a.glow
        )}
      />

      <div className="relative flex items-start justify-between">
        <div
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-xl transition-colors duration-300 group-hover:text-white',
            a.iconWrap
          )}
        >
          <Icon className="h-6 w-6" />
        </div>
        <ArrowUpRight
          className={cn(
            'h-5 w-5 shrink-0 transition-all duration-300',
            'group-hover:-translate-y-0.5 group-hover:translate-x-0.5',
            a.arrow
          )}
        />
      </div>

      <div className="relative mt-5 flex-1">
        <span
          className={cn(
            'inline-block rounded-md px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
            a.chip
          )}
        >
          {item.tagline}
        </span>
        <h2 className="mt-3 text-lg font-semibold text-foreground">{item.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {item.description}
        </p>
      </div>

      <div className={cn('relative mt-6 flex items-center gap-1.5 text-sm font-medium', a.text)}>
        {ctaLabel}
        <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
    </button>
  );
}

export function HubPage({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  description,
  items,
  columns = 3,
}: HubPageProps) {
  const router = useRouter();

  return (
    <div className="space-y-8">
      {/* Header editorial */}
      <header className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/[0.07] via-background to-background p-8 md:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative max-w-2xl">
          {eyebrow && (
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              {EyebrowIcon && <EyebrowIcon className="h-3.5 w-3.5" />}
              {eyebrow}
            </div>
          )}
          <h1
            className={cn(
              'text-3xl font-semibold tracking-tight text-foreground md:text-4xl',
              eyebrow && 'mt-4'
            )}
          >
            {title}
          </h1>
          {description && (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">
              {description}
            </p>
          )}
        </div>
      </header>

      {/* Grid de cards */}
      <div className={cn('grid grid-cols-1 gap-5', columnClass[columns])}>
        {items.map((item, i) => (
          <HubCard
            key={item.id}
            item={item}
            order={i + 1}
            onClick={() => router.push(item.route)}
          />
        ))}
      </div>
    </div>
  );
}
