import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring/40",
  {
    variants: {
      variant: {
        default:
          "border-primary/25 bg-primary/12 text-primary dark:text-primary",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-destructive/25 bg-destructive/12 text-destructive",
        outline: "border-border text-text-secondary",
        success: "border-success/25 bg-success/12 text-success",
        warning: "border-warning/25 bg-warning/12 text-warning",
        ai: "border-ai/30 bg-ai/12 text-ai",
        recording: "border-destructive/30 bg-destructive/12 text-destructive",
        // Variantes semânticas compartilhadas — pra distinguir dois estados que NÃO são
        // hierarquia (nenhum é "mais importante"), só categorias diferentes (ex.: atendimento
        // humano vs. IA ativa numa conversa). Nunca espalhar `bg-sky-50`/`bg-violet-50` direto
        // numa tela — usar `variant="info"`/`variant="accent"` aqui, um lugar só.
        info: "border-transparent bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300",
        accent: "border-transparent bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
