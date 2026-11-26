"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { CheckCircle2, Download, FolderOpen, ImageIcon, Loader2, Paperclip, Send, Video, X } from "lucide-react";
import { Button } from "@/components/Button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { cn } from "@/lib/utils";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useAssets } from "@/features/assets/hooks";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { createHref } from "@/features/marketing/create-routes";
import {
  ACTIVE_STATUSES,
  STATUS_LABEL,
  approveVideoVersion,
  cancelVideoVersion,
  createVideoProject,
  getVideoProject,
  listVideoProjects,
  requestVideoChange,
  type VideoAspect,
  type VideoEngineStatus,
  type VideoMaterialRole,
  type VideoSettings,
  type VideoVersionView,
} from "./api";

type Source = "footage" | "images";
type Material = { url: string; role: VideoMaterialRole; isVideo: boolean; name: string };

const ASPECTS: { value: VideoAspect; label: string; w: number; h: number }[] = [
  { value: "9:16", label: "Reels/Stories", w: 9, h: 16 },
  { value: "1:1", label: "Feed", w: 1, h: 1 },
  { value: "16:9", label: "YouTube/site", w: 16, h: 9 },
];
const DURATIONS: { value?: number; label: string }[] = [{ label: "Automática" }, { value: 15, label: "15 s" }, { value: 20, label: "20 s" }, { value: 30, label: "30 s" }, { value: 45, label: "45 s" }, { value: 60, label: "60 s" }];
const STYLES: { value: VideoSettings["editing"]; label: string }[] = [{ value: "dinamico", label: "Dinâmico" }, { value: "elegante", label: "Elegante" }, { value: "direto", label: "Direto" }];
const TRANSITIONS: { value: VideoSettings["transitions"]; label: string }[] = [{ value: "suaves", label: "Suaves" }, { value: "moderadas", label: "Moderadas" }, { value: "marcantes", label: "Marcantes" }];
const ROLE_OPTIONS: Record<Source, { value: VideoMaterialRole; label: string }[]> = {
  footage: [{ value: "footage", label: "Gravação" }, { value: "screen_recording", label: "Gravação de tela" }],
  images: [{ value: "product_photo", label: "Produto" }, { value: "screenshot", label: "Tela do sistema" }, { value: "reference", label: "Referência" }],
};
const PLACEHOLDER: Record<Source, string> = {
  footage: "Ex.: Transforme esta gravação em um Reels de 30 segundos. Escolha os melhores momentos, remova pausas, legendas animadas e uma abertura chamativa.",
  images: "Ex.: Crie um anúncio de 20 segundos com estas fotos, abertura impactante, movimentos suaves, destaque para o produto e chamada para comprar.",
};
const CHANGE_SUGGESTIONS = ["Deixe a abertura mais impactante", "Reduza para 15 segundos", "Mostre mais o produto", "Deixe as transições mais suaves", "Mude o texto do final", "Faça uma versão mais premium"];

const chip = (active: boolean) => cn("min-h-9 rounded-lg px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-60", active ? "bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground");

export function VideoCreateFlow({ status }: { status: VideoEngineStatus }) {
  const projectId = useSearchParams().get("projeto");
  return projectId ? <VideoProjectPanel projectId={projectId} /> : <NewVideo status={status} />;
}

