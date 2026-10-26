"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { Select, SelectItem } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useTenantsList } from "@/features/platform-admin/hooks";
import { setSocialProviderSwitch, setSocialTenantPolicy } from "@/features/social/api";
import { NetworkMark, StatePill } from "@/features/social/components";
import { useSocialProviderSwitches, useSocialTenantOverview } from "@/features/social/hooks";
import { NETWORK_LABEL } from "@/features/social/presentation";
import type { SocialProviderSwitchView, SocialTenantOverview } from "@/features/social/types";

const PROVIDER_LABEL: Record<string, string> = { meta_official: "Meta oficial (Instagram e Facebook)", tiktok_official: "TikTok oficial" };
const providerLabel = (type: string) => PROVIDER_LABEL[type] ?? type;

type PendingSwitch = { provider: SocialProviderSwitchView; field: "enabled" | "approved"; value: boolean };

/**
 * Admin → Social Providers (só platform admin). Liga/desliga cada provider (kill switch), registra a
 * homologação e libera, empresa por empresa e rede por rede, quem pode publicar. Nada é automático:
 * todo provider e toda empresa começam DESLIGADOS.
 */
export default function AdminSocialProvidersPage() {
  const switches = useSocialProviderSwitches();
  const tenants = useTenantsList({ limit: 200 });
  const [tenantId, setTenantId] = useState<string | undefined>();
  const [pending, setPending] = useState<PendingSwitch | undefined>();
  const [saving, setSaving] = useState(false);
  const tenantItems = useMemo(() => (tenants.data?.items ?? []).map((tenant) => ({ id: tenant.tenantId, label: tenant.displayName ?? tenant.ownerEmail ?? tenant.tenantId })), [tenants.data]);

  async function confirmSwitch() {
    if (!pending) return;
    setSaving(true);
    try {
      const next = { enabled: pending.field === "enabled" ? pending.value : pending.provider.enabled, approved: pending.field === "approved" ? pending.value : pending.provider.approved };
      await setSocialProviderSwitch(pending.provider.providerType, next);
      toast.success(`${providerLabel(pending.provider.providerType)} atualizado.`);
      setPending(undefined);
      await switches.mutate();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-8">
      <PageHeader title="Social Providers" description="Mecanismos de publicação do Vorix Marketing. Ativação é sempre explícita: provider, homologação e empresa." />

      <Card className="mb-6 overflow-hidden p-0">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">Status global</div>
        {switches.error ? <div className="p-5"><ErrorState error={switches.error} onRetry={() => void switches.mutate()} /></div> : !switches.data ? <Skeleton className="m-5 h-24" /> : (
          <ul className="divide-y divide-border" data-testid="social-provider-switches">
            {switches.data.providers.map((provider) => (
              <li key={provider.providerType} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{providerLabel(provider.providerType)}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {provider.networks.map((network) => <span key={network} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><NetworkMark network={network} size="sm" /> {NETWORK_LABEL[network]}</span>)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <StatePill label={provider.configured ? "App configurado" : "App não configurado"} tone={provider.configured ? "emerald" : "neutral"} />
                    <StatePill label={provider.realPublishingValidated ? "Publicação real validada" : "Publicação real não validada"} tone={provider.realPublishingValidated ? "emerald" : "amber"} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={provider.approved} onCheckedChange={(value) => setPending({ provider, field: "approved", value })} aria-label={`Homologado: ${providerLabel(provider.providerType)}`} />
                  Homologado
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={provider.enabled} onCheckedChange={(value) => setPending({ provider, field: "enabled", value })} aria-label={`Ligado: ${providerLabel(provider.providerType)}`} />
                  {provider.enabled ? "Ligado" : "Desligado"}
                </label>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold">Política por empresa</p>
        <SearchableCombo items={tenantItems} loading={!tenants.data && !tenants.error} value={tenantId ?? ""} onValueChange={(value) => setTenantId(value || undefined)} placeholder="Escolha uma empresa" searchPlaceholder="Buscar empresa..." emptyText="Nenhuma empresa encontrada" />
        {tenantId ? <TenantPolicy tenantId={tenantId} providers={switches.data?.providers ?? []} /> : <p className="mt-3 text-sm text-muted-foreground">Selecione uma empresa para ver e liberar a publicação nas redes.</p>}
      </Card>

      <ConfirmDialog
        open={!!pending}
        title={pending ? `${pending.field === "enabled" ? (pending.value ? "Ligar" : "Desligar") : pending.value ? "Marcar como homologado" : "Remover homologação de"} ${providerLabel(pending.provider.providerType)}?` : ""}
        description={pending?.field === "enabled" && !pending.value
          ? "Novas publicações por este provider ficam pausadas em todas as empresas. Nada é apagado: os agendamentos são preservados e os clientes são avisados."
          : pending?.field === "approved" && pending.value
            ? "Só marque depois da aprovação do app pela rede e de uma publicação real bem-sucedida. Isso não libera nenhuma empresa automaticamente."
            : "A mudança vale para todas as empresas que usam este provider."}
        confirmLabel="Confirmar"
        variant={pending?.value === false ? "danger" : "primary"}
        busy={saving}
        onConfirm={confirmSwitch}
        onCancel={() => setPending(undefined)}
      />
    </div>
  );
}

function TenantPolicy({ tenantId, providers }: { tenantId: string; providers: SocialProviderSwitchView[] }) {
  const { data, error, mutate } = useSocialTenantOverview(tenantId);
  const [saving, setSaving] = useState<string | undefined>();

  async function save(network: SocialTenantOverview["networks"][number]["network"], input: { publishingEnabled?: boolean; preferredProvider?: string; enabledProviders?: string[] }) {
    setSaving(network);
    try {
      await setSocialTenantPolicy(tenantId, network, input);
      toast.success(`Política do ${NETWORK_LABEL[network]} salva.`);
      await mutate();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    } finally {
      setSaving(undefined);
    }
  }

  if (error) return <div className="mt-4"><ErrorState error={error} onRetry={() => void mutate()} /></div>;
  if (!data) return <Skeleton className="mt-4 h-40" />;
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3" data-testid="social-tenant-policy">
      {data.networks.map((item) => (
        <div key={item.network} className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center gap-2"><NetworkMark network={item.network} size="sm" /><span className="font-medium">{NETWORK_LABEL[item.network]}</span></div>
          <label className="flex items-center gap-2 text-sm">
            <Switch disabled={saving === item.network} checked={item.policy.publishingEnabled} onCheckedChange={(value) => void save(item.network, { publishingEnabled: value, enabledProviders: item.policy.enabledProviders, preferredProvider: item.policy.preferredProvider })} aria-label={`Publicação liberada no ${NETWORK_LABEL[item.network]}`} />
            Publicação liberada
          </label>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Providers liberados</p>
            {item.providers.map((provider) => {
              const approved = providers.find((candidate) => candidate.providerType === provider.providerType)?.approved ?? provider.approved;
              const checked = item.policy.enabledProviders.includes(provider.providerType);
              return (
                <label key={provider.providerType} className="flex items-center gap-2 text-sm" title={approved ? undefined : "Provider ainda não homologado"}>
                  <Checkbox
                    disabled={saving === item.network || (!approved && !checked)}
                    checked={checked}
                    onCheckedChange={(value) => {
                      const enabledProviders = value ? [...item.policy.enabledProviders, provider.providerType] : item.policy.enabledProviders.filter((type) => type !== provider.providerType);
                      void save(item.network, { enabledProviders, publishingEnabled: enabledProviders.length > 0 && item.policy.publishingEnabled, preferredProvider: enabledProviders.includes(item.policy.preferredProvider) ? item.policy.preferredProvider : enabledProviders[0] ?? item.policy.preferredProvider });
                    }}
                    aria-label={`${providerLabel(provider.providerType)} liberado`}
                  />
                  {providerLabel(provider.providerType)}
                  {!approved ? <span className="text-xs text-muted-foreground">(não homologado)</span> : null}
                </label>
              );
            })}
          </div>
          {item.policy.enabledProviders.length > 1 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Preferido</p>
              <Select value={item.policy.preferredProvider} onValueChange={(value) => void save(item.network, { preferredProvider: value })}>
                {item.policy.enabledProviders.map((type) => <SelectItem key={type} value={type}>{providerLabel(type)}</SelectItem>)}
              </Select>
            </div>
          ) : null}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Contas</p>
            {item.accounts.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma conta conectada.</p> : (
              <ul className="space-y-1 text-xs">
                {item.accounts.map((account) => <li key={account.id} className="flex flex-wrap items-center justify-between gap-1"><span>{account.username ? `@${account.username}` : account.id}</span><span className="text-muted-foreground">{account.status} · {account.connectedProviders.map(providerLabel).join(", ") || "sem conexão ativa"}</span></li>)}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
