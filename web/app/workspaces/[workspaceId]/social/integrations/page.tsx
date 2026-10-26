"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, Link2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Select, SelectItem } from "@/components/Field";
import { GuardedButton } from "@/components/GuardedButton";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useMyAccess } from "@/features/auth/access";
import { beginSocialConnection, disconnectSocialAccount, getAuthorizedAccounts, SOCIAL_OAUTH_FLOW_KEY, syncSocialAccounts, testSocialAccount, updateSocialLatePolicy } from "@/features/social/api";
import { AccountAvatar, NetworkMark, StatePill } from "@/features/social/components";
import { useSocialAccounts, useSocialSettings } from "@/features/social/hooks";
import { accountName, ACTION_PERMISSION, formatDateTime, integrationCard, LATE_POLICY_OPTIONS, NETWORK_LABEL, waitingLabel, type IntegrationCardModel } from "@/features/social/presentation";
import { SOCIAL_NETWORKS, type SocialAccountView, type SocialAuthorizedAccount, type SocialLatePolicy, type SocialNetwork } from "@/features/social/types";

/** Marketing → Integrações: Instagram, Facebook e TikTok, sem nenhum termo técnico. */
export default function SocialIntegrationsPage() {
  return (
    <Suspense fallback={<IntegrationsSkeleton />}>
      <SocialIntegrations />
    </Suspense>
  );
}

