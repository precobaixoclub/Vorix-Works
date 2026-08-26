"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useMetaOAuthStatus } from "@/features/meta/hooks";
import { AutomationTab } from "./automation-tab";
import { ConversationsTab } from "./conversations-tab";

const TABS = [
  { key: "conversations", label: "Conversas" },
  { key: "automation", label: "Automação" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function InstagramDmPage() {
  const workspace = useCurrentWorkspace();
  const { data: oauth, isLoading, error } = useMetaOAuthStatus(workspace.id);
  const accounts = useMemo(() => (oauth?.accounts ?? []).filter((account) => account.providerId === "instagram" && account.status === "active"), [oauth]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>();
  const activeAccountId = selectedAccountId ?? accounts[0]?.providerSubjectId;
  const activeAccount = accounts.find((account) => account.providerSubjectId === activeAccountId);
  const [activeTab, setActiveTab] = useState<TabKey>("conversations");

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-accent" /></div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
        <ErrorState error={error} />
      </main>
    );
  }

  if (accounts.length === 0) {
    return (
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
        <PageHeader title="Mensagens do Instagram" description="Inbox de DM e respostas automáticas por palavra-chave." />
        <EmptyState
          title="Nenhuma conta do Instagram conectada"
          description="Conecte uma conta do Instagram em Conexões — a mesma conexão usada pra publicar posts também é usada aqui, só que com a permissão de mensagens ativada."
          action={<Link href={`/workspaces/${workspace.id}/connections`}><Button>Ir para Conexões</Button></Link>}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Mensagens do Instagram"
        description="Inbox de DM e respostas automáticas por palavra-chave."
        actions={
          accounts.length > 1 ? (
            <select
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              value={activeAccountId}
              onChange={(event) => setSelectedAccountId(event.target.value)}
            >
              {accounts.map((account) => (
                <option key={account.providerSubjectId} value={account.providerSubjectId}>{account.displayName ?? account.providerSubjectId}</option>
              ))}
            </select>
          ) : undefined
        }
      />

      <div className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeAccount ? (
        activeTab === "conversations" ? (
          <ConversationsTab workspaceId={workspace.id} instagramBusinessAccountId={activeAccount.providerSubjectId} />
        ) : (
          <AutomationTab workspaceId={workspace.id} instagramBusinessAccountId={activeAccount.providerSubjectId} />
        )
      ) : null}
    </main>
  );
}
