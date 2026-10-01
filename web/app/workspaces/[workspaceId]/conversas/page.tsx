"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Spinner } from "@/components/Spinner";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useInboxConnections, useInboxModuleStatus } from "@/features/inbox/hooks";
import { ConnectionsTab } from "./connections-tab";
import { ConversasHeader } from "./conversas-header";
import { InboxTab } from "./inbox-tab";

const TABS = [
  { key: "inbox", label: "Inbox" },
  { key: "connections", label: "Canais" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function ConversasPage() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("inbox");
  const { data: status, isLoading: statusLoading } = useInboxModuleStatus();
  // Achado real do usuário: quem abre Conversas pela primeira vez, sem nenhum canal CONECTADO
  // ainda, não tinha nenhum sinal de que precisava ir em "Canais" conectar um número — só via uma
  // lista vazia genérica. Precisa saber isso ANTES de decidir se mostra o Inbox normal ou o
  // destaque abaixo, então busca aqui (não dentro de `InboxTab`).
  const { data: connectionsData } = useInboxConnections(workspace.id);
  const hasConnectedChannel = (connectionsData?.connections ?? []).some((connection) => connection.status === "connected");

  if (statusLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  if (status && !status.enabled) {
    // Fase 10 (Pre-Pilot Hardening) — módulo desligado nunca é tratado como erro: nem chama
    // `/v1/inbox/conversations` (que 404-aria), nem mostra `ErrorState`/payload técnico. Só uma
    // mensagem neutra, sem prometer prazo, com um jeito claro de sair da tela.
    return (
      <div className="flex h-full items-center justify-center px-4">
        <EmptyState
          icon={<span aria-hidden="true">💬</span>}
          title="Atendimento por canais indisponível"
          description="O atendimento por canais está temporariamente indisponível neste ambiente."
          action={<Button variant="secondary" onClick={() => router.push(`/workspaces/${workspace.id}`)}>Voltar para Início</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConversasHeader tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="min-h-0 flex-1">
        {activeTab === "inbox" ? (
          connectionsData && !hasConnectedChannel ? (
            // Achado real do usuário: "não está intuitivo que precisa clicar em Canais para
            // conectar" — destaque central, nunca escondido atrás de uma lista vazia genérica.
            <div className="flex h-full items-center justify-center px-4">
              <EmptyState
                icon={<span aria-hidden="true">🔌</span>}
                title="Nenhum canal conectado ainda"
                description="Para começar a atender pelo WhatsApp, conecte um número e escaneie o QR Code."
                action={<Button onClick={() => setActiveTab("connections")}>Conectar canal</Button>}
              />
            </div>
          ) : (
            <InboxTab workspaceId={workspace.id} />
          )
        ) : (
          <div className="h-full overflow-y-auto p-3 sm:p-6">
            <ConnectionsTab workspaceId={workspace.id} />
          </div>
        )}
      </div>
    </div>
  );
}
