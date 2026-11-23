"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketingCalendar } from "@/components/marketing/MarketingCalendar";

/** Calendário único do Marketing (Fase 5): planejamento editorial + publicações reais. */
export default function CalendarPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[520px] w-full rounded-xl" />}>
      <MarketingCalendar />
    </Suspense>
  );
}
