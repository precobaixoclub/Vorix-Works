"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { PageSubnav } from "@/components/PageSubnav";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>
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
            <Select value={activeAccountId} onValueChange={setSelectedAccountId}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.providerSubjectId} value={account.providerSubjectId}>{account.displayName ?? account.providerSubjectId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      />

      {activeAccount ? (
        <PageSubnav items={TABS.map((tab) => ({ value: tab.key, label: tab.label }))} value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)}>
          {activeTab === "conversations" ? (
            <ConversationsTab workspaceId={workspace.id} instagramBusinessAccountId={activeAccount.providerSubjectId} />
          ) : (
            <AutomationTab workspaceId={workspace.id} instagramBusinessAccountId={activeAccount.providerSubjectId} />
          )}
        </PageSubnav>
      ) : null}
    </main>
  );
}
