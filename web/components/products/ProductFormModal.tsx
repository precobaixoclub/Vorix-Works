"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, ArrowLeft, ArrowRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input, MoneyInput, Textarea } from "@/components/Field";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ProductChannels } from "@/components/marketplaces/ProductChannels";
import { InventoryPanel, ShippingMeasures, TaxonomyManager } from "@/components/products/ProductEngineEditor";
import { RealEstateFields, VehicleFields } from "@/components/products/ProductSpecializedFields";
import { useMyAccess } from "@/features/auth/access";
import { createProduct, updateProduct, uploadProductImage, type CreateProductInput } from "@/features/crm/api";
import { centsFromCurrencyInput, currencyInputFromCents } from "@/features/crm/presentation";
import type { BillingType, Product } from "@/features/crm/types";
import { getProductMetadata } from "@/features/product-engine/api";
import { PRODUCT_SEGMENTS, segmentOf, type ProductSegment } from "@/features/product-engine/segments";
import { defaultRealEstate, validateSpecializedForm } from "@/features/product-engine/specializations";
import { newProductDetails, type ProductDetails, type ProductMetadata } from "@/features/product-engine/types";
import { bareUrl, effectiveImage, formatQuantity, optionsFromDetails, quantityFromInput, rowLabel, rowsFromVariants, syncRows, toDetailsOptions, toVariantDrafts, unlinkedPhotos, variationProblems, type DraftOption, type DraftRow } from "@/features/product-engine/wizard";
import { listVariants } from "@/features/sales/api";
import { BILLING_TYPE_LABEL, formatBp } from "@/features/sales/presentation";
import { formatCurrencyCents } from "@/lib/format";
import { compressImage, forEachLimited } from "@/lib/image-compress";
import { thumbUrl } from "@/lib/media";
import { cn } from "@/lib/utils";
import { CombinationTable } from "./wizard/CombinationTable";
import { MAX_PHOTOS, PhotoManager, type PendingPhoto } from "./wizard/PhotoManager";
import { VariationEditor } from "./wizard/VariationEditor";
import { Field, SegmentPicker, StepIntro, WizardStepper, type WizardStep } from "./wizard/WizardParts";

/** Tudo o que o cadastro guarda até o "Salvar" — também é o rascunho guardado no aparelho. */
type WizardState = {
  segmentId: string; name: string; description: string; code: string; categoryId?: string; brandId?: string; category: string;
  billingType: BillingType; unit: string; details: ProductDetails; specs: Record<string, string>;
  hasVariations: boolean; options: DraftOption[]; rows: DraftRow[]; photos: string[]; alts: Record<string, string>;
  price: string; minimum: string; cost: string; trackStock: boolean; stock: string; alertAt: string; active: boolean;
};
type StoredDraft = { savedAt: string; state: WizardState };
const APPAREL_KEYS = ["gender", "collection", "material"] as const;
const SALE_MODES: { value: NonNullable<ProductDetails["saleMode"]>; label: string }[] = [{ value: "INHERIT_SITE_DEFAULT", label: "Seguir o padrão do site" }, { value: "SHOW_ONLY", label: "Apenas mostrar" }, { value: "WHATSAPP_DIRECT", label: "Conversar pelo WhatsApp" }, { value: "WHATSAPP_CART", label: "Carrinho finalizado pelo WhatsApp" }, { value: "ONLINE_CHECKOUT", label: "Comprar pelo site (pagamento)" }];

function initialState(source: Product | undefined, copy: boolean): WizardState {
  const details: ProductDetails = source?.details ? { ...source.details, ...(copy ? { slug: undefined } : {}) } : newProductDetails();
  const segment = segmentOf(details, source?.itemType);
  const specs: Record<string, string> = Object.fromEntries((details.specs ?? []).map((spec) => [spec.key, String(spec.value)]));
  for (const key of APPAREL_KEYS) if (details.apparel?.[key]) specs[key] = details.apparel[key]!;
  const options = optionsFromDetails(details);
  return {
    segmentId: source ? segment.id : "", name: source ? (copy ? `${source.name} (cópia)` : source.name) : "", description: source?.description ?? "",
    code: copy ? "" : source?.code ?? "", categoryId: source?.categoryId, brandId: source?.brandId, category: source?.category ?? "",
    billingType: source?.billingType ?? "one_time", unit: source?.unit ?? "", details, specs,
    hasVariations: options.length > 0, options, rows: syncRows(options, []),
    photos: source?.imageUrls ?? [], alts: Object.fromEntries(details.media.map((item) => [bareUrl(item.url)!, item.alt])),
    price: source ? currencyInputFromCents(source.listPriceCents ?? source.priceCents) : "", minimum: source?.minimumPriceCents !== undefined ? currencyInputFromCents(source.minimumPriceCents) : "",
    cost: source?.costCents !== undefined ? currencyInputFromCents(source.costCents) : "", trackStock: source?.trackStock ?? segment.stock,
    stock: !copy && source?.trackStock ? formatQuantity(source.stockQuantity ?? 0) : "", alertAt: source?.stockAlertThreshold !== undefined ? formatQuantity(source.stockAlertThreshold) : "",
    active: copy ? true : source?.active ?? true,
  };
}

function readDraft(key: string): StoredDraft | undefined { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as StoredDraft : undefined; } catch { return undefined; } }
function writeDraft(key: string, state: WizardState) { try { localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), state })); } catch { /* sem armazenamento: o cadastro continua em memória */ } }
function dropDraft(key: string) { try { localStorage.removeItem(key); } catch { /* idem */ } }
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : fallback;

/**
 * Cadastro de produto em etapas (Tipo e informações → Características → Variações → Fotos → Preço e
 * estoque → Revisão). Nada depende de salvar no meio: fotos, variações, combinações e o vínculo
 * foto ↔ variação ficam em memória (e guardados no aparelho) até o "Salvar", que grava tudo num
 * único envio. Na edição, qualquer etapa pode ser aberta diretamente.
 */
