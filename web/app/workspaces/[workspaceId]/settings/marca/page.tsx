"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandAndIdentity } from "@/components/brand/BrandAndIdentity";
import { SettingsShell } from "@/components/settings/SettingsShell";

/** Configurações › Marca e identidade (Fase 5) — antes em Marketing › Marca (`/knowledge`). */
export default function BrandSettingsPage() {
  return (
    <SettingsShell active="brand" title="Marca e identidade" description="Empresa, público, logotipo, cores, estilo, materiais e diretrizes que a IA usa para criar com a cara da sua marca.">
      <Suspense fallback={<Skeleton className="h-[420px] w-full rounded-xl" />}>
        <BrandAndIdentity />
      </Suspense>
    </SettingsShell>
  );
}
