import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Textarea as ShadcnTextarea } from "@/components/ui/textarea";
import { maskCurrencyInput } from "@/features/crm/presentation";
import { Label as ShadcnLabel } from "@/components/ui/label";
import {
  Select as ShadcnSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Wrapper fino sobre `components/ui/{input,textarea,label,select}` (design system) — mesma
 * lógica de `Button.tsx`/`Card.tsx`. */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <ShadcnInput ref={ref} {...props} />;
});

/**
 * Campo de dinheiro com máscara (R$ 1.234,56) — mesmo contrato do `Input` (o `value` continua
 * sendo o texto e `onChange` recebe o evento com o texto JÁ mascarado), então quem lê o valor
 * segue usando `centsFromCurrencyInput`. Use em TODO campo de valor monetário.
 */
export const MoneyInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { currencySymbol?: string }>(function MoneyInput(
  { currencySymbol = "R$", className, onChange, ...props },
  ref,
) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{currencySymbol}</span>
      <ShadcnInput
        ref={ref}
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={["pl-10 text-right tabular-nums", className].filter(Boolean).join(" ")}
        onChange={(event) => {
          event.target.value = maskCurrencyInput(event.target.value);
          onChange?.(event);
        }}
      />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(props, ref) {
  return <ShadcnTextarea ref={ref} {...props} />;
});

export function Label({ children, htmlFor }: { children: string; htmlFor?: string }) {
  return (
    <ShadcnLabel htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">
      {children}
    </ShadcnLabel>
  );
}

/** Combo simples (poucas opções fixas) sobre `ui/select.tsx`. Radix não aceita `SelectItem`
 * com `value=""`, então quem tiver uma opção "vazio"/"automático" deve usar um valor-sentinela
 * próprio (ex.: `"none"`) e traduzir pra `""` fora deste componente — não muda o formato dos dados
 * salvos, só a representação na UI. */
export { SelectItem };

export function Select({
  id,
  value,
  onValueChange,
  placeholder,
  className,
  children,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ShadcnSelect value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </ShadcnSelect>
  );
}
