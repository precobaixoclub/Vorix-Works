"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { Input, Label, Textarea } from "@/components/Field";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { CHANNEL_LABEL, DEFAULT_PRODUCTION_CONFIG, FORMAT_LABEL } from "@/features/production-line/defaults";
import { readProductionConfig, writeProductionConfig } from "@/features/production-line/storage";
import type { ContentBlueprint, IdeaProductionMode, PostingRule, ProductionChannel, ProductionFormat, ProductionLineConfig, ProductionWeekday, WeeklyFormatQuota } from "@/features/production-line/types";

const CHANNELS: ProductionChannel[] = ["instagram", "facebook", "tiktok", "youtube"];
const FORMATS: ProductionFormat[] = ["single_image", "carousel", "video"];
const IDEA_FILTERS = [
  { id: "all", label: "Todas" },
  { id: "routine", label: "Rotina" },
  { id: "available", label: "No tanque" },
  { id: "standalone", label: "Avulsas" },
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

type ProductionView = "dashboard" | "schedule";
type IdeaFilter = (typeof IDEA_FILTERS)[number]["id"];

const CHANNEL_SHORT: Record<ProductionChannel, string> = {
  instagram: "IG",
  facebook: "FB",
  tiktok: "TT",
  youtube: "YT",
};

function IconPlus({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconLayer({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

function IconSliders({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.4" />
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.4" />
      <line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10" cy="8" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5" cy="12" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconSearch({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.2 10.2L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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

function IconTray({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" className={className} aria-hidden="true">
      <path d="M4 16l3-9h14l3 9" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M4 16h6.2c.4 1.6 1.8 2.7 3.8 2.7s3.4-1.1 3.8-2.7H24v6a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 22v-6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
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

export default function ProductionLinePage() {
  const workspace = useCurrentWorkspace();
  const [config, setConfig] = useState<ProductionLineConfig>(DEFAULT_PRODUCTION_CONFIG);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState(DEFAULT_PRODUCTION_CONFIG.blueprints[0]?.id ?? "");
  const [selectedRuleId, setSelectedRuleId] = useState(DEFAULT_PRODUCTION_CONFIG.postingRules[0]?.id ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ProductionView>("dashboard");
  const [ideaFilter, setIdeaFilter] = useState<IdeaFilter>("available");
  const [ideaSearch, setIdeaSearch] = useState("");
  const [formatFilter, setFormatFilter] = useState<ProductionFormat | "all">("all");
  const [draftIdea, setDraftIdea] = useState<ContentBlueprint | null>(null);
  const [ideaEditorOpen, setIdeaEditorOpen] = useState(false);

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

  const selectedBlueprint = draftIdea && selectedBlueprintId === draftIdea.id ? draftIdea : config.blueprints.find((blueprint) => blueprint.id === selectedBlueprintId) ?? config.blueprints[0];
  const selectedRule = config.postingRules.find((rule) => rule.id === selectedRuleId) ?? config.postingRules[0];
  const visibleBlueprints = useMemo(() => {
    const query = ideaSearch.trim().toLowerCase();
    return config.blueprints.filter((idea) => {
      if (!matchesIdeaFilter(idea, ideaFilter)) return false;
      if (formatFilter !== "all" && idea.format !== formatFilter) return false;
      if (query) {
        const haystack = `${idea.name} ${idea.ideaText} ${idea.objective}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [config.blueprints, ideaFilter, formatFilter, ideaSearch]);
  const routineBlueprints = useMemo(() => config.blueprints.filter(isRoutineIdea), [config.blueprints]);

  const productionSummary = useMemo(() => {
    const routineIdeas = config.blueprints.filter(isRoutineIdea);
    const ideas = routineIdeas.length;
    const availableIdeas = routineIdeas.filter((idea) => idea.status !== "used").length;
    const usedIdeas = routineIdeas.filter((idea) => idea.status === "used").length;
    const standaloneIdeas = config.blueprints.filter(isStandaloneIdea).length;
    const pendingReview = 0;
    const weeklyTotal = config.postingRules.reduce((total, rule) => total + totalWeeklyPosts(rule), 0);
    const channels = new Set(config.postingRules.flatMap((rule) => rule.channels));
    const dailyCapacity = config.postingRules.reduce((total, rule) => total + rule.maxPostsPerDay, 0);
    return { ideas, availableIdeas, usedIdeas, standaloneIdeas, pendingReview, weeklyTotal, channels: channels.size, dailyCapacity };
  }, [config]);
  const emptyIdeas = useMemo(() => config.blueprints.filter(isEffectivelyEmptyIdea), [config.blueprints]);
  const formatAlerts = useMemo(() => {
    if (!selectedRule) return [];
    return selectedRule.weeklyMix
      .filter((item) => scheduledQuantity(item) > 0)
      .map((item) => ({
        format: item.format,
        needed: scheduledQuantity(item),
        available: routineBlueprints.filter((idea) => idea.format === item.format && idea.status !== "used").length,
      }))
      .filter((row) => row.available < row.needed);
  }, [selectedRule, routineBlueprints]);

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
    setIdeaFilter("available");
    setSelectedBlueprintId(nextDraft.id);
    setIdeaEditorOpen(true);
  }

  function addStandaloneBlueprint() {
    const nextDraft = emptyBlueprint("standalone");
    setDraftIdea(nextDraft);
    setIdeaFilter("standalone");
    setSelectedBlueprintId(nextDraft.id);
    setIdeaEditorOpen(true);
  }

  function saveDraftIdea() {
    if (!draftIdea || !canPersistIdea(draftIdea)) return;
    const normalizedDraft: ContentBlueprint = {
      ...draftIdea,
      name: draftIdea.name.trim() && draftIdea.name.trim() !== "Nova ideia" ? draftIdea.name.trim() : draftIdea.ideaText.trim().slice(0, 60),
      objective: draftIdea.objective || draftIdea.ideaText,
      productionMode: draftIdea.productionMode === "standalone" ? "standalone" : "routine",
    };
    save({ ...config, blueprints: [...config.blueprints, normalizedDraft] });
    setDraftIdea(null);
    setIdeaFilter("available");
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
    const target = config.blueprints.find((idea) => idea.id === id);
    if (target) setIdeaFilter(target.productionMode === "standalone" ? "standalone" : target.status === "used" ? "used" : "available");
    setActiveView("dashboard");
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
    setIdeaFilter("available");
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

  function changeIdeaFilter(filter: IdeaFilter) {
    setIdeaFilter(filter);
    const first = config.blueprints.find((idea) => matchesIdeaFilter(idea, filter));
    if (first) setSelectedBlueprintId(first.id);
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-accent">Produção automática</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Produção de conteúdo</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Abasteça o tanque, crie conteúdos avulsos e acompanhe o que precisa revisar antes de postar.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <Button onClick={addBlueprint}><IconPlus /> {draftIdea ? "Continuar rascunho" : "Nova ideia"}</Button>
          <Button variant="secondary" onClick={addStandaloneBlueprint}><IconLayer /> Conteúdo avulso</Button>
          <Button variant="secondary" onClick={() => setActiveView("schedule")}><IconSliders /> Configurar rotina</Button>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-end gap-3">
        {savedAt ? <p className="text-xs text-ink-muted">Último salvamento: {savedAt}</p> : null}
        <button type="button" onClick={() => save(DEFAULT_PRODUCTION_CONFIG)} className="text-xs font-medium text-ink-faint hover:text-ink-muted">
          Restaurar padrão
        </button>
      </div>

      {activeView === "dashboard" ? (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader>
              <div>
                <p className="text-sm font-semibold text-ink">Tanque de ideias</p>
                <p className="text-xs text-ink-muted">Briefing para a próxima geração. Ideias da rotina entram no sorteio; avulsas ficam de fora.</p>
              </div>
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
                <input
                  type="search"
                  value={ideaSearch}
                  onChange={(event) => setIdeaSearch(event.target.value)}
                  placeholder="Buscar por nome ou descrição"
                  className="w-56 max-w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
                />
              </div>
            </CardHeader>
            <CardBody>
              <TankMetrics summary={productionSummary} />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <IdeaFilterTabs value={ideaFilter} onChange={changeIdeaFilter} />
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
              </div>
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
            </CardBody>
          </Card>

          <aside className="space-y-4">
            <RoutineStatusCard rule={selectedRule} onConfigure={() => setActiveView("schedule")} />
            <FormatAlertsCard alerts={formatAlerts} />
            <ReviewQueue totalPending={productionSummary.pendingReview} />
          </aside>
        </section>
      ) : null}

      {ideaEditorOpen && selectedBlueprint ? (
        <IdeaFormDialog
          workspaceId={workspace.id}
          blueprint={selectedBlueprint}
          isDraft={selectedBlueprint.id === draftIdea?.id}
          canSaveDraft={selectedBlueprint.id === draftIdea?.id ? canPersistIdea(draftIdea) : true}
          onChange={(patch) => updateBlueprint(selectedBlueprint.id, patch)}
          onClose={() => selectedBlueprint.id === draftIdea?.id ? discardDraftIdea() : setIdeaEditorOpen(false)}
          onSaveDraft={saveDraftIdea}
          onDiscardDraft={discardDraftIdea}
          onRemove={() => selectedBlueprint.id === draftIdea?.id ? discardDraftIdea() : removeBlueprint(selectedBlueprint.id)}
        />
      ) : null}

      {activeView === "schedule" ? (
      <section className="space-y-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(340px,0.55fr)]">
          <Card>
            <CardHeader>
              <div>
                <p className="text-sm font-semibold text-ink">Configurar rotina</p>
                <p className="text-xs text-ink-muted">Escolha onde publicar, em quais horários e quantos conteúdos saem por semana.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setActiveView("dashboard")}>Voltar ao painel</Button>
                <Button onClick={addRule}>Nova regra</Button>
              </div>
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
            </CardBody>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <div>
                <p className="text-sm font-semibold text-ink">Resumo da rotina</p>
                <p className="text-xs text-ink-muted">Confira o resultado antes de salvar.</p>
              </div>
            </CardHeader>
            <CardBody className="space-y-3">
              {selectedRule ? <SchedulePreview rule={selectedRule} ideas={routineBlueprints} /> : null}
            </CardBody>
          </Card>
        </div>

        <div className="rounded-xl border border-border bg-surface-raised px-3 py-3 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">Finalizar rotina</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {saveFeedback ?? (savedAt ? `Último salvamento: ${savedAt}` : "Revise a rotina e salve quando terminar.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveCurrentConfig}>{saveFeedback ? "Salvo" : "Salvar rotina"}</Button>
              <Button variant="secondary" onClick={() => setActiveView("dashboard")}>Voltar ao painel</Button>
              <Button variant="secondary" onClick={addBlueprint}>Nova ideia</Button>
            </div>
          </div>
        </div>
      </section>
      ) : null}
    </main>
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
  onSaveDraft: () => void;
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
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">{isDraft ? standalone ? "Conteúdo avulso" : "Nova ideia" : "Editar ideia"}</p>
              <h2 className="mt-1 text-lg font-semibold text-ink">{isDraft ? standalone ? "Criar conteúdo fora da rotina" : "Abastecer tanque de conteúdo" : blueprint.name || "Ideia sem nome"}</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-muted">
                {standalone ? "Use para criar uma peça única sem entrar no sorteio da rotina." : "Preencha primeiro a ideia e o formato. Referências e detalhes aparecem separados para não poluir o fluxo."}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xl leading-none text-ink-muted hover:bg-surface-sunken hover:text-ink" aria-label="Fechar">
              x
            </button>
          </div>
        </header>

        <div className="overflow-y-auto bg-surface-raised px-4 py-4 sm:px-5">
          {standalone ? (
            <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-blue-500/25 bg-blue-500/10 px-3.5 py-3 text-sm text-blue-300">
              <IconLayer className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Este conteúdo fica fora da rotina automática — não entra no sorteio semanal.</p>
            </div>
          ) : null}
          <BlueprintEditor
            workspaceId={workspaceId}
            blueprint={blueprint}
            onChange={onChange}
            onRemove={onRemove}
            canRemove
          />
        </div>

        <footer className="border-t border-border bg-surface-raised px-4 py-3 sm:px-5">
          {isDraft ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-ink-muted">{standalone ? "Conteúdo avulso fica separado do tanque automático." : "Só entra no tanque depois de salvar. O campo obrigatório é a ideia da postagem."}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={onDiscardDraft}>Descartar</Button>
                <Button disabled={!canSaveDraft} onClick={onSaveDraft}>{standalone ? "Criar avulso" : "Salvar no tanque"}</Button>
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

function RoutineStatusCard({ rule, onConfigure }: { rule?: PostingRule; onConfigure: () => void }) {
  const activeRows = rule ? rule.weeklyMix.filter((item) => scheduledQuantity(item) > 0) : [];
  return (
    <Card className="h-fit">
      <CardHeader>
        <div>
          <p className="text-sm font-semibold text-ink">Rotina ativa</p>
          <p className="text-xs text-ink-muted">{rule?.name ?? "Nenhuma rotina configurada"}</p>
        </div>
        <Button variant="secondary" className="min-h-8 px-3 py-1.5 text-xs" onClick={onConfigure}>Configurar</Button>
      </CardHeader>
      <CardBody>
        {rule ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Posts/semana" value={totalWeeklyPosts(rule)} />
              <Metric label="Canais" value={rule.channels.length} />
            </div>
            {activeRows.length > 0 ? (
              <div className="mt-3 space-y-2">
                {activeRows.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-ink"><IconFormat format={row.format} className="h-3.5 w-3.5 text-ink-faint" />{FORMAT_LABEL[row.format]}</span>
                    <span className="text-ink-muted">{formatScheduleLabel(row)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-ink-muted">Nenhum formato ativo ainda.</p>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-4 text-sm text-ink-muted">
            Nenhuma rotina configurada.
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function FormatAlertsCard({ alerts }: { alerts: { format: ProductionFormat; needed: number; available: number }[] }) {
  return (
    <Card className="h-fit">
      <CardHeader>
        <div>
          <p className="text-sm font-semibold text-ink">Alertas do tanque</p>
          <p className="text-xs text-ink-muted">O que precisa de atenção antes da rotina rodar.</p>
        </div>
      </CardHeader>
      <CardBody>
        {alerts.length === 0 ? (
          <p className="text-sm text-ink-muted">Estoque em dia para todos os formatos ativos na rotina.</p>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div key={alert.format} className="flex items-start gap-2.5">
                <IconWarn className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{FORMAT_LABEL[alert.format]} sem estoque suficiente</p>
                  <p className="text-xs text-ink-muted">{alert.available} no tanque para {alert.needed} por semana.</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ReviewQueue({ totalPending }: { totalPending: number }) {
  return (
    <Card className="h-fit">
      <CardHeader>
        <div>
          <p className="text-sm font-semibold text-ink">Para revisar e aprovar</p>
          <p className="text-xs text-ink-muted">{totalPending} peça(s) gerada(s) aguardando decisão.</p>
        </div>
      </CardHeader>
      <CardBody>
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center">
          <IconTray className="h-7 w-7 text-ink-faint" />
          <p className="text-sm font-medium text-ink">Nada para revisar ainda</p>
          <p className="text-xs text-ink-muted">
            Nenhuma imagem, carrossel ou vídeo foi gerado ainda. Quando uma rotina ou um conteúdo avulso gerar uma peça final, ela aparece aqui para aprovação.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function TankMetrics({ summary }: { summary: { ideas: number; availableIdeas: number; usedIdeas: number; standaloneIdeas: number } }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Metric label="No tanque" value={summary.availableIdeas} />
      <Metric label="Usadas" value={summary.usedIdeas} />
      <Metric label="Rotina" value={summary.ideas} />
      <Metric label="Avulsas" value={summary.standaloneIdeas} />
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

      <div className="mt-3 max-h-[620px] overflow-y-auto rounded-lg border border-border">
        <div className="hidden grid-cols-[2.1fr_0.9fr_1.3fr_0.85fr_0.85fr_1.3fr] gap-3 border-b border-border bg-surface-sunken px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint sm:grid">
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
          const preview = idea.ideaText.trim() || idea.objective.trim() || "Sem descrição preenchida.";
          return (
            <div
              key={idea.id}
              className={`grid grid-cols-1 gap-2 border-b border-border px-3 py-3 last:border-b-0 sm:grid-cols-[2.1fr_0.9fr_1.3fr_0.85fr_0.85fr_1.3fr] sm:items-center sm:gap-3 ${selected ? "bg-accent-soft" : "hover:bg-surface-sunken"}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{idea.name.trim() || "Ideia sem nome"}</p>
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

function IdeaFilterTabs({ value, onChange }: { value: IdeaFilter; onChange: (value: IdeaFilter) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">Ideias</p>
      <div className="inline-flex rounded-lg border border-border bg-surface p-1">
        {IDEA_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => onChange(filter.id)}
            className={`min-h-8 rounded-md px-3 text-sm font-medium ${value === filter.id ? "bg-accent text-white" : "text-ink-muted hover:text-ink"}`}
          >
            {filter.label}
          </button>
        ))}
      </div>
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

      <RuleAdvancedSettings
        rule={rule}
        onChange={onRuleChange}
        onRemove={onRemove}
        canRemove={canRemove}
      />
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
    onChange(item.id, {
      ...nextSchedule,
      quantity: nextSchedule.weekdays.length * nextSchedule.times.length,
    });
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
                onClick={() => enabled ? setActiveFormat(item.format) : toggleFormat(item)}
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
        <FormatSchedulePanel
          item={activeItem}
          ideas={ideas}
          onDisable={() => toggleFormat(activeItem)}
          onChange={(patch) => onChange(activeItem.id, patch)}
        />
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
    onChange({
      weekdays: normalizedWeekdays,
      times: normalizedTimes,
      quantity: normalizedWeekdays.length * normalizedTimes.length,
    });
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
          <p className="mt-0.5 text-xs text-ink-muted">
            {quantity} por semana · {available} no tanque · {used} usadas
          </p>
          {!hasEnough ? (
            <p className="mt-1 text-xs text-amber-500">Faltam ideias: {available} no tanque para {quantity} por semana.</p>
          ) : null}
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
    const next = normalizedTimes.map((time, currentIndex) => currentIndex === index ? value : time).filter(Boolean);
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
                onClick={() => selected ? onChange(normalizedTimes.filter((item) => item !== time || normalizedTimes.length === 1)) : addQuickTime(time)}
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
              <TimeSelect
                id={`rule-time-hour-${index}`}
                label="Hora"
                value={timePart(time, "hour")}
                options={hourOptions(time)}
                onChange={(hour) => updateTime(index, `${hour}:${timePart(time, "minute")}`)}
              />
              <TimeSelect
                id={`rule-time-minute-${index}`}
                label="Min"
                value={timePart(time, "minute")}
                options={minuteOptions(time)}
                onChange={(minute) => updateTime(index, `${timePart(time, "hour")}:${minute}`)}
              />
              <Button
                type="button"
                variant="ghost"
                className="mt-5 min-h-9 px-2 text-xs"
                disabled={normalizedTimes.length <= 1}
                onClick={() => removeTime(index)}
              >
                Remover
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        className="min-h-9 px-3 py-1.5 text-xs"
        onClick={addNextTime}
      >
        + Horário
      </Button>
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
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
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
    <CollapsibleSection
      title="Ajustes avançados"
      description="Nome da regra, fuso horário, limite diário e intervalo mínimo."
      open={open}
      onToggle={() => setOpen(!open)}
    >
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

function NumberStepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  function clamp(next: number) {
    return Math.max(min, Math.min(max, next));
  }

  return (
    <div>
      <Label>{label}</Label>
      <div className="grid grid-cols-[40px_minmax(0,1fr)_40px] overflow-hidden rounded-lg border border-border bg-surface">
        <button
          type="button"
          className="min-h-10 border-r border-border text-lg font-semibold text-ink-muted hover:bg-surface-sunken disabled:opacity-40"
          disabled={value <= min}
          onClick={() => onChange(clamp(value - 1))}
          aria-label={`Diminuir ${label.toLowerCase()}`}
        >
          -
        </button>
        <Input
          type="number"
          min={min}
          max={max}
          value={value}
          className="rounded-none border-0 text-center focus:ring-0"
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(clamp(next));
          }}
        />
        <button
          type="button"
          className="min-h-10 border-l border-border text-lg font-semibold text-ink-muted hover:bg-surface-sunken disabled:opacity-40"
          disabled={value >= max}
          onClick={() => onChange(clamp(value + 1))}
          aria-label={`Aumentar ${label.toLowerCase()}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function StepMarker({ value }: { value: number }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
      {value}
    </span>
  );
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
            placeholder="Ex.: Criar um carrossel mostrando 5 motivos para comprar X, com linguagem simples e chamada para WhatsApp no final."
            onChange={(event) => onChange({ ideaText: event.target.value, objective: event.target.value })}
          />
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
          <Textarea
            id="blueprint-links"
            rows={3}
            value={sourceLinksText}
            placeholder={"https://site.com/produto\nhttps://instagram.com/p/referencia"}
            onChange={(event) => onChange({ sourceLinks: splitLines(event.target.value) })}
          />
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
            <p className="mt-2 text-xs text-ink-muted">
              Envie print, foto, imagem ou vídeo curto. O arquivo enviado vira referência da ideia.
            </p>
            {uploading ? <p className="mt-2 text-xs text-accent">Enviando arquivo...</p> : null}
            {uploadError ? <p className="mt-2 text-xs text-red-600">{uploadError}</p> : null}
          </div>
          {blueprint.referenceImages.length > 0 ? (
            <div className="mt-2 space-y-2">
              {blueprint.referenceImages.map((url) => (
                <div key={url} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                  <a href={url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-xs font-medium text-accent hover:underline">
                    {fileLabel(url)}
                  </a>
                  <button type="button" onClick={() => removeReference(url)} className="shrink-0 text-xs font-medium text-ink-muted hover:text-red-600">
                    Remover
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Detalhes avançados"
        description="Ajuste legenda, direção visual e status apenas quando precisar de controle fino."
        open={advancedOpen}
        onToggle={() => setAdvancedOpen(!advancedOpen)}
      >
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

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <ModeToggle value={blueprint.approvalMode} onChange={(approvalMode) => onChange({ approvalMode })} label="Aprovação" />
            <IdeaStatusToggle value={blueprint.status} onChange={(status) => onChange({ status, usedAt: status === "used" ? new Date().toISOString() : undefined })} />
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
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            className={`min-h-8 rounded-md px-3 text-sm font-medium ${value === mode ? "bg-accent text-white" : "text-ink-muted hover:text-ink"}`}
          >
            {mode === "manual" ? "Manual" : "Automático"}
          </button>
        ))}
      </div>
    </div>
  );
}

function IdeaStatusToggle({ value, onChange }: { value: "available" | "used"; onChange: (value: "available" | "used") => void }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">Status da ideia</p>
      <div className="inline-flex rounded-lg border border-border bg-surface p-1">
        {(["available", "used"] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => onChange(status)}
            className={`min-h-8 rounded-md px-3 text-sm font-medium ${value === status ? "bg-accent text-white" : "text-ink-muted hover:text-ink"}`}
          >
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
          {typeof badge === "number" && badge > 0 ? (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">{badge}</span>
          ) : null}
          <span className="rounded-md border border-border bg-surface-raised px-2 py-1 text-xs font-semibold text-ink-muted">
            {open ? "Ocultar" : "Abrir"}
          </span>
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
  const textFields = [idea.ideaText, idea.objective, idea.theme, idea.captionDirection, idea.creativeDirection]
    .map((value) => value.trim())
    .filter(Boolean);
  return textFields.length === 0 && idea.sourceLinks.length === 0 && idea.referenceImages.length === 0;
}

function matchesIdeaFilter(idea: ContentBlueprint, filter: IdeaFilter): boolean {
  if (filter === "all") return true;
  if (filter === "routine") return isRoutineIdea(idea);
  if (filter === "standalone") return isStandaloneIdea(idea);
  if (filter === "used") return idea.status === "used";
  return idea.status !== "used" && isRoutineIdea(idea);
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
