"use client";

import { ChevronDown, Film, GalleryHorizontal, ImageIcon, ImagePlus, Plus, Trash2, X, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Input } from "@/components/Field";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { cn } from "@/lib/utils";
import { referenceThumb } from "./reference-images";
import type { EditorialIdea, EditorialIdeaFormat, EditorialIdeaInput } from "./api";

export const MAX_REFERENCE_IMAGES = 6;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const FORMAT_OPTIONS: { value: EditorialIdeaFormat; label: string; hint: string; icon: LucideIcon }[] = [
  { value: "single_image", label: "Imagem única", hint: "Um post com uma arte", icon: ImageIcon },
  { value: "carousel", label: "Carrossel", hint: "2 a 10 telas em sequência", icon: GalleryHorizontal },
  { value: "video", label: "Vídeo curto", hint: "Reels, Shorts ou TikTok", icon: Film },
];

type Slide = { headline: string; body: string };

function initialSlides(idea?: EditorialIdea): Slide[] {
  if (idea?.carouselScript?.length) return idea.carouselScript.map((slide) => ({ ...slide }));
  return [{ headline: "", body: "" }, { headline: "", body: "" }, { headline: "", body: "" }];
}

/**
 * Cadastro/edição de UMA ideia do bolsão. Só título e formato são obrigatórios; o resto é opcional e
 * o servidor completa com padrões derivados do título. As imagens de referência sobem para o storage
 * do workspace na hora e são a base visual da arte (no lugar de banco de fotos genérico).
 */
