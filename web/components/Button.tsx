import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover disabled:opacity-50",
  secondary: "bg-surface-raised text-ink border border-border hover:bg-surface-sunken disabled:opacity-50",
  ghost: "text-ink-muted hover:text-ink hover:bg-surface-sunken disabled:opacity-50",
  danger: "bg-surface-raised text-red-600 border border-border hover:bg-red-50 disabled:opacity-50",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", className = "", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex min-h-10 max-w-full items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-center text-sm font-medium leading-snug transition-colors cursor-pointer disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
});
