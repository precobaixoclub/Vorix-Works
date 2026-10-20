"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type SearchableComboItem = { id: string; label: string };

type SearchableComboExtraOption = {
  /** Valor especial fora da lista (ex.: "all", "none", ""). */
  value: string;
  label: string;
};

/**
 * Combo de seleção buscável — modelo de referência do design system pra "selecionar de uma lista
 * que pode crescer" (nunca um `<Select>` nativo com dezenas de itens). Genérico por design:
 * template original do pacote (`ProjectSelect`) chamava um hook `useProjects()` fixo; aqui recebe
 * `items` como prop, pra servir qualquer lista do Vorix (workspaces, contas de anúncio, pixels...).
 */
export function SearchableCombo({
  items,
  loading,
  value,
  onValueChange,
  placeholder = "Selecione",
  loadingLabel = "Carregando...",
  searchPlaceholder = "Buscar...",
  emptyText = "Nenhum item encontrado.",
  extraOption,
  disabled,
  className,
  contentClassName,
  id,
  leadingIcon,
  renderItem,
}: {
  items: readonly SearchableComboItem[];
  loading?: boolean;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  loadingLabel?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Opção fixa no topo (ex.: "Todos" / "Nenhum"), sempre visível, nunca filtrada pela busca. */
  extraOption?: SearchableComboExtraOption;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  id?: string;
  leadingIcon?: ReactNode;
  renderItem?: (item: SearchableComboItem) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const sortedItems = useMemo(() => [...items].sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" })), [items]);

  const selectedLabel = useMemo(() => {
    if (extraOption && value === extraOption.value) return extraOption.label;
    return sortedItems.find((item) => item.id === value)?.label;
  }, [extraOption, sortedItems, value]);
  const selectedItem = sortedItems.find((item) => item.id === value);

  function handleSelect(nextValue: string) {
    onValueChange(nextValue);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled || loading} className={cn("w-full min-w-0 justify-between font-normal", className)}>
          <span className={cn("flex min-w-0 flex-1 items-center gap-2 text-left", !selectedLabel && "text-muted-foreground")}>
            {selectedItem && renderItem && !loading ? renderItem(selectedItem) : <>{leadingIcon}<span className="truncate">{loading ? loadingLabel : selectedLabel || placeholder}</span></>}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-[var(--radix-popover-trigger-width)] p-0", contentClassName)} align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {extraOption ? (
                <CommandItem value={extraOption.label} onSelect={() => handleSelect(extraOption.value)}>
                  <Check className={cn("mr-2 h-4 w-4", value === extraOption.value ? "opacity-100" : "opacity-0")} />
                  {extraOption.label}
                </CommandItem>
              ) : null}
              {sortedItems.map((item) => (
                <CommandItem key={item.id} value={item.label} onSelect={() => handleSelect(item.id)}>
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === item.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex min-w-0 flex-1 items-center gap-2">{renderItem ? renderItem(item) : item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
