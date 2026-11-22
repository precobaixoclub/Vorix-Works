"use client";

import {
  CalendarDays,
  CheckCircle2,
  Download,
  Film,
  FileJson,
  GalleryHorizontal,
  ImageIcon,
  Images,
  LayoutGrid,
  Lightbulb,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DetailBlock, DetailModal } from "@/components/DetailModal";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getExecutionRun } from "@/features/execution/api";
import { generateFromIdea } from "@/features/production-line/api";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";
import {
  buildEditorialCalendar,
  createEditorialIdea,
  deleteEditorialIdea,
  downloadEditorialTemplate,
  EDITORIAL_BUCKET_LABEL,
  EDITORIAL_FORMAT_LABEL,
  editorialBucketOf,
  getEditorialBrief,
  importEditorialPack,
  importEditorialSpreadsheet,
  listEditorialIdeas,
  saveEditorialIdea,
  updateEditorialIdea,
  type EditorialIdea,
  type EditorialIdeaBucket,
  type EditorialIdeaFormat,
  type EditorialIdeaInput,
  type EditorialIdeaStatus,
} from "./api";
import { IdeaEditor } from "./IdeaEditor";
import { IdeasHubTabs } from "./IdeasHubTabs";
import { blueprintToIdeaInput, clearLocalTankIdeas, readLocalTankIdeas } from "./local-tank-migration";
import { referenceThumb } from "./reference-images";

type View = "grid" | "list" | "calendar";
const PAGE = 24;
const BUCKETS: EditorialIdeaBucket[] = ["pending", "used", "inactive"];
const FORMAT_ICON: Record<EditorialIdeaFormat, LucideIcon> = { single_image: ImageIcon, carousel: GalleryHorizontal, video: Film };

const BUCKET_TONE: Record<EditorialIdeaBucket, string> = {
  pending: "bg-emerald-500 text-white",
  used: "bg-zinc-700 text-zinc-100",
  inactive: "bg-amber-500 text-black",
};
const BUCKET_PILL_LABEL: Record<EditorialIdeaBucket, string> = { pending: "Pendente", used: "Usada", inactive: "Inativa" };

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
const formatDay = (date?: string) => (date ? WEEKDAY.format(new Date(`${date}T00:00:00Z`)) : "—");

/** Por que esta ideia não pode virar post agora (`null` = pode). */
function createBlockedReason(idea: EditorialIdea): string | null {
  if (idea.format === "video") return "Ideias de vídeo trazem o roteiro pronto para gravar; o gerador automático faz imagem e carrossel.";
  if (idea.status === "in_production") return "Esta ideia já está sendo criada. Acompanhe na Produção.";
  if (idea.status === "archived") return "Ideia inativa. Reative antes de criar o post.";
  return null;
}

/** Estado editorial derivado da execução real do motor criativo (nunca adivinhado). */
function statusFromRun(state: string): EditorialIdeaStatus | "failed" | undefined {
  if (state === "waiting_for_approval") return "produced";
  if (state === "completed") return "approved";
  if (state === "failed" || state === "cancelled") return "failed";
  return undefined;
}

function StatusPill({ status, className }: { status: EditorialIdeaStatus; className?: string }) {
  const bucket = editorialBucketOf(status);
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", BUCKET_TONE[bucket], className)}>{BUCKET_PILL_LABEL[bucket]}</span>;
}

/**
 * Bolsão de ideias do workspace: tudo o que está cadastrado aparece de cara, separado em Pendentes
 * (prontas para usar), Em andamento e Usadas. Cadastro manual ideia por ideia — com imagens de
 * referência que viram a base da arte — ou em lote por planilha. Nada é gerado nem publicado
 * sozinho a partir daqui: "Criar post" manda a ideia ao motor criativo e a peça segue para Revisão.
 */
