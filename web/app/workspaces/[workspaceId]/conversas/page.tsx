"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PageSubnav } from "@/components/PageSubnav";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { ConnectionsTab } from "./connections-tab";
import { InboxTab } from "./inbox-tab";

const TABS = [
  { key: "inbox", label: "Conversas" },
  { key: "connections", label: "Conexões" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * Módulo Conversas — inbox de WhatsApp via WuzAPI. Fase 1 entregou gestão de conexão; Fase 3
 * entrega a Inbox de verdade (`inbox-tab.tsx`, 3 colunas no desktop / uma por vez no mobile,
 * atualização em tempo real via SSE). Mesmo padrão de abas de `instagram-dm/page.tsx`.
 */
export default function ConversasPage() {
  const workspace = useCurrentWorkspace();
  const [activeTab, setActiveTab] = useState<TabKey>("inbox");

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Conversas" description="Central de atendimento via WhatsApp." />

      <PageSubnav items={TABS.map((tab) => ({ value: tab.key, label: tab.label }))} value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)}>
        {activeTab === "inbox" ? <InboxTab workspaceId={workspace.id} /> : <ConnectionsTab workspaceId={workspace.id} />}
      </PageSubnav>
    </main>
  );
}