export function IdeaEditor({ workspaceId, idea, categories, onClose, onSave }: {
  workspaceId: string;
  idea?: EditorialIdea;
  categories: string[];
  onClose: () => void;
  onSave: (input: EditorialIdeaInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(idea?.title ?? "");
  const [format, setFormat] = useState<EditorialIdeaFormat>(idea?.format ?? "single_image");
  const [category, setCategory] = useState(idea && idea.category !== "Geral" ? idea.category : "");
  const [priorityHigh, setPriorityHigh] = useState(idea?.priority === "high");
  const [keyMessage, setKeyMessage] = useState(idea && idea.keyMessage !== idea.title ? idea.keyMessage : "");
  const [slides, setSlides] = useState<Slide[]>(() => initialSlides(idea));
  const [references, setReferences] = useState<string[]>(idea?.referenceImages ?? []);
  const [caption, setCaption] = useState(idea && idea.caption !== idea.keyMessage ? idea.caption : "");
  const [cta, setCta] = useState(idea && idea.cta !== "Saiba mais no link da bio" ? idea.cta : "");
  const [targetAudience, setTargetAudience] = useState(idea && idea.targetAudience !== "Público da marca" ? idea.targetAudience : "");
  const [commercialObjective, setCommercialObjective] = useState(idea && idea.commercialObjective !== "Engajar e atrair clientes" ? idea.commercialObjective : "");
  const [creativePrompt, setCreativePrompt] = useState(idea?.creativePrompt ?? "");
  const [moreOpen, setMoreOpen] = useState(Boolean(idea?.creativePrompt || targetAudience || commercialObjective));
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const filledSlides = slides.filter((slide) => slide.headline.trim());
  const carouselInvalid = format === "carousel" && filledSlides.length < 2;
  const canSave = title.trim().length > 0 && !carouselInvalid && !uploading && !saving;

  async function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const images = Array.from(files).filter((file) => IMAGE_TYPES.has(file.type));
    if (images.length === 0) {
      toast.error("Envie imagens JPG, PNG ou WEBP.");
      return;
    }
    const room = MAX_REFERENCE_IMAGES - references.length;
    if (room <= 0) {
      toast.error(`No máximo ${MAX_REFERENCE_IMAGES} imagens por ideia.`);
      return;
    }
    setUploading(true);
    try {
      const uploaded = await Promise.all(images.slice(0, room).map((file) => uploadPublicationMedia(workspaceId, file)));
      setReferences((current) => [...current, ...uploaded.map((item) => item.url)]);
      if (images.length > room) toast.message(`Só cabem ${MAX_REFERENCE_IMAGES} imagens; as excedentes ficaram de fora.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível enviar a imagem.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        format,
        priority: priorityHigh ? "high" : "normal",
        ...(category.trim() ? { category: category.trim() } : {}),
        ...(keyMessage.trim() ? { keyMessage: keyMessage.trim() } : {}),
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        ...(cta.trim() ? { cta: cta.trim() } : {}),
        ...(targetAudience.trim() ? { targetAudience: targetAudience.trim() } : {}),
        ...(commercialObjective.trim() ? { commercialObjective: commercialObjective.trim() } : {}),
        ...(creativePrompt.trim() ? { creativePrompt: creativePrompt.trim() } : {}),
        ...(format === "carousel" ? { carouselScript: filledSlides.map((slide) => ({ headline: slide.headline.trim(), body: slide.body.trim() || slide.headline.trim() })) } : {}),
        referenceImages: references,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a ideia.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{idea ? "Editar ideia" : "Nova ideia"}</DialogTitle>
          <DialogDescription>
            {idea ? `${idea.externalId} · as mudanças valem para o próximo post criado com ela.` : "Só o título e o formato são obrigatórios. Adicione imagens de referência para a arte sair do jeito que você imagina."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          <FieldBlock label="Título da ideia" required>
            <Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="Ex.: 5 sinais de que seu atendimento está perdendo vendas" />
          </FieldBlock>

          <FieldBlock label="Formato" required>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Formato">
              {FORMAT_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = format === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setFormat(option.value)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                      active ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-card hover:border-primary/50",
                    )}
                  >
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-foreground">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">{option.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </FieldBlock>

          <section>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground">Imagens de referência</p>
              <span className="text-xs tabular-nums text-muted-foreground">{references.length}/{MAX_REFERENCE_IMAGES}</span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">Foto do produto, do casal, print da tela ou uma arte que te inspira. A arte do post é montada a partir delas.</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {references.map((url, index) => (
                <div key={url} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={referenceThumb(url, 160)} alt={`Referência ${index + 1}`} className="h-full w-full object-cover" />
                  {index === 0 ? <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">Capa</span> : null}
                  <button
                    type="button"
                    onClick={() => setReferences((current) => current.filter((item) => item !== url))}
                    aria-label={`Remover referência ${index + 1}`}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-100 transition-opacity hover:bg-destructive sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
              {references.length < MAX_REFERENCE_IMAGES ? (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files); }}
                  className={cn(
                    "flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground transition-colors",
                    dragging ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary hover:text-primary",
                    references.length === 0 && "col-span-3 aspect-auto py-8 sm:col-span-6",
                  )}
                >
                  <ImagePlus className="h-5 w-5" aria-hidden="true" />
                  {uploading ? "Enviando…" : references.length === 0 ? "Clique ou arraste imagens aqui" : "Adicionar"}
                </button>
              ) : null}
            </div>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(event) => void addFiles(event.target.files)} />
          </section>

          <FieldBlock label="Texto da arte" hint="A frase principal que aparece na imagem. Vazio = usa o título.">
            <Textarea value={keyMessage} onChange={(event) => setKeyMessage(event.target.value)} rows={2} maxLength={400} placeholder="Ex.: Cliente que espera, desiste." />
          </FieldBlock>

          {format === "carousel" ? (
            <section>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-foreground">Telas do carrossel <span className="text-destructive">*</span></p>
                <span className="text-xs text-muted-foreground">{filledSlides.length} preenchida(s) · mínimo 2</span>
              </div>
              <ol className="space-y-2">
                {slides.map((slide, index) => (
                  <li key={index} className="flex gap-2 rounded-lg border border-border bg-card p-2">
                    <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold tabular-nums text-primary">{index + 1}</span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Input value={slide.headline} maxLength={160} placeholder="Título da tela" onChange={(event) => setSlides((current) => current.map((item, i) => (i === index ? { ...item, headline: event.target.value } : item)))} />
                      <Textarea value={slide.body} rows={2} maxLength={500} placeholder="Texto de apoio (opcional)" onChange={(event) => setSlides((current) => current.map((item, i) => (i === index ? { ...item, body: event.target.value } : item)))} />
                    </div>
                    <button type="button" disabled={slides.length <= 2} onClick={() => setSlides((current) => current.filter((_, i) => i !== index))} aria-label={`Remover tela ${index + 1}`} className="mt-2 h-8 w-8 shrink-0 rounded-md text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-30">
                      <Trash2 className="mx-auto h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
              {slides.length < 10 ? (
                <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setSlides((current) => [...current, { headline: "", body: "" }])}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Adicionar tela
                </Button>
              ) : null}
            </section>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldBlock label="Assunto" hint="Agrupa as ideias nos filtros.">
              <Input value={category} onChange={(event) => setCategory(event.target.value)} list="editorial-categories" maxLength={80} placeholder="Ex.: Promoções" />
              <datalist id="editorial-categories">{categories.map((item) => <option key={item} value={item} />)}</datalist>
            </FieldBlock>
            <FieldBlock label="Chamada para ação">
              <Input value={cta} onChange={(event) => setCta(event.target.value)} maxLength={120} placeholder="Ex.: Chama no direct" />
            </FieldBlock>
          </div>

          <FieldBlock label="Legenda do post" hint="Sem link no texto: Instagram e Facebook derrubam o alcance. Use “link na bio”.">
            <Textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={4} maxLength={2200} placeholder="Escreva a legenda ou deixe vazio para usar o texto da arte." />
          </FieldBlock>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-foreground">Prioridade alta</span>
              <span className="block text-xs text-muted-foreground">Sai antes das outras no piloto automático e no calendário.</span>
            </span>
            <Switch checked={priorityHigh} onCheckedChange={setPriorityHigh} />
          </label>

          <section className="rounded-lg border border-border">
            <button type="button" onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-foreground">
              Mais detalhes (opcional)
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", moreOpen && "rotate-180")} aria-hidden="true" />
            </button>
            {moreOpen ? (
              <div className="space-y-4 border-t border-border px-4 py-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldBlock label="Público-alvo"><Input value={targetAudience} onChange={(event) => setTargetAudience(event.target.value)} maxLength={300} placeholder="Ex.: noivas que casam em 2027" /></FieldBlock>
                  <FieldBlock label="Objetivo"><Input value={commercialObjective} onChange={(event) => setCommercialObjective(event.target.value)} maxLength={300} placeholder="Ex.: gerar orçamentos" /></FieldBlock>
                </div>
                <FieldBlock label="Direção de arte" hint="Como a arte deve ficar: cena, clima, cores, o que evitar.">
                  <Textarea value={creativePrompt} onChange={(event) => setCreativePrompt(event.target.value)} rows={4} maxLength={8000} placeholder="Ex.: usar a foto do casal como fundo, tons quentes, título grande em serifa, logo pequena no topo." />
                </FieldBlock>
              </div>
            ) : null}
          </section>
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-6 py-4">
          <p className="text-xs text-destructive">{error ?? (carouselInvalid ? "Preencha o título de pelo menos 2 telas." : "")}</p>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={saving} onClick={onClose}>Cancelar</Button>
            <Button disabled={!canSave} onClick={() => void submit()}>{saving ? "Salvando…" : idea ? "Salvar alterações" : "Cadastrar ideia"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldBlock({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-foreground">{label}{required ? <span className="text-destructive"> *</span> : null}</p>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