export function EditorialIdeasBoard({ workspaceId, openNew = false }: { workspaceId: string; openNew?: boolean }) {
  const [ideas, setIdeas] = useState<EditorialIdea[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [view, setView] = useState<View>("grid");
  const [bucket, setBucket] = useState<EditorialIdeaBucket>("pending");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState<EditorialIdeaFormat | "all">("all");
  const [limit, setLimit] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditorialIdea | "new" | null>(openNew ? "new" : null);
  const [deleting, setDeleting] = useState<EditorialIdea | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sheetInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setIdeas(await listEditorialIdeas(workspaceId));
    } catch (cause) {
      setError(cause);
    }
  }, [workspaceId]);

  // Ideias antigas da Produção (guardadas só no navegador) sobem para o bolsão sozinhas, uma vez.
  const migrating = useRef(false);
  useEffect(() => {
    if (!ideas || migrating.current) return;
    const local = readLocalTankIdeas(workspaceId);
    if (local.length === 0) return;
    migrating.current = true;
    void (async () => {
      const migrated: string[] = [];
      for (const old of local) {
        try {
          let created: EditorialIdea;
          try {
            created = await createEditorialIdea(workspaceId, blueprintToIdeaInput(old, true));
          } catch {
            created = await createEditorialIdea(workspaceId, blueprintToIdeaInput(old, false));
          }
          if (old.status === "used") await updateEditorialIdea(workspaceId, created.id, { status: "published" });
          migrated.push(old.id);
        } catch { /* fica no navegador; tenta de novo na próxima visita */ }
      }
      clearLocalTankIdeas(workspaceId, migrated);
      if (migrated.length) {
        toast.success(`${migrated.length} ideia(s) da Produção agora estão no bolsão.`);
        await load();
      }
    })();
  }, [ideas, workspaceId, load]);

  useEffect(() => { void load(); }, [load]);

  // Ideias em produção acompanham a execução real: aguardando aprovação = produzida, concluída =
  // aprovada; falha volta a ideia para disponível.
  const syncedRuns = useRef(new Set<string>());
  useEffect(() => {
    if (!ideas) return;
    const pending = ideas.filter((idea) => idea.status === "in_production" && idea.executionRunId && !syncedRuns.current.has(idea.executionRunId)).slice(0, 15);
    if (pending.length === 0) return;
    void (async () => {
      const updates: EditorialIdea[] = [];
      for (const idea of pending) {
        syncedRuns.current.add(idea.executionRunId!);
        try {
          const detail = await getExecutionRun(workspaceId, idea.executionRunId!);
          const next = statusFromRun(detail.run.state);
          if (next === "failed") updates.push(await updateEditorialIdea(workspaceId, idea.id, { status: "available", executionRunId: null }));
          else if (next) updates.push(await updateEditorialIdea(workspaceId, idea.id, { status: next }));
        } catch { /* execução indisponível: a ideia continua como está */ }
      }
      if (updates.length) setIdeas((current) => current?.map((idea) => updates.find((update) => update.id === idea.id) ?? idea) ?? current);
    })();
  }, [ideas, workspaceId]);

  const categories = useMemo(() => [...new Set((ideas ?? []).map((idea) => idea.category))].sort((a, b) => a.localeCompare(b, "pt-BR")), [ideas]);
  const bucketCount = useMemo(() => {
    const count: Record<EditorialIdeaBucket, number> = { pending: 0, used: 0, inactive: 0 };
    for (const idea of ideas ?? []) count[editorialBucketOf(idea.status)] += 1;
    return count;
  }, [ideas]);
  const pendingWithoutReference = useMemo(() => (ideas ?? []).filter((idea) => idea.status === "available" && idea.format !== "video" && !idea.referenceImages?.length).length, [ideas]);

  const visible = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    return (ideas ?? [])
      .filter((idea) =>
        editorialBucketOf(idea.status) === bucket
        && (categoryFilter === "all" || idea.category === categoryFilter)
        && (formatFilter === "all" || idea.format === formatFilter)
        && (!query || `${idea.externalId} ${idea.title} ${idea.keyMessage} ${idea.category}`.toLowerCase().includes(query)))
      .sort((a, b) =>
        bucket === "used"
          ? b.statusChangedAt.localeCompare(a.statusChangedAt)
          : (a.priority === b.priority ? 0 : a.priority === "high" ? -1 : 1)
            || (a.scheduledDate ?? "9999").localeCompare(b.scheduledDate ?? "9999")
            || (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
            || a.externalId.localeCompare(b.externalId));
  }, [ideas, debouncedSearch, bucket, categoryFilter, formatFilter]);
  useEffect(() => { setLimit(PAGE); }, [debouncedSearch, bucket, categoryFilter, formatFilter]);

  const selected = ideas?.find((idea) => idea.id === selectedId) ?? null;
  const replace = (updated: EditorialIdea) => setIdeas((current) => current?.map((idea) => (idea.id === updated.id ? updated : idea)) ?? current);

  async function runImport(kind: "json" | "sheet", file: File) {
    setBusy(`import-${kind}`);
    try {
      const result = kind === "json"
        ? await importEditorialPack(workspaceId, JSON.parse(await file.text()) as unknown)
        : await importEditorialSpreadsheet(workspaceId, await file.text());
      toast.success(`${result.created} ideia(s) importada(s)${result.skipped ? `; ${result.skipped} já existiam e foram mantidas` : ""}.`);
      setBucket("pending");
      await load();
    } catch (cause) {
      toast.error(cause instanceof SyntaxError ? "O arquivo não é um JSON válido." : cause instanceof Error ? cause.message : "Não foi possível importar.");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
      if (sheetInput.current) sheetInput.current.value = "";
    }
  }

  async function onDownloadTemplate() {
    setBusy("template");
    try {
      await downloadEditorialTemplate();
      toast.success("Modelo baixado. Preencha (pode ser com outra IA) e use Importar planilha.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível baixar o modelo.");
    } finally {
      setBusy(null);
    }
  }

  async function onBuildCalendar() {
    setBusy("calendar");
    try {
      const result = await buildEditorialCalendar(workspaceId);
      setIdeas(result.ideas);
      setView("calendar");
      toast.success(result.scheduled ? `${result.scheduled} ideia(s) distribuídas nos próximos 30 dias, de segunda a sexta.` : "Os próximos 30 dias já estão planejados.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível montar o calendário.");
    } finally {
      setBusy(null);
    }
  }

  async function onPatch(idea: EditorialIdea, patch: Parameters<typeof updateEditorialIdea>[2], key: string) {
    setBusy(`${key}:${idea.id}`);
    try {
      replace(await updateEditorialIdea(workspaceId, idea.id, patch));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    } finally {
      setBusy(null);
    }
  }

  async function onToggleActive(idea: EditorialIdea) {
    const reactivate = idea.status === "archived";
    setBusy(`status:${idea.id}`);
    try {
      replace(await updateEditorialIdea(workspaceId, idea.id, reactivate ? { status: "available", executionRunId: null } : { status: "archived", scheduledDate: null }));
      toast.success(reactivate ? "Ideia reativada: voltou para Pendentes." : "Ideia inativada: o piloto automático não vai usar.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível mudar a ideia.");
    } finally {
      setBusy(null);
    }
  }

  async function onSave(input: EditorialIdeaInput) {
    if (editing && editing !== "new") {
      replace(await saveEditorialIdea(workspaceId, editing.id, input));
      toast.success("Ideia atualizada.");
    } else {
      const created = await createEditorialIdea(workspaceId, input);
      setIdeas((current) => [created, ...(current ?? [])]);
      setBucket("pending");
      toast.success(`Ideia ${created.externalId} cadastrada.`);
    }
    setEditing(null);
  }

  async function onDelete(idea: EditorialIdea) {
    setBusy(`delete:${idea.id}`);
    try {
      await deleteEditorialIdea(workspaceId, idea.id);
      setIdeas((current) => current?.filter((item) => item.id !== idea.id) ?? current);
      if (selectedId === idea.id) setSelectedId(null);
      toast.success("Ideia excluída.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível excluir.");
    } finally {
      setBusy(null);
      setDeleting(null);
    }
  }

  async function onGenerate(idea: EditorialIdea) {
    setBusy(`generate:${idea.id}`);
    try {
      const brief = await getEditorialBrief(workspaceId, idea.id);
      const references = idea.referenceImages ?? [];
      const run = await generateFromIdea({
        workspaceId,
        ...brief,
        channel: "instagram",
        aspectRatio: "4:5",
        ...(references.length ? { referenceImages: references, referenceAssets: references.map((url) => ({ url, role: "product_photo" as const })) } : {}),
      });
      syncedRuns.current.delete(run.executionRunId);
      replace(await updateEditorialIdea(workspaceId, idea.id, { status: "in_production", executionRunId: run.executionRunId }));
      toast.success("Post em criação! Acompanhe na Produção — ele vai para a Revisão antes de qualquer publicação.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível criar o post com esta ideia.");
    } finally {
      setBusy(null);
    }
  }

  const hiddenInputs = (
    <>
      <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void runImport("json", file); }} />
      <input ref={sheetInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void runImport("sheet", file); }} />
    </>
  );

  const header = (
    <>
    <IdeasHubTabs workspaceId={workspaceId} active="ideas" />
    <PageHeader
      title="Bolsão de ideias"
      description="Suas ideias de post num lugar só. Cadastre uma por vez com imagens de referência, ou importe várias por planilha."
      actions={
        <>
          {hiddenInputs}
          <Button variant="ghost" disabled={busy === "template"} onClick={() => void onDownloadTemplate()}>
            <Download className="h-4 w-4" aria-hidden="true" /> {busy === "template" ? "Baixando…" : "Modelo de planilha"}
          </Button>
          <Button variant="secondary" disabled={busy === "import-sheet"} onClick={() => sheetInput.current?.click()}>
            <Upload className="h-4 w-4" aria-hidden="true" /> {busy === "import-sheet" ? "Importando…" : "Importar planilha"}
          </Button>
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Nova ideia
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" aria-label="Mais ações"><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-1">
              <MenuItem icon={CalendarDays} disabled={busy === "calendar" || !bucketCount.pending} onClick={() => void onBuildCalendar()}>Planejar próximos 30 dias</MenuItem>
              <MenuItem icon={FileJson} disabled={busy === "import-json"} onClick={() => fileInput.current?.click()}>Importar pacote JSON</MenuItem>
            </PopoverContent>
          </Popover>
        </>
      }
    />
    </>
  );

  const editor = editing ? (
    <IdeaEditor
      key={editing === "new" ? "new" : editing.id}
      workspaceId={workspaceId}
      idea={editing === "new" ? undefined : editing}
      categories={categories}
      onClose={() => setEditing(null)}
      onSave={onSave}
    />
  ) : null;

  if (error && !ideas) return <>{header}<ErrorState error={error} onRetry={() => void load()} /></>;
  if (!ideas) {
    return (
      <>
        {header}
        <Skeleton className="mb-4 h-11 w-full max-w-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-72 w-full rounded-xl" />)}</div>
      </>
    );
  }

  if (ideas.length === 0) {
    return (
      <>
        {header}
        <section className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-10 sm:px-10">
          <div className="mx-auto max-w-2xl text-center">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary"><Lightbulb className="h-6 w-6" aria-hidden="true" /></span>
            <h2 className="text-xl font-semibold text-foreground">Seu bolsão está vazio</h2>
            <p className="mt-2 text-sm text-muted-foreground">Comece cadastrando uma ideia. Anexe fotos de referência (produto, cliente, tela) para a arte sair com a cara da sua marca.</p>
          </div>
          <div className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
            <StartTile icon={Plus} title="Cadastrar ideia" description="Uma por vez, com imagens de referência." primary onClick={() => setEditing("new")} />
            <StartTile icon={Upload} title="Importar planilha" description="Várias ideias de uma vez, em CSV." disabled={busy === "import-sheet"} onClick={() => sheetInput.current?.click()} />
            <StartTile icon={Download} title="Baixar modelo" description="Planilha no padrão para preencher." disabled={busy === "template"} onClick={() => void onDownloadTemplate()} />
          </div>
        </section>
        {editor}
      </>
    );
  }

  const scheduled = ideas.filter((idea) => idea.scheduledDate && idea.status !== "archived").sort((a, b) => a.scheduledDate!.localeCompare(b.scheduledDate!));
  const shown = visible.slice(0, limit);

  return (
    <>
      {header}

      <div className="mb-4 flex flex-wrap items-center gap-2 overflow-x-auto" role="tablist" aria-label="Situação das ideias">
        {BUCKETS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={bucket === item}
            onClick={() => setBucket(item)}
            className={cn(
              "inline-flex min-h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
              bucket === item ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {EDITORIAL_BUCKET_LABEL[item]}
            <span className={cn("rounded-full px-1.5 text-xs tabular-nums", bucket === item ? "bg-primary-foreground/20" : "bg-muted")}>{bucketCount[item]}</span>
          </button>
        ))}
      </div>

      {bucket === "pending" && pendingWithoutReference > 0 ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <Images className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {pendingWithoutReference} ideia(s) pendente(s) sem imagem de referência. Anexe uma foto para a arte sair com a cara da marca.
        </p>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título, texto ou código" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Assunto" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os assuntos</SelectItem>
            {categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={formatFilter} onValueChange={(value: EditorialIdeaFormat | "all") => setFormatFilter(value)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Formato" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os formatos</SelectItem>
            {(Object.keys(EDITORIAL_FORMAT_LABEL) as EditorialIdeaFormat[]).map((format) => <SelectItem key={format} value={format}>{EDITORIAL_FORMAT_LABEL[format]}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="inline-flex rounded-lg border border-border bg-card p-1" role="group" aria-label="Visualização">
          {([["grid", LayoutGrid, "Cards"], ["list", List, "Lista"], ["calendar", CalendarDays, "Calendário"]] as const).map(([option, Icon, label]) => (
            <Tooltip key={option}>
              <TooltipTrigger asChild>
                <button type="button" aria-label={label} aria-pressed={view === option} onClick={() => setView(option)} className={cn("flex h-8 w-9 items-center justify-center rounded-md", view === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>

      {view === "calendar" ? (
        scheduled.length === 0 ? (
          <EmptyBox title="Nenhuma ideia no calendário" description="Planeje os próximos 30 dias: uma ideia pendente por dia útil, alternando assuntos e formatos." action={<Button onClick={() => void onBuildCalendar()}>Planejar próximos 30 dias</Button>} />
        ) : (
          <Card><CardContent className="divide-y divide-border p-0">
            {scheduled.map((idea) => (
              <button key={idea.id} type="button" onClick={() => setSelectedId(idea.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted/50">
                <span className="w-24 shrink-0 text-sm font-medium tabular-nums text-foreground">{formatDay(idea.scheduledDate)}</span>
                <Thumb idea={idea} className="h-10 w-10 rounded-md" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{idea.title}</span>
                <span className="text-xs text-muted-foreground">{idea.category} · {EDITORIAL_FORMAT_LABEL[idea.format]}</span>
                <StatusPill status={idea.status} />
              </button>
            ))}
          </CardContent></Card>
        )
      ) : visible.length === 0 ? (
        <EmptyBox
          title={bucket === "pending" && bucketCount.pending === 0 ? "Nenhuma ideia pendente" : "Nada com esses filtros"}
          description={bucket === "pending" && bucketCount.pending === 0 ? "Todas as ideias já foram usadas ou estão em andamento. Cadastre novas para continuar postando." : "Limpe a busca ou escolha outro assunto/formato."}
          action={bucket === "pending" ? <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden="true" /> Nova ideia</Button> : undefined}
        />
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              busy={busy}
              onOpen={() => setSelectedId(idea.id)}
              onEdit={() => setEditing(idea)}
              onToggleActive={() => void onToggleActive(idea)}
              onDelete={() => setDeleting(idea)}
              onCreate={() => void onGenerate(idea)}
            />
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14" />
                <TableHead>Ideia</TableHead>
                <TableHead className="hidden md:table-cell">Assunto</TableHead>
                <TableHead className="hidden sm:table-cell">Formato</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Data</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((idea) => (
                <TableRow key={idea.id} className="cursor-pointer" onClick={() => setSelectedId(idea.id)}>
                  <TableCell><Thumb idea={idea} className="h-10 w-10 rounded-md" /></TableCell>
                  <TableCell className="max-w-md">
                    <p className="truncate font-medium text-foreground">{idea.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{idea.externalId}{idea.priority === "high" ? " · Prioridade alta" : ""}</p>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{idea.category}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{EDITORIAL_FORMAT_LABEL[idea.format]}</TableCell>
                  <TableCell><StatusPill status={idea.status} /></TableCell>
                  <TableCell className="hidden text-right text-sm tabular-nums text-muted-foreground lg:table-cell">{formatDay(idea.scheduledDate)}</TableCell>
                  <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <IdeaActions idea={idea} onEdit={() => setEditing(idea)} onToggleActive={() => void onToggleActive(idea)} onDelete={() => setDeleting(idea)} />
                      {idea.format === "video" || idea.status === "archived" ? null : <CreatePostButton idea={idea} busy={busy} size="sm" onCreate={() => void onGenerate(idea)} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {view !== "calendar" && visible.length > limit ? (
        <div className="mt-5 flex justify-center">
          <Button variant="secondary" onClick={() => setLimit((current) => current + PAGE)}>Mostrar mais ({visible.length - limit})</Button>
        </div>
      ) : null}

      {selected ? (
        <EditorialIdeaDetail
          idea={selected}
          busy={busy}
          onClose={() => setSelectedId(null)}
          onEdit={() => setEditing(selected)}
          onDelete={() => setDeleting(selected)}
          onToggleUsed={() => void onPatch(selected, selected.status === "available" ? { status: "published" } : { status: "available", executionRunId: null }, "status")}
          onToggleActive={() => void onToggleActive(selected)}
          onScheduleChange={(scheduledDate) => void onPatch(selected, { scheduledDate }, "date")}
          onGenerate={() => void onGenerate(selected)}
        />
      ) : null}

      {editor}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Excluir esta ideia?"
        description={deleting ? `"${deleting.title}" sai do bolsão. Posts já criados ou publicados com ela continuam onde estão.` : ""}
        confirmLabel="Excluir"
        variant="danger"
        busy={Boolean(deleting && busy === `delete:${deleting.id}`)}
        onConfirm={() => (deleting ? onDelete(deleting) : undefined)}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function MenuItem({ icon: Icon, children, onClick, disabled }: { icon: LucideIcon; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-muted disabled:opacity-50">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> {children}
    </button>
  );
}

function StartTile({ icon: Icon, title, description, onClick, primary, disabled }: { icon: LucideIcon; title: string; description: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:opacity-60",
        primary ? "border-primary bg-primary/10 hover:bg-primary/15" : "border-border bg-card hover:border-primary/50",
      )}
    >
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", primary ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <span>
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

function EmptyBox({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-12 text-center">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Capa da ideia: 1ª imagem de referência; sem imagem, um bloco com o ícone do formato. */
function Thumb({ idea, className, large }: { idea: EditorialIdea; className?: string; large?: boolean }) {
  const cover = idea.referenceImages?.[0];
  const Icon = FORMAT_ICON[idea.format];
  if (cover) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={referenceThumb(cover, large ? 480 : 160)} alt="" loading="lazy" className={cn("object-cover", className)} />;
  }
  return (
    <span className={cn("flex items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-muted text-primary", className)}>
      <Icon className={large ? "h-8 w-8" : "h-4 w-4"} aria-hidden="true" />
    </span>
  );
}

function IdeaCard({ idea, busy, onOpen, onEdit, onToggleActive, onDelete, onCreate }: { idea: EditorialIdea; busy: string | null; onOpen: () => void; onEdit: () => void; onToggleActive: () => void; onDelete: () => void; onCreate: () => void }) {
  const Icon = FORMAT_ICON[idea.format];
  const refs = idea.referenceImages?.length ?? 0;
  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
      <button type="button" onClick={onOpen} className="relative block aspect-[4/3] w-full overflow-hidden text-left" aria-label={`Abrir ${idea.title}`}>
        <Thumb idea={idea} large className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]" />
        <span className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
          <StatusPill status={idea.status} className="shadow-sm backdrop-blur" />
          <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
            <Icon className="h-3 w-3" aria-hidden="true" /> {EDITORIAL_FORMAT_LABEL[idea.format]}
          </span>
        </span>
        <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
          {refs > 1 ? <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white"><Images className="h-3 w-3" aria-hidden="true" /> {refs}</span> : <span />}
          {idea.priority === "high" ? <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-black">Prioridade</span> : null}
        </span>
        {!refs && idea.format !== "video" ? <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent p-2.5 pt-6 text-xs text-white/90">Sem imagem de referência</span> : null}
      </button>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <p className="truncate text-xs text-muted-foreground">{idea.externalId} · {idea.category}</p>
        <button type="button" onClick={onOpen} className="line-clamp-2 text-left text-sm font-semibold leading-snug text-foreground hover:underline">{idea.title}</button>
        {idea.keyMessage && idea.keyMessage !== idea.title ? <p className="line-clamp-2 text-xs text-muted-foreground">{idea.keyMessage}</p> : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <span className="text-xs tabular-nums text-muted-foreground">{idea.status !== "available" ? `Usada ${new Date(idea.statusChangedAt).toLocaleDateString("pt-BR")}` : idea.scheduledDate ? formatDay(idea.scheduledDate) : ""}</span>
          <div className="flex gap-1">
            <IdeaActions idea={idea} onEdit={onEdit} onToggleActive={onToggleActive} onDelete={onDelete} />
            {idea.status === "archived" ? null : idea.format === "video" ? <Button size="sm" variant="secondary" onClick={onOpen}>Ver roteiro</Button> : <CreatePostButton idea={idea} busy={busy} size="sm" onCreate={onCreate} />}
          </div>
        </div>
      </div>
    </article>
  );
}

function EditorialIdeaDetail({ idea, busy, onClose, onEdit, onDelete, onToggleUsed, onToggleActive, onScheduleChange, onGenerate }: {
  idea: EditorialIdea;
  busy: string | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleUsed: () => void;
  onToggleActive: () => void;
  onScheduleChange: (date: string | null) => void;
  onGenerate: () => void;
}) {
  const [date, setDate] = useState(idea.scheduledDate ?? "");
  useEffect(() => { setDate(idea.scheduledDate ?? ""); }, [idea.scheduledDate]);
  const refs = idea.referenceImages ?? [];

  return (
    <DetailModal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      eyebrow={`${idea.externalId} · ${idea.category}`}
      title={idea.title}
      description={
        <div className="flex flex-wrap gap-2">
          <StatusPill status={idea.status} />
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{EDITORIAL_FORMAT_LABEL[idea.format]}</span>
          {idea.priority === "high" ? <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">Prioridade alta</span> : null}
        </div>
      }
      srDescription="Detalhes da ideia do bolsão."
      widthStorageKey="vorix.editorial-ideas.detail.width"
      defaultWidthPercent={62}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {idea.format === "video" || idea.status === "archived" ? null : <CreatePostButton idea={idea} busy={busy} onCreate={onGenerate} />}
          <Button variant="secondary" onClick={onEdit}><Pencil className="h-4 w-4" aria-hidden="true" /> Editar</Button>
          {idea.status === "archived" ? null : (
            <Button variant="ghost" disabled={busy === `status:${idea.id}`} onClick={onToggleUsed}>
              {idea.status === "available" ? <><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Marcar como usada</> : <><RotateCcw className="h-4 w-4" aria-hidden="true" /> Voltar para pendente</>}
            </Button>
          )}
          <Button variant="ghost" disabled={busy === `status:${idea.id}`} onClick={onToggleActive}>
            {idea.status === "archived" ? <><Power className="h-4 w-4" aria-hidden="true" /> Reativar</> : <><PowerOff className="h-4 w-4" aria-hidden="true" /> Inativar</>}
          </Button>
          <Button variant="ghost" onClick={() => { void navigator.clipboard.writeText(idea.caption).then(() => toast.success("Legenda copiada.")); }}>Copiar legenda</Button>
          <Button variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="h-4 w-4" aria-hidden="true" /> Excluir</Button>
        </div>
      }
    >
      <div className="space-y-6">
        <DetailBlock label={`Imagens de referência (${refs.length})`} action={<Button size="sm" variant="ghost" onClick={onEdit}>{refs.length ? "Trocar" : "Adicionar"}</Button>}>
          {refs.length ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {refs.map((url, index) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={referenceThumb(url, 160)} alt={`Referência ${index + 1}`} className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4" aria-hidden="true" /> Sem imagens. Anexe fotos para a arte partir delas.</p>
          )}
        </DetailBlock>
        <DetailBlock label="Texto da arte"><p className="text-sm font-medium text-foreground">{idea.keyMessage}</p></DetailBlock>
        {idea.carouselScript ? (
          <DetailBlock label="Telas do carrossel">
            <ol className="space-y-2">{idea.carouselScript.map((slide, index) => (
              <li key={index} className="text-sm"><span className="font-medium tabular-nums text-foreground">{index + 1}. {slide.headline}</span>{slide.body && slide.body !== slide.headline ? <span className="block text-muted-foreground">{slide.body}</span> : null}</li>
            ))}</ol>
          </DetailBlock>
        ) : null}
        {idea.videoScript ? (
          <DetailBlock label="Roteiro do vídeo">
            <ol className="space-y-2">{idea.videoScript.map((scene, index) => (
              <li key={index} className="text-sm"><span className="font-medium tabular-nums text-foreground">{scene.time} · {scene.visual}</span><span className="block text-muted-foreground">{scene.text}</span></li>
            ))}</ol>
          </DetailBlock>
        ) : null}
        <DetailBlock label="Legenda"><p className="whitespace-pre-wrap break-words text-sm text-foreground">{idea.caption}</p></DetailBlock>
        <div className="grid gap-4 md:grid-cols-2">
          <DetailBlock label="Chamada para ação"><p className="text-sm text-foreground">{idea.cta}</p></DetailBlock>
          <DetailBlock label="Público-alvo"><p className="text-sm text-foreground">{idea.targetAudience}</p></DetailBlock>
        </div>
        {idea.creativePrompt || (idea.visualDirection && idea.approach !== "Cadastro manual") ? (
          <DetailBlock label="Prompt para a IA"><p className="whitespace-pre-wrap text-sm text-foreground">{idea.creativePrompt ?? idea.visualDirection}</p></DetailBlock>
        ) : null}
        <DetailBlock label="Calendário">
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-44" />
            <Button variant="secondary" disabled={!date || date === idea.scheduledDate || busy === `date:${idea.id}`} onClick={() => onScheduleChange(date)}>Agendar</Button>
            {idea.scheduledDate ? <Button variant="ghost" disabled={busy === `date:${idea.id}`} onClick={() => onScheduleChange(null)}>Tirar do calendário</Button> : null}
          </div>
        </DetailBlock>
      </div>
    </DetailModal>
  );
}

/** Menu "⋯" da ideia: editar, inativar/reativar e excluir. */
function IdeaActions({ idea, onEdit, onToggleActive, onDelete }: { idea: EditorialIdea; onEdit: () => void; onToggleActive: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => () => { setOpen(false); action(); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Ações da ideia ${idea.title}`}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        <MenuItem icon={Pencil} onClick={run(onEdit)}>Editar</MenuItem>
        <MenuItem icon={idea.status === "archived" ? Power : PowerOff} onClick={run(onToggleActive)}>{idea.status === "archived" ? "Reativar" : "Inativar"}</MenuItem>
        <button type="button" onClick={run(onDelete)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10">
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Excluir
        </button>
      </PopoverContent>
    </Popover>
  );
}

/** "Criar post" com o motivo do bloqueio no tooltip (nunca escondido). */
function CreatePostButton({ idea, busy, onCreate, size }: { idea: EditorialIdea; busy: string | null; onCreate: () => void; size?: "sm" }) {
  const blocked = createBlockedReason(idea);
  const creating = busy === `generate:${idea.id}`;
  const button = <Button size={size} disabled={Boolean(blocked) || Boolean(busy?.startsWith("generate:"))} onClick={onCreate}>{creating ? "Criando…" : "Criar post"}</Button>;
  if (!blocked) return button;
  return <Tooltip><TooltipTrigger asChild><span tabIndex={0} className="inline-flex">{button}</span></TooltipTrigger><TooltipContent>{blocked}</TooltipContent></Tooltip>;
}
