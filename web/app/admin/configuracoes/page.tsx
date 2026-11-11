"use client";

import { HubPage } from "@/components/HubPage";
import { ADMIN_SETTINGS_ITEMS } from "@/components/admin/admin-navigation";

/** Configurações da plataforma (`/admin/configuracoes`): o que vale para todos os clientes, num só
 * lugar. O plano, os limites e os créditos de UM cliente ficam em Clientes. */
export default function AdminSettingsHubPage() {
  return (
    <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <HubPage title="Configurações da plataforma" description="O que vale para todos os clientes. O plano, os limites e os créditos de cada cliente ficam em Clientes." items={ADMIN_SETTINGS_ITEMS} />
    </div>
  );
}
