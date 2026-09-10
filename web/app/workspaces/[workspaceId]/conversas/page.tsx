"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PageSubnav } from "@/components/PageSubnav";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { ConnectionsTab } from "./connections-tab";
import { InboxTab } from "./inbox-tab";

const TABS = [
  { key: "inbox", label: "Inbox" },
  { key: "connections", label: "Canais de atendimento" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function ConversasPage() {
  const workspace = useCurrentWorkspace();
  const [activeTab, setActiveTab] = useState<TabKey>("inbox");

  return (
    <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-6 sm:py-6">
      <PageHeader title="Conversas" description="AI Command Center para atendimento humano e WhatsApp, com contexto comercial sob demanda." />

      <PageSubnav items={TABS.map((tab) => ({ value: tab.key, label: tab.label }))} value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)}>
        {activeTab === "inbox" ? <InboxTab workspaceId={workspace.id} /> : <ConnectionsTab workspaceId={workspace.id} />}
      </PageSubnav>
    </main>
  );
}
