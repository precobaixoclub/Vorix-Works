import { forwardRef } from "react";
import { Button as ShadcnButton, type ButtonProps as ShadcnButtonProps } from "@/components/ui/button";

/**
 * Wrapper fino sobre `components/ui/button` (design system) — nunca editar `components/ui/**`
 * diretamente (perde no próximo `shadcn add`), e nunca reescrever cada uma das telas que já usam
 * `<Button variant="primary|secondary|ghost|danger">` só pra trocar de biblioteca. Mapeia o
 * vocabulário antigo pro novo; toda tela existente herda o visual do design system sem mudar
 * uma linha própria.
 */
type LegacyVariant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_MAP: Record<LegacyVariant, ShadcnButtonProps["variant"]> = {
  primary: "default",
  secondary: "outline",
  ghost: "ghost",
  danger: "destructive",
};

export type ButtonProps = Omit<ShadcnButtonProps, "variant"> & {
  variant?: LegacyVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "primary", ...props }, ref) {
  return <ShadcnButton ref={ref} variant={VARIANT_MAP[variant]} {...props} />;
});
