"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input, Label } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { Switch } from "@/components/ui/switch";
import {
  fetchBillingProviderSettings,
  updateBillingProviderSettings,
  type BillingProviderSettingsPublic,
} from "@/features/platform-admin/billing-provider-settings-api";

const WEBHOOK_URL = "https://api.vorixworks.com/webhooks/billing/mercadopago";

type RemoveTarget = "accessToken" | "webhookSecret" | undefined;

/**
 * Credenciais do Mercado Pago — tela nova, mesmo padrão de "Configurações (Anthropic)": substitui
 * editar `.env.zuno` no servidor por uma UI. Escopo é só CREDENCIAIS (access token/webhook secret/
 * notification URL) — qual provider está ATIVO (sandbox/stripe/mercadopago) continua sendo
 * BILLING_PROVIDER_ENABLED/BILLING_PROVIDER (variável de ambiente + deploy), decisão de produto
 * separada. Mudanças aqui refletem em até 60 segundos em runtime, sem restart de container.
 */
export default function AdminBillingProviderPage() {
  const [settings, setSettings] = useState<BillingProviderSettingsPublic | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();

  const [accessTokenInput, setAccessTokenInput] = useState("");
  const [webhookSecretInput, setWebhookSecretInput] = useState("");
  const [notificationUrlInput, setNotificationUrlInput] = useState("");
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget>(undefined);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await fetchBillingProviderSettings();
      setSettings(data);
      setNotificationUrlInput(data.mercadoPagoNotificationUrl ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar as credenciais.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (removeTarget) {
      setConfirmRemoveOpen(true);
      return;
    }
    void performSave(undefined);
  };

  const performSave = async (removing: RemoveTarget) => {
    setSaving(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      const target = removing ?? removeTarget;
      const updated = await updateBillingProviderSettings({
        mercadoPagoAccessToken: target === "accessToken" ? "" : accessTokenInput.trim() || undefined,
        mercadoPagoWebhookSecret: target === "webhookSecret" ? "" : webhookSecretInput.trim() || undefined,
        mercadoPagoNotificationUrl: notificationUrlInput.trim() || undefined,
      });
      setSettings(updated);
      setAccessTokenInput("");
      setWebhookSecretInput("");
      setRemoveTarget(undefined);
      setSuccess("Credenciais salvas. Efeito em runtime em até 60 segundos.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
      setConfirmRemoveOpen(false);
    }
  };

  const removeLabel = removeTarget === "accessToken" ? "Access Token" : removeTarget === "webhookSecret" ? "Webhook Secret" : "";

  return (
    <div className="mx-auto max-w-4xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Mercado Pago"
        description="Gerencie as credenciais do Mercado Pago (billing provider). Alterações se aplicam sem restart."
      />

      <ScreenGuide
        title="O que mexer aqui"
        description="Esta tela controla só as CREDENCIAIS do Mercado Pago Test/Live."
        items={[
          "Cole o Access Token gerado no painel Mercado Pago Developers.",
          "Cole o Webhook Secret (chave de assinatura, aba Webhooks — nunca o Access Token).",
          "Confirme a Notification URL cadastrada no painel do Mercado Pago.",
          "Salve e aguarde até 60 segundos para aplicar.",
        ]}
        aside={<p>Qual provider está ATIVO (sandbox/stripe/mercadopago) não muda aqui — isso continua sendo BILLING_PROVIDER_ENABLED/BILLING_PROVIDER no deploy.</p>}
      />

      {loading ? (
        <div className="flex items-center gap-2 py-14 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Carregando…
        </div>
      ) : (
        <form onSubmit={onSave} className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div>
                <div className="text-base font-semibold text-foreground">Credenciais Mercado Pago</div>
                <div className="text-xs text-muted-foreground">Access Token e Webhook Secret são guardados criptografados (AES-256-GCM). Só os últimos 4 caracteres são exibidos.</div>
              </div>
            </CardHeader>
            <CardBody className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <div className="text-sm">
                  <div className="text-muted-foreground">Access Token atual</div>
                  <div className="mt-1 font-mono text-foreground">
                    {settings?.hasMercadoPagoAccessToken
                      ? `…${settings.mercadoPagoAccessTokenLast4}`
                      : <span className="text-destructive">Nenhum Access Token configurado</span>}
                  </div>
                </div>
                <Label htmlFor="mp-access-token">{settings?.hasMercadoPagoAccessToken ? "Substituir por novo Access Token" : "Colar o Access Token"}</Label>
                <Input
                  id="mp-access-token"
                  type="password"
                  autoComplete="off"
                  value={accessTokenInput}
                  onChange={(e) => setAccessTokenInput(e.target.value)}
                  placeholder="TEST-... ou APP_USR-..."
                  disabled={removeTarget === "accessToken"}
                  className="font-mono"
                />
                <span className="text-xs text-muted-foreground">Deixe em branco para manter o valor atual.</span>
                {settings?.hasMercadoPagoAccessToken && (
                  <label className="mt-1 flex items-center gap-3 text-sm text-destructive">
                    <Switch checked={removeTarget === "accessToken"} onCheckedChange={(checked) => setRemoveTarget(checked ? "accessToken" : undefined)} />
                    Remover Access Token atual
                  </label>
                )}
              </div>

              <div className="flex flex-col gap-1.5 border-t border-border/60 pt-4">
                <div className="text-sm">
                  <div className="text-muted-foreground">Webhook Secret atual</div>
                  <div className="mt-1 font-mono text-foreground">
                    {settings?.hasMercadoPagoWebhookSecret
                      ? `…${settings.mercadoPagoWebhookSecretLast4}`
                      : <span className="text-destructive">Nenhum Webhook Secret configurado</span>}
                  </div>
                </div>
                <Label htmlFor="mp-webhook-secret">{settings?.hasMercadoPagoWebhookSecret ? "Substituir por novo Webhook Secret" : "Colar o Webhook Secret"}</Label>
                <Input
                  id="mp-webhook-secret"
                  type="password"
                  autoComplete="off"
                  value={webhookSecretInput}
                  onChange={(e) => setWebhookSecretInput(e.target.value)}
                  placeholder="chave de assinatura da aba Webhooks"
                  disabled={removeTarget === "webhookSecret"}
                  className="font-mono"
                />
                <span className="text-xs text-muted-foreground">Deixe em branco para manter o valor atual. Nunca é o mesmo valor do Access Token.</span>
                {settings?.hasMercadoPagoWebhookSecret && (
                  <label className="mt-1 flex items-center gap-3 text-sm text-destructive">
                    <Switch checked={removeTarget === "webhookSecret"} onCheckedChange={(checked) => setRemoveTarget(checked ? "webhookSecret" : undefined)} />
                    Remover Webhook Secret atual
                  </label>
                )}
              </div>

              <div className="flex flex-col gap-1.5 border-t border-border/60 pt-4">
                <Label htmlFor="mp-notification-url">Notification URL</Label>
                <Input
                  id="mp-notification-url"
                  type="text"
                  value={notificationUrlInput}
                  onChange={(e) => setNotificationUrlInput(e.target.value)}
                  placeholder={WEBHOOK_URL}
                  className="font-mono"
                />
                <span className="text-xs text-muted-foreground">
                  Não é um segredo — é a URL que o Mercado Pago chama a cada notificação. Precisa ser exatamente a mesma cadastrada em
                  Suas integrações → Webhooks no painel do Mercado Pago: <code className="font-mono">{WEBHOOK_URL}</code>
                </span>
              </div>
            </CardBody>
          </Card>

          {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}
          {success && <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm text-primary">{success}</div>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={saving}>
              Recarregar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Salvar credenciais"}
            </Button>
          </div>

          {settings?.updatedAt && (
            <div className="text-xs text-muted-foreground">
              Última atualização em {new Date(settings.updatedAt).toLocaleString("pt-BR")}
              {settings.updatedBy && ` por ${settings.updatedBy}`}.
            </div>
          )}
        </form>
      )}

      <ConfirmDialog
        open={confirmRemoveOpen}
        title={`Remover o ${removeLabel} atual?`}
        description="Sem essa credencial, chamadas ao Mercado Pago que dependem dela passam a falhar com 'não configurado' até um novo valor ser cadastrado."
        confirmLabel={`Remover ${removeLabel}`}
        variant="danger"
        busy={saving}
        onConfirm={() => void performSave(removeTarget)}
        onCancel={() => setConfirmRemoveOpen(false)}
      />
    </div>
  );
}
