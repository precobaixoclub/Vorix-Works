"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, FileBarChart2, LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AIInsightCard, AiBadge, AiLoading, VorixAiIcon } from "@/components/vorix/ai";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useCommercialMetrics } from "@/features/crm/hooks";
import { useInboxMembers, useInboxMetrics } from "@/features/inbox/hooks";
import { analyzeReport, createReportTemplate, deleteReportTemplate, draftReportTemplateWithAi, updateReportTemplate, useReportTemplates } from "@/features/reports/api";
import { buildSectionContent, SECTION_SOURCE, sectionLines } from "@/features/reports/sections";
import type { ReportAnalysis, ReportSectionContent, ReportSectionInfo, ReportSectionKey, ReportTemplateDraft, ReportTemplateItem } from "@/features/reports/types";
import { useSalesReports } from "@/features/sales/hooks";
import { ApiError } from "@/lib/api-client";
import { csvFilename, downloadCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type PeriodChoice = "last_7_days" | "last_30_days" | "this_month" | "last_month" | "last_90_days" | "custom";
const PERIOD_LABEL: Record<PeriodChoice, string> = {
  last_7_days: "Últimos 7 dias",
  last_30_days: "Últimos 30 dias",
  this_month: "Este mês",
  last_month: "Mês passado",
  last_90_days: "Últimos 90 dias",
  custom: "Personalizado",
};

/**
 * Relatórios: modelos prontos (fixos), modelos do cliente (montados à mão ou criados com IA) e
 * análise com IA do relatório calculado. Os números vêm do backend; a IA só interpreta e cada
 * destaque/risco/recomendação cita um número do próprio relatório.
 */
export default function ReportsPage() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: templates, error, isLoading, mutate } = useReportTemplates(workspace.id);
  const selectedId = searchParams.get("modelo") ?? "system:executive_summary";
  const [period, setPeriod] = useState<PeriodChoice>("last_30_days");
  const [customFrom, setCustomFrom] = useState(() => isoDate(addDays(new Date(), -29)));
  const [customTo, setCustomTo] = useState(() => isoDate(new Date()));
  const [editor, setEditor] = useState<{ mode: "new" } | { mode: "edit"; template: ReportTemplateItem } | { mode: "draft"; draft: ReportTemplateDraft; request: string } | undefined>();
  const [aiBuilderOpen, setAiBuilderOpen] = useState(false);
  const [deleting, setDeleting] = useState<ReportTemplateItem | undefined>();

  const allTemplates = useMemo(() => [...(templates?.system ?? []), ...(templates?.custom ?? [])], [templates]);
  const selected = allTemplates.find((template) => template.id === selectedId) ?? templates?.system[0];
  const select = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("modelo", id);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const range = useMemo(() => periodRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const periodLabel = period === "custom" ? `${formatDay(range.from)} a ${formatDay(range.to)}` : `${PERIOD_LABEL[period]} (${formatDay(range.from)} a ${formatDay(range.to)})`;

  return (
    <div className="mx-auto max-w-7xl px-3 py-6 sm:px-6">
      <PageHeader
        title="Relatórios"
        description="Modelos prontos e modelos seus, com exportação e análise da IA sobre os números do período."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/workspaces/${workspace.id}/results`}><Button variant="secondary">Painel de resultados</Button></Link>
            <Button variant="secondary" onClick={() => setEditor({ mode: "new" })}><Plus className="h-4 w-4" />Novo modelo</Button>
            {templates?.aiAvailable ? <Button variant="ai" onClick={() => setAiBuilderOpen(true)}><VorixAiIcon className="h-4 w-4 text-current" />Criar modelo com IA</Button> : null}
          </div>
        }
      />

      {isLoading ? <div className="flex justify-center py-16"><Spinner /></div> : null}
      {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}

      {templates && selected ? (
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <TemplateRail
            system={templates.system}
            custom={templates.custom}
            selectedId={selected.id}
            onSelect={select}
          />
          <ReportRunner
            key={`${selected.id}-${selected.sections.join(",")}`}
            workspaceId={workspace.id}
            template={selected}
            catalog={templates.catalog}
            aiAvailable={templates.aiAvailable}
            period={period}
            onPeriodChange={setPeriod}
            customFrom={customFrom}
            customTo={customTo}
            onCustomFrom={setCustomFrom}
            onCustomTo={setCustomTo}
            range={range}
            periodLabel={periodLabel}
            onEdit={selected.canEdit ? () => setEditor({ mode: "edit", template: selected }) : undefined}
            onDelete={selected.canEdit ? () => setDeleting(selected) : undefined}
          />
        </div>
      ) : null}

      {editor && templates ? (
        <TemplateEditor
          workspaceId={workspace.id}
          catalog={templates.catalog}
          initial={editor.mode === "edit" ? editor.template : editor.mode === "draft" ? { id: "", name: editor.draft.name, description: editor.draft.description, sections: editor.draft.sections } : undefined}
          draft={editor.mode === "draft" ? editor : undefined}
          onClose={() => setEditor(undefined)}
          onSaved={async (template) => {
            setEditor(undefined);
            await mutate();
            select(template.id);
          }}
        />
      ) : null}

      {aiBuilderOpen ? (
        <AiTemplateBuilder
          workspaceId={workspace.id}
          onClose={() => setAiBuilderOpen(false)}
          onDraft={(draft, request) => {
            setAiBuilderOpen(false);
            setEditor({ mode: "draft", draft, request });
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Excluir o modelo "${deleting?.name ?? ""}"?`}
        description="O modelo some para todo o workspace. Os dados dos relatórios não são afetados."
        confirmLabel="Excluir modelo"
        variant="danger"
        onCancel={() => setDeleting(undefined)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteReportTemplate(deleting.id, workspace.id);
            setDeleting(undefined);
            await mutate();
            select("system:executive_summary");
            toast.success("Modelo excluído.");
          } catch (cause) {
            toast.error("Não foi possível excluir o modelo", { description: cause instanceof Error ? cause.message : undefined });
          }
        }}
      />
    </div>
  );
}