export function ProductFormModal({ workspaceId, product, template, canViewCost, isManager, onClose, onSaved, onDuplicate }: { workspaceId: string; product?: Product; /** Produto usado como base de um novo cadastro (Duplicar): copia tudo, menos código, endereço e saldo. */ template?: Product; canViewCost: boolean; isManager: boolean; onClose: () => void; onSaved: (product: Product) => Promise<void> | void; onDuplicate?: (product: Product) => void }) {
  const access = useMyAccess();
  const canManage = access.can("product:manage"), canInventory = access.can("inventory:manage");
  const [saved, setSaved] = useState<Product | undefined>(product);
  const source = saved ?? template;
  const editing = Boolean(saved);
  const draftKey = `vx_product_wizard:${workspaceId}:${product?.id ?? (template ? `copy-${template.id}` : "new")}`;
  const [state, setState] = useState<WizardState>(() => initialState(source, !saved && Boolean(template)));
  const [stepIndex, setStepIndex] = useState(0);
  const [visited, setVisited] = useState<Set<string>>(() => new Set(editing ? ["info", "details", "variations", "photos", "pricing", "review"] : ["info"]));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<"draft" | "save">();
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const uploading = pending.length;
  const [organizing, setOrganizing] = useState(false);
  const [restorable, setRestorable] = useState<StoredDraft>();
  const [lastStored, setLastStored] = useState<string>();
  const { data: metadata, mutate: refreshMetadata } = useSWR(["product-metadata", workspaceId], () => getProductMetadata(workspaceId));
  const variantSource = saved ?? template;
  const { data: variants, error: variantsError } = useSWR(variantSource?.details?.options.length ? ["product-variants", workspaceId, variantSource.id, variantSource.updatedAt] : null, () => listVariants(variantSource!.id, workspaceId), { revalidateOnFocus: false });
  const rowsLoaded = useRef(!variantSource?.details?.options.length);
  const segment = PRODUCT_SEGMENTS.find((item) => item.id === state.segmentId);
  // Alterado pelo usuário desde a abertura ou o último salvamento (as combinações carregadas do servidor não contam).
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const patch = (next: Partial<WizardState>) => { setState((current) => ({ ...current, ...next })); setErrors([]); setDirty(true); };
  const patchDetails = (next: Partial<ProductDetails>) => { setState((current) => ({ ...current, details: { ...current.details, ...next } })); setErrors([]); setDirty(true); };

  // Combinações já salvas entram na tela (a chave inclui `updatedAt`: reabrir depois de salvar nunca usa a lista antiga) com preço, estoque, foto e status (na cópia, sem id nem código).
  useEffect(() => {
    if (rowsLoaded.current || !variants) return;
    rowsLoaded.current = true;
    const copy = !saved;
    setState((current) => ({ ...current, rows: rowsFromVariants(current.options, variants).map((row) => copy ? { ...row, variantId: undefined, sku: "", stock: "0" } : row) }));
  }, [variants, saved]);

  // Rascunho no aparelho: fechar o cadastro ou recarregar a página não perde o que foi feito.
  useEffect(() => { const stored = readDraft(draftKey); if (stored && (!product || stored.savedAt > product.updatedAt)) setRestorable(stored); }, [draftKey, product]);
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) { touched.current = true; return; }
    if (restorable || !canManage) return;
    const timer = setTimeout(() => { writeDraft(draftKey, state); setLastStored(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })); }, 700);
    return () => clearTimeout(timer);
  }, [state, draftKey, restorable, canManage]);

  const steps: WizardStep[] = useMemo(() => [
    { id: "info", label: "Informações", title: "O que você está cadastrando?" },
    { id: "details", label: "Características", title: "Características" },
    ...(segment?.variations ?? true ? [{ id: "variations", label: "Variações", title: "Variações" }] : []),
    { id: "photos", label: "Fotos", title: "Fotos" },
    { id: "pricing", label: segment?.family === "REAL_ESTATE" ? "Valores" : segment?.stock === false ? "Preço" : "Preço e estoque", title: "Preço" },
    { id: "review", label: "Revisão", title: "Revisão" },
  ], [segment]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const variationsOn = Boolean(segment?.variations && state.hasVariations);
  const activeOptions = variationsOn ? state.options.filter((option) => option.values.length) : [];
  const stockOn = Boolean(segment?.stock) && state.trackStock;

  // Fichas de veículo e imóvel sobrevivem à troca de tipo: voltar ao tipo recupera o que foi preenchido.
  const familyDrafts = useRef<{ vehicle?: ProductDetails["vehicle"]; realEstate?: ProductDetails["realEstate"] }>({});
  function chooseSegment(next: ProductSegment) {
    if (next.id === state.segmentId) return;
    if (state.details.vehicle) familyDrafts.current.vehicle = state.details.vehicle;
    if (state.details.realEstate) familyDrafts.current.realEstate = state.details.realEstate;
    const hadVariants = Boolean(saved?.details?.options.length);
    if (!next.variations && hadVariants) { setErrors(["Este produto tem combinações salvas. Para veículo ou imóvel, cadastre um produto novo (as vendas e o estoque das combinações ficam preservados)."]); return; }
    setState((current) => ({
      ...current, segmentId: next.id, trackStock: next.stock ? current.trackStock || !editing : false,
      hasVariations: next.variations ? current.hasVariations : false,
      details: {
        ...current.details, type: next.family,
        vehicle: next.family === "VEHICLE" ? current.details.vehicle ?? familyDrafts.current.vehicle ?? { make: "", model: "", kind: "car", features: [] } : undefined,
        realEstate: next.family === "REAL_ESTATE" ? current.details.realEstate ?? familyDrafts.current.realEstate ?? defaultRealEstate() : undefined,
      },
      billingType: next.family === "REAL_ESTATE" ? (current.details.realEstate?.purpose === "rent" ? "monthly" : "one_time") : current.billingType,
    }));
    setErrors([]); setDirty(true);
  }

  /** Problemas de uma etapa; `id` da etapa onde corrigir. */
  function problemsOf(id: string): string[] {
    if (id === "info") return [...(!segment ? ["Escolha o que você está cadastrando."] : []), ...(!state.name.trim() ? ["Dê um nome ao produto."] : [])];
    if (id === "details") { const problem = segment ? validateSpecializedForm(state.details) : undefined; return problem && problem.section !== "precos" && problem.section !== "estoque" ? [problem.message] : []; }
    if (id === "variations" && variationsOn) return [...(!state.options.length ? ["Adicione ao menos uma variação ou responda que o produto não tem variações."] : variationProblems(state.options)), ...(state.rows.length && !state.rows.some((row) => row.active) ? ["Deixe ao menos uma combinação ativa."] : [])];
    if (id === "pricing") { const problem = segment ? validateSpecializedForm(state.details) : undefined; return problem && (problem.section === "precos" || problem.section === "estoque") ? [problem.message] : []; }
    return [];
  }
  function go(index: number) { setStepIndex(index); setVisited((current) => new Set([...current, steps[index].id])); setErrors([]); document.getElementById("product-wizard-body")?.scrollTo({ top: 0 }); }
  /** Leva à Revisão (onde fica o botão de salvar) ou à primeira etapa com pendência. */
  function goToSave() { for (const [index, item] of steps.entries()) { const problems = item.id === "review" ? [] : problemsOf(item.id); if (problems.length) { go(index); setErrors(problems); return; } } go(steps.length - 1); }
  function next() { const problems = problemsOf(step.id); if (problems.length) { setErrors(problems); return; } go(Math.min(stepIndex + 1, steps.length - 1)); }

  async function upload(files: File[]) {
    const room = MAX_PHOTOS - state.photos.length - pending.length;
    if (room <= 0) { toast.info(`Cada produto pode ter até ${MAX_PHOTOS} fotos.`); return; }
    const list = files.slice(0, room);
    if (files.length > room) toast.info(`Só ${room} foto(s) couberam: o limite é ${MAX_PHOTOS}.`);
    // Prévia na hora; cada foto é reduzida no aparelho e enviada em paralelo (3 por vez). As URLs
    // entram na ordem em que foram escolhidas, assim que as anteriores terminam.
    const batch = list.map((file) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, preview: URL.createObjectURL(file), name: file.name }));
    setPending((current) => [...current, ...batch]);
    const results: (string | null | undefined)[] = list.map(() => undefined);
    let flushed = 0;
    const flush = () => {
      const ready: string[] = [];
      while (flushed < results.length && results[flushed] !== undefined) { const url = results[flushed++]; if (url) ready.push(url); }
      if (ready.length) { setState((current) => ({ ...current, photos: [...current.photos, ...ready].slice(0, MAX_PHOTOS) })); setDirty(true); }
    };
    await forEachLimited(list, 3, async (file, index) => {
      try { results[index] = (await uploadProductImage(workspaceId, await compressImage(file))).url; }
      catch (cause) { results[index] = null; toast.error(`Não foi possível enviar ${file.name}`, { description: message(cause, "") }); }
      flush();
      setPending((current) => current.filter((item) => item.id !== batch[index].id));
      URL.revokeObjectURL(batch[index].preview);
    });
  }

  function payload(active: boolean): Omit<CreateProductInput, "workspaceId"> {
    const seg = segment!;
    const specs = seg.fields.filter((field) => !(seg.family === "APPAREL" && (APPAREL_KEYS as readonly string[]).includes(field.key))).flatMap((field) => { const value = state.specs[field.key]?.trim(); return value ? [{ key: field.key, label: field.label, value: field.kind === "number" && Number.isFinite(Number(value.replace(",", "."))) ? Number(value.replace(",", ".")) : value }] : []; });
    const apparel = seg.family === "APPAREL" ? Object.fromEntries(APPAREL_KEYS.flatMap((key) => state.specs[key]?.trim() ? [[key, state.specs[key].trim()]] : [])) : undefined;
    const priceCents = centsFromCurrencyInput(state.price || "0");
    const realEstate = seg.family === "REAL_ESTATE";
    const trackStock = seg.stock && state.trackStock;
    const unchangedStock = saved?.trackStock && state.stock === formatQuantity(saved.stockQuantity ?? 0);
    return {
      name: state.name.trim(), description: state.description.trim() || undefined, priceCents, code: state.code.trim() || null,
      category: state.category.trim() || null, categoryId: state.categoryId ?? null, brandId: seg.family === "REAL_ESTATE" ? null : state.brandId ?? null,
      itemType: seg.itemType, billingType: realEstate ? (state.details.realEstate?.purpose === "rent" ? "monthly" : "one_time") : seg.itemType === "service" ? state.billingType : state.billingType,
      unit: state.unit.trim() || null,
      ...(canViewCost ? { costCents: state.cost.trim() ? centsFromCurrencyInput(state.cost) : null } : {}),
      ...(isManager ? { minimumPriceCents: state.minimum.trim() ? centsFromCurrencyInput(state.minimum) : null } : {}),
      trackStock,
      ...(trackStock && !variationsOn && canInventory && !unchangedStock ? { stockQuantity: quantityFromInput(state.stock) ?? 0 } : {}),
      ...(trackStock ? { stockAlertThreshold: quantityFromInput(state.alertAt) ?? null } : {}),
      imageUrls: state.photos, active,
      details: {
        ...state.details, type: seg.family, segment: seg.id, specs, apparel: apparel && Object.keys(apparel).length ? apparel : undefined,
        vehicle: seg.family === "VEHICLE" ? state.details.vehicle : undefined, realEstate: realEstate ? state.details.realEstate : undefined,
        shipping: seg.shipping ? state.details.shipping : undefined,
        options: variationsOn ? toDetailsOptions(state.options) : [],
        media: state.photos.map((url) => ({ url, alt: state.alts[bareUrl(url)!] ?? "" })),
      },
      variants: variationsOn ? toVariantDrafts(state.options, state.rows, { trackStock: Boolean(trackStock && canInventory), canViewCost, isManager }) : [],
    };
  }

  async function save(kind: "draft" | "save") {
    if (!segment) { go(0); setErrors(["Escolha o que você está cadastrando."]); return; }
    if (kind === "save") for (const [index, item] of steps.entries()) { const problems = problemsOf(item.id); if (problems.length) { go(index); setErrors(problems); return; } }
    if (!state.name.trim()) { go(0); setErrors(["Dê um nome ao produto para salvar o rascunho."]); return; }
    setBusy(kind); setErrors([]);
    try {
      const body = payload(kind === "draft" && !saved ? false : state.active);
      const result = saved ? await updateProduct(saved.id, workspaceId, body) : await createProduct({ workspaceId, ...body });
      dropDraft(draftKey);
      setDirty(false);
      if (kind === "save") { toast.success(saved ? "Produto atualizado." : "Produto cadastrado."); await onSaved(result); return; }
      // Rascunho no servidor: o cadastro continua aberto, agora editando o produto salvo.
      const fresh = result.details?.options.length ? await listVariants(result.id, workspaceId) : [];
      setSaved(result);
      setState((current) => { const options = optionsFromDetails(result.details ?? current.details); return { ...current, active: result.active, code: result.code ?? current.code, details: result.details ?? current.details, photos: result.imageUrls ?? [], options, rows: rowsFromVariants(options, fresh), stock: result.trackStock ? formatQuantity(result.stockQuantity ?? 0) : current.stock }; });
      toast.success("Rascunho salvo. O produto fica desativado até você salvar o cadastro.");
    } catch (cause) {
      setErrors([message(cause, "Não foi possível salvar o produto.")]);
    } finally { setBusy(undefined); }
  }

  const waitingVariants = Boolean(variantSource?.details?.options.length) && !rowsLoaded.current && !variantsError;
  const last = stepIndex === steps.length - 1;
  const saveLabel = editing ? "Salvar alterações" : state.details.siteVisible ? "Publicar produto" : "Salvar produto";
  const cover = state.photos[0];
  const title = saved ? "Editar produto" : template ? "Duplicar produto" : "Cadastrar produto";
  // Cadastro novo/cópia nunca salvo, ou edição com mudanças pendentes: avisa em destaque e confirma ao sair.
  const unsaved = canManage && (!saved || dirty);
  const requestClose = () => { if (unsaved && (dirty || uploading > 0 || Boolean(template && !saved))) setConfirmClose(true); else onClose(); };
  useEffect(() => {
    if (!unsaved || (!dirty && !uploading)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved, dirty, uploading]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent className="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92vh] sm:max-h-[92vh] sm:w-[calc(100vw-2rem)] sm:max-w-5xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3 pr-12 sm:px-6">
          <div className="min-w-0">
            <DialogTitle className="flex min-w-0 items-center gap-2 text-base font-semibold sm:text-lg"><span className="truncate">{title}{state.name.trim() ? <span className="font-normal text-muted-foreground"> · {state.name.trim()}</span> : null}</span>{unsaved ? <span className="shrink-0 rounded-full bg-warning px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning-foreground">Não salvo</span> : null}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground" aria-live="polite">{!canManage ? "Somente leitura: seu perfil não altera produtos." : lastStored ? `Rascunho guardado neste aparelho às ${lastStored}` : "O progresso fica guardado neste aparelho."}</DialogDescription>
          </div>
        </div>
        {unsaved ? <div role="status" className="flex items-start gap-2.5 border-b border-warning/50 bg-warning/15 px-4 py-2.5 text-sm sm:items-center sm:px-6">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning sm:mt-0" />
          <p className="min-w-0 flex-1"><strong className="font-semibold">{saved ? "Há alterações não salvas." : template ? "Esta cópia ainda não foi salva." : "Este produto ainda não foi salvo."}</strong> <span className="text-muted-foreground">{saved ? `Clique em “${saveLabel}” para gravar.` : `Ele só passa a existir no catálogo${state.details.siteVisible ? " e no site" : ""} depois de “${saveLabel}” na etapa Revisão.`}</span></p>
          {!saved && !last ? <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={goToSave}>Ir para salvar</Button> : null}
        </div> : null}
        <WizardStepper steps={steps} current={stepIndex} visited={visited} onSelect={go} />
        <div id="product-wizard-body" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className={cn("mx-auto w-full space-y-6 px-4 py-5 sm:px-6 sm:py-6", step.id === "pricing" || step.id === "variations" ? "max-w-4xl" : "max-w-3xl")}>
            {restorable ? <div role="status" className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span>Você tem um cadastro não salvo de {new Date(restorable.savedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.</span>
              <span className="flex gap-2"><Button size="sm" onClick={() => { setState({ ...restorable.state, rows: restorable.state.rows ?? [] }); rowsLoaded.current = true; setRestorable(undefined); setDirty(true); }}>Continuar de onde parei</Button><Button size="sm" variant="ghost" onClick={() => { dropDraft(draftKey); setRestorable(undefined); }}>Descartar</Button></span>
            </div> : null}
            {template && !saved && step.id === "info" ? <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">Cópia de <strong className="text-foreground">{template.name}</strong>. Altere só o que muda; o código é gerado automaticamente e o estoque começa zerado.</p> : null}
            {errors.length ? <div role="alert" className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{errors.map((error) => <p key={error}>{error}</p>)}</div> : null}

            {step.id === "info" ? <InfoStep state={state} patch={patch} segment={segment} onSegment={chooseSegment} metadata={metadata} canManage={canManage} editing={editing} onOrganize={() => setOrganizing(true)} /> : null}
            {step.id === "details" ? <DetailsStep state={state} patch={patch} patchDetails={patchDetails} segment={segment} metadata={metadata} onOrganize={() => setOrganizing(true)} /> : null}
            {step.id === "variations" ? <section className="space-y-5">
              <StepIntro title="Este produto tem variações?" hint="Variações são versões do mesmo produto que o cliente escolhe: tamanho, cor, voltagem, sabor..." />
              <div role="radiogroup" aria-label="Este produto tem variações?" className="grid grid-cols-2 gap-2 sm:max-w-md">
                {([[false, "Não", "Um único item"], [true, "Sim", "Tamanhos, cores..."]] as const).map(([value, label, hint]) => <button key={label} type="button" role="radio" aria-checked={state.hasVariations === value} disabled={!canManage} onClick={() => patch({ hasVariations: value })} className={cn("rounded-xl border p-3 text-left", state.hasVariations === value ? "border-primary bg-primary/10 ring-1 ring-primary/40" : "border-border/70")}><span className="block text-sm font-semibold">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></button>)}
              </div>
              {state.hasVariations ? <>
                <VariationEditor options={state.options} disabled={!canManage} suggestedTypes={segment?.variationTypes ?? []} onChange={(options) => patch({ options, rows: syncRows(options, state.rows) })} />
                {state.rows.length ? <div className="space-y-2"><StepIntro title="Quais combinações existem?" hint="Desative as que você não vende (ex.: Rosa não tem GG). Preço, estoque e foto de cada uma ficam nas próximas etapas." /><CombinationTable options={state.options} rows={state.rows} onChange={(rows) => patch({ rows })} columns={{}} photos={state.photos} cover={cover} disabled={!canManage} /></div> : null}
              </> : null}
              {waitingVariants ? <p className="text-sm text-muted-foreground" role="status">Carregando combinações salvas...</p> : null}
            </section> : null}
            {step.id === "photos" ? <section className="space-y-5">
              <StepIntro title="Fotos" hint={variationsOn ? "Envie todas as fotos e diga a qual variação cada uma pertence. Não precisa salvar antes." : "A primeira foto é a capa do produto."} />
              <PhotoManager photos={state.photos} onPhotos={(photos) => patch({ photos })} alts={state.alts} onAlt={(url, alt) => patch({ alts: { ...state.alts, [bareUrl(url)!]: alt } })} upload={(files) => void upload(files)} pending={pending} options={activeOptions} onOptions={(options) => patch({ options: state.options.map((option) => options.find((item) => item.id === option.id) ?? option) })} rows={variationsOn ? state.rows : []} onRows={(rows) => patch({ rows })} disabled={!canManage} />
            </section> : null}
            {step.id === "pricing" ? <PricingStep state={state} patch={patch} patchDetails={patchDetails} segment={segment} variationsOn={variationsOn} canViewCost={canViewCost} isManager={isManager} canManage={canManage} canInventory={canInventory} saved={saved} workspaceId={workspaceId} /> : null}
            {step.id === "review" ? <ReviewStep state={state} patch={patch} patchDetails={patchDetails} segment={segment} variationsOn={variationsOn} stockOn={stockOn} saved={saved} workspaceId={workspaceId} onEdit={(id) => go(steps.findIndex((item) => item.id === id))} canManage={canManage} /> : null}
          </div>
        </div>
        <footer className="flex items-center gap-2 border-t border-border/70 bg-popover px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <Button type="button" variant="ghost" disabled={stepIndex === 0} onClick={() => go(stepIndex - 1)} aria-label="Voltar"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Voltar</span></Button>
          {saved && onDuplicate ? <Button type="button" variant="ghost" aria-label="Duplicar produto" onClick={() => onDuplicate(saved)} disabled={Boolean(busy)}><Copy className="h-4 w-4" /><span className="hidden sm:inline">Duplicar</span></Button> : null}
          {!saved && canManage ? <Button type="button" variant="ghost" loading={busy === "draft"} disabled={Boolean(busy) || uploading > 0 || waitingVariants} onClick={() => void save("draft")}><span className="sm:hidden">Rascunho</span><span className="hidden sm:inline">Salvar rascunho</span></Button> : null}
          <span className="flex-1" />
          {!last ? <Button type="button" variant={editing ? "secondary" : "primary"} onClick={next}>Avançar<ArrowRight className="h-4 w-4" /></Button> : null}
          {canManage && (last || editing) ? <Button type="button" loading={busy === "save"} disabled={Boolean(busy) || uploading > 0 || waitingVariants} onClick={() => void save("save")} aria-label={saveLabel}>{editing && !last ? <><span className="sm:hidden">Salvar</span><span className="hidden sm:inline">{saveLabel}</span></> : saveLabel}</Button> : null}
        </footer>
        <ConfirmDialog open={confirmClose} title={saved ? "Sair sem salvar as alterações?" : template ? "Sair sem salvar a cópia?" : "Sair sem salvar o produto?"} description={uploading > 0 ? "Ainda há fotos sendo enviadas e o cadastro não foi salvo. O que já foi preenchido fica guardado neste aparelho para continuar depois." : saved ? "As alterações ainda não foram gravadas. Elas ficam guardadas neste aparelho para continuar depois." : "O produto ainda não existe no catálogo. O que foi preenchido fica guardado neste aparelho para continuar depois."} confirmLabel="Sair sem salvar" cancelLabel="Continuar cadastro" variant="danger" onCancel={() => setConfirmClose(false)} onConfirm={() => { setConfirmClose(false); onClose(); }} />
        {organizing ? <TaxonomyManager workspaceId={workspaceId} onClose={() => { setOrganizing(false); void refreshMetadata(); }} /> : null}
      </DialogContent>
    </Dialog>
  );
}

type StepProps = { state: WizardState; patch: (next: Partial<WizardState>) => void; segment?: ProductSegment };

function InfoStep({ state, patch, segment, onSegment, metadata, canManage, editing, onOrganize }: StepProps & { onSegment: (segment: ProductSegment) => void; metadata?: ProductMetadata; canManage: boolean; editing: boolean; onOrganize: () => void }) {
  const [changing, setChanging] = useState(!segment);
  return <section className="space-y-6">
    <div className="space-y-3">
      <StepIntro title="O que você está cadastrando?" hint="Os próximos campos se ajustam ao tipo escolhido." />
      {segment && !changing ? <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3"><span className="flex items-center gap-2.5"><span aria-hidden="true" className="text-xl">{segment.icon}</span><span><span className="block text-sm font-semibold">{segment.label}</span><span className="block text-xs text-muted-foreground">{segment.description}</span></span></span><Button type="button" size="sm" variant="ghost" disabled={!canManage} onClick={() => setChanging(true)}>Trocar</Button></div>
        : <SegmentPicker value={state.segmentId} disabled={!canManage} onChange={(next) => { onSegment(next); setChanging(false); }} />}
    </div>
    {segment ? <div className="space-y-4">
      <Field label="Nome do produto" htmlFor="product-name"><Input id="product-name" value={state.name} disabled={!canManage} onChange={(event) => patch({ name: event.target.value })} placeholder={segment.namePlaceholder} /></Field>
      <Field label="Descrição" htmlFor="product-description" hint={`${state.description.length}/5000 · aparece no site quando o produto é publicado.`}><Textarea id="product-description" rows={5} maxLength={5000} disabled={!canManage} value={state.description} onChange={(event) => patch({ description: event.target.value })} className="min-h-28 resize-y" placeholder="Conte o que o cliente precisa saber: detalhes, diferenciais, condições." /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Categoria"><SearchableCombo value={state.categoryId ?? ""} items={(metadata?.categories ?? []).filter((item) => item.active).map((item) => ({ id: item.id, label: categoryPath(item.id, metadata!) }))} onValueChange={(id) => patch({ categoryId: id || undefined })} extraOption={{ value: "", label: "Sem categoria" }} placeholder="Sem categoria" disabled={!canManage} /></Field>
        {segment.family !== "REAL_ESTATE" ? <Field label="Marca"><SearchableCombo value={state.brandId ?? ""} items={(metadata?.brands ?? []).filter((item) => item.active).map((item) => ({ id: item.id, label: item.name }))} onValueChange={(id) => patch({ brandId: id || undefined })} extraOption={{ value: "", label: "Sem marca" }} placeholder="Sem marca" disabled={!canManage} /></Field> : null}
        <Field label="Código do produto" htmlFor="product-code" hint={editing ? "Se apagar, o código atual é mantido." : "Em branco = próximo número da sequência."}><Input id="product-code" value={state.code} disabled={!canManage} onChange={(event) => patch({ code: event.target.value })} placeholder="Gerado automaticamente" /></Field>
      </div>
      {canManage ? <button type="button" onClick={onOrganize} className="text-xs font-medium text-muted-foreground underline hover:text-foreground">Criar categoria, marca ou especificação</button> : null}
    </div> : null}
  </section>;
}

function DetailsStep({ state, patch, patchDetails, segment, metadata, onOrganize }: StepProps & { patchDetails: (next: Partial<ProductDetails>) => void; metadata?: ProductMetadata; onOrganize: () => void }) {
  const ancestors = new Set<string>(); let parent = state.categoryId;
  while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = metadata?.categories.find((category) => category.id === parent)?.parentId; }
  const attributes = (metadata?.attributes ?? []).filter((attribute) => attribute.active && (!attribute.categoryId || ancestors.has(attribute.categoryId)));
  const setAttribute = (key: string, value: string | number | boolean | undefined) => { const next = { ...state.details.attributes }; if (value === undefined || value === "") delete next[key]; else next[key] = value; patchDetails({ attributes: next }); };
  if (!segment) return null;
  return <section className="space-y-6">
    <StepIntro title="Características" hint="Tudo é opcional, mas ajuda o cliente a decidir e aparece na página do produto." />
    {segment.family === "VEHICLE" ? <><VehicleFields section="ficha" value={state.details.vehicle ?? { make: "", model: "", features: [] }} onChange={(vehicle) => patchDetails({ vehicle })} /><VehicleFields section="localizacao" value={state.details.vehicle ?? { make: "", model: "", features: [] }} onChange={(vehicle) => patchDetails({ vehicle })} /></> : null}
    {segment.family === "REAL_ESTATE" ? <><RealEstateFields section="ficha" value={state.details.realEstate ?? defaultRealEstate()} onChange={(realEstate) => patchDetails({ realEstate })} /><RealEstateFields section="localizacao" value={state.details.realEstate ?? defaultRealEstate()} onChange={(realEstate) => patchDetails({ realEstate })} /></> : null}
    {segment.fields.length ? <div className="grid gap-4 sm:grid-cols-2">{segment.fields.map((field) => {
      const id = `spec-${field.key}`, value = state.specs[field.key] ?? "", set = (next: string) => patch({ specs: { ...state.specs, [field.key]: next } });
      return <Field key={field.key} label={field.label} htmlFor={id} className={field.kind === "textarea" ? "sm:col-span-2" : undefined}>
        {field.kind === "select" ? <select id={id} value={value} onChange={(event) => set(event.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"><option value="">Não informado</option>{field.choices?.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select>
          : field.kind === "textarea" ? <Textarea id={id} rows={3} value={value} onChange={(event) => set(event.target.value)} placeholder={field.placeholder} />
            : <Input id={id} value={value} inputMode={field.kind === "number" ? "decimal" : undefined} onChange={(event) => set(event.target.value)} placeholder={field.placeholder} />}
      </Field>;
    })}</div> : null}
    {attributes.length ? <div className="space-y-3 border-t border-border/60 pt-5"><h4 className="text-sm font-semibold">Especificações da categoria</h4><div className="grid gap-4 sm:grid-cols-2">{attributes.map((attribute) => {
      const id = `attribute-${attribute.key}`, label = `${attribute.label}${attribute.required ? " *" : ""}${attribute.unit ? ` (${attribute.unit})` : ""}`, value = state.details.attributes[attribute.key];
      return <Field key={attribute.id} label={label} htmlFor={id}>{attribute.kind === "boolean" ? <Switch id={id} checked={value === true} onCheckedChange={(checked) => setAttribute(attribute.key, checked)} /> : attribute.kind === "select" ? <select id={id} value={String(value ?? "")} onChange={(event) => setAttribute(attribute.key, event.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"><option value="">Selecione</option>{attribute.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select> : <Input id={id} type={attribute.kind === "number" ? "number" : "text"} value={String(value ?? "")} onChange={(event) => setAttribute(attribute.key, event.target.value === "" ? undefined : attribute.kind === "number" ? Number(event.target.value) : event.target.value)} />}</Field>;
    })}</div></div> : null}
    <button type="button" onClick={onOrganize} className="text-xs font-medium text-muted-foreground underline hover:text-foreground">Cadastrar uma especificação para a categoria</button>
  </section>;
}

function PricingStep({ state, patch, patchDetails, segment, variationsOn, canViewCost, isManager, canManage, canInventory, saved, workspaceId }: StepProps & { patchDetails: (next: Partial<ProductDetails>) => void; variationsOn: boolean; canViewCost: boolean; isManager: boolean; canManage: boolean; canInventory: boolean; saved?: Product; workspaceId: string }) {
  if (!segment) return null;
  const realEstate = segment.family === "REAL_ESTATE";
  const listCents = centsFromCurrencyInput(state.price || "0"), costCents = state.cost.trim() ? centsFromCurrencyInput(state.cost) : undefined;
  const margin = costCents !== undefined && listCents > 0 ? Math.round(((listCents - costCents) * 10000) / listCents) : undefined;
  const stockOn = segment.stock && state.trackStock;
  return <section className="space-y-6">
    <StepIntro title={realEstate ? "Valores e disponibilidade" : segment.stock ? "Preço e estoque" : "Preço"} hint={variationsOn ? "O preço do produto vale para todas as combinações; mude só as que custam diferente." : undefined} />
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label={realEstate ? (state.details.realEstate?.purpose === "rent" ? "Aluguel mensal" : "Valor de venda") : "Preço de venda"} htmlFor="product-price"><MoneyInput id="product-price" value={state.price} disabled={!canManage} onChange={(event) => patch({ price: event.target.value })} placeholder="0,00" /></Field>
      {isManager ? <Field label="Menor preço sem aprovação" htmlFor="product-minimum"><MoneyInput id="product-minimum" value={state.minimum} disabled={!canManage} onChange={(event) => patch({ minimum: event.target.value })} placeholder="Sem limite" /></Field> : null}
      {canViewCost ? <Field label="Quanto custa para você" htmlFor="product-cost" hint={`Margem: ${formatBp(margin)}`}><MoneyInput id="product-cost" value={state.cost} disabled={!canManage} onChange={(event) => patch({ cost: event.target.value })} placeholder="Opcional" /></Field> : null}
      {segment.itemType === "service" ? <Field label="Como é cobrado" htmlFor="product-billing"><select id="product-billing" value={state.billingType} disabled={!canManage} onChange={(event) => patch({ billingType: event.target.value as BillingType })} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">{(Object.keys(BILLING_TYPE_LABEL) as BillingType[]).map((key) => <option key={key} value={key}>{BILLING_TYPE_LABEL[key]}</option>)}</select></Field> : null}
    </div>
    {realEstate ? <><RealEstateFields section="precos" value={state.details.realEstate ?? defaultRealEstate()} onChange={(realEstate) => patchDetails({ realEstate })} /><RealEstateFields section="estoque" value={state.details.realEstate ?? defaultRealEstate()} onChange={(realEstate) => patchDetails({ realEstate })} /></> : null}
    {segment.stock ? <div className="space-y-4 border-t border-border/60 pt-5">
      <label className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-3">
        <span><span className="block text-sm font-medium">Controlar estoque</span><span className="block text-xs text-muted-foreground">Cada venda ganha desconta do estoque; perder ou reabrir a venda devolve.</span></span>
        <Switch checked={state.trackStock} disabled={!canManage} onCheckedChange={(trackStock) => patch({ trackStock })} aria-label="Controlar estoque" />
      </label>
      {stockOn ? <div className="grid gap-4 sm:grid-cols-3">
        {!variationsOn ? <Field label="Quantidade em estoque" htmlFor="product-stock" hint={!canInventory ? "Seu perfil não ajusta estoque." : undefined}><Input id="product-stock" inputMode="decimal" disabled={!canManage || !canInventory} value={state.stock} onChange={(event) => patch({ stock: event.target.value.replace(/[^\d.,]/g, "") })} placeholder="0" /></Field> : null}
        <Field label="Avisar quando chegar a" htmlFor="product-alert"><Input id="product-alert" inputMode="decimal" disabled={!canManage} value={state.alertAt} onChange={(event) => patch({ alertAt: event.target.value.replace(/[^\d.,]/g, "") })} placeholder="Ex.: 5" /></Field>
        <Field label="Unidade" htmlFor="product-unit"><Input id="product-unit" value={state.unit} disabled={!canManage} onChange={(event) => patch({ unit: event.target.value })} placeholder="un, cx, kg, m²" /></Field>
      </div> : null}
    </div> : null}
    {variationsOn && state.rows.length ? <div className="space-y-3 border-t border-border/60 pt-5">
      <StepIntro title="Preço, estoque e foto de cada combinação" hint="Selecione várias (ex.: todas da cor Preto) para aplicar de uma vez." />
      <CombinationTable options={state.options} rows={state.rows} onChange={(rows) => patch({ rows })} photos={state.photos} cover={state.photos[0]} productPrice={state.price} disabled={!canManage} columns={{ sku: true, price: true, cost: canViewCost, stock: stockOn && canInventory, photo: true }} />
    </div> : null}
    {saved && stockOn ? <details className="rounded-xl border border-border/70 p-3"><summary className="cursor-pointer text-sm font-medium">Movimentações de estoque (entradas, saídas, reservas)</summary><div className="mt-3"><InventoryPanel workspaceId={workspaceId} product={saved} /></div></details> : null}
  </section>;
}

function ReviewStep({ state, patchDetails, patch, segment, variationsOn, stockOn, saved, workspaceId, onEdit, canManage }: StepProps & { patchDetails: (next: Partial<ProductDetails>) => void; variationsOn: boolean; stockOn: boolean; saved?: Product; workspaceId: string; onEdit: (step: string) => void; canManage: boolean }) {
  if (!segment) return null;
  const usable = state.options.filter((option) => option.values.length);
  const activeRows = variationsOn ? state.rows.filter((row) => row.active) : [];
  const price = centsFromCurrencyInput(state.price || "0");
  const prices = activeRows.map((row) => row.price.trim() ? centsFromCurrencyInput(row.price) : price);
  const stockTotal = variationsOn ? activeRows.reduce((sum, row) => sum + (quantityFromInput(row.stock) ?? 0), 0) : quantityFromInput(state.stock) ?? 0;
  const warnings = [
    ...(!state.photos.length ? [["photos", "O produto está sem fotos."]] : []),
    ...(price <= 0 && segment.itemType !== "service" ? [["pricing", "O preço está zerado."]] : []),
    ...(variationsOn && unlinkedPhotos(state.photos, usable, state.rows).length ? [["photos", `${unlinkedPhotos(state.photos, usable, state.rows).length} foto(s) não estão vinculadas a nenhuma variação.`]] : []),
    ...(variationsOn && usable.length > 1 && usable.some((option) => option.values.some((value) => !value.image)) && state.photos.length > 1 ? [["photos", "Algumas variações ainda usam a capa como foto."]] : []),
    ...(stockOn && stockTotal <= 0 ? [["pricing", "O estoque está zerado: o produto aparece como indisponível."]] : []),
  ] as [string, string][];
  const range = prices.length ? [Math.min(...prices), Math.max(...prices)] : [price, price];
  return <section className="space-y-6">
    <StepIntro title="Revisão" hint="Confira como o produto vai ficar antes de salvar." />
    <div className="overflow-hidden rounded-xl border border-border/70 sm:flex">
      <div className="h-44 w-full bg-muted/40 sm:aspect-square sm:h-auto sm:w-56 sm:shrink-0">{/* eslint-disable-next-line @next/next/no-img-element */}{state.photos[0] ? <img src={thumbUrl(state.photos[0], 480)} alt="" decoding="async" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem foto</span>}</div>
      <div className="min-w-0 flex-1 space-y-3 p-4">
        <div><p className="text-xs text-muted-foreground">{segment.icon} {segment.label}</p><p className="text-lg font-semibold">{state.name || "Sem nome"}</p><p className="text-base font-medium">{range[0] === range[1] ? formatCurrencyCents(range[0]) : `${formatCurrencyCents(range[0])} a ${formatCurrencyCents(range[1])}`}</p></div>
        {state.description ? <p className="line-clamp-3 text-sm text-muted-foreground">{state.description}</p> : null}
        {usable.map((option) => <div key={option.id}><p className="text-xs font-medium text-muted-foreground">{option.name}</p><div className="mt-1 flex flex-wrap gap-1.5">{option.values.map((value) => <span key={value.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">{value.swatch ? <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-border" style={{ background: value.swatch }} /> : null}{value.label}</span>)}</div></div>)}
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {variationsOn ? <div><dt className="text-xs text-muted-foreground">Combinações ativas</dt><dd className="font-medium">{activeRows.length} de {state.rows.length}</dd></div> : null}
          {stockOn ? <div><dt className="text-xs text-muted-foreground">Estoque total</dt><dd className="font-medium">{formatQuantity(stockTotal)}{state.unit ? ` ${state.unit}` : ""}</dd></div> : null}
          <div><dt className="text-xs text-muted-foreground">Fotos</dt><dd className="font-medium">{state.photos.length}</dd></div>
        </dl>
      </div>
    </div>
    {variationsOn && activeRows.length ? <details className="rounded-xl border border-border/70 p-3"><summary className="cursor-pointer text-sm font-medium">Ver as {activeRows.length} combinações ativas</summary><ul className="mt-3 grid gap-2 sm:grid-cols-2">{activeRows.map((row) => { const image = effectiveImage(row, usable, state.photos[0]); return <li key={rowLabel(row, usable)} className="flex items-center gap-2 text-sm">{/* eslint-disable-next-line @next/next/no-img-element */}{image ? <img src={thumbUrl(image, 160)} alt="" loading="lazy" decoding="async" className="h-9 w-9 rounded-md object-cover" /> : <span className="h-9 w-9 rounded-md bg-muted" />}<span className="min-w-0 flex-1 truncate">{rowLabel(row, usable)}</span><span className="tabular-nums text-muted-foreground">{formatCurrencyCents(row.price.trim() ? centsFromCurrencyInput(row.price) : price)}{stockOn ? ` · ${row.stock || 0} un` : ""}</span></li>; })}</ul></details> : null}
    {warnings.length ? <ul className="space-y-1.5" aria-label="Pontos de atenção">{warnings.map(([step, text]) => <li key={text} className="flex items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm"><span>{text}</span><button type="button" className="shrink-0 text-xs font-medium underline" onClick={() => onEdit(step)}>Ajustar</button></li>)}</ul> : null}
    <div className="space-y-3 border-t border-border/60 pt-5">
      <h4 className="text-sm font-semibold">Publicação</h4>
      <ToggleRow label="Disponível para venda" hint="Desativado, o produto não entra em novas oportunidades nem no site." checked={state.active} disabled={!canManage} onChange={(active) => patch({ active })} />
      <ToggleRow label="Mostrar no site" hint="Depende do módulo Vorix Site." checked={state.details.siteVisible} disabled={!canManage} onChange={(siteVisible) => patchDetails({ siteVisible })} />
      {state.details.siteVisible ? <Field label="Como vender no site" htmlFor="product-sale-mode"><select id="product-sale-mode" value={state.details.saleMode ?? "INHERIT_SITE_DEFAULT"} disabled={!canManage} onChange={(event) => patchDetails({ saleMode: event.target.value as NonNullable<ProductDetails["saleMode"]> })} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">{SALE_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></Field> : null}
      <ToggleRow label="Incluir no catálogo" checked={state.details.catalogVisible} disabled={!canManage} onChange={(catalogVisible) => patchDetails({ catalogVisible })} />
      {segment.shipping ? <details className="rounded-xl border border-border/70 p-3"><summary className="cursor-pointer text-sm font-medium">Peso e medidas para frete</summary><div className="mt-3"><ShippingMeasures value={state.details.shipping} onChange={(shipping) => patchDetails({ shipping })} /></div></details> : null}
      <details className="rounded-xl border border-border/70 p-3"><summary className="cursor-pointer text-sm font-medium">Aparência no Google e endereço da página</summary><div className="mt-3 space-y-3">
        <Field label="Endereço do produto" htmlFor="product-slug" hint="Em branco = gerado a partir do nome."><Input id="product-slug" value={state.details.slug ?? ""} placeholder="camiseta-oversized" onChange={(event) => patchDetails({ slug: event.target.value || undefined })} /></Field>
        <Field label="Título nos buscadores" htmlFor="product-seo-title"><Input id="product-seo-title" maxLength={160} value={state.details.seo.title ?? ""} onChange={(event) => patchDetails({ seo: { ...state.details.seo, title: event.target.value } })} /></Field>
        <Field label="Descrição nos buscadores" htmlFor="product-seo-description"><Textarea id="product-seo-description" maxLength={320} value={state.details.seo.description ?? ""} onChange={(event) => patchDetails({ seo: { ...state.details.seo, description: event.target.value } })} /></Field>
      </div></details>
      {saved ? <ProductChannels workspaceId={workspaceId} productId={saved.id} siteVisible={state.details.siteVisible} /> : null}
    </div>
  </section>;
}

function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="flex items-center justify-between gap-4 rounded-xl border border-border/70 px-3 py-3"><span><span className="block text-sm font-medium">{label}</span>{hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}</span><Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} /></label>;
}

function categoryPath(id: string, metadata: ProductMetadata) { const parts: string[] = []; const seen = new Set<string>(); let current = metadata.categories.find((item) => item.id === id); while (current && !seen.has(current.id)) { seen.add(current.id); parts.unshift(current.name); current = metadata.categories.find((item) => item.id === current?.parentId); } return parts.join(" / "); }

export function formatQuantityInput(value: number): string {
  return formatQuantity(value);
}

export { quantityFromInput };
