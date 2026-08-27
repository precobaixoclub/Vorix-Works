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
import { fetchPlatformAiSettings, updatePlatformAiSettings, type PlatformAiSettingsPublic } from "@/features/platform-admin/ai-settings-api";

/**
 * Configuração global do AI Gateway — Sprint 25/Fase 3. Substitui as variáveis de ambiente por
 * uma UI: liga/desliga o Gateway, liga/desliga a extração de briefing, gerencia a API key da
 * Anthropic (guardada criptografada com AES-256-GCM) e o modelo padrão. Mudanças refletem em até
 * 60 segundos em runtime — sem restart de container.
 */
export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<PlatformAiSettingsPublic | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();

  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [briefingEnabled, setBriefingEnabled] = useState(false);
  const [model, setModel] = useState("claude-haiku-4-5-20251001");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await fetchPlatformAiSettings();
      setSettings(data);
      setGatewayEnabled(data.gatewayEnabled);
      setBriefingEnabled(data.briefingExtractionEnabled);
      setModel(data.anthropicBriefingExtractionModel);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar as configurações.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (removeKey) {
      setConfirmRemoveOpen(true);
      return;
    }
    void performSave();
  };

  const performSave = async () => {
    setSaving(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      const payload = {
        gatewayEnabled,
        briefingExtractionEnabled: briefingEnabled,
        anthropicBriefingExtractionModel: model,
        anthropicApiKey: removeKey ? "" : apiKeyInput.trim() || undefined,
      };
      const updated = await updatePlatformAiSettings(payload);
      setSettings(updated);
      setApiKeyInput("");
      setRemoveKey(false);
      setSuccess("Configurações salvas. Efeito em runtime em até 60 segundos.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
      setConfirmRemoveOpen(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Configurações do AI Gateway"
        description="Gerencie flags globais e a chave da Anthropic. Alterações se aplicam sem restart."
      />

      <ScreenGuide
        title="O que mexer aqui"
        description="Esta tela controla a IA de texto usada para leitura de briefing e automações internas."
        items={[
          "Ligue o AI Gateway para permitir chamadas reais de IA.",
          "Ligue extração de briefing se quiser preencher dados com IA.",
          "Cole a chave Anthropic quando usar Claude.",
          "Salve e aguarde até 60 segundos para aplicar.",
        ]}
        aside={<p>OpenAI e Gemini ficam na tela Chaves OpenAI/Gemini.</p>}
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
                <div className="text-base font-semibold text-foreground">Flags globais</div>
                <div className="text-xs text-muted-foreground">Controlam se a IA está ativa em toda a plataforma.</div>
              </div>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <label className="flex items-center gap-3 text-sm text-foreground">
                <Switch checked={gatewayEnabled} onCheckedChange={setGatewayEnabled} />
                <span>
                  <span className="font-medium">AI Gateway ligado</span>
                  <span className="ml-1 text-muted-foreground">— quando desligado, todas as chamadas de IA voltam para o fallback determinístico.</span>
                </span>
              </label>
              <label className="flex items-center gap-3 text-sm text-foreground">
                <Switch checked={briefingEnabled} onCheckedChange={setBriefingEnabled} disabled={!gatewayEnabled} />
                <span>
                  <span className="font-medium">Extração de briefing por IA</span>
                  <span className="ml-1 text-muted-foreground">— usa IA para preencher campos de briefing a partir dos dados da produção.</span>
                </span>
              </label>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <div className="text-base font-semibold text-foreground">Anthropic (Claude)</div>
                <div className="text-xs text-muted-foreground">A chave é guardada criptografada (AES-256-GCM). Só os últimos 4 caracteres são exibidos.</div>
              </div>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <div className="text-sm">
                <div className="text-muted-foreground">API key atual</div>
                <div className="mt-1 font-mono text-foreground">
                  {settings?.hasAnthropicApiKey
                    ? `sk-ant-…${settings.anthropicApiKeyLast4}`
                    : <span className="text-destructive">Nenhuma chave configurada</span>}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="anthropic-key">
                  {settings?.hasAnthropicApiKey ? "Substituir por nova chave" : "Colar a chave"}
                </Label>
                <Input
                  id="anthropic-key"
                  type="password"
                  autoComplete="off"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-ant-api03-..."
                  disabled={removeKey}
                  className="font-mono"
                />
                <span className="text-xs text-muted-foreground">Deixe em branco para manter a chave atual.</span>
              </div>

              {settings?.hasAnthropicApiKey && (
                <label className="flex items-center gap-3 text-sm text-destructive">
                  <Switch checked={removeKey} onCheckedChange={setRemoveKey} />
                  Remover chave atual (o Gateway ficará &quot;não configurado&quot; até nova chave)
                </label>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="briefing-model">Modelo padrão (briefing_field_extraction)</Label>
                <Input id="briefing-model" type="text" value={model} onChange={(e) => setModel(e.target.value)} className="font-mono" />
                <span className="text-xs text-muted-foreground">Precisa estar registrado no Model Registry (ex.: <code>claude-haiku-4-5-20251001</code>).</span>
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
              {saving ? "Salvando..." : "Salvar configurações"}
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
        title="Remover a chave da Anthropic?"
        description="O AI Gateway ficará sem chave configurada até que uma nova seja cadastrada — chamadas de IA que dependem de Claude passam a usar o fallback determinístico."
        confirmLabel="Remover chave"
        variant="danger"
        busy={saving}
        onConfirm={() => void performSave()}
        onCancel={() => setConfirmRemoveOpen(false)}
      />
    </div>
  );
}
