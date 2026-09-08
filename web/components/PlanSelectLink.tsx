"use client";

import Link from "next/link";
import { Button, type ButtonProps } from "@/components/Button";
import { trackProductEvent } from "@/lib/product-events";

/**
 * CTA "Começar com [Plano]" da página pública de pricing — registra `plan_selected` (evento
 * comportamental, seção 9) antes de navegar pro `/signup`. Extraído como Client Component próprio
 * porque `pricing/page.tsx` é Server Component (busca o catálogo via SSR) e não pode passar um
 * `onClick` direto pra um componente cliente.
 */
export function PlanSelectLink({ planCode, className, variant, children }: { planCode: string; className?: string; variant?: ButtonProps["variant"]; children: React.ReactNode }) {
  return (
    <Link href="/signup" className={className} onClick={() => trackProductEvent("plan_selected", { planKey: planCode })}>
      <Button className="w-full" variant={variant}>
        {children}
      </Button>
    </Link>
  );
}
