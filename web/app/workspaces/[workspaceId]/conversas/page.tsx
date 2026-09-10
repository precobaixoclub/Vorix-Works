"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PageSubnav } from "@/components/PageSubnav";
import { Spinner } from "@/components/Spinner";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useInboxModuleStatus } from "@/features/inbox/hooks";
import { ConnectionsTab } from "./connections-tab";
import { InboxTab } from "./inbox-tab";

const TABS = [
  { key: "inbox", label: "Inbox" },
  { key: "connections", label: "Canais de atendimento" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function ConversasPage() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("inbox");
  const { data: status, isLoading: statusLoading } = useInboxModuleStatus();

  return (
    <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-6 sm:py-6">
      <PageHeader title="Conversas" description="AI Command Center para atendimento humano e WhatsApp, com contexto comercial sob demanda." />

      {statusLoading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : status && !status.enabled ? (
        // Fase 10 (Pre-Pilot Hardening) — módulo desligado nunca é tratado como erro: nem chama
        // `/v1/inbox/conversations` (que 404-aria), nem mostra `ErrorState`/payload técnico. Só uma
        // mensagem neutra, sem prometer prazo, com um jeito claro de sair da tela.
        <EmptyState
          icon={<span aria-hidden="true">💬</span>}
          title="Atendimento por canais indisponível"
          description="O atendimento por canais está temporariamente indisponível neste ambiente."
          action={<Button variant="secondary" onClick={() => router.push(`/workspaces/${workspace.id}`)}>Voltar para Início</Button>}
        />
      ) : (
        <PageSubnav items={TABS.map((tab) => ({ value: tab.key, label: tab.label }))} value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)}>
          {activeTab === "inbox" ? <InboxTab workspaceId={workspace.id} /> : <ConnectionsTab workspaceId={workspace.id} />}
        </PageSubnav>
      )}
    </main>
  );
}
