import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Card as ShadcnCard, CardHeader as ShadcnCardHeader } from "@/components/ui/card";

/** Wrapper fino sobre `components/ui/card` (design system) — mesma lógica de `Button.tsx`: toda
 * tela que já usa `<Card>`/`<CardHeader>`/`<CardBody>` herda o visual novo sem mudar nada. */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <ShadcnCard className={cn("min-w-0", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <ShadcnCardHeader className={cn("flex-row flex-wrap items-center justify-between gap-3 space-y-0 border-b border-border/60 px-5 py-4", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}
