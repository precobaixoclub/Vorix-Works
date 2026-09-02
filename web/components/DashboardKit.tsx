import { type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * Peças compartilhadas pelos 4 dashboards de Negociações. Padroniza KPI,
 * moldura de gráfico, estados (loading/erro/vazio) e formatação — para que as
 * telas fiquem só com a composição, sem repetir casca.
 */

// --- Formatação --------------------------------------------------------------

export const brl = (v: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v ?? 0));

/** Moeda compacta para eixo de gráfico (R$ 12,5 mil) — evita rótulo gigante. */
export const brlCompact = (v: number | null | undefined) => {
  const n = Number(v ?? 0);
  if (Math.abs(n) >= 1000) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1,
    }).format(n);
  }
  return brl(n);
};

export const num = (v: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR').format(Number(v ?? 0));

export const pct = (v: number | null | undefined) =>
  v == null ? '—' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%`;

/** Horas → "3d 4h" / "5h 20min" — número cru em horas é ilegível. */
export const horas = (h: number | null | undefined) => {
  if (h == null) return '—';
  const total = Math.max(0, Number(h));
  if (total < 1) return `${Math.round(total * 60)}min`;
  if (total < 24) {
    const inteiras = Math.floor(total);
    const min = Math.round((total - inteiras) * 60);
    return min ? `${inteiras}h ${min}min` : `${inteiras}h`;
  }
  const dias = Math.floor(total / 24);
  const resto = Math.round(total % 24);
  return resto ? `${dias}d ${resto}h` : `${dias}d`;
};

const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/** 'YYYY-MM' → 'Ago'; 'YYYY-MM-DD' → '18/08'. */
export const bucketLabel = (bucket: string) => {
  const partes = bucket.split('-');
  if (partes.length === 2) return MESES_CURTOS[Number(partes[1]) - 1] ?? bucket;
  if (partes.length === 3) return `${partes[2]}/${partes[1]}`;
  return bucket;
};

/** Paleta dos gráficos — tokens globais `--chart-1`..`--chart-6` (`app/globals.css`), vocabulário
 * fechado `primary → emerald → sky → violet → amber → rose` (mesmo de `HubAccent`). Nunca uma cor
 * solta por gráfico — `hsl(var(--chart-N))` já resolve sozinho pra light/dark. */
export const CHART_COLORS = [
  'hsl(var(--chart-1))', // primary (marca)
  'hsl(var(--chart-2))', // emerald
  'hsl(var(--chart-3))', // sky
  'hsl(var(--chart-4))', // violet
  'hsl(var(--chart-5))', // amber
  'hsl(var(--chart-6))', // rose
];

// --- Blocos ------------------------------------------------------------------

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  /** Realce sutil para o KPI mais importante da linha. */
  accent?: 'default' | 'positive' | 'negative';
  icon?: ReactNode;
}

export function KpiCard({ label, value, hint, accent = 'default', icon }: KpiCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {icon && <span className="text-muted-foreground">{icon}</span>}
        </div>
        <p
          className={cn(
            'mt-2 text-2xl font-bold tabular-nums tracking-tight',
            accent === 'positive' && 'text-emerald-600 dark:text-primary-glow',
            accent === 'negative' && 'text-destructive',
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

interface ChartCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** Ação no canto (filtro, seletor). */
  action?: ReactNode;
  className?: string;
  /** Altura da área do gráfico. Default 280px. */
  height?: number;
  /** Quando vazio, mostra a mensagem em vez do gráfico. */
  empty?: boolean;
  emptyText?: string;
}

export function ChartCard({
  title, description, children, action, className, height = 280, empty, emptyText,
}: ChartCardProps) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </CardHeader>
      <CardContent className="flex-1 pt-2">
        {empty ? (
          <div
            className="flex items-center justify-center text-sm text-muted-foreground"
            style={{ height }}
          >
            {emptyText ?? 'Sem dados no período'}
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

/** Loading padrão do projeto (spinner), na altura do bloco. */
export function DashboardLoading({ height = 280 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center" style={{ height }}>
      <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

export function DashboardError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="border-destructive">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm text-destructive">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-sm font-medium text-primary hover:underline"
          >
            Tentar novamente
          </button>
        )}
      </CardContent>
    </Card>
  );
}

/** Iniciais para o avatar quando o colaborador não tem foto. */
export function initials(nome: string) {
  return nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function PersonAvatar({
  nome, avatarUrl, className,
}: { nome: string; avatarUrl?: string | null; className?: string }) {
  return (
    <Avatar className={className}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={nome} />}
      <AvatarFallback className="text-xs">{initials(nome)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Barra proporcional para tabelas de ranking — o número sozinho não deixa
 * comparar; a barra dá a leitura relativa de relance.
 */
export function ProportionBar({
  value, max, className,
}: { value: number; max: number; className?: string }) {
  const pctWidth = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${pctWidth}%` }} />
    </div>
  );
}

/** Tooltip do Recharts com a cara do tema (o default é branco/estranho no dark). */
export const tooltipStyle = {
  contentStyle: {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '0.5rem',
    fontSize: '12px',
    color: 'hsl(var(--popover-foreground))',
  },
  labelStyle: { color: 'hsl(var(--popover-foreground))', fontWeight: 600 },
  itemStyle: { color: 'hsl(var(--popover-foreground))' },
} as const;

/** Eixos com a tipografia menor usada nos dashboards. */
export const axisProps = {
  tick: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' },
  stroke: 'hsl(var(--border))',
} as const;
