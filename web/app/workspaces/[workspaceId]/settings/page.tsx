"use client";

import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { formatDateTime } from "@/lib/format";

export default function SettingsPage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const activeIntegrations = workspace.integrations.filter((integration) => integration.status === "connected").length;
  const pendingIntegrations = workspace.integrations.filter((integration) => integration.status === "pending").length;
  const memberRoles = countBy(workspace.members.map((member) => member.role));
  const canSeeGovernance = state.status === "authenticated" && (state.role === "owner" || state.role === "admin");

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Configurações" description="Gerencie preferências, integrações e configurações deste workspace." />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <p className="text-sm font-semibold text-foreground">Geral</p>
                <p className="mt-1 text-xs text-muted-foreground">Identificação e preferências reais do workspace.</p>
              </div>
              <StatusBadge status={workspace.status} />
            </CardHeader>
            <CardBody className="grid gap-3 text-sm sm:grid-cols-2">
              <InfoRow label="Nome" value={workspace.name} />
              <InfoRow label="Tipo" value={workspace.kind ?? "Não definido"} />
              <InfoRow label="Fuso horário" value={workspace.settings.timezone ?? "Não definido"} />
              <InfoRow label="Idioma" value={workspace.settings.language ?? "Não definido"} />
              <InfoRow label="Formato padrão" value={workspace.settings.defaultAspectRatio ?? "Não definido"} />
              <InfoRow label="Atualizado em" value={formatDateTime(workspace.updatedAt)} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <p className="text-sm font-semibold text-foreground">Produção</p>
                <p className="mt-1 text-xs text-muted-foreground">Preferências criativas usadas antes de gerar conteúdo.</p>
              </div>
            </CardHeader>
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <SettingsAction
                href={`/workspaces/${workspace.id}/production`}
                title="Linha de produção"
                description="Ajuste formato, motor criativo e regras da criação."
              />
              <SettingsAction
                href={`/workspaces/${workspace.id}/knowledge?tab=guidelines`}
                title="Diretrizes Criativas"
                description="Edite as instruções permanentes da Marca."
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <p className="text-sm font-semibold text-foreground">Publicação</p>
                <p className="mt-1 text-xs text-muted-foreground">Agendamento e saída dos conteúdos para os canais conectados.</p>
              </div>
            </CardHeader>
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <SettingsAction href={`/workspaces/${workspace.id}/publish`} title="Publicar" description="Prepare posts, escolha canais e acompanhe pendências." />
              <SettingsAction href={`/workspaces/${workspace.id}/calendar`} title="Calendário" description="Organize publicações por data, status e canal." />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <p className="text-sm font-semibold text-foreground">Integrações</p>
                <p className="mt-1 text-xs text-muted-foreground">Resumo das conexões registradas neste workspace.</p>
              </div>
              <Link href={`/workspaces/${workspace.id}/connections`} className="text-sm font-medium text-primary hover:underline">
                Abrir Conexões
              </Link>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Metric label="Total" value={workspace.integrations.length} />
                <Metric label="Ativas" value={activeIntegrations} />
                <Metric label="Pendentes" value={pendingIntegrations} />
              </div>
              <div className="space-y-2">
                {workspace.integrations.slice(0, 4).map((integration) => (
                  <div key={integration.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{integration.displayName ?? integration.channel}</p>
                      <p className="text-xs text-muted-foreground">{integration.channel}</p>
                    </div>
                    <StatusBadge status={integration.status} />
                  </div>
                ))}
                {workspace.integrations.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma integração registrada.</p> : null}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <p className="text-sm font-semibold text-foreground">Equipe</p>
                <p className="mt-1 text-xs text-muted-foreground">Distribuição de acesso no workspace.</p>
              </div>
            </CardHeader>
            <CardBody className="grid grid-cols-2 gap-2 text-sm">
              <Metric label="Membros" value={workspace.members.length} />
              <Metric label="Owners" value={memberRoles.owner ?? 0} />
              <Metric label="Admins" value={memberRoles.admin ?? 0} />
              <Metric label="Editores" value={memberRoles.editor ?? 0} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <p className="text-sm font-semibold text-foreground">Conta</p>
                <p className="mt-1 text-xs text-muted-foreground">Sessão atual e escopo de acesso.</p>
              </div>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              {state.status === "authenticated" ? (
                <>
                  <InfoRow label="Usuário" value={state.user.name} />
                  <InfoRow label="E-mail" value={state.user.email} />
                  <InfoRow label="Papel" value={state.role} />
                </>
              ) : (
                <p className="text-muted-foreground">Sessão carregando.</p>
              )}
              {canSeeGovernance ? (
                <Link href={`/workspaces/${workspace.id}/governance`} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground hover:bg-muted">
                  Abrir Governança
                </Link>
              ) : null}
            </CardBody>
          </Card>

        </div>
      </div>
    </main>
  );
}

function SettingsAction({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link href={href} className="block rounded-lg border border-border px-3 py-3 transition-colors hover:bg-muted">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <p className="mt-3 text-xs font-medium text-primary">Abrir</p>
    </Link>
  );
}

function InfoRow({ label, value, subtle = false }: { label: string; value: string; subtle?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 break-words font-medium ${subtle ? "text-xs text-muted-foreground/70" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function countBy(items: readonly string[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item]: (acc[item] ?? 0) + 1 }), {});
}
