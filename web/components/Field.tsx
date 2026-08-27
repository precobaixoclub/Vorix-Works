import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Textarea as ShadcnTextarea } from "@/components/ui/textarea";
import { Label as ShadcnLabel } from "@/components/ui/label";

/** Wrapper fino sobre `components/ui/{input,textarea,label}` (design system) — mesma lógica de
 * `Button.tsx`/`Card.tsx`. */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <ShadcnInput ref={ref} {...props} />;
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
