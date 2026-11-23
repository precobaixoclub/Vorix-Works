"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { SWRConfig } from "swr";
import { APP_SWR_RETRY } from "@/lib/swr-retry";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

/** Providers globais do design system — tema (`.dark` na <html>, `next-themes`, padrão "system"
 * pra preservar o comportamento anterior de seguir a preferência do SO), tooltips (Radix exige um
 * `TooltipProvider` ancestral) e toasts (`sonner`, usado por `ReportTable`/telas novas). */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      {/* Fase 14: sem repetir 403/404 para sempre; rede/servidor/429 no máximo 3 vezes. */}
      <SWRConfig value={APP_SWR_RETRY}>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster position="top-right" />
        </TooltipProvider>
      </SWRConfig>
    </ThemeProvider>
  );
}
