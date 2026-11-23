"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ChannelIcon } from "@/components/ChannelIcon";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useGoogleCalendarStatus } from "@/features/meetings/agenda";
import { INTEGRATION_STATE_LABEL, integrationState, isSocialChannel, type IntegrationState } from "@/features/settings/sections";
import { useSolutions } from "@/features/solutions/hooks";
import type { WorkspaceIntegration } from "@/features/workspace/types";
import { cn } from "@/lib/utils";

const TONE: Record<IntegrationState, string> = {
  connected: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  attention: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200",
  disconnected: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};

/**
 * Integrações (Fase 10): todas as conexões da empresa, por finalidade — atendimento, redes sociais,
 * agenda e reuniões, site e comércio. Cada grupo leva à tela que JÁ conecta/desconecta (OAuth,
 * tokens e webhooks continuam lá). A situação mostrada é só a que o servidor informa; onde ele não
 * informa nada aqui, a tela diz isso em vez de presumir "funcionando".
 */
export default function IntegrationsHubPage() {
  const workspace = useCurrentWorkspace();
  const { available } = useSolutions();
  const has = (key: string) => available.includes(key as never);
  const base = `/workspaces/${workspace.id}`;
  const google = useGoogleCalendarStatus(workspace.id, has("meetings"));
  const messaging = workspace.integrations.filter((integration) => !isSocialChannel(integration.channel));
  const social = workspace.integrations.filter((integration) => isSocialChannel(integration.channel));

  return (
    <SettingsShell active="integrations-hub" title="Integrações" description="As contas e serviços conectados à sua empresa, organizados pelo que cada um faz.">
      <div className="grid gap-4 xl:grid-cols-2">
        {has("conversations") ? (
          <Group title="Atendimento e mensagens" testId="integrations-messaging" links={[["Canais de atendimento", `${base}/conversas?aba=canais`], ["Instagram Direct", `${base}/connections`]]}>
            <AccountList items={messaging} empty="Nenhum canal de mensagens conectado." />
          </Group>
        ) : null}
        {has("marketing") ? (
          <Group title="Redes sociais e publicidade" testId="integrations-social" links={[["Redes sociais", `${base}/social/integrations`], ["Anúncios", `${base}/meta-ads`]]}>
            <AccountList items={social} empty="Nenhuma rede social conectada." />
          </Group>
        ) : null}
        {has("meetings") ? (
          <Group title="Agenda e reuniões" testId="integrations-meetings" links={[["Agenda e integrações", `${base}/meetings/integrations`], ["Contas de gravação", `${base}/meetings/recorder-accounts`]]}>
            {google.error ? <p className="text-sm text-muted-foreground">Não foi possível consultar a Google Agenda agora.</p> : !google.data ? <p className="text-sm text-muted-foreground">Consultando a Google Agenda…</p> : (
              <StatusRow label={`Google Agenda${google.data.googleEmail ? ` · ${google.data.googleEmail}` : ""}`} state={google.data.configured === false ? "unknown" : google.data.lastErrorMessage ? "attention" : integrationState(google.data.status)} note={google.data.configured === false ? "Não disponível neste ambiente" : google.data.lastErrorMessage ? "Falha na última sincronização" : undefined} />
            )}
          </Group>
        ) : null}
        {has("site") || has("conversations") ? (
          <Group
            title="Site e comércio"
            testId="integrations-commerce"
            links={[...(has("site") ? [["Endereço e domínio", `${base}/site?section=dominio`], ["Pagamentos e entrega", `${base}/site?section=loja`]] as [string, string][] : []), ["Marketplaces", `${base}/settings/marketplaces`]]}
          >
            <p className="text-sm text-muted-foreground">A situação do domínio, dos pagamentos e dos marketplaces aparece em cada tela, onde também se conecta e desconecta.</p>
          </Group>
        ) : null}
      </div>
    </SettingsShell>
  );
}

function Group({ title, testId, links, children }: { title: string; testId: string; links: [string, string][]; children: React.ReactNode }) {
  return (
    <Card data-testid={testId}>
      <CardHeader><p className="text-sm font-semibold text-foreground">{title}</p></CardHeader>
      <CardBody className="space-y-3">
        {children}
        <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
          {links.map(([label, href]) => (
            <Link key={href} href={href} className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted/50">
              {label} <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function AccountList({ items, empty }: { items: readonly WorkspaceIntegration[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((integration) => (
        <li key={integration.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
          <ChannelIcon channel={integration.channel} label={integration.displayName ?? integration.channel} showLabel className="min-w-0 text-foreground" />
          <StateBadge state={integrationState(integration.status)} />
        </li>
      ))}
    </ul>
  );
}

function StatusRow({ label, state, note }: { label: string; state: IntegrationState; note?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
      <span className="min-w-0 break-all text-foreground">{label}{note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}</span>
      <StateBadge state={state} />
    </div>
  );
}

function StateBadge({ state }: { state: IntegrationState }) {
  return <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[state])} data-state={state}>{INTEGRATION_STATE_LABEL[state]}</span>;
}