function TemplateRail({ system, custom, selectedId, onSelect }: { system: ReportTemplateItem[]; custom: ReportTemplateItem[]; selectedId: string; onSelect: (id: string) => void }) {
  const item = (template: ReportTemplateItem) => (
    <button
      key={template.id}
      type="button"
      onClick={() => onSelect(template.id)}
      className={cn(
        "relative flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
        template.id === selectedId ? "bg-solution/10 text-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-solution" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      )}
    >
      {template.source === "ai" ? <VorixAiIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <FileBarChart2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0">
        <span className="block truncate font-medium">{template.name}</span>
        <span className="block text-[11px] text-muted-foreground">{template.sections.length} seções</span>
      </span>
    </button>
  );
  return (
    <>
      <div className="lg:hidden">
        <Select value={selectedId} onValueChange={onSelect}>
          <SelectTrigger aria-label="Modelo de relatório"><SelectValue /></SelectTrigger>
          <SelectContent>
            {system.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
            {custom.map((template) => <SelectItem key={template.id} value={template.id}>{template.name} (meu)</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <nav aria-label="Modelos de relatório" className="hidden space-y-5 lg:block">
        <div>
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-text-disabled">Modelos prontos</p>
          <div className="space-y-0.5">{system.map(item)}</div>
        </div>
        <div>
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-text-disabled">Meus modelos</p>
          {custom.length ? <div className="space-y-0.5">{custom.map(item)}</div> : <p className="px-3 text-xs text-muted-foreground">Crie um modelo com as seções que você acompanha — à mão ou descrevendo para a IA.</p>}
        </div>
      </nav>
    </>
  );
}

function ReportRunner(props: {
  workspaceId: string;
  template: ReportTemplateItem;
  catalog: ReportSectionInfo[];
  aiAvailable: boolean;
  period: PeriodChoice;
  onPeriodChange: (value: PeriodChoice) => void;
  customFrom: string;
  customTo: string;
  onCustomFrom: (value: string) => void;
  onCustomTo: (value: string) => void;
  range: { from: string; to: string };
  periodLabel: string;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { workspaceId, template, catalog, range } = props;
  const needs = new Set(template.sections.map((key) => SECTION_SOURCE[key]));
  const commercial = useCommercialMetrics(workspaceId, { dateFrom: range.from, dateTo: range.to });
  const inbox = useInboxMetrics(workspaceId, { dateFrom: range.from, dateTo: range.to, enabled: needs.has("inbox") });
  const sales = useSalesReports(workspaceId, { from: range.from, to: range.to });
  const { data: memberData } = useInboxMembers(workspaceId);
  const [analysis, setAnalysis] = useState<ReportAnalysis | undefined>();
  const [analyzing, setAnalyzing] = useState(false);
  const [focus, setFocus] = useState("");

  useEffect(() => setAnalysis(undefined), [range.from, range.to]);

  const memberName = (userId: string) => memberData?.members.find((member) => member.userId === userId)?.name ?? "Usuário removido";
  const sources = {
    commercial: needs.has("commercial") ? commercial.data : undefined,
    inbox: needs.has("inbox") ? inbox.data : undefined,
    sales: needs.has("sales") ? sales.data : undefined,
    memberName,
  };
  const loading = (needs.has("commercial") && commercial.isLoading) || (needs.has("inbox") && inbox.isLoading) || (needs.has("sales") && sales.isLoading);
  const failure = (needs.has("commercial") && commercial.error) || (needs.has("inbox") && inbox.error) || (needs.has("sales") && sales.error);
  const titleOf = (key: ReportSectionKey) => catalog.find((section) => section.key === key)?.title ?? key;
  const contents = template.sections.map((key) => ({ key, title: titleOf(key), content: buildSectionContent(key, sources) }));
  const ready = !loading && contents.every((section) => section.content !== undefined);

  function exportCsv() {
    const rows: { section: string; item: string; value: string }[] = [];
    for (const { title, content } of contents) {
      if (!content) continue;
      for (const kpi of content.kpis) rows.push({ section: title, item: kpi.label, value: kpi.value });
      if (content.table) {
        for (const row of content.table.rows) rows.push({ section: title, item: row[0] ?? "", value: content.table.columns.slice(1).map((column, index) => `${column}: ${row[index + 1]}`).join(" | ") });
      }
    }
    downloadCsv(csvFilename(`relatorio-${slug(template.name)}-${range.from}-a-${range.to}`), [
      { header: "Seção", value: (row) => row.section },
      { header: "Item", value: (row) => row.item },
      { header: "Valor", value: (row) => row.value },
    ], rows);
  }

  async function runAnalysis() {
    setAnalyzing(true);
    try {
      const sections = contents.filter((section) => section.content && !section.content.unavailableReason).map((section) => ({ title: section.title, lines: sectionLines(section.content!) }));
      setAnalysis(await analyzeReport({ workspaceId, reportName: template.name, periodLabel: props.periodLabel, sections, focus: focus.trim() || undefined }));
    } catch (cause) {
      const outOfCredits = cause instanceof ApiError && cause.statusCode === 402;
      toast.error(outOfCredits ? "Seus créditos de IA acabaram" : "Não foi possível analisar o relatório", {
        description: cause instanceof Error ? cause.message.replace(/^[A-Z_]+(\([^)]*\))?:\s*/, "") : undefined,
        ...(outOfCredits ? { action: { label: "Comprar créditos", onClick: () => { window.location.href = `/workspaces/${workspaceId}/settings/plano#creditos`; } } } : {}),
      });
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="vorix-display truncate text-lg font-semibold text-foreground">{template.name}</h2>
                {template.source === "ai" ? <AiBadge label="Criado com IA" /> : template.id.startsWith("system:") ? <Badge variant="outline">Modelo pronto</Badge> : null}
              </div>
              {template.description ? <p className="mt-1 text-sm text-muted-foreground">{template.description}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {props.onEdit ? <Button variant="ghost" size="sm" onClick={props.onEdit}><Pencil className="h-4 w-4" />Editar</Button> : null}
              {props.onDelete ? <Button variant="ghost" size="sm" onClick={props.onDelete} aria-label="Excluir modelo"><Trash2 className="h-4 w-4" /></Button> : null}
              <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!ready}><Download className="h-4 w-4" />Exportar CSV</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <Label>Período</Label>
              <Select value={props.period} onValueChange={(value) => props.onPeriodChange(value as PeriodChoice)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(PERIOD_LABEL) as PeriodChoice[]).map((key) => <SelectItem key={key} value={key}>{PERIOD_LABEL[key]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {props.period === "custom" ? (
              <>
                <div><Label htmlFor="report-from">De</Label><Input id="report-from" type="date" value={props.customFrom} max={props.customTo} onChange={(event) => props.onCustomFrom(event.target.value)} /></div>
                <div><Label htmlFor="report-to">Até</Label><Input id="report-to" type="date" value={props.customTo} min={props.customFrom} onChange={(event) => props.onCustomTo(event.target.value)} /></div>
              </>
            ) : null}
            <p className="pb-2 text-xs text-muted-foreground">{props.periodLabel}</p>
          </div>
        </CardBody>
      </Card>

      {props.aiAvailable ? (
        analyzing ? (
          <AiLoading kind="analyzing" detail="os números deste relatório" />
        ) : analysis ? (
          <AIInsightCard
            title="Análise do relatório"
            meta={formatDateTime(analysis.generatedAt)}
            actions={<Button variant="ghost" size="sm" onClick={runAnalysis}>Analisar de novo</Button>}
            footnote="Gerado pela IA a partir dos números deste relatório — revise antes de decidir."
          >
            <div className="space-y-3">
              {analysis.summary ? <p className="text-foreground">{analysis.summary}</p> : null}
              <InsightList title="Destaques" items={analysis.highlights.map((item) => ({ title: item.title, evidence: item.evidence }))} />
              <InsightList title="Pontos de atenção" items={analysis.risks.map((item) => ({ title: item.title, evidence: item.evidence }))} />
              <InsightList title="Recomendações" items={analysis.recommendations.map((item) => ({ title: item.title, detail: item.rationale, evidence: item.evidence }))} />
            </div>
          </AIInsightCard>
        ) : (
          <div className="vorix-ai-surface flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground"><VorixAiIcon className="h-4 w-4" />Peça para a IA ler este relatório</p>
              <Input className="mt-2" value={focus} onChange={(event) => setFocus(event.target.value)} placeholder="Opcional: o que você quer entender? Ex.: por que a conversão caiu?" maxLength={300} aria-label="Pergunta para a análise" />
            </div>
            <Button variant="ai" onClick={runAnalysis} disabled={!ready}><VorixAiIcon className="h-4 w-4 text-current" />Analisar com IA</Button>
          </div>
        )
      ) : null}

      {failure ? <ErrorState error={failure} onRetry={() => { void commercial.mutate(); void inbox.mutate(); void sales.mutate(); }} /> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {contents.map(({ key, title, content }) => (
          <SectionCard key={key} title={title} description={catalog.find((section) => section.key === key)?.description} content={content} loading={loading && !content} />
        ))}
      </div>
    </div>
  );
}

function InsightList({ title, items }: { title: string; items: { title: string; detail?: string; evidence: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="mt-1 space-y-1.5">
        {items.map((item) => (
          <li key={item.title} className="text-sm">
            <span className="font-medium text-foreground">{item.title}</span>
            {item.detail ? <span className="text-muted-foreground"> — {item.detail}</span> : null}
            <span className="block text-[11px] text-muted-foreground">Base: “{item.evidence}”</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionCard({ title, description, content, loading }: { title: string; description?: string; content?: ReportSectionContent; loading: boolean }) {
  const wide = Boolean(content?.table && content.table.columns.length > 3);
  return (
    <Card className={cn("min-w-0", wide && "xl:col-span-2")}>
      <CardBody className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {loading || !content ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-lg bg-muted/60" />)}</div>
        ) : content.unavailableReason ? (
          <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{content.unavailableReason}</p>
        ) : content.empty ? (
          <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Sem dados neste período.</p>
        ) : (
          <>
            {content.kpis.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                {content.kpis.map((kpi) => (
                  <div key={kpi.label} className="rounded-lg border border-border/60 bg-surface-2/40 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">{kpi.label}</p>
                    <p className="mt-0.5 break-words text-sm font-semibold tabular-nums text-foreground">{kpi.value}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {content.table && content.table.rows.length ? (
              <div className="overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-surface-2/40">
                      {content.table.columns.map((column, index) => <th key={column} className={cn("px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground", index === 0 ? "text-left" : "text-right")}>{column}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {content.table.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-b border-border/40 last:border-0">
                        {row.map((cell, index) => <td key={index} className={cn("px-3 py-2", index === 0 ? "text-foreground" : "text-right tabular-nums text-muted-foreground")}>{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function TemplateEditor({ workspaceId, catalog, initial, draft, onClose, onSaved }: {
  workspaceId: string;
  catalog: ReportSectionInfo[];
  initial?: ReportTemplateItem;
  draft?: { draft: ReportTemplateDraft; request: string };
  onClose: () => void;
  onSaved: (template: ReportTemplateItem) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sections, setSections] = useState<ReportSectionKey[]>(initial?.sections ?? []);
  const [saving, setSaving] = useState(false);
  const editing = Boolean(initial?.id);

  const toggle = (key: ReportSectionKey) => setSections((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));

  async function save() {
    setSaving(true);
    try {
      const saved = editing && initial
        ? await updateReportTemplate(initial.id, { workspaceId, name: name.trim(), description: description.trim() || null, sections })
        : await createReportTemplate({ workspaceId, name: name.trim(), description: description.trim() || undefined, sections, source: draft ? "ai" : "manual", aiRequest: draft?.request });
      toast.success(editing ? "Modelo atualizado." : "Modelo salvo.");
      await onSaved(saved);
    } catch (cause) {
      toast.error("Não foi possível salvar o modelo", { description: cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? "Editar modelo de relatório" : draft ? "Revise o modelo criado pela IA" : "Novo modelo de relatório"} onClose={onClose} maxWidthClass="sm:max-w-3xl">
      <div className="space-y-4">
        {draft ? (
          <AIInsightCard title="Sugestão da IA" footnote="Confira as seções antes de salvar — nada é salvo sem a sua confirmação.">
            <p className="text-sm text-foreground">{draft.draft.rationale}</p>
            {draft.draft.warnings.length ? <p className="mt-1 text-xs text-muted-foreground">Não existe no catálogo: {draft.draft.warnings.map((warning) => warning.replace(/^section_unknown:\s*/, "")).join("; ")}</p> : null}
          </AIInsightCard>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="report-name">Nome</Label><Input id="report-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus placeholder="Ex.: Fechamento semanal" /></div>
          <div><Label htmlFor="report-description">Descrição</Label><Input id="report-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="Para que serve este relatório" /></div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Seções do relatório</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{sections.length} selecionada(s) · aparecem na ordem escolhida</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {catalog.map((section) => {
              const position = sections.indexOf(section.key);
              return (
                <label key={section.key} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors", position >= 0 ? "border-solution/50 bg-solution/[0.06]" : "border-border/70 hover:bg-surface-2")}>
                  <Checkbox checked={position >= 0} onCheckedChange={() => toggle(section.key)} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">{position >= 0 ? <span className="flex h-4 w-4 items-center justify-center rounded-full bg-solution text-[10px] text-solution-foreground">{position + 1}</span> : null}{section.title}</span>
                    <span className="block text-xs text-muted-foreground">{section.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} loading={saving} disabled={saving || !name.trim() || sections.length === 0}>{editing ? "Salvar alterações" : "Salvar modelo"}</Button>
        </div>
      </div>
    </Modal>
  );
}

const AI_EXAMPLES = [
  "Quero acompanhar toda segunda o fechamento da semana: vendas, perdas e quem mais vendeu.",
  "Um relatório para a reunião mensal de atendimento: tempo de resposta, satisfação e volume por atendente.",
  "Entender quais produtos dão mais margem e quanto desconto estamos dando.",
];

function AiTemplateBuilder({ workspaceId, onClose, onDraft }: { workspaceId: string; onClose: () => void; onDraft: (draft: ReportTemplateDraft, request: string) => void }) {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      onDraft(await draftReportTemplateWithAi(workspaceId, request.trim()), request.trim());
    } catch (cause) {
      const outOfCredits = cause instanceof ApiError && cause.statusCode === 402;
      toast.error(outOfCredits ? "Seus créditos de IA acabaram" : "Não foi possível criar o modelo", { description: cause instanceof Error ? cause.message.replace(/^[A-Z_]+(\([^)]*\))?:\s*/, "") : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Criar modelo de relatório com IA" onClose={onClose} maxWidthClass="sm:max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Descreva o que você quer acompanhar. A IA escolhe as seções certas e você revisa antes de salvar.</p>
        {busy ? (
          <AiLoading kind="generating" detail="o seu modelo de relatório" />
        ) : (
          <>
            <Textarea value={request} onChange={(event) => setRequest(event.target.value)} rows={4} maxLength={1000} placeholder="Ex.: Quero ver quanto vendemos por origem e por vendedor, e onde estamos perdendo negócios." aria-label="O que você quer acompanhar" autoFocus />
            <div className="flex flex-wrap gap-2">
              {AI_EXAMPLES.map((example) => (
                <button key={example} type="button" onClick={() => setRequest(example)} className="rounded-full border border-border px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-ai/50 hover:text-foreground">
                  <LayoutTemplate className="mr-1 inline h-3 w-3" />{example}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">Usa créditos de IA.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button variant="ai" onClick={generate} disabled={busy || request.trim().length < 8}><VorixAiIcon className="h-4 w-4 text-current" />Gerar modelo</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function periodRange(period: PeriodChoice, customFrom: string, customTo: string): { from: string; to: string } {
  const today = new Date();
  if (period === "custom") return { from: customFrom, to: customTo };
  if (period === "this_month") return { from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDate(today) };
  if (period === "last_month") return { from: isoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: isoDate(new Date(today.getFullYear(), today.getMonth(), 0)) };
  const days = period === "last_7_days" ? 6 : period === "last_90_days" ? 89 : 29;
  return { from: isoDate(addDays(today, -days)), to: isoDate(today) };
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDay(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "relatorio";
}

