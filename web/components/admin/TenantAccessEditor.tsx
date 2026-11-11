"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { Input } from "@/components/Field";
import { ErrorState } from "@/components/ErrorState";
import { GuardedButton } from "@/components/GuardedButton";
import { Switch } from "@/components/ui/switch";
import { accessLabels, describeChange, features, quota, resources, selectClass, type AccessMode, type Contract, type Controls, type Feature, type Resource, type TenantSolution } from "./tenant-contract-model";

const GIB = 1024 ** 3;
/** Limites padrão ao liberar o Meetings manualmente (1 gravação simultânea, 600 min/mês, 90 dias, 20 GB). */
const MEETINGS_DEFAULT_LIMITS = { maxConcurrentRecordings: 1, monthlyRecordingMinutes: 600, meetingRetentionDays: 90, maxStorageBytes: 20 * GIB };
type MeetingsLimitKey = keyof typeof MEETINGS_DEFAULT_LIMITS;
const meetingsFields: { key: MeetingsLimitKey; label: string; scale: number }[] = [
  { key: "maxConcurrentRecordings", label: "Gravações simultâneas", scale: 1 },
  { key: "monthlyRecordingMinutes", label: "Minutos de gravação por mês", scale: 1 },
  { key: "meetingRetentionDays", label: "Retenção das gravações (dias)", scale: 1 },
  { key: "maxStorageBytes", label: "Armazenamento (GB)", scale: GIB },
];

type SolutionDraft = { enabled: boolean; limits?: Record<string, number> };
type Draft = { controls: Controls; solutions: Record<string, SolutionDraft> };

function solutionBaseline(solution: TenantSolution): SolutionDraft {
  const enabled = solution.entitlement?.enabled ?? solution.enabled;
  return solution.key === "meetings" ? { enabled, limits: { ...MEETINGS_DEFAULT_LIMITS, ...solution.entitlement?.limits } } : { enabled };
}
function initialDraft(data: Contract, solutions: TenantSolution[]): Draft {
  return {
    controls: structuredClone(data.controls),
    solutions: Object.fromEntries(solutions.map(solution => [solution.key, solutionBaseline(solution)])),
  };
}
const normalizeControls = (controls: Controls): Controls => ({ ...controls, displayName: controls.displayName?.trim() || undefined });
function solutionChanges(solution: TenantSolution, draft: SolutionDraft) {
  const base = solutionBaseline(solution); const lines: string[] = [];
  if (base.enabled !== draft.enabled) lines.push(`${solution.name}: ${base.enabled ? "liberado" : "bloqueado"} → ${draft.enabled ? "liberado" : "bloqueado"}`);
  for (const field of meetingsFields) {
    const before = base.limits?.[field.key]; const after = draft.limits?.[field.key];
    if (before !== after) lines.push(`${solution.name} · ${field.label}: ${formatScaled(before, field.scale)} → ${formatScaled(after, field.scale)}`);
  }
  return lines;
}
const formatScaled = (value: number | undefined, scale: number) => value === undefined || Number.isNaN(value) ? "—" : (value / scale).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const sourceLabel = (source?: string) => source === "subscription" ? "assinatura" : source === "manual" ? "liberação manual" : source === "internal" ? "conta interna" : "padrão da plataforma";

/**
 * Aba "Acessos e limites": UM rascunho, UM motivo e UM botão para tudo o que define o que a conta
 * pode usar (acesso, soluções, recursos do plano, limites de uso e limites do Meetings). Ao salvar,
 * só o que mudou é enviado: controles da conta (uma chamada versionada) e cada solução alterada.
 */
export function TenantAccessEditor({ data, path, refresh }: { data: Contract; path: string; refresh: () => Promise<void> }) {
  const { data: solutions, error, mutate } = useSWR(["admin-tenant-solutions", data.controls.tenantId], () => apiClient.get<{ solutions: TenantSolution[] }>(`${path}/solutions`));
  const [generation, setGeneration] = useState(0);
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!solutions) return <p className="py-8 text-sm text-muted-foreground">Carregando soluções da conta…</p>;
  const reload = async (resetDraft: boolean) => { await Promise.all([refresh(), mutate()]); if (resetDraft) setGeneration(value => value + 1); };
  return <AccessForm key={generation} data={data} solutions={solutions.solutions} path={path} reload={reload} />;
}

