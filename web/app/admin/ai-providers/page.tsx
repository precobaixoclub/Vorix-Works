"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Input } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { Switch } from "@/components/ui/switch";
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
const CAPABILITY_LABELS: Record<string, string> = {
  text_generation: "Texto",
  image_generation: "Imagem",
  video_generation: "Vídeo",
};

/**
 * Módulo admin "Chaves OpenAI/Gemini" (`/admin/ai-providers`). Mantém as credenciais de geração
 * em um lugar claro: OpenAI para imagem/texto quando habilitado, Google Gemini/Veo para vídeo, e
 * Anthropic em `/admin/settings`. Abaixo ficam custos e financeiro para operação da plataforma.
 */
export default function AdminAiProvidersPage() {
  const [providers, setProviders] = useState<AiProviderOverview[] | undefined>();
  const [operationTypes, setOperationTypes] = useState<AiOperationType[] | undefined>();
  const [finance, setFinance] = useState<AiProvidersFinanceSummary | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | undefined>();
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [providersData, operationTypesData, financeData] = await Promise.all([
        fetchAiProviders(),
        fetchAiOperationTypes(),
        fetchAiProvidersFinance(),
      ]);
      setProviders(providersData);
      setOperationTypes(operationTypesData);
      setFinance(financeData);
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
      <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
        <div className="flex items-center gap-2 py-14 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Carregando…
        </div>
      </div>
    );
  }

  if (error || !providers || !operationTypes || !finance) {
    return (
      <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
        <EmptyState title="Não foi possível carregar Provedores de IA" description={error ?? "Tente novamente."} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Chaves OpenAI/Gemini"
        description="Configure as chaves usadas pela linha de produção para gerar imagem, texto e vídeo. Sem chave ativa, a geração cai para fallback ou fica indisponível."
      />

      <ScreenGuide
        title="Como configurar"
        description="Cole a chave no provedor correto e marque Ativo para a linha de produção poder usar."
        items={[
          "OpenAI habilita geração de imagem e recursos de texto configurados.",
          "Gemini/Veo habilita geração de vídeo.",
          "Anthropic fica em Configurações.",
          "Depois de salvar, confira o selo com chave e o status Ativo.",
        ]}
        aside={<p>Use uma chave de produção da conta correta. A chave salva não aparece inteira novamente por segurança.</p>}
      />

      {message ? (
        <div className={`mb-4 rounded-lg border px-4 py-2 text-sm ${message.kind === "ok" ? "border-primary/40 bg-primary/10 text-primary" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
          {message.text}
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {providers.map((provider) => (
            <ProviderSetupCard
              key={provider.code}
              provider={provider}
              inputValue={apiKeyInputs[provider.code] ?? ""}
              busy={busyKey === `key-${provider.code}` || busyKey === `status-${provider.code}`}
              onInput={(value) => setApiKeyInputs((prev) => ({ ...prev, [provider.code]: value }))}
              onSaveKey={() => run(`key-${provider.code}`, async () => {
                await setAiProviderApiKey(provider.code, apiKeyInputs[provider.code].trim());
                setApiKeyInputs((prev) => ({ ...prev, [provider.code]: "" }));
              })}
              onToggle={(enabled) => run(`status-${provider.code}`, () => setAiProviderStatus(provider.code, enabled ? "active" : "disabled"))}
            />
          ))}
        </div>

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-foreground">Modelos e custos reais</div>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-muted-foreground">
              Esta seção é operacional. As chaves principais ficam nos cards acima; aqui você confere modelos ativos e preço real de cada provedor.
            </p>
          </CardBody>
        </Card>

        {providers.filter((p) => !p.externallyManaged && p.models.length > 0).map((provider) => (
          <Card key={provider.code}>
            <CardHeader>
              <div>
                <div className="text-base font-semibold text-foreground">{provider.displayName}</div>
                <div className="text-xs text-muted-foreground">
                  {provider.capabilities.map((c) => CAPABILITY_LABELS[c] ?? c).join(", ")} · {provider.health.ok ? "Saudável" : provider.health.safeMessage ?? "Indisponível"}
                </div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${provider.status === "active" ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                {provider.status === "active" ? "Ativo" : "Desativado"}
              </span>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-1">Modelo</th>
                      <th className="py-1">Ativo</th>
                      <th className="py-1 text-right">Preço real</th>
                    </tr>
                  </thead>
                  <tbody>
                    {provider.models.map((model) => (
                      <tr key={model.id} className="border-t border-border/60">
                        <td className="py-1.5 font-mono text-foreground">{model.modelId}</td>
                        <td className="py-1.5">{model.active ? "Sim" : "Não"}</td>
                        <td className="py-1.5 text-right text-muted-foreground">{formatPricing(model.pricing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        ))}

        <Card>
          <CardHeader>
            <div className="text-base font-semibold text-foreground">Custo em crédito por operação</div>
          </CardHeader>
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
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
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <div className="text-base font-semibold text-foreground">Percentual de lucro por cliente</div>
              <div className="text-xs text-muted-foreground">
                A receita estimada de cada geração é <code>custo real × (1 + % de lucro)</code>, configurado por conta em{" "}
                <Link href="/admin/tenants" className="text-primary hover:underline">/admin/tenants/:id</Link>. Uma conta interna própria pode ficar em 0% (fica só no custo).
              </div>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <div className="text-base font-semibold text-foreground">Financeiro por provedor (mês corrente)</div>
              <div className="text-xs text-muted-foreground">Custo real pago ao provedor vs. receita estimada (créditos × valor de referência) vs. lucro.</div>
            </div>
          </CardHeader>
          <CardBody>
            {finance.byProvider.length === 0 ? (
              <EmptyState title="Sem gerações neste período" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
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
                        <td className="py-1.5 text-foreground">{row.providerCode}</td>
                        <td className="py-1.5 text-right text-muted-foreground tabular-nums">{row.totalGenerations}</td>
                        <td className="py-1.5 text-right text-muted-foreground tabular-nums">{row.totalCreditsConsumed}</td>
                        <td className="py-1.5 text-right text-muted-foreground tabular-nums">{formatUsd(row.totalProviderCostUsd)}</td>
                        <td className="py-1.5 text-right text-muted-foreground tabular-nums">{formatUsd(row.totalEstimatedRevenueUsd)}</td>
                        <td className="py-1.5 text-right font-semibold text-emerald-600 tabular-nums">{formatUsd(row.totalProfitUsd)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-border font-semibold">
                      <td className="py-1.5 text-foreground">Total</td>
                      <td className="py-1.5 text-right text-foreground tabular-nums">{finance.totals.generations}</td>
                      <td className="py-1.5 text-right text-foreground tabular-nums">{finance.totals.creditsConsumed}</td>
                      <td className="py-1.5 text-right text-foreground tabular-nums">{formatUsd(finance.totals.providerCostUsd)}</td>
                      <td className="py-1.5 text-right text-foreground tabular-nums">{formatUsd(finance.totals.estimatedRevenueUsd)}</td>
                      <td className="py-1.5 text-right text-emerald-600 tabular-nums">{formatUsd(finance.totals.profitUsd)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ProviderSetupCard({
  provider,
  inputValue,
  busy,
  onInput,
  onSaveKey,
  onToggle,
}: {
  provider: AiProviderOverview;
  inputValue: string;
  busy: boolean;
  onInput: (value: string) => void;
  onSaveKey: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const providerHint: Record<string, string> = {
    openai: "Cole uma chave da OpenAI Platform para geração de imagens e recursos de texto configurados.",
    google: "Cole a chave do Google AI Studio/Gemini para Gemini e Veo.",
    anthropic: "Claude é configurado na tela Configurações (Anthropic).",
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-foreground">{provider.displayName}</p>
          <p className="mt-1 text-xs text-muted-foreground">{provider.capabilities.map((c) => CAPABILITY_LABELS[c] ?? c).join(", ")}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${provider.hasSecretConfigured ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"}`}>
          {provider.hasSecretConfigured ? "com chave" : "sem chave"}
        </span>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{providerHint[provider.code] ?? "Configure a chave deste provedor."}</p>
      {provider.externallyManaged ? (
        <Link href="/admin/settings" className="inline-flex min-h-10 items-center rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted">
          Abrir Anthropic
        </Link>
      ) : (
        <div className="flex flex-col gap-3">
          <Input
            type="password"
            autoComplete="off"
            placeholder={provider.code === "openai" ? "sk-..." : "AIza..."}
            value={inputValue}
            onChange={(event) => onInput(event.target.value)}
            className="font-mono"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button type="button" disabled={!inputValue.trim() || busy} onClick={onSaveKey} className="flex-1">
              Salvar chave
            </Button>
            <label className="flex min-h-10 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground">
              <Switch checked={provider.status === "active"} disabled={busy} onCheckedChange={onToggle} />
              Ativo
            </label>
          </div>
        </div>
      )}
    </Card>
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
        <div className="text-foreground">{operationType.label}</div>
        <div className="font-mono text-xs text-muted-foreground">{operationType.code}</div>
      </td>
      <td className="py-1.5 text-muted-foreground">{operationType.defaultProviderCode ?? "—"}</td>
      <td className="py-1.5 text-right">
        <Input
          type="number"
          min="0"
          value={creditsCost}
          onChange={(e) => setCreditsCost(e.target.value)}
          className="w-20 text-right tabular-nums"
        />
      </td>
      <td className="py-1.5 text-right">
        <Switch checked={operationType.active} onCheckedChange={(checked) => void onSave({ active: checked })} />
      </td>
      <td className="py-1.5 text-right">
        <Button
          type="button"
          variant="secondary"
          disabled={busy || Number(creditsCost) === operationType.creditsCost}
          onClick={() => void onSave({ creditsCost: Number(creditsCost) })}
          className="h-7 px-3 text-xs"
        >
          Salvar
        </Button>
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