function SocialIntegrations() {
  const workspace = useCurrentWorkspace();
  const params = useSearchParams();
  const router = useRouter();
  const { can } = useMyAccess();
  const { data, error, isLoading, mutate } = useSocialAccounts(workspace.id);
  const [busy, setBusy] = useState<string | undefined>();
  const [disconnecting, setDisconnecting] = useState<SocialAccountView | undefined>();
  const pick = SOCIAL_NETWORKS.find((network) => network === params.get("pick"));
  const timezone = useSocialSettings(workspace.id).data?.timezone ?? "America/Sao_Paulo";

  useEffect(() => {
    const connected = SOCIAL_NETWORKS.find((network) => network === params.get("connected"));
    if (connected) {
      toast.success(`${NETWORK_LABEL[connected]} conectado.`);
      router.replace(`/workspaces/${workspace.id}/social/integrations`);
    }
  }, [params, router, workspace.id]);

  const cards = useMemo(() => SOCIAL_NETWORKS.map((network) => integrationCard(network, data?.accounts ?? [], data?.networks.find((item) => item.network === network))), [data]);
  const nothingConnected = !!data && data.accounts.every((account) => account.status === "DISCONNECTED");
  const firstConnectable = cards.find((card) => card.primaryAction === "connect");

  async function connect(network: SocialNetwork) {
    setBusy(`connect:${network}`);
    try {
      const started = await beginSocialConnection(workspace.id, network, `/workspaces/${workspace.id}/social/integrations`);
      window.sessionStorage.setItem(SOCIAL_OAUTH_FLOW_KEY, network);
      window.location.assign(started.redirectUrl);
    } catch (cause) {
      toast.error(messageOf(cause));
      setBusy(undefined);
    }
  }

  async function test(account: SocialAccountView) {
    setBusy(`test:${account.id}`);
    try {
      const result = await testSocialAccount(workspace.id, account.id);
      if (result.healthy) toast.success(result.message);
      else toast.error(result.message);
      await mutate();
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function confirmDisconnect() {
    if (!disconnecting) return;
    setBusy(`disconnect:${disconnecting.id}`);
    try {
      await disconnectSocialAccount(workspace.id, disconnecting.id);
      toast.success(`${NETWORK_LABEL[disconnecting.network]} desconectado. Os agendamentos foram preservados.`);
      setDisconnecting(undefined);
      await mutate();
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Integrações" description="Conecte as redes sociais onde o Vorix vai publicar. Você autoriza direto na rede; o Vorix nunca vê a sua senha." />

      {error ? <ErrorState error={error} onRetry={() => void mutate()} /> : null}
      {isLoading ? <IntegrationsSkeleton /> : null}

      {data && nothingConnected && firstConnectable ? (
        <EmptyState
          className="mb-6"
          icon={<Link2 />}
          title="Nenhuma rede conectada"
          description="Conecte Instagram, Facebook ou TikTok para criar e agendar publicações por aqui."
          action={can(ACTION_PERMISSION.connect) ? <Button onClick={() => void connect(firstConnectable.network)} loading={busy === `connect:${firstConnectable.network}`}>Conectar minha primeira rede</Button> : undefined}
        />
      ) : null}

      {data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="social-integration-cards">
          {cards.map((card) => (
            <IntegrationCard
              key={card.network}
              card={card}
              timezone={timezone}
              busy={busy}
              canConnect={can(ACTION_PERMISSION.connect)}
              canManage={can(ACTION_PERMISSION.manage_accounts)}
              onConnect={() => void connect(card.network)}
              onTest={(account) => void test(account)}
              onDisconnect={setDisconnecting}
            />
          ))}
        </div>
      ) : null}

      {data && can(ACTION_PERMISSION.settings) ? <LatePolicyCard workspaceId={workspace.id} /> : null}

      {pick ? <AccountPicker workspaceId={workspace.id} network={pick} onDone={() => { router.replace(`/workspaces/${workspace.id}/social/integrations`); void mutate(); }} /> : null}

      <ConfirmDialog
        open={!!disconnecting}
        title={disconnecting ? `Desconectar ${accountName(disconnecting)} (${NETWORK_LABEL[disconnecting.network]})?` : "Desconectar conta?"}
        description="O Vorix para de publicar nesta conta. Nada é apagado: as publicações agendadas ficam aguardando até você reconectar."
        confirmLabel="Desconectar"
        variant="danger"
        busy={!!busy?.startsWith("disconnect:")}
        onConfirm={confirmDisconnect}
        onCancel={() => setDisconnecting(undefined)}
      />
    </div>
  );
}

function IntegrationCard({ card, timezone, busy, canConnect, canManage, onConnect, onTest, onDisconnect }: {
  card: IntegrationCardModel;
  timezone: string;
  busy?: string;
  canConnect: boolean;
  canManage: boolean;
  onConnect: () => void;
  onTest: (account: SocialAccountView) => void;
  onDisconnect: (account: SocialAccountView) => void;
}) {
  const label = NETWORK_LABEL[card.network];
  const tone = card.state === "connected" ? "emerald" : card.state === "attention" ? "amber" : "neutral";
  const waiting = waitingLabel(card.waitingPublications);
  return (
    <Card className="flex flex-col gap-4 p-5" data-testid={`social-card-${card.network}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <NetworkMark network={card.network} size="lg" />
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{label}</p>
            <StatePill label={card.headline} tone={tone} className="mt-1" />
          </div>
        </div>
      </div>

      {card.message ? <p className={card.state === "attention" ? "text-sm font-medium text-amber-700 dark:text-amber-400" : "text-sm text-muted-foreground"}>{card.message}</p> : null}
      {waiting ? (
        <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
          <CalendarClock className="h-4 w-4" aria-hidden /> {waiting}
        </p>
      ) : null}

      {card.accounts.length > 0 ? (
        <ul className="space-y-3">
          {card.accounts.map((account) => (
            <li key={account.id} className="rounded-lg border border-border bg-surface-2/40 p-3">
              <div className="flex items-center gap-3">
                <AccountAvatar name={accountName(account)} avatarUrl={account.avatarUrl} network={account.network} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{accountName(account)}</p>
                  {account.displayName && account.username ? <p className="truncate text-xs text-muted-foreground">{account.displayName}</p> : null}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div><dt className="text-muted-foreground">Última verificação</dt><dd className="tabular-nums text-foreground">{formatDateTime(account.lastSyncAt, timezone)}</dd></div>
                <div><dt className="text-muted-foreground">Próxima publicação</dt><dd className="tabular-nums text-foreground">{formatDateTime(account.nextPublicationAt, timezone)}</dd></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <GuardedButton size="sm" variant="secondary" allowed={canConnect} blockedReason="Você não tem permissão para gerenciar conexões." loading={busy === `test:${account.id}`} onClick={() => onTest(account)}>
                  Testar conexão
                </GuardedButton>
                <GuardedButton size="sm" variant="ghost" allowed={canManage} blockedReason="Só quem gerencia contas pode desconectar." onClick={() => onDisconnect(account)}>
                  Desconectar
                </GuardedButton>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-auto flex flex-wrap gap-2">
        {card.primaryAction ? (
          <GuardedButton allowed={canConnect} blockedReason="Peça a um administrador para conectar esta rede." loading={busy === `connect:${card.network}`} onClick={onConnect}>
            {card.primaryAction === "reconnect" ? `Reconectar ${label}` : `Conectar ${label}`}
          </GuardedButton>
        ) : null}
        {card.state === "connected" ? (
          <GuardedButton variant="secondary" allowed={canConnect} blockedReason="Peça a um administrador para conectar esta rede." loading={busy === `connect:${card.network}`} onClick={onConnect}>
            Adicionar outra conta
          </GuardedButton>
        ) : null}
      </div>
    </Card>
  );
}

/** Depois da autorização com várias contas: o cliente escolhe quais usar. */
function AccountPicker({ workspaceId, network, onDone }: { workspaceId: string; network: SocialNetwork; onDone: () => void }) {
  const [accounts, setAccounts] = useState<SocialAuthorizedAccount[] | undefined>();
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    getAuthorizedAccounts(workspaceId, network).then((result) => {
      setAccounts(result.accounts);
      setSelected(result.accounts.filter((account) => account.alreadyConnected).map((account) => account.externalAccountId));
    }).catch((cause) => {
      toast.error(messageOf(cause));
      onDone();
    });
  }, [network, onDone, workspaceId]);

  async function save() {
    setSaving(true);
    try {
      await syncSocialAccounts(workspaceId, { network, externalAccountIds: selected });
      toast.success(selected.length === 1 ? `Conta do ${NETWORK_LABEL[network]} conectada.` : `${selected.length} contas do ${NETWORK_LABEL[network]} conectadas.`);
      onDone();
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Escolha as contas do ${NETWORK_LABEL[network]}`} onClose={onDone}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Você autorizou mais de uma conta. Marque as que o Vorix deve usar para publicar.</p>
        {!accounts ? <Skeleton className="h-24 w-full" /> : (
          <ul className="space-y-2" data-testid="social-account-picker">
            {accounts.map((account) => {
              const checked = selected.includes(account.externalAccountId);
              return (
                <li key={account.externalAccountId}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/50">
                    <Checkbox checked={checked} onCheckedChange={(value) => setSelected((current) => value ? [...current, account.externalAccountId] : current.filter((id) => id !== account.externalAccountId))} aria-label={accountName(account)} />
                    <AccountAvatar name={accountName(account)} avatarUrl={account.avatarUrl} network={network} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{accountName(account)}</span>
                      {account.alreadyConnected ? <span className="text-xs text-muted-foreground">Já conectada</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onDone}>Agora não</Button>
          <Button onClick={() => void save()} loading={saving} disabled={!accounts || selected.length === 0}>Conectar selecionadas</Button>
        </div>
      </div>
    </Modal>
  );
}

function LatePolicyCard({ workspaceId }: { workspaceId: string }) {
  const { data, mutate } = useSocialSettings(workspaceId);
  const [saving, setSaving] = useState<SocialNetwork | undefined>();
  if (!data) return null;

  async function save(network: SocialNetwork, latePolicy: SocialLatePolicy) {
    setSaving(network);
    try {
      await updateSocialLatePolicy(workspaceId, network, latePolicy);
      toast.success(`Preferência do ${NETWORK_LABEL[network]} salva.`);
      await mutate();
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setSaving(undefined);
    }
  }

  return (
    <Card className="mt-6 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground"><ShieldCheck className="h-4 w-4" /></span>
        <div>
          <p className="font-semibold text-foreground">Quando uma publicação perder o horário por desconexão</p>
          <p className="text-sm text-muted-foreground">O que fazer quando a conta volta a funcionar depois do horário marcado. Agendamentos nunca são apagados.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {data.networks.map((item) => (
          <div key={item.network} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2"><NetworkMark network={item.network} size="sm" /><span className="text-sm font-medium">{NETWORK_LABEL[item.network]}</span></div>
            <Select value={item.latePolicy.whenLate} onValueChange={(value) => void save(item.network, { ...item.latePolicy, whenLate: value as SocialLatePolicy["whenLate"] })}>
              {LATE_POLICY_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </Select>
            <p className="text-xs text-muted-foreground">{LATE_POLICY_OPTIONS.find((option) => option.value === item.latePolicy.whenLate)?.description}</p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Atraso tolerado
              <Input
                type="number"
                min={0}
                max={1440}
                defaultValue={item.latePolicy.toleranceMinutes}
                className="h-8 w-20 tabular-nums"
                disabled={saving === item.network}
                onBlur={(event) => {
                  const minutes = Math.max(0, Math.min(1440, Math.round(Number(event.currentTarget.value) || 0)));
                  if (minutes !== item.latePolicy.toleranceMinutes) void save(item.network, { ...item.latePolicy, toleranceMinutes: minutes });
                }}
              />
              min
            </label>
          </div>
        ))}
      </div>
    </Card>
  );
}

function IntegrationsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {SOCIAL_NETWORKS.map((network) => <Skeleton key={network} className="h-56 w-full rounded-xl" />)}
    </div>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Algo deu errado. Tente novamente.";
}
