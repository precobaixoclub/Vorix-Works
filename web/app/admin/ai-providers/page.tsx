"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import {
  fetchAiOperationTypes,
  fetchAiProviders,
  fetchAiProvidersFinance,
  setAiProviderApiKey,
  setAiProviderStatus,
  updateAiOperationType,
  type AiOperationType,
  type AiProviderOverview,
  type AiProvidersFinanceSummary,
} from "@/features/platform-admin/ai-providers-api";
import { fetchPlatformAiSettings, updatePlatformAiSettings } from "@/features/platform-admin/ai-settings-api";

const CAPABILITY_LABELS: Record<string, string> = {
  text_generation: "Texto",
  image_generation: "Imagem",
  video_generation: "Vídeo",
};

/**
 * Módulo admin "Provedores de IA" (`/admin/ai-providers`) — Sprint 26. Um único lugar para:
 * cadastrar/ligar/desligar cada provedor (OpenAI para imagem, Google Gemini/Veo para vídeo;
 * Anthropic aparece como card informativo, gerido em `/admin/settings`), editar quanto cada
 * operação custa em crédito Vorix, e ver gasto/receita/lucro por provedor no mês corrente.
 */
export default function AdminAiProvidersPage() {
  const [providers, setProviders] = useState<AiProviderOverview[] | undefined>();
  const [operationTypes, setOperationTypes] = useState<AiOperationType[] | undefined>();
  const [finance, setFinance] = useState<AiProvidersFinanceSummary | undefined>();
  const [creditUnitValueUsd, setCreditUnitValueUsd] = useState("0.05");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | undefined>();
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [providersData, operationTypesData, financeData, aiSettings] = await Promise.all([
        fetchAiProviders(),
        fetchAiOperationTypes(),
        fetchAiProvidersFinance(),
        fetchPlatformAiSettings(),
      ]);
      setProviders(providersData);
      setOperationTypes(operationTypesData);
      setFinance(financeData);
      setCreditUnitValueUsd(String(aiSettings.creditUnitValueUsd));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar Provedores de IA.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusyKey(key);
    setMessage(undefined);
    try {
      await action();
      await load();
      setMessage({ kind: "ok", text: "Alteração aplicada." });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : "Falhou." });
    } finally {
      setBusyKey(undefined);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-center gap-2 py-14 text-sm text-ink-muted">
          <Spinner className="h-4 w-4" /> Carregando…
        </div>
      </div>
    );
  }

  if (error || !providers || !operationTypes || !finance) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <EmptyState title="Não foi possível carregar Provedores de IA" description={error ?? "Tente novamente."} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        title="Provedores de IA"
        description="Cadastre cada provedor (chave, status), defina quanto cada operação custa em crédito Vorix, e acompanhe gasto/receita/lucro por provedor."
      />

      {message ? (
        <div className={`mb-4 rounded-lg border px-4 py-2 text-sm ${message.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {message.text}
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-ink">Anthropic (Claude)</div>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-ink-muted">
              Usado para texto (chat, extração de briefing). Chave e modelo padrão são gerenciados em{" "}
              <Link href="/admin/settings" className="text-accent hover:underline">/admin/settings</Link>.
            </p>
          </CardBody>
        </Card>

        {providers.filter((p) => !p.externallyManaged).map((provider) => (
          <Card key={provider.code}>
            <CardHeader>
              <div>
                <div className="text-base font-semibold text-ink">{provider.displayName}</div>
                <div className="text-xs text-ink-muted">
                  {provider.capabilities.map((c) => CAPABILITY_LABELS[c] ?? c).join(", ")} · {provider.health.ok ? "Saudável" : provider.health.safeMessage ?? "Indisponível"}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={provider.status === "active"}
                  disabled={busyKey === `status-${provider.code}`}
                  onChange={(e) => run(`status-${provider.code}`, () => setAiProviderStatus(provider.code, e.target.checked ? "active" : "disabled"))}
                  className="h-4 w-4"
                />
                Habilitado
              </label>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <div className="text-sm">
                <div className="text-ink-muted">API key</div>
                <div className="mt-1 font-mono text-ink">
                  {provider.hasSecretConfigured ? "Configurada" : <span className="text-error">Nenhuma chave configurada</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="Colar nova chave"
                  value={apiKeyInputs[provider.code] ?? ""}
                  onChange={(e) => setApiKeyInputs((prev) => ({ ...prev, [provider.code]: e.target.value }))}
                  className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!apiKeyInputs[provider.code]?.trim() || busyKey === `key-${provider.code}`}
                  onClick={() => run(`key-${provider.code}`, async () => {
                    await setAiProviderApiKey(provider.code, apiKeyInputs[provider.code].trim());
                    setApiKeyInputs((prev) => ({ ...prev, [provider.code]: "" }));
                  })}
                  className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent/90 disabled:opacity-50"
                >
                  Salvar
                </button>
              </div>
              {provider.models.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                      <th className="py-1">Modelo</th>
                      <th className="py-1">Ativo</th>
                      <th className="py-1 text-right">Preço real (não exibido ao cliente)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {provider.models.map((model) => (
                      <tr key={model.id} className="border-t border-border/60">
                        <td className="py-1.5 font-mono text-ink">{model.modelId}</td>
                        <td className="py-1.5">{model.active ? "Sim" : "Não"}</td>
                        <td className="py-1.5 text-right text-ink-muted">{formatPricing(model.pricing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </CardBody>
          </Card>
        ))}

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-ink">Custo em crédito por operação</div>
          </CardHeader>
          <CardBody>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th className="py-1">Operação</th>
                  <th className="py-1">Provedor padrão</th>
                  <th className="py-1 text-right">Créditos</th>
                  <th className="py-1 text-right">Ativo</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {operationTypes.map((op) => (
                  <OperationTypeRow key={op.code} operationType={op} busy={busyKey === `op-${op.code}`} onSave={(patch) => run(`op-${op.code}`, () => updateAiOperationType(op.code, patch))} />
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-ink">Valor de referência do crédito</div>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              Usado só para estimar receita/lucro no painel abaixo — não é o preço real cobrado do cliente (ainda não existe gateway de pagamento).
            </p>
            <div className="flex gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-muted">US$</span>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={creditUnitValueUsd}
                  onChange={(e) => setCreditUnitValueUsd(e.target.value)}
                  className="w-32 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
                <span className="text-sm text-ink-muted">por crédito</span>
              </div>
              <button
                type="button"
                disabled={busyKey === "credit-unit-value"}
                onClick={() => run("credit-unit-value", () => updatePlatformAiSettings({ creditUnitValueUsd: Number(creditUnitValueUsd) }))}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent/90 disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <div className="text-base font-semibold text-ink">Financeiro por provedor (mês corrente)</div>
              <div className="text-xs text-ink-muted">Custo real pago ao provedor vs. receita estimada (créditos × valor de referência) vs. lucro.</div>
            </div>
          </CardHeader>
          <CardBody>
            {finance.byProvider.length === 0 ? (
              <EmptyState title="Sem gerações neste período" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                    <th className="py-1">Provedor</th>
                    <th className="py-1 text-right">Gerações</th>
                    <th className="py-1 text-right">Créditos</th>
                    <th className="py-1 text-right">Custo real</th>
                    <th className="py-1 text-right">Receita estimada</th>
                    <th className="py-1 text-right">Lucro</th>
                  </tr>
                </thead>
                <tbody>
                  {finance.byProvider.map((row) => (
                    <tr key={row.providerCode} className="border-t border-border/60">
                      <td className="py-1.5 text-ink">{row.providerCode}</td>
                      <td className="py-1.5 text-right text-ink-muted">{row.totalGenerations}</td>
                      <td className="py-1.5 text-right text-ink-muted">{row.totalCreditsConsumed}</td>
                      <td className="py-1.5 text-right text-ink-muted">{formatUsd(row.totalProviderCostUsd)}</td>
                      <td className="py-1.5 text-right text-ink-muted">{formatUsd(row.totalEstimatedRevenueUsd)}</td>
                      <td className="py-1.5 text-right font-semibold text-emerald-700">{formatUsd(row.totalProfitUsd)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border font-semibold">
                    <td className="py-1.5 text-ink">Total</td>
                    <td className="py-1.5 text-right text-ink">{finance.totals.generations}</td>
                    <td className="py-1.5 text-right text-ink">{finance.totals.creditsConsumed}</td>
                    <td className="py-1.5 text-right text-ink">{formatUsd(finance.totals.providerCostUsd)}</td>
                    <td className="py-1.5 text-right text-ink">{formatUsd(finance.totals.estimatedRevenueUsd)}</td>
                    <td className="py-1.5 text-right text-emerald-700">{formatUsd(finance.totals.profitUsd)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function OperationTypeRow({
  operationType,
  busy,
  onSave,
}: {
  operationType: AiOperationType;
  busy: boolean;
  onSave: (patch: { creditsCost?: number; active?: boolean }) => Promise<void>;
}) {
  const [creditsCost, setCreditsCost] = useState(String(operationType.creditsCost));

  return (
    <tr className="border-t border-border/60">
      <td className="py-1.5">
        <div className="text-ink">{operationType.label}</div>
        <div className="font-mono text-xs text-ink-muted">{operationType.code}</div>
      </td>
      <td className="py-1.5 text-ink-muted">{operationType.defaultProviderCode ?? "—"}</td>
      <td className="py-1.5 text-right">
        <input
          type="number"
          min="0"
          value={creditsCost}
          onChange={(e) => setCreditsCost(e.target.value)}
          className="w-20 rounded-md border border-border bg-surface-raised px-2 py-1 text-right text-sm text-ink focus:border-accent focus:outline-none"
        />
      </td>
      <td className="py-1.5 text-right">
        <input
          type="checkbox"
          checked={operationType.active}
          onChange={(e) => void onSave({ active: e.target.checked })}
          className="h-4 w-4"
        />
      </td>
      <td className="py-1.5 text-right">
        <button
          type="button"
          disabled={busy || Number(creditsCost) === operationType.creditsCost}
          onClick={() => void onSave({ creditsCost: Number(creditsCost) })}
          className="rounded-md border border-border px-3 py-1 text-xs text-ink hover:bg-surface-sunken disabled:opacity-50"
        >
          Salvar
        </button>
      </td>
    </tr>
  );
}

function formatPricing(pricing: { kind: string } & Record<string, unknown>): string {
  if (pricing.kind === "per_image") return `US$ ${pricing.usdPerImage} / imagem`;
  if (pricing.kind === "per_video_second") return `US$ ${pricing.usdPerSecond} / segundo`;
  if (pricing.kind === "tokens") return `US$ ${pricing.inputPerMillionUsd}/${pricing.outputPerMillionUsd} por milhão (in/out)`;
  return "—";
}

function formatUsd(value: number): string {
  return `US$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
