"use client";

import { type ReactNode } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useModalWidth } from '@/hooks/useModalWidth';

interface ResizableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** Chave base do localStorage (escopada por usuário). Sem ela, não persiste. */
  widthStorageKey?: string;
  /** Largura inicial em % da viewport quando não há preferência salva. */
  defaultWidthPercent?: number;
  /** Classes extras do DialogContent. */
  className?: string;
}

/**
 * Dialog padrão do design system para modais COM CONTEÚDO que se beneficiam de
 * redimensionamento: botões de zoom de largura (ao lado do X de fechar),
 * preferência salva por-usuário-por-modal, e ALTURA AUTOMÁTICA (o modal cresce
 * com o conteúdo até 88vh, aí o corpo rola). Não use em confirmações/alertas
 * pequenos — para esses, o Dialog/AlertDialog simples basta.
 *
 * O conteúdo (header, corpo, footer) é responsabilidade do consumidor. Para o
 * corpo rolar quando o modal atinge o teto, envolva-o num
 * `<div className="overflow-y-auto">` — o DialogContent já é flex-col.
 */
export function ResizableDialog({
  open,
  onOpenChange,
  children,
  widthStorageKey,
  defaultWidthPercent = 60,
  className,
}: ResizableDialogProps) {
  const { hasZoom, widthStyle, canZoomOut, canZoomIn, zoomOut, zoomIn } = useModalWidth({
    storageKey: widthStorageKey,
    defaultPercent: defaultWidthPercent,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        style={widthStyle}
        className={cn('flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0', className)}
      >
        {/* Botões de zoom à esquerda do X de fechar (que fica em right-4). */}
        {hasZoom && (
          <div className="absolute right-12 top-3.5 z-10 flex items-center gap-1">
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
        {children}
      </DialogContent>
    </Dialog>
  );
}
