"use client";

import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, Loader2, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Campos de cadastro editáveis no lugar onde são lidos — o padrão do design system
 * para ficha de registro dentro de um `<DetailModal>`. Não existe "modo
 * leitura" e "modo edição": clicou no valor, editou, saiu do campo, salvou.
 *
 * O `onSave` recebe `null` quando o usuário limpa o campo (o contrato de patch
 * do backend trata `null` como "apagar" e chave ausente como "não mexer").
 */

const SAVED_FEEDBACK_MS = 1600;

interface FieldShellProps {
  label: string;
  icon?: LucideIcon;
  /** Indicador de estado à direita do rótulo. */
  status?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Moldura comum: rótulo micro-caixa-alta + controle. */
export function FieldShell({ label, icon: Icon, status, children, className }: FieldShellProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/80">
        {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate">{label}</span>
        {status}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Selo de "salvando…" / "salvo" exibido junto ao rótulo. */
function SaveStatus({ saving, saved }: { saving: boolean; saved: boolean }) {
  if (saving) return <Loader2 className="w-3 h-3 shrink-0 animate-spin text-muted-foreground" />;
  if (saved)
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-primary dark:text-primary-glow">
        <Check className="w-3 h-3" />
        salvo
      </span>
    );
  return null;
}

interface InlineFieldProps {
  label: string;
  /** Valor cru persistido (o que vai para o `onSave`). */
  value: string | null | undefined;
  onSave: (value: string | null) => Promise<unknown>;
  type?: 'text' | 'textarea' | 'select' | 'url';
  /** Opções do `type="select"`. */
  options?: { key: string; label: string }[];
  icon?: LucideIcon;
  placeholder?: string;
  /** Exibição do valor quando difere do valor cru (rótulo de catálogo, link). */
  display?: React.ReactNode;
  /** Texto quando vazio. */
  emptyText?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
}

export function InlineField({
  label,
  value,
  onSave,
  type = 'text',
  options,
  icon,
  placeholder,
  display,
  emptyText = 'Adicionar',
  rows = 3,
  disabled,
  className,
}: InlineFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Valor de fora muda (outro lead, refetch) → o rascunho acompanha.
  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const commit = async (next: string) => {
    const normalized = next.trim();
    const current = value ?? '';
    setEditing(false);
    if (normalized === current) return;

    setSaving(true);
    try {
      // String vazia limpa o campo — o backend trata `null` como "apagar".
      await onSave(normalized === '' ? null : normalized);
      setSaved(true);
    } catch {
      // O toast de erro vem do hook; o campo volta ao valor persistido.
      setDraft(current);
    } finally {
      setSaving(false);
    }
  };

  const status = <SaveStatus saving={saving} saved={saved} />;

  // Select salva na escolha — não tem "sair do campo".
  if (type === 'select') {
    return (
      <FieldShell label={label} icon={icon} status={status} className={className}>
        <Select
          value={value ?? ''}
          onValueChange={(next) => commit(next)}
          disabled={disabled || saving}
        >
          <SelectTrigger className="h-9 border-transparent bg-transparent px-2 hover:border-input hover:bg-background focus:border-input">
            <SelectValue placeholder={emptyText} />
          </SelectTrigger>
          <SelectContent>
            {options?.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldShell>
    );
  }

  if (editing) {
    return (
      <FieldShell label={label} icon={icon} status={status} className={className}>
        {type === 'textarea' ? (
          <Textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            rows={rows}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              // Enter quebra linha; Cmd/Ctrl+Enter salva; Esc descarta.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(draft);
              if (e.key === 'Escape') {
                setDraft(value ?? '');
                setEditing(false);
              }
            }}
          />
        ) : (
          <Input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            value={draft}
            placeholder={placeholder}
            inputMode={type === 'url' ? 'url' : undefined}
            className="h-9"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(draft);
              if (e.key === 'Escape') {
                setDraft(value ?? '');
                setEditing(false);
              }
            }}
          />
        )}
      </FieldShell>
    );
  }

  const isEmpty = !value;

  return (
    <FieldShell label={label} icon={icon} status={status} className={className}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        aria-label={`Editar ${label}`}
        className={cn(
          'group flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm transition-colors',
          'hover:border-input hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          disabled && 'pointer-events-none opacity-60',
          type === 'textarea' ? 'min-h-[2.25rem]' : 'items-center',
        )}
      >
        <span
          className={cn(
            'min-w-0 flex-1',
            type === 'textarea' ? 'whitespace-pre-wrap break-words' : 'truncate',
            isEmpty ? 'text-muted-foreground/60' : 'font-medium text-foreground',
          )}
        >
          {isEmpty ? emptyText : display || value}
        </span>
        <Pencil className="w-3.5 h-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
      </button>
    </FieldShell>
  );
}

interface ToggleFieldProps {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => Promise<unknown>;
  disabled?: boolean;
}

/** Booleano de cadastro — salva no clique, sem modo de edição. */
export function ToggleField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: ToggleFieldProps) {
  const [saving, setSaving] = useState(false);

  const handleChange = async (next: boolean) => {
    setSaving(true);
    try {
      await onCheckedChange(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description && (
          <span className="block text-xs text-muted-foreground">{description}</span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
        <Switch checked={checked} onCheckedChange={handleChange} disabled={disabled || saving} />
      </span>
    </label>
  );
}
