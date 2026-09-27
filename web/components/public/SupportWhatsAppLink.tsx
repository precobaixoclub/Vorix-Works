"use client";

import type { ReactNode } from "react";
import { trackProductEvent } from "@/lib/product-events";
import { getSupportWhatsAppUrl } from "@/lib/support";

/**
 * Link oficial de SUPORTE (WhatsApp) do site público — mesmo padrão de `PlanSelectLink`
 * (componente cliente fino, só pra poder disparar `trackProductEvent` no clique). Sempre abre em
 * nova aba (`target="_blank"`) — nunca navega o visitante pra fora do site sem ele perceber.
 */
export function SupportWhatsAppLink({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <a
      href={getSupportWhatsAppUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={() => trackProductEvent("support_whatsapp_clicked")}
    >
      {children}
    </a>
  );
}