function NewVideo({ status }: { status: VideoEngineStatus }) {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const { data: assets } = useAssets(workspace.id);
  const recent = useSWR(["video-projects", workspace.id], () => listVideoProjects(workspace.id));
  const [source, setSource] = useState<Source>("images");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [request, setRequest] = useState("");
  const [aspect, setAspect] = useState<VideoAspect>("9:16");
  const [duration, setDuration] = useState<number | undefined>();
  const [editing, setEditing] = useState<VideoSettings["editing"]>("dinamico");
  const [transitions, setTransitions] = useState<VideoSettings["transitions"]>("moderadas");
  const [captions, setCaptions] = useState(true);
  const [music, setMusic] = useState(status.musicLibraryAvailable);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const libraryImages = (assets ?? []).filter((asset) => asset.status === "active" && asset.storageRef?.metadata?.url && /\.(jpe?g|png|webp)(\?|$)/i.test(asset.storageRef.metadata.url) && asset.kind !== "logo");
  const canGenerate = materials.length > 0 && request.trim().length >= 8 && !busy && !uploading;

  function choose(next: Source) {
    if (next === source) return;
    setSource(next);
    setMaterials([]);
    setError(null);
  }

  async function attach(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of list) {
        const isVideo = file.type.startsWith("video/");
        if ((source === "footage") !== isVideo) throw new Error(source === "footage" ? "Envie vídeos (MP4 ou MOV) nesta opção." : "Envie imagens (JPEG, PNG ou WEBP) nesta opção.");
        const uploaded = await uploadPublicationMedia(workspace.id, file);
        setMaterials((prev) => (prev.length >= status.limits.maxMaterials ? prev : [...prev, { url: uploaded.url, role: isVideo ? "footage" : "product_photo", isVideo, name: file.name }]));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar o arquivo.");
    } finally {
      setUploading(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const settings: VideoSettings = { ...(duration ? { targetDurationSeconds: duration } : {}), editing, transitions, captions: source === "footage" ? captions : false, music: status.musicLibraryAvailable && music };
      const created = await createVideoProject({ workspaceId: workspace.id, aspect, request: request.trim(), settings, materials: materials.map((m) => ({ url: m.url, role: m.role, label: m.name.slice(0, 80) })) });
      router.push(createHref(workspace.id, "video", new URLSearchParams({ projeto: created.projectId })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível iniciar o vídeo.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="video-create">
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Como você quer criar o vídeo">
        {([
          { value: "footage" as const, title: "Editar vídeo", text: "Envie gravações. A IA escolhe os melhores momentos, corta pausas e coloca legendas.", icon: Video },
          { value: "images" as const, title: "Criar vídeo com imagens", text: "Use fotos de produto ou telas. A IA monta um anúncio com movimento, textos e chamada final.", icon: ImageIcon },
        ]).map((option) => (
          <button key={option.value} type="button" role="radio" aria-checked={source === option.value} disabled={busy} onClick={() => choose(option.value)} className={cn("flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors", source === option.value ? "border-solution/60 bg-solution/10" : "border-border/70 bg-card hover:border-solution/45")}>
            <span aria-hidden="true" className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", source === option.value ? "bg-solution/20 text-solution" : "bg-muted")}><option.icon className="h-[18px] w-[18px]" /></span>
            <span><span className="block font-semibold text-foreground">{option.title}</span><span className="mt-1 block text-sm text-muted-foreground">{option.text}</span></span>
          </button>
        ))}
      </div>

      <Card className="p-5 sm:p-6">
        <Label htmlFor="video-request">O que você quer no vídeo?</Label>
        <textarea id="video-request" rows={4} value={request} maxLength={status.limits.maxRequestChars} disabled={busy} onChange={(event) => setRequest(event.target.value)} placeholder={PLACEHOLDER[source]} className="mt-2 w-full resize-none border-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/70 disabled:opacity-60" />
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <button type="button" disabled={busy || uploading} onClick={() => fileInput.current?.click()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60">
            <Paperclip className="h-4 w-4" aria-hidden="true" /> {uploading ? "Enviando…" : source === "footage" ? "Enviar vídeos" : "Enviar imagens"}
          </button>
          {source === "images" ? (
            <button type="button" disabled={busy} onClick={() => setLibraryOpen(true)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60">
              <FolderOpen className="h-4 w-4" aria-hidden="true" /> Da biblioteca
            </button>
          ) : null}
          <input ref={fileInput} type="file" multiple className="hidden" accept={source === "footage" ? "video/mp4,video/quicktime" : "image/jpeg,image/png,image/webp"} onChange={(event) => { void attach(event.target.files); event.target.value = ""; }} />
          <span className="text-xs text-muted-foreground/70">{materials.length}/{status.limits.maxMaterials} materiais</span>
        </div>
        {materials.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {materials.map((material, index) => (
              <li key={material.url} className="flex items-center gap-1.5 rounded-lg bg-muted p-1.5">
                {material.isVideo ? <span className="flex h-10 w-10 items-center justify-center rounded-md bg-card text-muted-foreground"><Video className="h-4 w-4" aria-hidden="true" /></span> : /* eslint-disable-next-line @next/next/no-img-element */ <img src={material.url} alt="" className="h-10 w-10 rounded-md object-cover" />}
                <select aria-label={`Tipo do material ${index + 1}`} value={material.role} disabled={busy} onChange={(event) => setMaterials((prev) => prev.map((m) => (m.url === material.url ? { ...m, role: event.target.value as VideoMaterialRole } : m)))} className="rounded bg-transparent text-xs text-muted-foreground">
                  {ROLE_OPTIONS[source].map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                </select>
                <button type="button" aria-label="Remover" disabled={busy} onClick={() => setMaterials((prev) => prev.filter((m) => m.url !== material.url))} className="rounded p-0.5 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Formato</p>
          <div className="flex flex-wrap gap-2">
            {ASPECTS.map((option) => (
              <button key={option.value} type="button" disabled={busy} onClick={() => setAspect(option.value)} className={cn(chip(aspect === option.value), "flex items-center gap-2")}>
                <span aria-hidden="true" className={cn("block rounded-[2px]", aspect === option.value ? "bg-primary" : "bg-muted-foreground/70")} style={{ width: option.w >= option.h ? 16 : Math.round((16 * option.w) / option.h), height: option.h >= option.w ? 16 : Math.round((16 * option.h) / option.w) }} />
                {option.value} <span className="text-muted-foreground/70">· {option.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Duração</p>
          <div className="flex flex-wrap gap-2">{DURATIONS.map((option) => <button key={option.label} type="button" disabled={busy} onClick={() => setDuration(option.value)} className={chip(duration === option.value)}>{option.label}</button>)}</div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Estilo de edição</p>
          <div className="flex flex-wrap gap-2">{STYLES.map((option) => <button key={option.value} type="button" disabled={busy} onClick={() => setEditing(option.value)} className={chip(editing === option.value)}>{option.label}</button>)}</div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Transições</p>
          <div className="flex flex-wrap gap-2">{TRANSITIONS.map((option) => <button key={option.value} type="button" disabled={busy} onClick={() => setTransitions(option.value)} className={chip(transitions === option.value)}>{option.label}</button>)}</div>
        </div>
        {source === "footage" ? (
          <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={captions} disabled={busy} onChange={(event) => setCaptions(event.target.checked)} /> Legendas automáticas da fala</label>
        ) : null}
        {status.musicLibraryAvailable ? (
          <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={music} disabled={busy} onChange={(event) => setMusic(event.target.checked)} /> Trilha sonora (biblioteca licenciada)</label>
        ) : null}
      </section>

      <p className="text-xs text-muted-foreground">Marca: <span className="font-medium text-foreground">{workspace.name}</span> — cores, fontes e logo do Perfil da Marca deste espaço.</p>

      {error ? <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p> : null}

      <div className="flex justify-end border-t border-border/60 pt-4">
        <Button size="xl" loading={busy} disabled={!canGenerate} onClick={() => void generate()}>Gerar vídeo</Button>
      </div>

      {recent.data && recent.data.length > 0 ? (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Vídeos recentes</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {recent.data.slice(0, 6).map((project) => (
              <li key={project.id}>
                <Link href={createHref(workspace.id, "video", new URLSearchParams({ projeto: project.id }))} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-3 py-2 text-sm hover:bg-muted/40">
                  <span className="truncate">{project.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{project.latest ? STATUS_LABEL[project.latest.status] : "—"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {libraryOpen ? (
        <Modal title="Escolher da biblioteca" onClose={() => setLibraryOpen(false)}>
          {libraryImages.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma imagem na biblioteca.</p> : (
            <div className="grid grid-cols-3 gap-2">
              {libraryImages.map((asset) => (
                <button key={asset.id} type="button" onClick={() => { const url = asset.storageRef!.metadata!.url!; setMaterials((prev) => (prev.some((m) => m.url === url) || prev.length >= status.limits.maxMaterials ? prev : [...prev, { url, role: asset.materialType === "screenshot_site" || asset.materialType === "screenshot_app" ? "screenshot" : "product_photo", isVideo: false, name: asset.name }])); setLibraryOpen(false); }} className="overflow-hidden rounded-lg bg-muted text-left hover:ring-2 hover:ring-primary">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.storageRef?.metadata?.url} alt="" className="aspect-square w-full object-cover" />
                  <p className="truncate px-1.5 py-1 text-[11px] text-muted-foreground">{asset.name}</p>
                </button>
              ))}
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}

function VideoProjectPanel({ projectId }: { projectId: string }) {
  const workspace = useCurrentWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [change, setChange] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = useSWR(["video-project", workspace.id, projectId], () => getVideoProject(workspace.id, projectId), {
    refreshInterval: (data) => (data?.versions.some((v) => ACTIVE_STATUSES.includes(v.status)) ? 2_000 : 0),
  });
  const versions = project.data?.versions ?? [];
  const selected = versions.find((v) => v.id === selectedId) ?? versions[0];
  const active = versions.some((v) => ACTIVE_STATUSES.includes(v.status));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await project.mutate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }

  if (project.error) return <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">Não foi possível abrir este vídeo.</p>;
  if (!project.data || !selected) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>;
  const ratio = project.data.aspect.replace(":", "/");
  const publishHref = selected.videoUrl ? createHref(workspace.id, "pronto", new URLSearchParams({ media: selected.videoUrl, source: `video-${selected.id}` })) : undefined;

  return (
    <div className="space-y-5" data-testid="video-project">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-semibold text-foreground">{project.data.title}</h2>
          <p className="text-xs text-muted-foreground">{project.data.aspect} · {project.data.materials.length} materiais · versão {selected.number}</p>
        </div>
        <Link href={createHref(workspace.id, "video")} className="text-sm font-medium text-primary hover:underline">Novo vídeo</Link>
      </div>

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Card className="overflow-hidden bg-black/90 p-0">
            <div className="mx-auto w-full" style={{ aspectRatio: ratio, maxHeight: "70vh", maxWidth: project.data.aspect === "9:16" ? "min(100%, 39vh)" : "100%" }}>
              {selected.videoUrl ? (
                <video key={selected.id} controls playsInline poster={selected.posterUrl} src={selected.videoUrl} className="h-full w-full" />
              ) : ACTIVE_STATUSES.includes(selected.status) ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white">
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                  <p className="text-sm">{selected.message ?? STATUS_LABEL[selected.status]}</p>
                  <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuenow={selected.progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-white" style={{ width: `${selected.progress}%` }} /></div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/80">{selected.error ?? STATUS_LABEL[selected.status]}</div>
              )}
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", selected.status === "approved" || selected.status === "ready_for_review" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : selected.status === "failed" || selected.status === "needs_revision" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{STATUS_LABEL[selected.status]}</span>
            {ACTIVE_STATUSES.includes(selected.status) ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => cancelVideoVersion(workspace.id, selected.id))}>Cancelar</Button> : null}
            {selected.status === "ready_for_review" ? <Button size="sm" loading={busy} onClick={() => void run(() => approveVideoVersion(workspace.id, selected.id))}><CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" /> Aprovar versão</Button> : null}
            {selected.status === "approved" && publishHref ? <Link href={publishHref} className="inline-flex min-h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Publicar ou agendar</Link> : null}
            {selected.videoUrl ? <a href={selected.videoUrl} download className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><Download className="h-4 w-4" aria-hidden="true" /> Baixar MP4</a> : null}
          </div>
          {selected.status === "approved" ? <p className="text-xs text-muted-foreground">A publicação segue as regras da marca: se ela exige aprovação pelo WhatsApp, o post só sai depois do OK.</p> : null}

          {selected.gate ? (
            <details className="rounded-xl border border-border/60 bg-card px-4 py-3" open={selected.status === "needs_revision"}>
              <summary className="cursor-pointer text-sm font-medium text-foreground">Controle de qualidade: {selected.gate.checks.filter((c) => c.status === "pass").length} ok · {selected.gate.checks.filter((c) => c.status === "warn").length} avisos · {selected.gate.checks.filter((c) => c.status === "fail").length} falhas</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {selected.gate.checks.map((check) => <li key={check.id} className={cn(check.status === "fail" ? "text-destructive" : check.status === "warn" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{check.status === "pass" ? "✓" : check.status === "fail" ? "✗" : check.status === "warn" ? "!" : "•"} {check.label} — {check.detail}</li>)}
              </ul>
            </details>
          ) : null}
          {selected.rationale ? <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Ideia da edição:</span> {selected.rationale}</p> : null}

          <Card className="p-4">
            <Label htmlFor="video-change">Pedir alteração</Label>
            <div className="mt-2 flex gap-2">
              <input id="video-change" value={change} maxLength={1500} disabled={busy || active} onChange={(event) => setChange(event.target.value)} placeholder="Ex.: Deixe a abertura mais impactante" className="min-h-10 flex-1 rounded-lg border border-border/70 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60" />
              <Button aria-label="Enviar alteração" disabled={busy || active || change.trim().length < 8} onClick={() => void run(async () => { await requestVideoChange(workspace.id, projectId, change.trim(), selected.id); setChange(""); setSelectedId(null); })}><Send className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CHANGE_SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" disabled={busy || active} onClick={() => setChange(suggestion)} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60">{suggestion}</button>)}
            </div>
            {active ? <p className="mt-2 text-xs text-muted-foreground">Aguarde a versão em produção terminar para pedir outra alteração.</p> : null}
          </Card>
          {error ? <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p> : null}
        </div>

        <aside aria-label="Versões" className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Versões</p>
          <ul className="space-y-2">
            {versions.map((version: VideoVersionView) => (
              <li key={version.id}>
                <button type="button" onClick={() => setSelectedId(version.id)} className={cn("w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors", version.id === selected.id ? "border-solution/60 bg-solution/10" : "border-border/60 bg-card hover:bg-muted/40")}>
                  <span className="flex items-center justify-between gap-2"><span className="font-medium">Versão {version.number}</span><span className="text-xs text-muted-foreground">{STATUS_LABEL[version.status]}</span></span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{version.request}</span>
                  {version.durationSeconds ? <span className="mt-0.5 block text-[11px] text-muted-foreground/80">{version.durationSeconds.toFixed(1)} s{version.strategy ? ` · ${version.strategy}` : ""}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