function AccessForm({ data, solutions, path, reload }: { data: Contract; solutions: TenantSolution[]; path: string; reload: (resetDraft: boolean) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(data, solutions));
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const controls = draft.controls;
  const setControls = (patch: Partial<Controls>) => setDraft(current => ({ ...current, controls: { ...current.controls, ...patch } }));
  const setSolution = (key: string, patch: Partial<SolutionDraft>) => setDraft(current => ({ ...current, solutions: { ...current.solutions, [key]: { ...current.solutions[key], ...patch } } }));

  const controlChanges = describeChange(data.controls, normalizeControls(controls));
  const changedSolutions = solutions.map(solution => ({ solution, lines: solutionChanges(solution, draft.solutions[solution.key]) })).filter(item => item.lines.length);
  const changes = [...controlChanges, ...changedSolutions.flatMap(item => item.lines)];
  const invalidNumber = Object.values(controls.limits).some(value => typeof value === "number" && Number.isNaN(value))
    || Object.values(draft.solutions).some(item => Object.values(item.limits ?? {}).some(value => Number.isNaN(value)));
  const blockedReason = !changes.length ? "Nenhuma alteração para salvar."
    : invalidNumber ? "Preencha todos os limites definidos."
    : reason.trim().length < 3 ? "Informe o motivo da alteração (mínimo 3 caracteres)." : "";

  async function save() {
    if (blockedReason) return;
    setBusy(true); setError("");
    let savedSomething = false;
    try {
      if (controlChanges.length) {
        const next = normalizeControls(controls);
        await apiClient.put(`${path}/controls`, { displayName: next.displayName, accessMode: next.accessMode, capabilities: next.capabilities, limits: next.limits, expectedVersion: data.controls.version, reason: reason.trim() });
        savedSomething = true;
      }
      for (const { solution } of changedSolutions) {
        const item = draft.solutions[solution.key];
        await apiClient.put(`${path}/solutions/${encodeURIComponent(solution.key)}`, { enabled: item.enabled, source: solution.commercialAvailability === "internal" ? "internal" : "manual", reason: reason.trim(), ...(item.limits ? { limits: item.limits } : {}) });
        savedSomething = true;
      }
      toast.success("Alterações salvas", { description: "O acesso da conta é atualizado em até 1 segundo." });
      await reload(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível salvar.";
      // Parte já gravada: recarrega para o resumo mostrar só o que ainda falta, mantendo o rascunho.
      if (savedSomething) { await reload(false).catch(() => undefined); setError(`${message} Parte das alterações já foi salva; o resumo mostra o que ainda falta.`); }
      else setError(message);
    } finally { setBusy(false); }
  }

  return <Card>
    <CardHeader className="block space-y-1">
      <h2 className="font-semibold">Acessos e limites da conta</h2>
      <p className="text-sm text-muted-foreground">Tudo o que esta conta pode usar, em um só lugar. Concessões manuais alteram o acesso sem criar cobranças nem mudar o valor contratado.</p>
    </CardHeader>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="min-w-0">
        <CardBody className="space-y-8">
          <Section title="Conta">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm">Nome da conta<Input value={controls.displayName ?? ""} maxLength={120} placeholder={controls.tenantId} onChange={event => setControls({ displayName: event.target.value })} /></label>
              <label className="space-y-1 text-sm">Acesso à plataforma<select className={selectClass} value={controls.accessMode} onChange={event => setControls({ accessMode: event.target.value as AccessMode })}>{Object.entries(accessLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            </div>
          </Section>

          <Section title="Soluções" description="Ligue ou desligue cada produto para esta conta.">
            <div className="space-y-2">{solutions.map(solution => {
              const item = draft.solutions[solution.key];
              return <div key={solution.key} className="rounded-lg border border-border/60 px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{solution.name}</span>
                    {solution.commercialAvailability === "internal" && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">acesso interno</span>}
                    {solutionChanges(solution, item).length > 0 && <Changed />}
                    <span className="block text-xs text-muted-foreground">Origem: {sourceLabel(solution.entitlement?.source)} · Acesso hoje: {solution.enabled ? "liberado" : "bloqueado"}</span>
                  </span>
                  <Switch checked={item.enabled} onCheckedChange={enabled => setSolution(solution.key, { enabled })} aria-label={solution.name} />
                </div>
                {item.limits && item.enabled && <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">{meetingsFields.map(field => {
                  const value = item.limits![field.key];
                  return <label key={field.key} className="space-y-1 text-xs">{field.label}<Input required type="number" min={0} step={field.scale === 1 ? 1 : "any"} className="tabular-nums" value={Number.isNaN(value) ? "" : value / field.scale} onChange={event => setSolution(solution.key, { limits: { ...item.limits, [field.key]: event.target.value === "" ? Number.NaN : Math.round(Number(event.target.value) * field.scale) } })} /></label>;
                })}</div>}
              </div>;
            })}</div>
          </Section>

          <Section title="Recursos do plano">
            <div className="divide-y divide-border">{(Object.entries(features) as [Feature, string][]).map(([key, label]) => {
              const value = controls.capabilities[key];
              return <div key={key} className="grid items-center gap-2 py-3 sm:grid-cols-2">
                <label htmlFor={`feature-${key}`} className="text-sm">{label}{value !== data.controls.capabilities[key] && <Changed />}<span className="block text-xs text-muted-foreground">Contrato: {data.contract.capabilities[key] ? "incluído" : "não incluído"} · Hoje: {data.effective.capabilities[key] && !data.effective.readOnly ? "liberado" : "bloqueado"}</span></label>
                <select id={`feature-${key}`} className={selectClass} value={value === undefined ? "inherit" : value ? "enabled" : "blocked"} onChange={event => { const capabilities = { ...controls.capabilities }; if (event.target.value === "inherit") delete capabilities[key]; else capabilities[key] = event.target.value === "enabled"; setControls({ capabilities }); }}>
                  <option value="inherit">Seguir contrato ({data.contract.capabilities[key] ? "incluído" : "não incluído"})</option><option value="enabled">Liberar manualmente</option><option value="blocked">Bloquear</option>
                </select>
              </div>;
            })}</div>
          </Section>

          <Section title="Limites de uso" description="Reduzir um limite preserva os dados existentes e impede novas inclusões acima do teto. Apenas espaços ativos ocupam vagas.">
            <div className="divide-y divide-border">{(Object.entries(resources) as [Resource, string][]).map(([key, label]) => {
              const value = controls.limits[key]; const used = data.usage[key] ?? 0;
              return <div key={key} className="grid items-center gap-2 py-3 sm:grid-cols-[1fr_1fr_8rem]">
                <label htmlFor={`limit-mode-${key}`} className="text-sm">{label}{value !== data.controls.limits[key] && <Changed />}<span className="block text-xs text-muted-foreground tabular-nums">Uso: {quota(used)} · Contrato: {quota(data.contract.limits[key])} · Hoje: {quota(data.effective.limits[key])}</span>
                  {typeof value === "number" && !Number.isNaN(value) && value < used && <span className="block text-xs text-amber-700 dark:text-amber-300">Abaixo do uso atual: novas inclusões ficarão bloqueadas.</span>}
                </label>
                <select id={`limit-mode-${key}`} className={selectClass} value={value === undefined ? "inherit" : value === null ? "unlimited" : "custom"} onChange={event => { const limits = { ...controls.limits }; const contract = data.contract.limits[key]; if (event.target.value === "inherit") delete limits[key]; else limits[key] = event.target.value === "unlimited" ? null : typeof contract === "number" ? contract : Math.max(used, 1); setControls({ limits }); }}>
                  <option value="inherit">Seguir contrato ({quota(data.contract.limits[key])})</option><option value="custom">Definir limite</option><option value="unlimited">Ilimitado</option>
                </select>
                {typeof value === "number" && <Input aria-label={`Limite de ${label}`} className="tabular-nums" type="number" min={0} max={1000000000} step={1} required value={Number.isNaN(value) ? "" : value} onChange={event => setControls({ limits: { ...controls.limits, [key]: event.target.value === "" ? Number.NaN : Number(event.target.value) } })} />}
              </div>;
            })}</div>
          </Section>
        </CardBody>

        <div className="sticky bottom-0 z-10 space-y-3 rounded-b-xl border-t border-border bg-card/95 px-5 py-4 backdrop-blur">
          {changes.length ? <details className="text-sm" open={changes.length <= 4}>
            <summary className="cursor-pointer font-medium">{changes.length === 1 ? "1 alteração pendente" : `${changes.length} alterações pendentes`}</summary>
            <ul className="mt-2 max-h-40 list-inside list-disc overflow-auto text-xs text-muted-foreground">{changes.map(line => <li key={line}>{line}</li>)}</ul>
          </details> : <p className="text-sm text-muted-foreground">Nenhuma alteração pendente.</p>}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1 space-y-1 text-sm">Motivo da alteração<Input minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Ex.: liberação comercial negociada com o cliente" /></label>
            <GuardedButton type="submit" allowed={!blockedReason} blockedReason={blockedReason}>{busy ? "Salvando…" : "Salvar alterações"}</GuardedButton>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      </fieldset>
    </form>
  </Card>;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="space-y-3"><div><h3 className="font-medium">{title}</h3>{description && <p className="text-xs text-muted-foreground">{description}</p>}</div>{children}</section>;
}
function Changed() {
  return <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">alterado</span>;
}
