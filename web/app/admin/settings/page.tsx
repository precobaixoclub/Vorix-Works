"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
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

  const onSave = async (event: React.FormEvent) => {
    event.preventDefault();
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
        <div className="flex items-center gap-2 py-14 text-sm text-ink-muted">
          <Spinner className="h-4 w-4" /> Carregando…
        </div>
      ) : (
        <form onSubmit={onSave} className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <div>
                <div className="text-base font-semibold text-ink">Flags globais</div>
                <div className="text-xs text-ink-muted">Controlam se a IA está ativa em toda a plataforma.</div>
              </div>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <label className="flex items-center gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={gatewayEnabled}
                  onChange={(e) => setGatewayEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                <span>
                  <span className="font-medium">AI Gateway ligado</span>
                  <span className="ml-1 text-ink-muted">— quando desligado, todas as chamadas de IA voltam para o fallback determinístico.</span>
                </span>
              </label>
              <label className="flex items-center gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={briefingEnabled}
                  onChange={(e) => setBriefingEnabled(e.target.checked)}
                  disabled={!gatewayEnabled}
                  className="h-4 w-4"
                />
                <span>
                  <span className="font-medium">Extração de briefing por IA</span>
                  <span className="ml-1 text-ink-muted">— usa IA para preencher campos de briefing a partir dos dados da produção.</span>
                </span>
              </label>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <div className="text-base font-semibold text-ink">Anthropic (Claude)</div>
                <div className="text-xs text-ink-muted">A chave é guardada criptografada (AES-256-GCM). Só os últimos 4 caracteres são exibidos.</div>
              </div>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <div className="text-sm">
                <div className="text-ink-muted">API key atual</div>
                <div className="mt-1 font-mono text-ink">
                  {settings?.hasAnthropicApiKey
                    ? `sk-ant-…${settings.anthropicApiKeyLast4}`
                    : <span className="text-error">Nenhuma chave configurada</span>}
                </div>
              </div>

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink">
                  {settings?.hasAnthropicApiKey ? "Substituir por nova chave" : "Colar a chave"}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-ant-api03-..."
                  disabled={removeKey}
                  className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
                />
                <span className="text-xs text-ink-muted">Deixe em branco para manter a chave atual.</span>
              </label>

              {settings?.hasAnthropicApiKey && (
                <label className="flex items-center gap-2 text-sm text-error">
                  <input
                    type="checkbox"
                    checked={removeKey}
                    onChange={(e) => setRemoveKey(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Remover chave atual (o Gateway ficará "não configurado" até nova chave)
                </label>
              )}

              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink">Modelo padrão (briefing_field_extraction)</span>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-sm text-ink focus:border-accent focus:outline-none"
                />
                <span className="text-xs text-ink-muted">Precisa estar registrado no Model Registry (ex.: <code>claude-haiku-4-5-20251001</code>).</span>
              </label>
            </CardBody>
          </Card>

          {error && <div className="rounded-md border border-error/40 bg-error/10 px-4 py-2 text-sm text-error">{error}</div>}
          {success && <div className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm text-accent">{success}</div>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={saving}
              className="rounded-md border border-border px-4 py-2 text-sm text-ink hover:bg-surface-sunken disabled:opacity-50"
            >
              Recarregar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar configurações"}
            </button>
          </div>

          {settings?.updatedAt && (
            <div className="text-xs text-ink-muted">
              Última atualização em {new Date(settings.updatedAt).toLocaleString("pt-BR")}
              {settings.updatedBy && ` por ${settings.updatedBy}`}.
            </div>
          )}
        </form>
      )}
    </div>
  );
}
