"use client";

import { useState } from "react";
import { mutate } from "swr";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { ProgressivePanel, ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { StatsGrid } from "@/components/StatsGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { connectProvider, disconnectProvider, runPublicationSync } from "@/features/providers/api";
import { useProviderHealth, useProviders, usePublicationSync, useWebhooks } from "@/features/providers/hooks";
import type { PublicationProviderDescriptor } from "@/features/publication/types";
import { formatDateTime } from "@/lib/format";

export default function ProvidersPage() {
  const workspace = useCurrentWorkspace();
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [eventsOpen, setEventsOpen] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const { data: providers, isLoading: isLoadingProviders, error: providersError, mutate: mutateProviders } = useProviders();
  const showSandboxTools = process.env.NEXT_PUBLIC_SHOW_SANDBOX_PROVIDERS === "true";
  const visibleProviders = (providers ?? []).filter((provider) => showSandboxTools || !provider.providerId.includes("sandbox"));
  const selected = visibleProviders.find((provider) => provider.providerId === selectedProviderId) ?? visibleProviders[0];
  const { data: health } = useProviderHealth(selected?.providerId, workspace.id);
  const { data: webhooks } = useWebhooks(workspace.id, selected?.providerId);
  const { data: sync } = usePublicationSync(workspace.id, selected?.providerId);

  async function runAction(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    try {
      await action();
      await Promise.all([
        mutate("providers"),
        mutate(["provider-health", selected?.providerId, workspace.id]),
        mutate(["webhooks", workspace.id, selected?.providerId]),
        mutate(["publication-sync", workspace.id, selected?.providerId]),
        mutate(["credentials", workspace.id]),
      ]);
    } finally {
      setBusy(undefined);
    }
  }

  async function connectSelected() {
    if (!selected) return;
    await runAction(`connect:${selected.providerId}`, async () => {
      const result = await connectProvider(selected.providerId, workspace.id);
      if ("authorizationUrl" in result) window.location.assign(result.authorizationUrl);
    });
  }

  async function disconnectSelected() {
    if (!selected) return;
    await runAction(`disconnect:${selected.providerId}`, () => disconnectProvider(selected.providerId, workspace.id));
    setConfirmingDisconnect(false);
  }

  if (isLoadingProviders) {
    return (
      <main className="mx-auto flex max-w-7xl justify-center px-3 py-10 sm:px-6 sm:py-16">
        <Spinner />
      </main>
    );
  }

  if (providersError) {
    return (
      <main className="mx-auto max-w-7xl px-3 py-10 sm:px-6 sm:py-16">
        <ErrorState error={providersError} onRetry={() => mutateProviders()} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Provedores" description="Painel técnico das integrações que publicam, recebem retorno e sincronizam status." />

      <ScreenGuide
        title="Tela de diagnóstico"
        description="Para conectar contas, use Conexões. Aqui você confere se cada provedor está saudável."
        items={[
          "Escolha um provedor na lista da esquerda.",
          "Veja se credenciais e webhooks estão saudáveis.",
          "Rode sincronização do workspace quando o status não atualizar.",
          "Desconecte apenas se precisar refazer a autorização.",
        ]}
        aside={<p>Os nomes internos aparecem para facilitar suporte. No uso normal, basta observar o status e os avisos.</p>}
      />

      <div className="mb-6">
        <StatsGrid>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Provedores</p><p className="text-2xl font-semibold text-foreground">{visibleProviders.length}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Ativos</p><p className="text-2xl font-semibold text-foreground">{visibleProviders.filter((provider) => provider.enabled).length}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Webhooks</p><p className="text-2xl font-semibold text-foreground">{webhooks?.metrics.received ?? 0}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Sync pendente</p><p className="text-2xl font-semibold text-foreground">{sync?.pending.length ?? 0}</p></Card>
        </StatsGrid>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-medium text-foreground">Registro</p>
          </div>
          <div className="divide-y divide-border">
            {visibleProviders.map((provider) => (
              <button
                key={provider.providerId}
                className={`w-full px-4 py-3 text-left transition-colors ${selected?.providerId === provider.providerId ? "bg-primary/10" : "hover:bg-muted"}`}
                onClick={() => setSelectedProviderId(provider.providerId)}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{provider.displayName}</p>
                  <StatusBadge status={provider.status ?? (provider.enabled ? "enabled" : "disabled")} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{provider.providerId} · {provider.oauthType ?? "none"} · v{provider.providerVersion}</p>
              </button>
            ))}
          </div>
        </Card>

        {!selected ? (
          <EmptyState title="Nenhum provedor" description="O registro não retornou provedores." />
        ) : (
          <div className="space-y-5">
            <Card className="p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-lg font-semibold text-foreground">{selected.displayName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{selected.providerId} · OAuth {selected.oauthType ?? "none"} · {selected.supportedChannels.join(", ")}</p>
                  <CapabilityLine provider={selected} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!!busy || !selected.enabled || selected.oauthType === "none"} onClick={connectSelected}>Conectar</Button>
                  <Button variant="secondary" disabled={!!busy || !health?.credentials.length} onClick={() => setConfirmingDisconnect(true)}>Desconectar</Button>
                  <Button variant="secondary" disabled={!!busy} onClick={() => runAction("sync", () => runPublicationSync(workspace.id))}>Sincronizar workspace</Button>
                </div>
              </div>
            </Card>

            <div className="grid gap-4 md:grid-cols-3">
              <Card className="p-4">
                <p className="text-xs text-muted-foreground">Saúde</p>
                <div className="mt-2"><StatusBadge status={health?.ok ? "active" : "failed"} /></div>
                <p className="mt-2 text-xs text-muted-foreground">{health?.safeMessage ?? "Nenhuma verificação de saúde carregada."}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-muted-foreground">Credenciais</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{health?.credentials.length ?? 0}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-muted-foreground">Webhook inválido/replay</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{(webhooks?.metrics.invalidSignatures ?? 0) + (webhooks?.metrics.replayRejected ?? 0)}</p>
              </Card>
            </div>

            <ProgressivePanel
              title="Eventos técnicos"
              description="Webhooks, eventos normalizados e sincronização. Abra para investigar erro de publicação."
              open={eventsOpen}
              onToggle={() => setEventsOpen(!eventsOpen)}
              badge={(webhooks?.events.length ?? 0) + (sync?.events.length ?? 0)}
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="p-4">
                  <p className="mb-3 text-sm font-medium text-foreground">Webhooks recentes</p>
                  <EventList events={(webhooks?.events ?? []).map((event) => ({ id: event.id, title: event.status, detail: `${event.providerId} · ${event.rejectionReason ?? event.rawPayloadDigest.slice(0, 12)} · ${formatDateTime(event.receivedAt)}`, status: event.status }))} />
                </Card>
                <Card className="p-4">
                  <p className="mb-3 text-sm font-medium text-foreground">Eventos normalizados</p>
                  <EventList events={(webhooks?.normalized ?? []).map((event) => ({ id: event.id, title: event.type, detail: `${event.publicationId ?? "sem publication"} · ${event.externalStatus ?? "sem status"} · ${formatDateTime(event.createdAt)}`, status: event.status }))} />
                </Card>
              </div>

              <Card className="mt-4 p-4">
                <p className="mb-3 text-sm font-medium text-foreground">Sincronização</p>
                <EventList events={(sync?.events ?? []).map((event) => ({ id: event.id, title: event.safeMessage, detail: `${event.providerId} · ${event.publicationId ?? "sem publication"} · ${formatDateTime(event.createdAt)}`, status: event.status }))} />
              </Card>
            </ProgressivePanel>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmingDisconnect}
        title={`Desconectar ${selected?.displayName ?? "provedor"}?`}
        description="A credencial ativa deste provedor será desconectada. Para publicar novamente será preciso refazer a autorização."
        confirmLabel="Desconectar"
        variant="danger"
        busy={!!busy}
        onCancel={() => setConfirmingDisconnect(false)}
        onConfirm={disconnectSelected}
      />
    </main>
  );
}

function CapabilityLine({ provider }: { provider: PublicationProviderDescriptor }) {
  const capabilities = provider.capabilities;
  const labels = capabilities
    ? Object.entries(capabilities).filter(([, enabled]) => enabled).map(([key]) => key)
    : [
      provider.supportsStatusLookup ? "status" : undefined,
      provider.supportsReceiptVerification ? "verification" : undefined,
      provider.supportsScheduling ? "scheduling" : undefined,
    ].filter(Boolean);
  return <p className="mt-3 text-xs text-muted-foreground">{labels.join(" · ")}</p>;
}

function EventList({ events }: { events: readonly { id: string; title: string; detail: string; status: string }[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">Nenhum evento.</p>;
  return (
    <div className="space-y-3">
      {events.slice(0, 8).map((event) => (
        <div key={event.id} className="border-b border-border pb-2 last:border-0 last:pb-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">{event.title}</p>
            <StatusBadge status={event.status} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{event.detail}</p>
        </div>
      ))}
    </div>
  );
}
