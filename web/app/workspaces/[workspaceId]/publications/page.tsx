"use client";

import Link from "next/link";
import { useState } from "react";
import { mutate } from "swr";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { ProgressivePanel, ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { beginMetaPagesOAuth, disconnectMetaPagesOAuth } from "@/features/publication/api";
import { useMetaPagesOAuthStatus, usePublicationDeadLetters, usePublicationMetrics, usePublicationOutbox, usePublicationProviders, usePublicationQueue, usePublicationReconciliations, usePublications } from "@/features/publication/hooks";
import { formatDateTime } from "@/lib/format";

export default function PublicationsPage() {
  const workspace = useCurrentWorkspace();
  const [oauthBusy, setOauthBusy] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const { data: publications, isLoading, error, mutate: mutatePublications } = usePublications(workspace.id);
  const { data: queue } = usePublicationQueue(workspace.id);
  const { data: metrics } = usePublicationMetrics(workspace.id);
  const { data: providers } = usePublicationProviders();
  const { data: metaOAuth } = useMetaPagesOAuthStatus(workspace.id);
  const { data: outbox } = usePublicationOutbox(workspace.id);
  const { data: reconciliations } = usePublicationReconciliations(workspace.id);
  const { data: deadLetters } = usePublicationDeadLetters(workspace.id);
  const showSandboxTools = process.env.NEXT_PUBLIC_SHOW_SANDBOX_PROVIDERS === "true";
  const visibleProviders = (providers ?? []).filter((provider) => showSandboxTools || !provider.providerId.includes("sandbox"));
  const metaProvider = showSandboxTools ? providers?.find((provider) => provider.providerId === "meta_pages_sandbox") : undefined;

  async function connectMetaPages() {
    setOauthBusy(true);
    try {
      const result = await beginMetaPagesOAuth(workspace.id);
      window.location.assign(result.authorizationUrl);
    } finally {
      setOauthBusy(false);
    }
  }

  async function disconnectFirstCredential() {
    const credential = metaOAuth?.credentialReferences[0];
    if (!credential) return;
    setOauthBusy(true);
    try {
      await disconnectMetaPagesOAuth(workspace.id, credential.credentialReferenceId);
      await mutate(["meta-pages-oauth-status", workspace.id]);
    } finally {
      setOauthBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Publicação Técnica" description="Diagnóstico da fila e execução de publicação." />
      <ScreenGuide
        title="Quando abrir esta tela"
        description="No dia a dia, use Publicar ou Postagens Publicadas. Esta tela serve para investigar a fila interna."
        items={[
          "Fila mostra itens aguardando processamento.",
          "Caixa de saída mostra mensagens ainda não confirmadas.",
          "Não entregues lista falhas que precisam de correção.",
          "Use Provedores para diagnosticar credenciais e sincronização.",
        ]}
        aside={<p>Se a intenção é criar uma postagem nova, volte para Publicar ou Produção.</p>}
      />
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-ink-muted">Fila</p><p className="text-2xl font-semibold text-ink">{queue?.size ?? 0}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-muted">Vazão</p><p className="text-2xl font-semibold text-ink">{metrics?.publicationThroughput ?? 0}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-muted">Caixa de saída pendente</p><p className="text-2xl font-semibold text-ink">{metrics?.outboxPending ?? 0}</p></Card>
        <Card className="p-4"><p className="text-xs text-ink-muted">Resultados desconhecidos</p><p className="text-2xl font-semibold text-ink">{metrics?.unknownOutcomes ?? 0}</p></Card>
      </div>
      <div className="mb-6 space-y-3">
        <ProgressivePanel
          title="Diagnóstico técnico da fila"
          description="Abra apenas quando uma publicação falhar ou ficar pendente."
          open={diagnosticsOpen}
          onToggle={() => setDiagnosticsOpen(!diagnosticsOpen)}
          badge={(deadLetters?.length ?? 0) > 0 ? `${deadLetters?.length} falha(s)` : undefined}
        >
          <div className="grid gap-4 lg:grid-cols-4">
            <Card className="p-4">
              <p className="mb-2 text-sm font-medium text-ink">Registro de Provedores</p>
              <div className="space-y-2 text-xs text-ink-muted">{visibleProviders.map((provider) => <p key={provider.providerId}>{provider.displayName} · v{provider.providerVersion} · {provider.enabled ? "ativo" : "desativado"} · {provider.supportedChannels.length} canais</p>)}</div>
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-sm font-medium text-ink">Caixa de Saída</p>
              <p className="text-xs text-ink-muted">{outbox?.length ?? 0} mensagem(ns) · reivindicadas {metrics?.outboxClaimed ?? 0} · lease expirado {metrics?.leaseExpired ?? 0} · fencing rejeitado {metrics?.fencingRejected ?? 0}</p>
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-sm font-medium text-ink">Reconciliação</p>
              <p className="text-xs text-ink-muted">{reconciliations?.length ?? 0} registro(s) · pendente {metrics?.reconciliationPending ?? 0} · sucesso {metrics?.reconciliationSuccess ?? 0}</p>
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-sm font-medium text-ink">Não Entregues</p>
              <p className="text-xs text-ink-muted">{deadLetters?.length ?? 0} registro(s) · divergência {metrics?.receiptMismatch ?? 0} · falhas de credencial {metrics?.credentialResolutionFailures ?? 0}</p>
            </Card>
          </div>
        </ProgressivePanel>

        {showSandboxTools ? (
          <ProgressivePanel
            title="Meta Pages Sandbox"
            description="Ambiente de teste da Meta. No uso normal, prefira Conexões."
            open={sandboxOpen}
            onToggle={() => setSandboxOpen(!sandboxOpen)}
            badge={metaOAuth?.connected ? "conectado" : undefined}
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium text-ink">Status do sandbox</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {metaProvider?.enabled ? "Provedor registrado" : "Provedor desabilitado"} · {metaOAuth?.connected ? "OAuth conectado" : "OAuth desconectado"}
                  {metaOAuth?.credentialReferences[0]?.providerSubjectId ? ` · page ${metaOAuth.credentialReferences[0].providerSubjectId}` : ""}
                </p>
                {metaOAuth?.credentialReferences[0]?.expiresAt ? <p className="mt-1 text-xs text-ink-muted">token expira em {formatDateTime(metaOAuth.credentialReferences[0].expiresAt)}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={oauthBusy || !metaProvider?.enabled} onClick={connectMetaPages}>Conectar sandbox</Button>
                <Button variant="secondary" disabled={oauthBusy || !metaOAuth?.connected} onClick={disconnectFirstCredential}>Desconectar</Button>
              </div>
            </div>
          </ProgressivePanel>
        ) : null}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutatePublications()} />
      ) : !publications || publications.length === 0 ? (
        <EmptyState title="Nenhuma publicação" description="Crie um PublicationPlan a partir de ExecutionArtifacts pela API ou por um fluxo de produto." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-ink-muted">
                <th className="px-4 py-3 font-medium">Publicação</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Modo</th>
                <th className="px-4 py-3 font-medium">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {publications.map((publication) => (
                <tr key={publication.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">
                    <Link href={`/workspaces/${workspace.id}/publications/${publication.id}`} className="hover:text-accent">{publication.id}</Link>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={publication.state} /></td>
                  <td className="px-4 py-3"><span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">{publication.mode === "dry_run" ? "Simulação" : "Real"}</span></td>
                  <td className="px-4 py-3 text-ink-muted">{formatDateTime(publication.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}
