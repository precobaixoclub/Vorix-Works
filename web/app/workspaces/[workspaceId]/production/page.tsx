"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { Input, Label, Textarea } from "@/components/Field";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { CHANNEL_LABEL, DEFAULT_PRODUCTION_CONFIG, FORMAT_LABEL } from "@/features/production-line/defaults";
import { deriveObjective, extractExecutionRunFailure, generateFromIdea, MAX_IDEA_TEXT_LENGTH } from "@/features/production-line/api";
import { getGenerationRecord, recordGeneration, type GenerationRecord } from "@/features/production-line/generation-log";
import { useExecutionRun, useExecutionRuns } from "@/features/execution/hooks";
import type { ExecutionRun, ExecutionRunDetail, ExecutionRunState } from "@/features/execution/types";
import { readProductionConfig, writeProductionConfig } from "@/features/production-line/storage";
import { useProductionSettings } from "@/features/production-settings/hooks";
import type { ContentBlueprint, IdeaProductionMode, PostingRule, ProductionAspectRatio, ProductionChannel, ProductionFormat, ProductionLineConfig, ProductionWeekday, ReferenceAssetRole, WeeklyFormatQuota } from "@/features/production-line/types";
import { formatRelativeTime } from "@/lib/format";

const CHANNELS: ProductionChannel[] = ["instagram", "facebook", "tiktok", "youtube"];
const FORMATS: ProductionFormat[] = ["single_image", "carousel", "video"];
const ASPECT_RATIO_OPTIONS: ProductionAspectRatio[] = ["1:1", "4:5", "9:16", "16:9"];
const REFERENCE_ASSET_ROLE_OPTIONS: { value: ReferenceAssetRole; label: string }[] = [
  { value: "product_photo", label: "Foto do produto" },
  { value: "screenshot", label: "Print de tela" },
  { value: "logo", label: "Logo" },
  { value: "reference_style", label: "Referência de estilo" },
  { value: "other", label: "Outro" },
];
const IDEA_TYPE_FILTERS = [
  { id: "all", label: "Todas" },
  { id: "routine", label: "Rotina" },
  { id: "standalone", label: "Avulsas" },
] as const;
const IDEA_STATUS_FILTERS = [
  { id: "all", label: "Todas" },
  { id: "available", label: "No tanque" },
  { id: "used", label: "Usadas" },
] as const;
const WEEKDAYS: { id: ProductionWeekday; short: string; label: string }[] = [
  { id: "mon", short: "Seg", label: "Segunda" },
  { id: "tue", short: "Ter", label: "Terça" },
  { id: "wed", short: "Qua", label: "Quarta" },
  { id: "thu", short: "Qui", label: "Quinta" },
  { id: "fri", short: "Sex", label: "Sexta" },
  { id: "sat", short: "Sáb", label: "Sábado" },
  { id: "sun", short: "Dom", label: "Domingo" },
];
const QUICK_TIMES = ["08:00", "09:00", "12:00", "13:30", "18:30", "20:00"];
const MINUTE_OPTIONS = ["00", "15", "30", "45"];
const WEEKDAY_INDEX: Record<ProductionWeekday, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const QUEUE_TABS = [
  { id: "in_progress", label: "Em andamento" },
  { id: "waiting_review", label: "Aguardando revisão" },
  { id: "completed", label: "Concluídos" },
  { id: "failed", label: "Com problema" },
] as const;
const PERIOD_FILTERS = [
  { id: "all", label: "Todo período" },
  { id: "today", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
] as const;
const IN_PROGRESS_STATES: readonly ExecutionRunState[] = ["created", "validating", "ready", "running"];
const RUN_STATE_LABEL: Record<string, string> = { created: "Na fila", validating: "Preparando", ready: "Pronto para processar", running: "Gerando com IA…" };
const UNTITLED_CONTENT_TITLE = "Conteúdo sem título";

type ProductionMode = "queue" | "configure";
type QueueTabId = (typeof QUEUE_TABS)[number]["id"];
type PeriodFilterId = (typeof PERIOD_FILTERS)[number]["id"];
type SortOrder = "recent" | "oldest";
type IdeaTypeFilter = (typeof IDEA_TYPE_FILTERS)[number]["id"];
type IdeaStatusFilter = (typeof IDEA_STATUS_FILTERS)[number]["id"];

const CHANNEL_SHORT: Record<ProductionChannel, string> = {
  instagram: "IG",
  facebook: "FB",
  tiktok: "TT",
  youtube: "YT",
};

function IconLayer({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

function IconWarn({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M8 1.5l7 12.5H1L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.2v3.3M8 11.6h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconFormat({ format, className = "h-3.5 w-3.5" }: { format: ProductionFormat; className?: string }) {
  if (format === "carousel") {
    return (
      <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
        <rect x="1.5" y="4.5" width="9" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
        <rect x="4.5" y="1.5" width="9" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    );
  }
  if (format === "video") {
    return (
      <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M6.5 5.6l4 2.4-4 2.4V5.6z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.5 11.2L6.8 8l2 2 3.7-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function newId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}

function emptyBlueprint(productionMode: IdeaProductionMode = "routine"): ContentBlueprint {
  return {
    id: newId("blueprint"),
    name: "",
    format: "single_image",
    ideaText: "",
    objective: "",
    theme: "",
    captionDirection: "",
    creativeDirection: "",
    mediaCount: 1,
    channels: ["instagram"],
    approvalMode: "manual",
    sourceLinks: [],
    referenceImages: [],
    status: "available",
    productionMode,
  };
}

function emptyRule(blueprintId: string): PostingRule {
  return {
    id: newId("rule"),
    name: "Nova regra",
    channels: ["instagram"],
    timezone: "America/Sao_Paulo",
    times: ["09:00"],
    maxPostsPerDay: 1,
    spacingMinutes: 180,
    publishMode: "manual",
    weeklyMix: [
      { id: newId("mix"), format: "single_image", quantity: 2, weekdays: ["mon", "wed"], times: ["09:00"] },
      { id: newId("mix"), format: "carousel", quantity: 1, weekdays: ["fri"], times: ["18:30"] },
      { id: newId("mix"), format: "video", quantity: 1, weekdays: ["tue"], times: ["18:30"] },
    ],
    sequence: [{ id: newId("seq"), blueprintId, quantity: 1, everyDays: 1 }],
  };
}

/** Próxima ocorrência real de um (dia da semana, horário) a partir de agora — usado só para
 * mostrar "próximo horário planejado" na rotina; nunca uma promessa de disparo automático (a
 * rotina hoje é planejamento/estoque, não um cron que gera sozinho). */
function nextOccurrence(weekday: ProductionWeekday, time: string, now: Date): Date {
  const [hour, minute] = time.split(":").map(Number);
  const result = new Date(now);
  result.setHours(hour || 0, minute || 0, 0, 0);
  let dayDiff = WEEKDAY_INDEX[weekday] - now.getDay();
  if (dayDiff < 0 || (dayDiff === 0 && result <= now)) dayDiff += 7;
  result.setDate(now.getDate() + dayDiff);
  return result;
}

function describeNextSlot(rules: PostingRule[]): string | null {
  const now = new Date();
  let earliest: Date | null = null;
  for (const rule of rules) {
    for (const item of rule.weeklyMix) {
      if (scheduledQuantity(item) === 0) continue;
      for (const weekday of item.weekdays) {
        for (const time of item.times) {
          const candidate = nextOccurrence(weekday, time, now);
          if (!earliest || candidate < earliest) earliest = candidate;
        }
      }
    }
  }
  if (!earliest) return null;
  const isToday = earliest.toDateString() === now.toDateString();
  const time = earliest.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `hoje às ${time}`;
  const weekdayShort = WEEKDAYS[(earliest.getDay() + 6) % 7]?.short ?? "";
  return `${weekdayShort.toLowerCase()} às ${time}`;
}

type RunSummary = { title: string; images: { uri: string }[]; failureMessage?: string; record?: GenerationRecord };

/** Deriva título/thumbnail/mensagem de erro de um `ExecutionRunDetail` já carregado — mesma fonte
 * de dado que `review/page.tsx` usa (artefatos "copy"/"structure" + registro local), nunca IDs
 * técnicos, traceId ou payload cru. */
function deriveRunSummary(workspaceId: string, run: ExecutionRun, detail: ExecutionRunDetail | undefined): RunSummary {
  const record = getGenerationRecord(workspaceId, run.id);
  const images = (detail?.artifacts ?? []).flatMap((artifact) => {
    const payload = artifact.payload as { output?: { images?: Array<{ uri?: string }> } } | undefined;
    return payload?.output?.images?.filter((image): image is { uri: string } => Boolean(image.uri)) ?? [];
  });
  const copyOutput = (detail?.artifacts ?? []).find((artifact) => artifact.outputPort === "copy")?.payload as { output?: { title?: string } } | undefined;
  const structureOutput = (detail?.artifacts ?? []).find((artifact) => artifact.outputPort === "structure")?.payload as { output?: { angle?: string } } | undefined;
  const title = copyOutput?.output?.title || structureOutput?.output?.angle || record?.name || record?.ideaText?.slice(0, 68) || UNTITLED_CONTENT_TITLE;
  const failureMessage = detail ? extractExecutionRunFailure(detail).message : undefined;
  return { title, images, failureMessage, record };
}

function hasProductionCardTitle(workspaceId: string, run: ExecutionRun): boolean {
  const record = getGenerationRecord(workspaceId, run.id);
  if (!record) return false;
  const title = (record.name || record.ideaText || "").trim().toLowerCase();
  return Boolean(title) && title !== UNTITLED_CONTENT_TITLE.toLowerCase() && title !== "ideia sem nome";
}

export default function ProductionLinePage() {
  const workspace = useCurrentWorkspace();
  const [config, setConfig] = useState<ProductionLineConfig>(DEFAULT_PRODUCTION_CONFIG);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState(DEFAULT_PRODUCTION_CONFIG.blueprints[0]?.id ?? "");
  const [selectedRuleId, setSelectedRuleId] = useState(DEFAULT_PRODUCTION_CONFIG.postingRules[0]?.id ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [mode, setMode] = useState<ProductionMode>("queue");
  const [ideaTypeFilter, setIdeaTypeFilter] = useState<IdeaTypeFilter>("all");
  const [ideaStatusFilter, setIdeaStatusFilter] = useState<IdeaStatusFilter>("available");
  const [ideaSearch, setIdeaSearch] = useState("");
  const [formatFilter, setFormatFilter] = useState<ProductionFormat | "all">("all");
  const [ideaFiltersOpen, setIdeaFiltersOpen] = useState(false);
  const [draftIdea, setDraftIdea] = useState<ContentBlueprint | null>(null);
  const [ideaEditorOpen, setIdeaEditorOpen] = useState(false);

  // Fila operacional — dado real de `ExecutionRun`, nunca do tanque local.
  const { data: executionRuns, mutate: refreshRuns } = useExecutionRuns(workspace.id);
  const { data: productionSettings } = useProductionSettings(workspace.id);
  const [queueTab, setQueueTab] = useState<QueueTabId>("in_progress");
  const [queueSearch, setQueueSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<ProductionChannel | "all">("all");
  const [queueFormatFilter, setQueueFormatFilter] = useState<ProductionFormat | "all">("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterId>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readProductionConfig(workspace.id);
    setConfig(stored);
    setSelectedBlueprintId(stored.blueprints[0]?.id ?? "");
    setSelectedRuleId(stored.postingRules[0]?.id ?? "");
  }, [workspace.id]);

  useEffect(() => {
    if (!saveFeedback) return;
    const timeoutId = window.setTimeout(() => setSaveFeedback(null), 2500);
    return () => window.clearTimeout(timeoutId);
  }, [saveFeedback]);

  // Fila é conteúdo em movimento — revalida sozinha em segundo plano, sem exigir F5.
  useEffect(() => {
    const intervalId = window.setInterval(() => refreshRuns(), 15_000);
    return () => window.clearInterval(intervalId);
  }, [refreshRuns]);

  const selectedBlueprint = draftIdea && selectedBlueprintId === draftIdea.id ? draftIdea : config.blueprints.find((blueprint) => blueprint.id === selectedBlueprintId) ?? config.blueprints[0];
  const selectedRule = config.postingRules.find((rule) => rule.id === selectedRuleId) ?? config.postingRules[0];
  const visibleBlueprints = useMemo(() => {
    const query = ideaSearch.trim().toLowerCase();
    return config.blueprints.filter((idea) => {
      if (ideaTypeFilter === "routine" && !isRoutineIdea(idea)) return false;
      if (ideaTypeFilter === "standalone" && !isStandaloneIdea(idea)) return false;
      if (ideaStatusFilter !== "all" && idea.status !== ideaStatusFilter) return false;
      if (formatFilter !== "all" && idea.format !== formatFilter) return false;
      if (query) {
        const haystack = `${idea.name} ${idea.ideaText} ${idea.objective}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [config.blueprints, ideaTypeFilter, ideaStatusFilter, formatFilter, ideaSearch]);
  const routineBlueprints = useMemo(() => config.blueprints.filter(isRoutineIdea), [config.blueprints]);
  const emptyIdeas = useMemo(() => config.blueprints.filter(isEffectivelyEmptyIdea), [config.blueprints]);

  const hasGuidelines = Boolean(productionSettings?.productionPrompt?.trim());
  const rotinaAtiva = config.postingRules.some((rule) => rule.weeklyMix.some((item) => scheduledQuantity(item) > 0));
  const nextSlot = useMemo(() => describeNextSlot(config.postingRules), [config.postingRules]);

  const realRuns = useMemo(() => (executionRuns ?? []).filter((run) => run.mode === "real"), [executionRuns]);
  const visibleRuns = useMemo(() => realRuns.filter((run) => hasProductionCardTitle(workspace.id, run)), [realRuns, workspace.id]);
  const inProgressRuns = useMemo(() => visibleRuns.filter((run) => IN_PROGRESS_STATES.includes(run.state)), [visibleRuns]);
  const waitingReviewRuns = useMemo(() => visibleRuns.filter((run) => run.state === "waiting_for_approval"), [visibleRuns]);
  const completedRuns = useMemo(() => visibleRuns.filter((run) => run.state === "completed"), [visibleRuns]);
  const failedRuns = useMemo(() => visibleRuns.filter((run) => run.state === "failed"), [visibleRuns]);
  const completedTodayCount = useMemo(() => {
    const today = new Date().toDateString();
    return completedRuns.filter((run) => (run.finishedAt ? new Date(run.finishedAt).toDateString() === today : false)).length;
  }, [completedRuns]);

  const runsByTab: Record<QueueTabId, ExecutionRun[]> = {
    in_progress: inProgressRuns,
    waiting_review: waitingReviewRuns,
    completed: completedRuns,
    failed: failedRuns,
  };

  const filteredQueueRuns = useMemo(() => {
    const query = queueSearch.trim().toLowerCase();
    const now = Date.now();
    const periodMs: Record<PeriodFilterId, number | null> = { all: null, today: 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000, "30d": 30 * 24 * 60 * 60 * 1000 };
    const list = runsByTab[queueTab].filter((run) => {
      const record = getGenerationRecord(workspace.id, run.id);
      if (channelFilter !== "all" && record?.channel !== channelFilter) return false;
      if (queueFormatFilter !== "all" && record?.format !== queueFormatFilter) return false;
      const limit = periodMs[periodFilter];
      if (limit !== null && now - new Date(run.createdAt).getTime() > limit) return false;
      if (query) {
        const haystack = `${record?.name ?? ""} ${record?.ideaText ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => (sortOrder === "recent" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
  }, [runsByTab, queueTab, queueSearch, channelFilter, queueFormatFilter, periodFilter, sortOrder, workspace.id]);

  const totalQueueRuns = visibleRuns.length;
  const activeQueueFilterCount = [
    channelFilter !== "all",
    queueFormatFilter !== "all",
    periodFilter !== "all",
    sortOrder !== "recent",
  ].filter(Boolean).length;
  const activeIdeaFilterCount = [
    ideaTypeFilter !== "all",
    ideaStatusFilter !== "available",
    formatFilter !== "all",
  ].filter(Boolean).length;

  async function handleRetryFailed(run: ExecutionRun) {
    const record = getGenerationRecord(workspace.id, run.id);
    if (!record) return;
    setRetryingRunId(run.id);
    setRetryError(null);
    try {
      const generateInput = {
        workspaceId: workspace.id,
        name: record.name,
        objective: record.objective,
        ideaText: record.ideaText,
        format: record.format,
        channel: record.channel,
        targetAudience: record.targetAudience,
      };
      const result = await generateFromIdea(generateInput);
      recordGeneration(workspace.id, { ...generateInput, executionRunId: result.executionRunId, ideaId: record.ideaId, createdAt: new Date().toISOString() });
      await refreshRuns();
      setQueueTab("in_progress");
    } catch (cause) {
      setRetryError(cause instanceof Error ? cause.message : "Não foi possível tentar de novo.");
    } finally {
      setRetryingRunId(null);
    }
  }

  function save(next: ProductionLineConfig, options: { manual?: boolean } = {}) {
    setConfig(next);
    writeProductionConfig(workspace.id, next);
    const timestamp = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setSavedAt(timestamp);
    if (options.manual) setSaveFeedback(`Rotina salva neste navegador às ${timestamp}.`);
  }

  function saveCurrentConfig() {
    save(config, { manual: true });
  }

  function updateBlueprint(id: string, patch: Partial<ContentBlueprint>) {
    if (draftIdea?.id === id) {
      setDraftIdea({ ...draftIdea, ...patch });
      return;
    }
    save({ ...config, blueprints: config.blueprints.map((blueprint) => (blueprint.id === id ? { ...blueprint, ...patch } : blueprint)) });
  }

  function addBlueprint() {
    const nextDraft = draftIdea ?? emptyBlueprint("routine");
    setDraftIdea(nextDraft);
    setSelectedBlueprintId(nextDraft.id);
    setIdeaEditorOpen(true);
  }

  function saveDraftIdea(ideaMode: IdeaProductionMode) {
    if (!draftIdea || !canPersistIdea(draftIdea)) return;
    const normalizedDraft: ContentBlueprint = {
      ...draftIdea,
      name: draftIdea.name.trim() && draftIdea.name.trim() !== "Nova ideia" ? draftIdea.name.trim() : draftIdea.ideaText.trim().slice(0, 60),
      objective: deriveObjective(draftIdea.objective, draftIdea.ideaText),
      productionMode: ideaMode,
    };
    save({ ...config, blueprints: [...config.blueprints, normalizedDraft] });
    setDraftIdea(null);
    setIdeaTypeFilter(ideaMode === "standalone" ? "standalone" : "routine");
    setIdeaStatusFilter("available");
    setSelectedBlueprintId(normalizedDraft.id);
    setIdeaEditorOpen(false);
  }

  function discardDraftIdea() {
    setDraftIdea(null);
    setSelectedBlueprintId(config.blueprints[0]?.id ?? "");
    setIdeaEditorOpen(false);
  }

  function removeBlueprint(id: string) {
    const nextBlueprints = config.blueprints.filter((blueprint) => blueprint.id !== id);
    const fallbackId = nextBlueprints[0]?.id ?? "";
    const nextRules = config.postingRules.map((rule) => ({
      ...rule,
      sequence: rule.sequence.map((step) => (step.blueprintId === id ? { ...step, blueprintId: fallbackId } : step)),
    }));
    save({ blueprints: nextBlueprints, postingRules: nextRules });
    setSelectedBlueprintId(fallbackId);
    if (selectedBlueprintId === id) setIdeaEditorOpen(false);
  }

  function openBlueprint(id: string) {
    setSelectedBlueprintId(id);
    setIdeaEditorOpen(true);
  }

  function toggleBlueprintStatus(blueprint: ContentBlueprint) {
    const nextStatus = blueprint.status === "used" ? "available" : "used";
    updateBlueprint(blueprint.id, { status: nextStatus, usedAt: nextStatus === "used" ? new Date().toISOString() : undefined });
  }

  function removeEmptyIdeas() {
    if (emptyIdeas.length === 0) return;
    const removedIds = new Set(emptyIdeas.map((idea) => idea.id));
    const nextBlueprints = config.blueprints.filter((idea) => !removedIds.has(idea.id));
    const fallbackId = nextBlueprints[0]?.id ?? "";
    const nextRules = config.postingRules.map((rule) => ({
      ...rule,
      sequence: rule.sequence.map((step) => (removedIds.has(step.blueprintId) ? { ...step, blueprintId: fallbackId } : step)),
    }));
    save({ blueprints: nextBlueprints, postingRules: nextRules });
    setSelectedBlueprintId(fallbackId);
    setIdeaTypeFilter("all");
    setIdeaStatusFilter("available");
  }

  function updateRule(id: string, patch: Partial<PostingRule>) {
    save({ ...config, postingRules: config.postingRules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) });
  }

  function addRule() {
    const rule = emptyRule(config.blueprints[0]?.id ?? "");
    save({ ...config, postingRules: [...config.postingRules, rule] });
    setSelectedRuleId(rule.id);
  }

  function removeRule(id: string) {
    if (config.postingRules.length <= 1) return;
    const nextRules = config.postingRules.filter((rule) => rule.id !== id);
    save({ ...config, postingRules: nextRules });
    setSelectedRuleId(nextRules[0].id);
  }

  function updateWeeklyMix(rule: PostingRule, itemId: string, patch: Partial<WeeklyFormatQuota>) {
    updateRule(rule.id, { weeklyMix: rule.weeklyMix.map((item) => (item.id === itemId ? { ...item, ...patch } : item)) });
  }

  if (mode === "configure") {
    return (
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
        <button type="button" onClick={() => setMode("queue")} className="mb-4 text-sm font-medium text-ink-muted hover:text-ink">
          ← Voltar à produção
        </button>

        <PromptSetupCard workspaceId={workspace.id} hasGuidelines={hasGuidelines} compact={false} />

        <Card className="mb-4">
          <CardHeader>
            <div>
              <p className="text-sm font-semibold text-ink">Rotina automática</p>
              <p className="text-xs text-ink-muted">Onde publicar, em quais horários, e o tanque de ideias que abastece a agenda.</p>
            </div>
            <Button onClick={addRule}>Nova regra</Button>
          </CardHeader>
          <CardBody>
            <div className="mb-4 flex flex-wrap gap-2">
              {config.postingRules.map((rule) => (
                <button
                  key={rule.id}
                  type="button"
                  onClick={() => setSelectedRuleId(rule.id)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    selectedRule?.id === rule.id ? "border-ink-faint bg-surface-sunken text-ink" : "border-border bg-surface hover:bg-surface-sunken"
                  }`}
                >
                  {rule.name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(300px,0.5fr)]">
              {selectedRule ? (
                <ScheduleBuilder
                  rule={selectedRule}
                  ideas={routineBlueprints}
                  onRuleChange={(patch) => updateRule(selectedRule.id, patch)}
                  onWeeklyMixChange={(itemId, patch) => updateWeeklyMix(selectedRule, itemId, patch)}
                  onRemove={() => removeRule(selectedRule.id)}
                  canRemove={config.postingRules.length > 1}
                />
              ) : null}
              {selectedRule ? <SchedulePreview rule={selectedRule} ideas={routineBlueprints} /> : null}
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink">Tanque de ideias</p>
                  <p className="text-xs text-ink-muted">Estoque de texto para a rotina sortear — gerar a peça continua sendo feito em Criar.</p>
                </div>
                <Button variant="secondary" onClick={addBlueprint}><span aria-hidden="true">+</span> {draftIdea ? "Continuar rascunho" : "Nova ideia"}</Button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="search"
                  value={ideaSearch}
                  onChange={(event) => setIdeaSearch(event.target.value)}
                  placeholder="Buscar ideias"
                  className="min-h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft sm:max-w-sm"
                />
                <Button variant="secondary" onClick={() => setIdeaFiltersOpen((open) => !open)}>
                  Filtros{activeIdeaFilterCount > 0 ? ` (${activeIdeaFilterCount})` : ""}
                </Button>
              </div>
              {ideaFiltersOpen ? (
                <div className="mt-3 rounded-lg border border-border bg-surface-sunken p-3">
                  <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-ink-muted">Tipo</p>
                      <SegmentedFilter value={ideaTypeFilter} options={IDEA_TYPE_FILTERS} onChange={setIdeaTypeFilter} />
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-ink-muted">Status</p>
                      <SegmentedFilter value={ideaStatusFilter} options={IDEA_STATUS_FILTERS} onChange={setIdeaStatusFilter} />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-ink-muted">
                      Formato
                      <select
                        value={formatFilter}
                        onChange={(event) => setFormatFilter(event.target.value as ProductionFormat | "all")}
                        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-medium text-ink outline-none focus:border-accent"
                      >
                        <option value="all">Todos</option>
                        {FORMATS.map((format) => (
                          <option key={format} value={format}>{FORMAT_LABEL[format]}</option>
                        ))}
                      </select>
                    </label>
                    {activeIdeaFilterCount > 0 ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setIdeaTypeFilter("all");
                          setIdeaStatusFilter("available");
                          setFormatFilter("all");
                        }}
                      >
                        Limpar filtros
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <IdeaInventory
                ideas={visibleBlueprints}
                totalIdeas={config.blueprints.length}
                selectedId={selectedBlueprint?.id}
                emptyCount={emptyIdeas.length}
                onOpen={openBlueprint}
                onToggleStatus={toggleBlueprintStatus}
                onRemove={removeBlueprint}
                onCleanEmpty={removeEmptyIdeas}
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-xs text-ink-muted">{saveFeedback ?? (savedAt ? `Último salvamento: ${savedAt}` : "Revise a rotina e salve quando terminar.")}</p>
              <Button onClick={saveCurrentConfig}>{saveFeedback ? "Salvo" : "Salvar rotina"}</Button>
            </div>
          </CardBody>
        </Card>

        {ideaEditorOpen && selectedBlueprint ? (
          <IdeaFormDialog
            workspaceId={workspace.id}
            blueprint={selectedBlueprint}
            isDraft={selectedBlueprint.id === draftIdea?.id}
            canSaveDraft={selectedBlueprint.id === draftIdea?.id ? canPersistIdea(draftIdea) : true}
            onChange={(patch) => updateBlueprint(selectedBlueprint.id, patch)}
            onClose={() => (selectedBlueprint.id === draftIdea?.id ? discardDraftIdea() : setIdeaEditorOpen(false))}
            onSaveDraft={saveDraftIdea}
            onDiscardDraft={discardDraftIdea}
            onRemove={() => (selectedBlueprint.id === draftIdea?.id ? discardDraftIdea() : removeBlueprint(selectedBlueprint.id))}
          />
        ) : null}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-ink">Produção</h1>
          <p className="mt-1 text-sm text-ink-muted">Crie ideias, ajuste o prompt da IA e acompanhe a fila.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Button onClick={() => { setMode("configure"); addBlueprint(); }}>+ Nova ideia</Button>
          <Link href={`/workspaces/${workspace.id}/knowledge?tab=guidelines`}>
            <Button variant={hasGuidelines ? "secondary" : "primary"} className="w-full">{hasGuidelines ? "Editar prompt" : "Configurar prompt"}</Button>
          </Link>
          <Button variant="secondary" onClick={() => setMode("configure")}>Configurar rotina</Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-ink-muted">
        <span>Prompt: <strong className="font-semibold text-ink">{hasGuidelines ? "configurado" : "pendente"}</strong></span>
        <span>Rotina: <strong className="font-semibold text-ink">{rotinaAtiva ? "ativa" : "pausada"}</strong></span>
        {rotinaAtiva && nextSlot ? <span>Próximo: <strong className="font-semibold text-ink">{nextSlot}</strong></span> : null}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5 rounded-lg bg-surface-raised p-1">
        {QUEUE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setQueueTab(tab.id)}
            className={`min-h-8 rounded-md px-2.5 text-xs font-medium transition-colors ${
              queueTab === tab.id ? "bg-accent text-white" : "bg-surface-raised text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label} <span className="text-xs opacity-70">({runsByTab[tab.id].length})</span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="search"
          value={queueSearch}
          onChange={(event) => setQueueSearch(event.target.value)}
          placeholder="Buscar produção"
          className="min-h-9 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft sm:max-w-xs"
        />
        <Button variant="secondary" className="min-h-9 py-1.5" onClick={() => setFiltersOpen((open) => !open)}>
          Filtros{activeQueueFilterCount > 0 ? ` (${activeQueueFilterCount})` : ""}
        </Button>
      </div>

      {filtersOpen ? (
        <div className="mb-4 rounded-xl border border-border bg-surface-raised p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value as ProductionChannel | "all")} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent">
              <option value="all">Todos os canais</option>
              {CHANNELS.map((channel) => (<option key={channel} value={channel}>{CHANNEL_LABEL[channel]}</option>))}
            </select>
            <select value={queueFormatFilter} onChange={(event) => setQueueFormatFilter(event.target.value as ProductionFormat | "all")} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent">
              <option value="all">Todos os formatos</option>
              {FORMATS.map((format) => (<option key={format} value={format}>{FORMAT_LABEL[format]}</option>))}
            </select>
            <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value as PeriodFilterId)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-accent">
              {PERIOD_FILTERS.map((period) => (<option key={period.id} value={period.id}>{period.label}</option>))}
            </select>
            <SegmentedFilter value={sortOrder} options={[{ id: "recent", label: "Recentes" }, { id: "oldest", label: "Antigos" }]} onChange={setSortOrder} />
            {activeQueueFilterCount > 0 ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setChannelFilter("all");
                  setQueueFormatFilter("all");
                  setPeriodFilter("all");
                  setSortOrder("recent");
                }}
              >
                Limpar filtros
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {retryError ? <p className="mb-3 text-sm text-danger">{retryError}</p> : null}

      {totalQueueRuns === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface-raised px-6 py-14 text-center">
          <p className="font-display text-lg font-semibold text-ink">Sua produção está vazia</p>
          <p className="max-w-sm text-sm text-ink-muted">Crie seu primeiro conteúdo com IA e acompanhe o processo por aqui.</p>
          <Link href={`/workspaces/${workspace.id}/create`} className="mt-1"><Button>Criar conteúdo</Button></Link>
        </div>
      ) : filteredQueueRuns.length === 0 ? (
        <div className="rounded-2xl bg-surface-raised px-6 py-10 text-center text-sm text-ink-muted">Nada aqui para os filtros atuais.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredQueueRuns.map((run) => (
            <ProductionRunCard
              key={run.id}
              workspaceId={workspace.id}
              run={run}
              onRetry={() => handleRetryFailed(run)}
              retrying={retryingRunId === run.id}
            />
          ))}
        </div>
      )}

      {queueTab === "completed" && completedRuns.length > 0 ? (
        <div className="mt-4 text-right">
          <Link href={`/workspaces/${workspace.id}/campaigns`} className="text-sm font-medium text-accent hover:underline">Ver todos os conteúdos →</Link>
        </div>
      ) : null}

    </main>
  );
}

function ProductionRunCard({
  workspaceId,
  run,
  onRetry,
  retrying,
}: {
  workspaceId: string;
  run: ExecutionRun;
  onRetry: () => void;
  retrying: boolean;
}) {
  const needsDetail = run.state === "completed" || run.state === "waiting_for_approval" || run.state === "failed";
  const { data: detail } = useExecutionRun(workspaceId, needsDetail ? run.id : undefined);
  const [expanded, setExpanded] = useState(false);
  const summary = deriveRunSummary(workspaceId, run, detail);
  const thumbnail = summary.images[0]?.uri;

  return (
    <div className="overflow-hidden rounded-xl bg-surface-raised">
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnail} alt="" className="aspect-square w-full object-cover" />
      ) : run.state === "failed" ? null : (
        <div className="flex aspect-[3/2] w-full items-center justify-center bg-surface-sunken text-2xl text-ink-faint" aria-hidden="true">
          {IN_PROGRESS_STATES.includes(run.state) ? "✦" : "🖼"}
        </div>
      )}

      <div className="space-y-2 p-3.5">
        <p className="truncate text-sm font-semibold text-ink">{summary.title}</p>
        {summary.record ? (
          <p className="text-xs text-ink-muted">{CHANNEL_LABEL[summary.record.channel]} · {FORMAT_LABEL[summary.record.format]}</p>
        ) : null}

        {run.state === "failed" ? (
          <>
            <p className="text-sm text-danger">Não foi possível concluir a geração.</p>
            {expanded ? <p className="rounded-lg bg-danger-bg px-2.5 py-2 text-xs text-danger">{summary.failureMessage || "Motivo não informado pelo provedor."}</p> : null}
            <div className="flex flex-wrap gap-2 pt-1">
              {summary.record ? (
                <Button className="min-h-8 px-3 py-1.5 text-xs" disabled={retrying} onClick={onRetry}>{retrying ? "Tentando…" : "Tentar novamente"}</Button>
              ) : null}
              <Button variant="secondary" className="min-h-8 px-3 py-1.5 text-xs" onClick={() => setExpanded((prev) => !prev)}>Detalhes</Button>
            </div>
          </>
        ) : run.state === "waiting_for_approval" ? (
          <>
            <StatusBadge status="waiting_for_approval" />
            <Link href={`/workspaces/${workspaceId}/review`}>
              <Button className="min-h-8 w-full px-3 py-1.5 text-xs">Revisar</Button>
            </Link>
          </>
        ) : run.state === "completed" ? (
          <>
            <p className="text-xs text-ink-muted">Concluído · {formatRelativeTime(run.finishedAt ?? run.updatedAt)}</p>
            <Link href={`/workspaces/${workspaceId}/campaigns`} className="text-xs font-medium text-accent hover:underline">Ver em Conteúdos →</Link>
          </>
        ) : (
          <>
            <p className="text-sm text-accent">{RUN_STATE_LABEL[run.state] ?? "Processando…"}</p>
            <p className="text-xs text-ink-faint">Iniciado há {formatRelativeTime(run.createdAt)}</p>
            {summary.record ? (
              <button type="button" onClick={() => setExpanded((prev) => !prev)} className="text-xs font-medium text-ink-muted hover:text-ink">
                {expanded ? "Ocultar detalhes" : "Ver detalhes"}
              </button>
            ) : null}
            {expanded && summary.record ? (
              <div className="rounded-lg bg-surface-sunken px-2.5 py-2 text-xs text-ink-muted">
                <p className="whitespace-pre-wrap">{summary.record.ideaText}</p>
                {summary.record.targetAudience ? <p className="mt-1.5">Público: {summary.record.targetAudience}</p> : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function PromptSetupCard({ workspaceId, hasGuidelines, compact }: { workspaceId: string; hasGuidelines: boolean; compact: boolean }) {
  return (
    <div className={`mb-4 rounded-xl border px-4 py-3 ${hasGuidelines ? "border-border bg-surface-raised" : "border-accent/40 bg-accent-soft"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${hasGuidelines ? "text-ink" : "text-accent"}`}>
            {hasGuidelines ? "Prompt da IA configurado" : "Configure o prompt da IA antes de gerar conteúdo"}
          </p>
          <p className={`mt-0.5 text-sm ${hasGuidelines ? "text-ink-muted" : "text-accent"}`}>
            {hasGuidelines
              ? "A IA já tem diretrizes criativas fixas desta marca."
              : compact
                ? "Esse prompt define estilo, tom, limites e referências que a IA deve seguir em todas as criações."
                : "Antes de abastecer a rotina, defina como a IA deve escrever e criar visualmente: tom de voz, cores, estilo, regras do que nunca inventar e uso de materiais reais."}
          </p>
        </div>
        <Link href={`/workspaces/${workspaceId}/knowledge?tab=guidelines`} className="shrink-0">
          <Button variant={hasGuidelines ? "secondary" : "primary"}>{hasGuidelines ? "Editar prompt" : "Configurar prompt da IA"}</Button>
        </Link>
      </div>
    </div>
  );
}

function IdeaFormDialog({
  workspaceId,
  blueprint,
  isDraft,
  canSaveDraft,
  onChange,
  onClose,
  onSaveDraft,
  onDiscardDraft,
  onRemove,
}: {
  workspaceId: string;
  blueprint: ContentBlueprint;
  isDraft: boolean;
  canSaveDraft: boolean;
  onChange: (patch: Partial<ContentBlueprint>) => void;
  onClose: () => void;
  onSaveDraft: (mode: IdeaProductionMode) => void;
  onDiscardDraft: () => void;
  onRemove: () => void;
}) {
  const standalone = isStandaloneIdea(blueprint);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 py-3 sm:items-center sm:py-6">
      <section className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-xl">
        <header className="border-b border-border bg-surface-raised px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">{isDraft ? "Nova ideia" : "Editar ideia"}</p>
              <h2 className="mt-1 text-lg font-semibold text-ink">{isDraft ? "Abastecer tanque de conteúdo" : displayIdeaName(blueprint)}</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-muted">
                {isDraft ? "Preencha a ideia e o formato para entrar no estoque da rotina — gerar a peça é sempre em Criar." : "Preencha primeiro a ideia e o formato. Referências e detalhes aparecem separados para não poluir o fluxo."}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xl leading-none text-ink-muted hover:bg-surface-sunken hover:text-ink" aria-label="Fechar">
              x
            </button>
          </div>
        </header>

        <div className="overflow-y-auto bg-surface-raised px-4 py-4 sm:px-5">
          {!isDraft && standalone ? (
            <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-blue-500/25 bg-blue-500/10 px-3.5 py-3 text-sm text-blue-300">
              <IconLayer className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Este conteúdo fica fora da rotina automática — não entra no sorteio semanal.</p>
            </div>
          ) : null}
          <BlueprintEditor workspaceId={workspaceId} blueprint={blueprint} onChange={onChange} onRemove={onRemove} canRemove />
        </div>

        <footer className="border-t border-border bg-surface-raised px-4 py-3 sm:px-5">
          {isDraft ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-ink-muted">Escolha uma das opções para salvar. O campo obrigatório é a ideia da postagem.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={onDiscardDraft}>Descartar</Button>
                <Button variant="secondary" disabled={!canSaveDraft} onClick={() => onSaveDraft("routine")}>Salvar no tanque</Button>
                <Button disabled={!canSaveDraft} onClick={() => onSaveDraft("standalone")}>Salvar como avulsa</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="danger" onClick={onRemove}>Remover ideia</Button>
              <Button onClick={onClose}>Concluir</Button>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}

function IdeaInventory({
  ideas,
  totalIdeas,
  selectedId,
  emptyCount,
  onOpen,
  onToggleStatus,
  onRemove,
  onCleanEmpty,
}: {
  ideas: ContentBlueprint[];
  totalIdeas: number;
  selectedId?: string;
  emptyCount: number;
  onOpen: (id: string) => void;
  onToggleStatus: (idea: ContentBlueprint) => void;
  onRemove: (id: string) => void;
  onCleanEmpty: () => void;
}) {
  return (
    <section className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">Mostrando {ideas.length} de {totalIdeas} ideia(s).</p>
        {emptyCount > 0 ? (
          <button type="button" onClick={onCleanEmpty} className="text-xs font-medium text-amber-400 hover:text-amber-300">
            Limpar {emptyCount} ideia(s) sem descrição
          </button>
        ) : null}
      </div>

      <div className="mt-3 max-h-[480px] overflow-y-auto rounded-lg border border-border">
        <div className="hidden grid-cols-[2.3fr_0.9fr_1.3fr_0.85fr_0.85fr_1fr] gap-3 border-b border-border bg-surface-sunken px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint sm:grid">
          <span>Ideia</span>
          <span>Formato</span>
          <span>Canais</span>
          <span>Tipo</span>
          <span>Status</span>
          <span className="text-right">Ações</span>
        </div>

        {ideas.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-ink-muted">O tanque ainda não tem ideias para este filtro.</div>
        ) : ideas.map((idea) => {
          const selected = selectedId === idea.id;
          const preview = idea.ideaText.trim() || idea.objective.trim() || "Rascunho sem descrição. Remova ou preencha a ideia.";
          return (
            <div
              key={idea.id}
              className={`grid grid-cols-1 gap-2 border-b border-border px-3 py-3 last:border-b-0 sm:grid-cols-[2.3fr_0.9fr_1.3fr_0.85fr_0.85fr_1fr] sm:items-center sm:gap-3 ${selected ? "bg-accent-soft" : "hover:bg-surface-sunken"}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{displayIdeaName(idea)}</p>
                <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">{preview}</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                <IconFormat format={idea.format} className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                {FORMAT_LABEL[idea.format]}
              </div>
              <div className="flex flex-wrap gap-1">
                {idea.channels.map((channel) => (
                  <span key={channel} title={CHANNEL_LABEL[channel]} className="flex h-5 w-5 items-center justify-center rounded-md border border-border bg-surface-sunken font-mono text-[9px] font-bold text-ink-faint">
                    {CHANNEL_SHORT[channel]}
                  </span>
                ))}
              </div>
              <span className="inline-flex w-fit items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                {isStandaloneIdea(idea) ? "avulsa" : "rotina"}
              </span>
              <span className="inline-flex w-fit items-center gap-1.5 text-[11px] font-medium text-ink-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${idea.status === "used" ? "bg-ink-faint" : "bg-accent"}`} />
                {idea.status === "used" ? "usada" : "no tanque"}
              </span>
              <div className="flex flex-wrap justify-start gap-1.5 sm:justify-end">
                <Button className="min-h-8 px-2.5 py-1.5 text-xs" onClick={() => onOpen(idea.id)}>Abrir</Button>
                <Button variant="ghost" className="min-h-8 px-2.5 py-1.5 text-xs" onClick={() => onToggleStatus(idea)}>
                  {idea.status === "used" ? "Voltar" : "Marcar usada"}
                </Button>
                <Button variant="danger" className="min-h-8 px-2.5 py-1.5 text-xs" onClick={() => onRemove(idea.id)}>Remover</Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SegmentedFilter<T extends string>({ value, options, onChange }: { value: T; options: readonly { id: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface p-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`min-h-8 rounded-md px-3 text-sm font-medium ${value === option.id ? "bg-accent text-white" : "text-ink-muted hover:text-ink"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ScheduleBuilder({
  rule,
  ideas,
  onRuleChange,
  onWeeklyMixChange,
  onRemove,
  canRemove,
}: {
  rule: PostingRule;
  ideas: ContentBlueprint[];
  onRuleChange: (patch: Partial<PostingRule>) => void;
  onWeeklyMixChange: (itemId: string, patch: Partial<WeeklyFormatQuota>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface p-3 sm:p-4">
        <div className="mb-3 flex items-start gap-3">
          <StepMarker value={1} />
          <div>
            <p className="text-sm font-semibold text-ink">Onde publicar</p>
            <p className="mt-0.5 text-xs text-ink-muted">Selecione os canais que entram nesta rotina.</p>
          </div>
        </div>
        <ChannelPicker selected={rule.channels} onChange={(channels) => onRuleChange({ channels })} hideLabel />
      </section>

      <section className="rounded-lg border border-border bg-surface p-3 sm:p-4">
        <div className="mb-3 flex items-start gap-3">
          <StepMarker value={2} />
          <div>
            <p className="text-sm font-semibold text-ink">Agenda por tipo de conteúdo</p>
            <p className="mt-0.5 text-xs text-ink-muted">Escolha dias e horários próprios para imagem, carrossel e vídeo.</p>
          </div>
        </div>
        <WeeklyMixEditor rule={rule} ideas={ideas} onChange={onWeeklyMixChange} />
      </section>

      <section className="rounded-lg border border-border bg-surface p-3 sm:p-4">
        <div className="mb-3 flex items-start gap-3">
          <StepMarker value={3} />
          <div>
            <p className="text-sm font-semibold text-ink">Aprovação</p>
            <p className="mt-0.5 text-xs text-ink-muted">Escolha se você revisa antes de postar ou se a linha publica sozinha.</p>
          </div>
        </div>
        <PublishModePicker value={rule.publishMode} onChange={(publishMode) => onRuleChange({ publishMode })} />
      </section>

      <RuleAdvancedSettings rule={rule} onChange={onRuleChange} onRemove={onRemove} canRemove={canRemove} />
    </div>
  );
}

function SchedulePreview({ rule, ideas }: { rule: PostingRule; ideas: ContentBlueprint[] }) {
  const weeklyTotal = totalWeeklyPosts(rule);
  const availableIdeas = ideas.filter((idea) => idea.status !== "used").length;
  const selectedChannels = rule.channels.map((channel) => CHANNEL_LABEL[channel]).join(", ");
  const approvalText = rule.publishMode === "auto" ? "publica automaticamente" : "fica aguardando sua aprovação";
  const formatRows = rule.weeklyMix.filter((item) => scheduledQuantity(item) > 0).map((item) => {
    const available = ideas.filter((idea) => idea.format === item.format && idea.status !== "used").length;
    return { ...item, available, quantity: scheduledQuantity(item) };
  });

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-surface px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Como vai funcionar</p>
        <p className="mt-1 text-sm font-semibold text-ink">
          {weeklyTotal} post{weeklyTotal === 1 ? "" : "s"} por semana em {selectedChannels || "nenhum canal"}, com dias e horários definidos por formato.
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Depois de gerar, a postagem {approvalText}. Há {availableIdeas} {availableIdeas === 1 ? "ideia disponível" : "ideias disponíveis"} no tanque.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Posts/semana" value={weeklyTotal} />
        <Metric label="No tanque" value={availableIdeas} />
      </div>

      <div className="space-y-2">
        {formatRows.map((row) => {
          const hasEnough = row.available >= row.quantity || row.quantity === 0;
          return (
            <div key={row.id} className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">{FORMAT_LABEL[row.format]}</p>
                <span className="text-sm font-semibold text-ink">{row.quantity}/semana</span>
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">{formatScheduleLabel(row)}</p>
              <p className={`mt-0.5 text-xs ${hasEnough ? "text-ink-muted" : "text-amber-500"}`}>
                {hasEnough ? `${row.available} ${row.available === 1 ? "ideia pronta" : "ideias prontas"} no tanque.` : `Faltam ideias: ${row.available} no tanque para ${row.quantity} por semana.`}
              </p>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink-muted">
        Se faltar ideia em algum formato, a linha pausa só aquele formato até o tanque ser abastecido.
      </div>
    </div>
  );
}

function WeeklyMixEditor({ rule, ideas, onChange }: { rule: PostingRule; ideas: ContentBlueprint[]; onChange: (itemId: string, patch: Partial<WeeklyFormatQuota>) => void }) {
  const [activeFormat, setActiveFormat] = useState<ProductionFormat>(rule.weeklyMix.find((item) => scheduledQuantity(item) > 0)?.format ?? rule.weeklyMix[0]?.format ?? "single_image");
  const activeItem = rule.weeklyMix.find((item) => item.format === activeFormat && scheduledQuantity(item) > 0)
    ?? rule.weeklyMix.find((item) => scheduledQuantity(item) > 0);

  function defaultSchedule(format: ProductionFormat): Pick<WeeklyFormatQuota, "weekdays" | "times"> {
    if (format === "single_image") return { weekdays: ["mon", "wed"], times: ["09:00"] };
    if (format === "carousel") return { weekdays: ["fri"], times: ["18:30"] };
    return { weekdays: ["tue"], times: ["18:30"] };
  }

  function toggleFormat(item: WeeklyFormatQuota) {
    const enabled = scheduledQuantity(item) > 0;
    if (enabled) {
      onChange(item.id, { weekdays: [], times: [], quantity: 0 });
      const nextActive = rule.weeklyMix.find((candidate) => candidate.id !== item.id && scheduledQuantity(candidate) > 0);
      if (nextActive) setActiveFormat(nextActive.format);
      return;
    }
    const nextSchedule = defaultSchedule(item.format);
    onChange(item.id, { ...nextSchedule, quantity: nextSchedule.weekdays.length * nextSchedule.times.length });
    setActiveFormat(item.format);
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium text-ink-muted">Tipos que entram nesta rotina</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {rule.weeklyMix.map((item) => {
            const available = ideas.filter((idea) => idea.format === item.format && idea.status !== "used").length;
            const enabled = scheduledQuantity(item) > 0;
            const selected = activeItem?.format === item.format;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => (enabled ? setActiveFormat(item.format) : toggleFormat(item))}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  enabled
                    ? selected ? "border-ink bg-surface-sunken" : "border-ink-faint bg-surface-raised hover:bg-surface-sunken"
                    : "border-border bg-surface text-ink-muted hover:bg-surface-sunken"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink"><IconFormat format={item.format} className="h-3.5 w-3.5 text-ink-faint" />{FORMAT_LABEL[item.format]}</span>
                  <span className="flex items-center gap-1.5">
                    {enabled && available < scheduledQuantity(item) ? <IconWarn className="h-3.5 w-3.5 text-amber-400" /> : null}
                    <span className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${enabled ? "bg-accent" : "border border-border bg-surface-sunken"}`}>
                      <span className={`absolute h-3 w-3 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-3.5" : "translate-x-0.5"}`} />
                    </span>
                  </span>
                </span>
                <span className="mt-2 block text-xs text-ink-muted">
                  {enabled ? `${scheduledQuantity(item)} por semana · ${formatScheduleLabel(item)}` : "Clique para configurar"}
                </span>
                <span className="mt-1 block text-xs text-ink-muted">{available} no tanque</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeItem ? (
        <FormatSchedulePanel item={activeItem} ideas={ideas} onDisable={() => toggleFormat(activeItem)} onChange={(patch) => onChange(activeItem.id, patch)} />
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-4 text-sm text-ink-muted">
          Nenhum tipo está ativo nesta rotina. Escolha imagem, carrossel ou vídeo para configurar os dias e horários.
        </div>
      )}
    </div>
  );
}

function FormatSchedulePanel({
  item,
  ideas,
  onDisable,
  onChange,
}: {
  item: WeeklyFormatQuota;
  ideas: ContentBlueprint[];
  onDisable: () => void;
  onChange: (patch: Partial<WeeklyFormatQuota>) => void;
}) {
  const available = ideas.filter((idea) => idea.format === item.format && idea.status !== "used").length;
  const used = ideas.filter((idea) => idea.format === item.format && idea.status === "used").length;
  const weekdays: ProductionWeekday[] = item.weekdays.length > 0 ? item.weekdays : ["mon"];
  const times = item.times.length > 0 ? item.times : ["09:00"];
  const quantity = weekdays.length * times.length;
  const hasEnough = available >= quantity || quantity === 0;

  function updateSchedule(nextWeekdays: ProductionWeekday[], nextTimes: string[]) {
    const normalizedWeekdays = nextWeekdays.length > 0 ? nextWeekdays : weekdays;
    const normalizedTimes = nextTimes.length > 0 ? nextTimes : times;
    onChange({ weekdays: normalizedWeekdays, times: normalizedTimes, quantity: normalizedWeekdays.length * normalizedTimes.length });
  }

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            Configurar {FORMAT_LABEL[item.format].toLowerCase()}
            {!hasEnough ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                <IconWarn className="h-2.5 w-2.5" /> faltam ideias
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">{quantity} por semana · {available} no tanque · {used} usadas</p>
          {!hasEnough ? <p className="mt-1 text-xs text-amber-500">Faltam ideias: {available} no tanque para {quantity} por semana.</p> : null}
        </div>
        <Button variant="secondary" className="min-h-8 px-3 py-1.5 text-xs" onClick={onDisable}>Desligar tipo</Button>
      </div>

      <div className="mt-4 grid gap-4">
        <WeekdayPicker selected={weekdays} onChange={(nextWeekdays) => updateSchedule(nextWeekdays, times)} />
        <TimeSlotPicker times={times} onChange={(nextTimes) => updateSchedule(weekdays, nextTimes)} compact />
      </div>
    </div>
  );
}

function WeekdayPicker({ selected, onChange }: { selected: ProductionWeekday[]; onChange: (weekdays: ProductionWeekday[]) => void }) {
  function toggle(weekday: ProductionWeekday) {
    if (selected.includes(weekday)) {
      if (selected.length === 1) return;
      onChange(selected.filter((item) => item !== weekday));
      return;
    }
    const next = WEEKDAYS.map((item) => item.id).filter((item) => item === weekday || selected.includes(item));
    onChange(next);
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">Dias da semana</p>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {WEEKDAYS.map((weekday) => (
          <button
            key={weekday.id}
            type="button"
            title={weekday.label}
            onClick={() => toggle(weekday.id)}
            className={`min-h-9 rounded-lg border px-2 text-xs font-semibold transition-colors ${
              selected.includes(weekday.id) ? "border-ink-faint bg-surface-sunken text-ink" : "border-border bg-surface text-ink-muted hover:bg-surface-sunken hover:text-ink"
            }`}
          >
            {weekday.short}
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeSlotPicker({ times, onChange, compact = false }: { times: string[]; onChange: (times: string[]) => void; compact?: boolean }) {
  const normalizedTimes = times.length > 0 ? times : ["09:00"];

  function updateTime(index: number, value: string) {
    const next = normalizedTimes.map((time, currentIndex) => (currentIndex === index ? value : time)).filter(Boolean);
    onChange(next);
  }

  function removeTime(index: number) {
    if (normalizedTimes.length <= 1) return;
    onChange(normalizedTimes.filter((_, currentIndex) => currentIndex !== index));
  }

  function addQuickTime(time: string) {
    if (normalizedTimes.includes(time)) return;
    onChange([...normalizedTimes, time].sort(compareTimes));
  }

  function addNextTime() {
    const next = QUICK_TIMES.find((time) => !normalizedTimes.includes(time)) ?? "09:00";
    addQuickTime(next);
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs font-medium text-ink-muted">Horários rápidos</p>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_TIMES.map((time) => {
            const selected = normalizedTimes.includes(time);
            return (
              <button
                key={time}
                type="button"
                onClick={() => (selected ? onChange(normalizedTimes.filter((item) => item !== time || normalizedTimes.length === 1)) : addQuickTime(time))}
                className={`min-h-8 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                  selected ? "border-ink-faint bg-surface-sunken text-ink" : "border-border bg-surface text-ink-muted hover:bg-surface-sunken hover:text-ink"
                }`}
              >
                {time}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`grid gap-2 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        {normalizedTimes.map((time, index) => (
          <div key={`${time}-${index}`} className="rounded-lg border border-border bg-surface p-2">
            <Label htmlFor={`rule-time-${index}`}>{`Horário ${index + 1}`}</Label>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
              <TimeSelect id={`rule-time-hour-${index}`} label="Hora" value={timePart(time, "hour")} options={hourOptions(time)} onChange={(hour) => updateTime(index, `${hour}:${timePart(time, "minute")}`)} />
              <TimeSelect id={`rule-time-minute-${index}`} label="Min" value={timePart(time, "minute")} options={minuteOptions(time)} onChange={(minute) => updateTime(index, `${timePart(time, "hour")}:${minute}`)} />
              <Button type="button" variant="ghost" className="mt-5 min-h-9 px-2 text-xs" disabled={normalizedTimes.length <= 1} onClick={() => removeTime(index)}>Remover</Button>
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" className="min-h-9 px-3 py-1.5 text-xs" onClick={addNextTime}>+ Horário</Button>
    </div>
  );
}

function TimeSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-[11px] font-medium text-ink-muted">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-border bg-surface-raised px-2 text-sm font-semibold text-ink outline-none focus:border-ink-faint focus:ring-2 focus:ring-surface-sunken"
      >
        {options.map((option) => (<option key={option} value={option}>{option}</option>))}
      </select>
    </label>
  );
}

function PublishModePicker({ value, onChange }: { value: "manual" | "auto"; onChange: (value: "manual" | "auto") => void }) {
  const options = [
    { id: "manual" as const, title: "Revisar antes", description: "A linha gera e espera sua aprovação para publicar." },
    { id: "auto" as const, title: "Publicar sozinha", description: "A linha publica no horário definido sem pedir aprovação." },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded-lg border p-3 text-left transition-colors ${value === option.id ? "border-ink-faint bg-surface-sunken" : "border-border bg-surface-raised hover:bg-surface-sunken"}`}
        >
          <span className="block text-sm font-semibold text-ink">{option.title}</span>
          <span className="mt-1 block text-xs text-ink-muted">{option.description}</span>
        </button>
      ))}
    </div>
  );
}

function RuleAdvancedSettings({ rule, onChange, onRemove, canRemove }: { rule: PostingRule; onChange: (patch: Partial<PostingRule>) => void; onRemove: () => void; canRemove: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <CollapsibleSection title="Ajustes avançados" description="Nome da regra, fuso horário, limite diário e intervalo mínimo." open={open} onToggle={() => setOpen(!open)}>
      <div>
        <Label htmlFor="rule-name">Nome da rotina</Label>
        <Input id="rule-name" value={rule.name} onChange={(event) => onChange({ name: event.target.value })} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="rule-timezone">Fuso horário</Label>
          <Input id="rule-timezone" value={rule.timezone} onChange={(event) => onChange({ timezone: event.target.value })} />
        </div>
        <NumberField label="Máximo por dia" value={rule.maxPostsPerDay} min={1} max={20} onChange={(value) => onChange({ maxPostsPerDay: value })} />
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-ink-muted">Horário padrão da rotina</p>
        <TimeSlotPicker times={rule.times} onChange={(times) => onChange({ times })} compact />
      </div>
      <NumberField label="Intervalo mínimo entre posts (min)" value={rule.spacingMinutes} min={15} max={1440} onChange={(value) => onChange({ spacingMinutes: value })} />
      <Button variant="danger" disabled={!canRemove} onClick={onRemove}>Remover regra</Button>
    </CollapsibleSection>
  );
}

function StepMarker({ value }: { value: number }) {
  return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">{value}</span>;
}

function totalWeeklyPosts(rule: PostingRule): number {
  return (rule.weeklyMix ?? []).reduce((sum, item) => sum + scheduledQuantity(item), 0);
}

function scheduledQuantity(item: WeeklyFormatQuota): number {
  return item.weekdays.length * item.times.length;
}

function formatScheduleLabel(item: Pick<WeeklyFormatQuota, "weekdays" | "times">): string {
  const weekdayLabels = item.weekdays.map((weekday) => WEEKDAYS.find((option) => option.id === weekday)?.short ?? weekday);
  const days = weekdayLabels.length > 0 ? weekdayLabels.join(", ") : "sem dia";
  const times = item.times.length > 0 ? item.times.join(", ") : "sem horário";
  return `${days} às ${times}`;
}

function compareTimes(left: string, right: string): number {
  return minutesFromTime(left) - minutesFromTime(right);
}

function minutesFromTime(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return hour * 60 + minute;
}

function timePart(value: string, part: "hour" | "minute"): string {
  const [hour = "09", minute = "00"] = value.split(":");
  return part === "hour" ? hour.padStart(2, "0") : minute.padStart(2, "0");
}

function hourOptions(currentTime: string): string[] {
  const current = timePart(currentTime, "hour");
  const options = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
  return options.includes(current) ? options : [current, ...options].sort();
}

function minuteOptions(currentTime: string): string[] {
  const current = timePart(currentTime, "minute");
  return MINUTE_OPTIONS.includes(current) ? MINUTE_OPTIONS : [current, ...MINUTE_OPTIONS].sort();
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}

function BlueprintEditor({ workspaceId, blueprint, onChange, onRemove, canRemove }: { workspaceId: string; blueprint: ContentBlueprint; onChange: (patch: Partial<ContentBlueprint>) => void; onRemove: () => void; canRemove: boolean }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [referencesOpen, setReferencesOpen] = useState(blueprint.sourceLinks.length > 0 || blueprint.referenceImages.length > 0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const sourceLinksText = blueprint.sourceLinks.join("\n");

  async function uploadReferences(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const uploaded = await Promise.all(Array.from(files).map((file) => uploadPublicationMedia(workspaceId, file)));
      onChange({ referenceImages: [...blueprint.referenceImages, ...uploaded.map((item) => item.url)] });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Não foi possível enviar o arquivo.");
    } finally {
      setUploading(false);
    }
  }

  function removeReference(url: string) {
    onChange({ referenceImages: blueprint.referenceImages.filter((item) => item !== url) });
  }

  function setReferenceRole(url: string, role: ReferenceAssetRole) {
    onChange({ referenceAssetRoles: { ...blueprint.referenceAssetRoles, [url]: role } });
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <section className="rounded-lg border border-border bg-surface-sunken p-3">
        <div className="mb-3">
          <p className="text-sm font-semibold text-ink">1. Ideia principal</p>
          <p className="mt-0.5 text-xs text-ink-muted">Descreva o que deve ser produzido. Esse texto é o que abastece o tanque.</p>
        </div>
        <div>
          <Label htmlFor="blueprint-name">Nome da ideia</Label>
          <Input
            id="blueprint-name"
            value={blueprint.name}
            placeholder="Nova ideia"
            onFocus={() => {
              if (blueprint.name.trim() === "Nova ideia") onChange({ name: "" });
            }}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </div>

        <div className="mt-3">
          <Label htmlFor="blueprint-idea">Ideia da postagem</Label>
          <Textarea
            id="blueprint-idea"
            rows={5}
            value={blueprint.ideaText}
            maxLength={MAX_IDEA_TEXT_LENGTH}
            placeholder="Ex.: Criar um carrossel mostrando 5 motivos para comprar X, com linguagem simples e chamada para WhatsApp no final."
            onChange={(event) => onChange({ ideaText: event.target.value })}
          />
          <p className={`mt-1 text-right text-xs ${blueprint.ideaText.length >= MAX_IDEA_TEXT_LENGTH ? "text-red-600" : "text-ink-faint"}`}>
            {blueprint.ideaText.length}/{MAX_IDEA_TEXT_LENGTH}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface-sunken p-3">
        <div className="mb-3">
          <p className="text-sm font-semibold text-ink">2. Como gerar</p>
          <p className="mt-0.5 text-xs text-ink-muted">Escolha o tipo de conteúdo e onde ele pode ser usado.</p>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-muted">Formato</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {FORMATS.map((format) => (
              <button
                key={format}
                type="button"
                onClick={() => onChange({ format, mediaCount: format === "carousel" ? Math.max(blueprint.mediaCount, 3) : 1 })}
                className={`rounded-lg border px-3 py-3 text-left transition-colors ${blueprint.format === format ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface-raised text-ink hover:bg-surface-sunken"}`}
              >
                <span className="block text-sm font-semibold">{FORMAT_LABEL[format]}</span>
                <span className="mt-1 block text-xs text-ink-muted">{formatHelp(format)}</span>
              </button>
            ))}
          </div>
        </div>

        {blueprint.format === "carousel" ? (
          <div className="mt-3 max-w-40">
            <NumberField label="Slides" value={blueprint.mediaCount} min={2} max={10} onChange={(value) => onChange({ mediaCount: value })} />
          </div>
        ) : null}

        <div className="mt-3">
          <ChannelPicker selected={blueprint.channels} onChange={(channels) => onChange({ channels })} />
        </div>
      </section>

      <CollapsibleSection
        title="3. Referências opcionais"
        description="Use quando quiser que a geração siga uma imagem, print, vídeo ou página como base."
        open={referencesOpen}
        onToggle={() => setReferencesOpen(!referencesOpen)}
        badge={blueprint.sourceLinks.length + blueprint.referenceImages.length}
      >
        <div>
          <Label htmlFor="blueprint-links">Links de referência</Label>
          <Textarea id="blueprint-links" rows={3} value={sourceLinksText} placeholder={"https://site.com/produto\nhttps://instagram.com/p/referencia"} onChange={(event) => onChange({ sourceLinks: splitLines(event.target.value) })} />
        </div>
        <div>
          <Label htmlFor="blueprint-files">Arquivos de referência</Label>
          <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-3">
            <input
              id="blueprint-files"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              disabled={uploading}
              onChange={(event) => uploadReferences(event.target.files)}
              className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
            />
            <p className="mt-2 text-xs text-ink-muted">Envie print, foto, imagem ou vídeo curto. O arquivo enviado vira referência da ideia.</p>
            {uploading ? <p className="mt-2 text-xs text-accent">Enviando arquivo...</p> : null}
            {uploadError ? <p className="mt-2 text-xs text-red-600">{uploadError}</p> : null}
          </div>
          {blueprint.referenceImages.length > 0 ? (
            <div className="mt-2 space-y-2">
              {blueprint.referenceImages.map((url) => (
                <div key={url} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                  <a href={url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-xs font-medium text-accent hover:underline">{fileLabel(url)}</a>
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      aria-label={`Papel da referência ${fileLabel(url)}`}
                      value={blueprint.referenceAssetRoles?.[url] ?? "product_photo"}
                      onChange={(event) => setReferenceRole(url, event.target.value as ReferenceAssetRole)}
                      className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
                    >
                      {REFERENCE_ASSET_ROLE_OPTIONS.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}
                    </select>
                    <button type="button" onClick={() => removeReference(url)} className="text-xs font-medium text-ink-muted hover:text-red-600">Remover</button>
                  </div>
                </div>
              ))}
              <p className="text-xs text-ink-muted">O papel de cada referência (foto do produto, print de tela, logo) é usado só quando o motor GPT está ativo.</p>
            </div>
          ) : null}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Detalhes avançados" description="Ajuste legenda, direção visual e status apenas quando precisar de controle fino." open={advancedOpen} onToggle={() => setAdvancedOpen(!advancedOpen)}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div>
            <Label htmlFor="blueprint-caption">Direção de legenda</Label>
            <Textarea id="blueprint-caption" rows={3} value={blueprint.captionDirection} onChange={(event) => onChange({ captionDirection: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="blueprint-creative">Direção visual</Label>
            <Textarea id="blueprint-creative" rows={3} value={blueprint.creativeDirection} onChange={(event) => onChange({ creativeDirection: event.target.value })} />
          </div>
        </div>

        <div className="mt-3">
          <Label htmlFor="blueprint-audience">Público-alvo</Label>
          <Input id="blueprint-audience" value={blueprint.targetAudience ?? ""} placeholder="Ex.: mulheres de 25-40 anos interessadas em moda sustentável" onChange={(event) => onChange({ targetAudience: event.target.value })} />
          <p className="mt-1 text-xs text-ink-muted">Usado só na geração real de imagem — sem isso, entra um público genérico.</p>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div>
            <Label htmlFor="blueprint-aspect-ratio">Proporção da peça</Label>
            <select
              id="blueprint-aspect-ratio"
              value={blueprint.aspectRatio ?? ""}
              onChange={(event) => onChange({ aspectRatio: (event.target.value || undefined) as ProductionAspectRatio | undefined })}
              className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
            >
              <option value="">Automático (4:5)</option>
              {ASPECT_RATIO_OPTIONS.map((ratio) => (<option key={ratio} value={ratio}>{ratio}</option>))}
            </select>
            <p className="mt-1 text-xs text-ink-muted">Usado só pelo motor GPT (quando ativo) — o motor padrão continua decidindo o formato pelo canal.</p>
          </div>
          <div>
            <Label htmlFor="blueprint-forbidden">Elementos proibidos</Label>
            <Input id="blueprint-forbidden" value={blueprint.forbiddenElements ?? ""} placeholder="Ex.: logo de concorrente, preço antigo" onChange={(event) => onChange({ forbiddenElements: event.target.value })} />
            <p className="mt-1 text-xs text-ink-muted">Lista separada por vírgula do que a peça NUNCA deve mostrar. Usado só pelo motor GPT (quando ativo).</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <ModeToggle value={blueprint.approvalMode} onChange={(approvalMode) => onChange({ approvalMode })} label="Aprovação" />
            <IdeaStatusToggle value={blueprint.status} onChange={(status) => onChange({ status, usedAt: status === "used" ? new Date().toISOString() : undefined })} />
            <IdeaModeToggle value={blueprint.productionMode ?? "routine"} onChange={(productionMode) => onChange({ productionMode })} />
          </div>
          <Button variant="danger" disabled={!canRemove} onClick={onRemove}>Remover ideia</Button>
        </div>
      </CollapsibleSection>
    </div>
  );
}

function ChannelPicker({ selected, onChange, hideLabel = false }: { selected: ProductionChannel[]; onChange: (channels: ProductionChannel[]) => void; hideLabel?: boolean }) {
  function toggle(channel: ProductionChannel) {
    if (selected.includes(channel)) {
      if (selected.length === 1) return;
      onChange(selected.filter((item) => item !== channel));
    } else {
      onChange([...selected, channel]);
    }
  }

  return (
    <div>
      {hideLabel ? null : <p className="mb-1.5 text-xs font-medium text-ink-muted">Canais</p>}
      <div className="flex flex-wrap gap-2">
        {CHANNELS.map((channel) => (
          <button
            key={channel}
            type="button"
            onClick={() => toggle(channel)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              selected.includes(channel) ? "border-ink-faint bg-surface-sunken text-ink" : "border-border bg-surface text-ink-muted hover:bg-surface-sunken"
            }`}
          >
            {CHANNEL_LABEL[channel]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModeToggle({ value, onChange, label }: { value: "manual" | "auto"; onChange: (value: "manual" | "auto") => void; label: string }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">{label}</p>
      <div className="inline-flex rounded-lg border border-border bg-surface p-1">
        {(["manual", "auto"] as const).map((mode) => (
          <button key={mode} type="button" onClick={() => onChange(mode)} className={`min-h-8 rounded-md px-3 text-sm font-medium ${value === mode ? "bg-accent text-white" : "text-ink-muted hover:text-ink"}`}>
            {mode === "manual" ? "Manual" : "Automático"}
          </button>
        ))}
      </div>
    </div>
  );
}

function IdeaModeToggle({ value, onChange }: { value: IdeaProductionMode; onChange: (value: IdeaProductionMode) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">Tipo</p>
      <div className="inline-flex rounded-lg border border-border bg-surface p-1">
        {(["routine", "standalone"] as const).map((mode) => (
          <button key={mode} type="button" onClick={() => onChange(mode)} className={`min-h-8 rounded-md px-3 text-sm font-medium ${value === mode ? "bg-accent text-white" : "text-ink-muted hover:text-ink"}`}>
            {mode === "routine" ? "Rotina" : "Avulsa"}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-ink-muted">Muda o tipo desta mesma ideia — não cria cópia.</p>
    </div>
  );
}

function IdeaStatusToggle({ value, onChange }: { value: "available" | "used"; onChange: (value: "available" | "used") => void }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">Status da ideia</p>
      <div className="inline-flex rounded-lg border border-border bg-surface p-1">
        {(["available", "used"] as const).map((status) => (
          <button key={status} type="button" onClick={() => onChange(status)} className={`min-h-8 rounded-md px-3 text-sm font-medium ${value === status ? "bg-accent text-white" : "text-ink-muted hover:text-ink"}`}>
            {status === "available" ? "No tanque" : "Usada"}
          </button>
        ))}
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  description,
  open,
  onToggle,
  badge,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface-sunken p-3">
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-3 text-left">
        <span>
          <span className="block text-sm font-semibold text-ink">{title}</span>
          <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {typeof badge === "number" && badge > 0 ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">{badge}</span> : null}
          <span className="rounded-md border border-border bg-surface-raised px-2 py-1 text-xs font-semibold text-ink-muted">{open ? "Ocultar" : "Abrir"}</span>
        </span>
      </button>
      {open ? <div className="mt-3 grid grid-cols-1 gap-3">{children}</div> : null}
    </section>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
        }}
      />
    </div>
  );
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function canPersistIdea(idea: ContentBlueprint): boolean {
  return idea.ideaText.trim().length > 0;
}

function isEffectivelyEmptyIdea(idea: ContentBlueprint): boolean {
  const textFields = [idea.ideaText, idea.objective, idea.theme, idea.captionDirection, idea.creativeDirection].map((value) => value.trim()).filter(Boolean);
  return textFields.length === 0 && idea.sourceLinks.length === 0 && idea.referenceImages.length === 0;
}

function displayIdeaName(idea: ContentBlueprint): string {
  const explicitName = idea.name.trim();
  if (explicitName && explicitName.toLowerCase() !== "nova ideia" && explicitName.toLowerCase() !== "ideia sem nome") return explicitName;
  const text = idea.ideaText.trim() || idea.objective.trim();
  if (text) return text.length > 68 ? `${text.slice(0, 65)}...` : text;
  return "Rascunho sem descrição";
}

function isRoutineIdea(idea: ContentBlueprint): boolean {
  return idea.productionMode !== "standalone";
}

function isStandaloneIdea(idea: ContentBlueprint): boolean {
  return idea.productionMode === "standalone";
}

function fileLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : url;
  } catch {
    return url;
  }
}

function formatHelp(format: ProductionFormat): string {
  if (format === "carousel") return "vários slides";
  if (format === "video") return "vídeo curto";
  return "uma arte";
}
