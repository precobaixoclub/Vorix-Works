"use client";

import { ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useModalWidth } from '@/hooks/useModalWidth';

export interface DetailModalSection {
  /** Identificador da seção — casa com o `value` controlado. */
  value: string;
  /** Rótulo exibido no item de navegação. */
  label: string;
  /** Ícone opcional (Lucide) exibido à esquerda do rótulo. */
  icon?: LucideIcon;
  /** Contador/indicador exibido à direita do rótulo. */
  badge?: React.ReactNode;
}

/**
 * Bloco de conteúdo dentro de uma seção do modal: micro-título caixa-alta + fio
 * horizontal + conteúdo. Substitui `<Card>` aninhado (caixa dentro de caixa).
 */
export function DetailBlock({
  label,
  action,
  children,
  className,
}: {
  label: string;
  /** Conteúdo à direita do fio (contador, ação da seção). */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-4 flex items-center gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </h3>
        <div className="h-px flex-1 bg-border" />
        {action}
      </div>
      {children}
    </section>
  );
}

interface DetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Título do modal (linha principal do cabeçalho). */
  title: React.ReactNode;
  /**
   * Título acessível em texto puro. Obrigatório quando `title` não é string —
   * o Radix exige um DialogTitle legível por leitores de tela.
   */
  srTitle?: string;
  /** Subtítulo do cabeçalho (também usado como DialogDescription). */
  description?: React.ReactNode;
  /** Descrição acessível em texto puro quando `description` não é string. */
  srDescription?: string;
  /** Etiqueta curta acima do título (categoria do registro). */
  eyebrow?: string;
  /** Placa de identidade à esquerda do título (monograma, avatar, ícone). */
  avatar?: React.ReactNode;
  /** Conteúdo extra do cabeçalho (badges, ações) — à direita no desktop. */
  headerExtra?: React.ReactNode;
  /** Seções de navegação. Sem seções (ou com 1), o índice não é renderizado. */
  sections?: DetailModalSection[];
  /** Value da seção ativa. */
  value?: string;
  /** Chamado ao selecionar outra seção. */
  onValueChange?: (value: string) => void;
  /** Conteúdo da seção ativa. */
  children: React.ReactNode;
  /** Rodapé fixo opcional (ações do modal). */
  footer?: React.ReactNode;
  /** Classes extras do DialogContent (ex.: `max-w-3xl`). */
  className?: string;
  /** Chave de localStorage para lembrar a largura escolhida. Obrigatória p/ persistir. */
  widthStorageKey?: string;
  /** Largura inicial em % da viewport quando não há preferência salva (default 70). */
  defaultWidthPercent?: number;
  /**
   * Fixa a altura do modal no teto (88vh) em vez de deixá-la crescer com o
   * conteúdo. Use quando a seção tem **rolagem interna própria** (listas com
   * `h-full` + `overflow-y-auto`, split com colunas roláveis): sem altura
   * definida no pai, o `h-full` do filho resolve para zero e o conteúdo some.
   * Para formulários comuns, deixe `false` (altura acompanha o conteúdo).
   */
  fullHeight?: boolean;
  /**
   * A seção ativa ocupa a área toda, até as bordas (sem o padding do corpo e
   * sem o scroll do container — o conteúdo gerencia o próprio). Use com
   * layouts em colunas/split que precisam encostar no rodapé do modal.
   * Evita o truque de margem negativa, que deixava sobrar o padding de baixo.
   */
  bleed?: boolean;
}

/**
 * Modal de informações — padrão único deste design system para exibir os detalhes de um
 * registro. Substitui qualquer painel lateral (`Sheet`) de visualização.
 *
 * Estética "dossiê": cabeçalho com placa de identidade, índice de seções
 * recuado à esquerda com trilho de destaque na seção ativa e área de leitura
 * com scroll próprio. Coerente com o design system (tokens de marca e
 * de tema claro/escuro).
 */
