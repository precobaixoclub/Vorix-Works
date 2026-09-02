import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Estados padronizados em toda variante — hover, focus-visible (anel fino do sistema), active
// (levemente mais escuro que hover, dá feedback tátil de "pressionado") e disabled (opacidade +
// sem pointer events). `loading` é tratado à parte pelo componente `Button` abaixo (spinner +
// aria-busy), não por classe CSS.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary/75 rounded-md shadow-none",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80 rounded-md",
        outline: "border border-border bg-transparent text-foreground hover:bg-muted active:bg-muted/70 rounded-md",
        secondary: "bg-muted text-foreground hover:bg-muted/80 active:bg-muted/70 rounded-md",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/70 rounded-md",
        link: "text-primary underline-offset-4 hover:underline",
        hero: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 rounded-md font-medium text-base shadow-none",
        success: "bg-success text-success-foreground hover:bg-success/90 active:bg-success/80 rounded-md",
        warning: "bg-warning text-warning-foreground hover:bg-warning/90 active:bg-warning/80 rounded-md",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6",
        xl: "h-11 px-8 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Estado de carregamento padronizado: substitui o ícone líder por um spinner (herda a cor do
   * texto via `currentColor`, funciona em toda variante), desabilita o botão e marca
   * `aria-busy` — nunca implementar um spinner ad hoc por tela. */
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    if (asChild) {
      return (
        <Slot className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Slot>
      )
    }
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
        ) : null}
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