export function DetailModal({
  open,
  onOpenChange,
  title,
  srTitle,
  description,
  srDescription,
  eyebrow,
  avatar,
  headerExtra,
  sections,
  value,
  onValueChange,
  children,
  footer,
  className,
  widthStorageKey,
  defaultWidthPercent,
  fullHeight,
  bleed,
}: DetailModalProps) {
  const hasSections = !!sections && sections.length > 1;
  const isStringTitle = typeof title === 'string';
  const isStringDescription = typeof description === 'string';

  // Zoom de largura persistido por-usuário-por-modal (altura fica automática).
  const { hasZoom, widthStyle, canZoomOut, canZoomIn, zoomOut, zoomIn } = useModalWidth({
    storageKey: widthStorageKey,
    defaultPercent: defaultWidthPercent,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Abertura/fechamento suaves: a primitive (ui/dialog) desliza o modal de
        // 48% do topo + metade da largura e escala em 200ms — o deslize longo é
        // o que dava a sensação de "salto"/zoom brusco. Não podemos editar a
        // primitive, mas as keyframes enter/exit do tailwindcss-animate leem
        // estas custom properties; via style inline (vence a cascata,
        // independente da ordem das classes do Tailwind) zeramos o deslize,
        // deixamos uma escala sutil (0.98) e uma duração maior para um
        // fade + zoom leve e gradual.
        style={
          {
            '--tw-enter-translate-x': '0px',
            '--tw-enter-translate-y': '0px',
            '--tw-exit-translate-x': '0px',
            '--tw-exit-translate-y': '0px',
            '--tw-enter-scale': '0.98',
            '--tw-exit-scale': '0.98',
            animationDuration: '300ms',
            animationTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
            // Largura controlada pelo zoom (% da viewport, passo de 5%).
            ...widthStyle,
          } as React.CSSProperties
        }
        className={cn(
          // Altura AUTOMÁTICA: cresce com o conteúdo até o teto de 88vh, aí o
          // corpo rola (flex-1 overflow-y-auto). Sem `h-` fixo — era o que
          // deixava o modal alto demais para pouco conteúdo. A largura vem do
          // zoom (style inline, % da viewport).
          'flex max-h-[88vh] flex-col gap-0 overflow-hidden rounded-xl p-0 shadow-2xl',
          // Seções com rolagem própria precisam de altura definida no pai —
          // sem isso o `h-full` do filho vira zero e o conteúdo desaparece.
          fullHeight && 'h-[88vh]',
          className,
        )}
      >
        {/* Cabeçalho — placa de identidade + títulos + badges */}
        <div className="relative shrink-0 border-b bg-muted/20 px-6 py-5 pr-14">
          {/* Véu de cor: dá atmosfera sem competir com o conteúdo */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent"
          />

          <div className="relative flex flex-col gap-4 md:flex-row md:items-start">
            {avatar && <div className="shrink-0">{avatar}</div>}

            <div className="min-w-0 flex-1">
              {eyebrow && (
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                  {eyebrow}
                </p>
              )}

              {isStringTitle ? (
                <DialogTitle className="truncate text-[22px] leading-tight tracking-tight">
                  {title}
                </DialogTitle>
              ) : (
                <>
                  <DialogTitle className="sr-only">{srTitle || 'Detalhes'}</DialogTitle>
                  <div className="text-[22px] font-semibold leading-tight tracking-tight">
                    {title}
                  </div>
                </>
              )}

              {isStringDescription ? (
                <DialogDescription className="mt-1.5">{description}</DialogDescription>
              ) : (
                <>
                  <DialogDescription className="sr-only">
                    {srDescription || 'Detalhes do registro.'}
                  </DialogDescription>
                  {description && <div className="mt-1.5">{description}</div>}
                </>
              )}
            </div>

            {(hasZoom || headerExtra) && (
              <div className="flex shrink-0 items-center gap-2 md:pt-0.5">
                {/* Zoom de largura — no fluxo, à esquerda das ações do header
                    (não absoluto), para nunca sobrepor os botões do headerExtra. */}
                {hasZoom && (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Diminuir"
                      aria-label="Diminuir largura"
                      disabled={!canZoomOut}
                      onClick={zoomOut}
                    >
                      <ZoomOut className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Aumentar"
                      aria-label="Aumentar largura"
                      disabled={!canZoomIn}
                      onClick={zoomIn}
                    >
                      <ZoomIn className="w-4 h-4" />
                    </Button>
                  </div>
                )}
                {headerExtra}
              </div>
            )}
          </div>
        </div>

        {/* Corpo: índice de seções + área de leitura */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {hasSections && (
            <nav
              className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b bg-muted/30 p-2 md:w-60 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:border-r md:p-3"
              aria-label="Seções do registro"
            >
              <p className="mb-1 hidden px-3 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70 md:block">
                Seções
              </p>

              {sections!.map((section) => {
                const Icon = section.icon;
                const isActive = section.value === value;
                return (
                  <button
                    key={section.value}
                    type="button"
                    onClick={() => onValueChange?.(section.value)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group relative flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg py-2 pl-3 pr-2.5 text-sm transition-colors duration-150 md:w-full',
                      isActive
                        ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border/60'
                        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                    )}
                  >
                    {/* Trilho de destaque da seção ativa (desktop) */}
                    <span
                      aria-hidden
                      className={cn(
                        'absolute inset-y-1.5 left-0 hidden w-[3px] rounded-full bg-primary transition-opacity duration-150 dark:bg-primary-glow md:block',
                        isActive ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {Icon && (
                      <Icon
                        className={cn(
                          'w-4 h-4 shrink-0 transition-colors',
                          isActive ? 'text-primary dark:text-primary-glow' : 'text-muted-foreground/70',
                        )}
                      />
                    )}
                    <span className="flex-1 text-left">{section.label}</span>
                    {section.badge && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {section.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          )}

          {/* `key` remonta a área a cada troca de seção → transição de entrada */}
          <div
            key={value}
            className={cn(
              'min-w-0 flex-1 duration-200 animate-in fade-in-0 slide-in-from-bottom-1',
              bleed ? 'overflow-hidden' : 'overflow-y-auto p-6 md:p-7',
            )}
          >
            {children}
          </div>
        </div>

        {footer && <div className="shrink-0 border-t bg-muted/20 px-6 py-4">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}
