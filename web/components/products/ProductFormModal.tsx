"use client";

import { createContext, useContext, useRef, useState } from "react";
import { ProductChannels } from "@/components/marketplaces/ProductChannels";
import { PageSubnav } from "@/components/PageSubnav";
import { ProductEngineEditor, PRODUCT_SECTIONS } from "@/components/products/ProductEngineEditor";
import { newProductDetails,type ProductDetails } from "@/features/product-engine/types";
import {defaultRealEstate,validateSpecializedForm} from "@/features/product-engine/specializations";
const FormSectionContext=createContext("geral");
import { ImagePlus, Loader2, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Input, Label, MoneyInput, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { createProduct, updateProduct, uploadProductImage, type CreateProductInput } from "@/features/crm/api";
import { centsFromCurrencyInput, currencyInputFromCents } from "@/features/crm/presentation";
import type { BillingType, Product } from "@/features/crm/types";


import { BILLING_TYPE_LABEL, formatBp } from "@/features/sales/presentation";
import { formatCurrencyCents } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX_PHOTOS = 30;

/**
 * Cadastro de produto/serviço em blocos simples, na ordem em que a pessoa pensa: fotos, o que é,
 * quanto custa, estoque (só se quiser controlar — aí pede quantidade, aviso de reposição e
 * unidade) e descrição. Usado no menu Produtos (vitrine) e em Configurações.
 */
export function ProductFormModal({ workspaceId, product, canViewCost, isManager, onClose, onSaved }: { workspaceId: string; product?: Product; canViewCost: boolean; isManager: boolean; onClose: () => void; onSaved: (product: Product) => Promise<void> | void }) {
  const [section,setSection]=useState("geral");
  const [details,setDetails]=useState(product?.details??newProductDetails());
  const familyDrafts=useRef<Partial<Record<ProductDetails["type"],ProductDetails>>>({});
  const specialized=details.type==="VEHICLE"||details.type==="REAL_ESTATE";
  const sections=PRODUCT_SECTIONS.filter(item=>item.value!=="variacoes"||!specialized).map(item=>item.value==="estoque"&&details.type==="REAL_ESTATE"?{...item,label:"Disponibilidade"}:item);
  if(specialized)sections.splice(1,0,{value:"ficha",label:details.type==="VEHICLE"?"Ficha do veículo":"Ficha do imóvel"},{value:"localizacao",label:"Localização"});
  const [categoryId,setCategoryId]=useState(product?.categoryId);
  const [brandId,setBrandId]=useState(product?.brandId);
  const [name, setName] = useState(product?.name ?? "");
  const [code, setCode] = useState(product?.code ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [itemType, setItemType] = useState<"product" | "service">(product?.itemType ?? "product");
  const [billingType, setBillingType] = useState<BillingType>(product?.billingType ?? "one_time");
  const [unit, setUnit] = useState(product?.unit ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [list, setList] = useState(product ? currencyInputFromCents(product.listPriceCents ?? product.priceCents) : "");
  const [minimum, setMinimum] = useState(product?.minimumPriceCents !== undefined ? currencyInputFromCents(product.minimumPriceCents) : "");
  const [cost, setCost] = useState(product?.costCents !== undefined ? currencyInputFromCents(product.costCents) : "");
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? false);
  const [stock, setStock] = useState(product?.stockQuantity !== undefined && product.trackStock ? formatQuantityInput(product.stockQuantity) : "");
  const [alertAt, setAlertAt] = useState(product?.stockAlertThreshold !== undefined ? formatQuantityInput(product.stockAlertThreshold) : "");
  const [photos, setPhotos] = useState<string[]>(product?.imageUrls ?? []);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const listCents = centsFromCurrencyInput(list);
  const costCents = cost.trim() ? centsFromCurrencyInput(cost) : undefined;
  const margin = costCents !== undefined && listCents > 0 ? Math.round(((listCents - costCents) * 10000) / listCents) : undefined;

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      toast.info(`Cada produto pode ter até ${MAX_PHOTOS} fotos.`);
      return;
    }
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of [...files].slice(0, room)) uploaded.push((await uploadProductImage(workspaceId, file)).url);
      setPhotos((current) => [...current, ...uploaded].slice(0, MAX_PHOTOS));
    } catch (cause) {
      toast.error("Não foi possível enviar a foto", { description: cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : undefined });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function changeType(type:ProductDetails["type"]) {
    if(type===details.type)return;
    if(product?.details?.options.length&&(type==="VEHICLE"||type==="REAL_ESTATE")){setError("Este produto possui combinações já cadastradas. Cadastre o veículo ou imóvel como um novo produto para preservar as negociações e o estoque.");return;}
    familyDrafts.current[details.type]=details;
    const stored=familyDrafts.current[type];
    const next=stored??{...details,type,options:[],apparel:undefined,vehicle:undefined,realEstate:undefined,...(type==="VEHICLE"?{vehicle:{make:"",model:"",kind:"car" as const,features:[]}}:{}),...(type==="REAL_ESTATE"?{realEstate:defaultRealEstate()}:{}),...(type==="APPAREL"?{options:[{key:"size",name:"Tamanho",values:["P","M","G"]}]}:{})};
    setDetails(next);setError(undefined);if(type==="VEHICLE"||type==="REAL_ESTATE"){setItemType("product");setBillingType(next.realEstate?.purpose==="rent"?"monthly":"one_time");}
  }

  async function handleSave() {
    const problem=validateSpecializedForm(details);if(problem){setError(problem.message);setSection(problem.section);return;}
    setBusy(true);
    setError(undefined);
    const payload: Omit<CreateProductInput, "workspaceId"> = {
      details:{...details,media:photos.map(url=>({url,alt:details.media.find(item=>item.url===url)?.alt??""}))},categoryId:categoryId??null,brandId:brandId??null,
      name: name.trim(),
      description: description.trim() || undefined,
      priceCents: listCents,
      code: code.trim() || null,
      category: category.trim() || null,
      itemType:specialized?"product":itemType,
      billingType:details.type==="REAL_ESTATE"?(details.realEstate?.purpose==="rent"?"monthly":"one_time"):billingType,
      unit: trackStock ? unit.trim() || null : product?.unit ?? null,
      ...(canViewCost ? { costCents: costCents ?? null } : {}),
      ...(isManager ? { minimumPriceCents: minimum.trim() ? centsFromCurrencyInput(minimum) : null } : {}),
      trackStock:details.type==="REAL_ESTATE"?false:trackStock,
      // Saldo só vai quando o usuário mudou o número: reenviar o valor lido ao abrir desfaria vendas feitas enquanto o modal estava aberto.
      ...(trackStock && details.type!=="REAL_ESTATE" ? { ...(details.options.length||(product?.trackStock&&stock===formatQuantityInput(product.stockQuantity??0))?{}:{stockQuantity:quantityFromInput(stock)??0}),stockAlertThreshold:quantityFromInput(alertAt)??null } : {}),
      imageUrls: photos,
    };
    try {
      const saved = product ? await updateProduct(product.id, workspaceId, payload) : await createProduct({ workspaceId, ...payload });
      toast.success(product ? "Produto atualizado." : "Produto cadastrado.");
      await onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : "Não foi possível salvar o produto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={product ? "Editar produto" : "Cadastrar produto"} onClose={onClose} maxWidthClass="sm:max-w-6xl">
      <FormSectionContext.Provider value={section}><PageSubnav className="min-w-0 max-w-full" items={sections} value={section} onValueChange={value=>{setSection(value);setError(undefined);}}><div className="min-w-0 space-y-5">
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

        {section==="geral"?<div className="space-y-2"><Label htmlFor="product-engine-type">O que você vai cadastrar?</Label><select id="product-engine-type" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" value={details.type} onChange={event=>changeType(event.target.value as ProductDetails["type"])}><option value="GENERAL">Geral — produto ou serviço</option><option value="APPAREL">Vestuário — roupas e acessórios</option><option value="VEHICLE">Veículos — automóveis, motos e utilitários</option><option value="REAL_ESTATE">Imóveis — casas, apartamentos e terrenos</option></select><p className="text-xs text-muted-foreground">Os campos e as seções se ajustam ao tipo escolhido. Fotos e descrição são comuns a todos.</p></div>:null}

        <FormSection step={1} title="Fotos" hint="A primeira foto é a capa. Até 30 fotos (JPG, PNG ou WEBP, até 5 MB cada).">
          <div className="flex flex-wrap gap-3">
            {photos.map((url, index) => (
              <div key={url} className={cn("group relative h-24 w-24 overflow-hidden rounded-xl border bg-surface-2", index === 0 ? "border-solution ring-2 ring-solution/30" : "border-border/70")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Foto ${index + 1} de ${name || "produto"}`} className="h-full w-full object-cover" />
                {index === 0 ? <span className="absolute left-1 top-1 rounded-full bg-solution px-1.5 text-[10px] font-semibold text-solution-foreground">Capa</span> : null}
                <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1">
                  {index > 0 ? (
                    <button type="button" onClick={() => setPhotos((current) => [url, ...current.filter((item) => item !== url)])} className="rounded-md bg-background/85 p-1 text-foreground hover:bg-background" aria-label="Usar como capa" title="Usar como capa">
                      <Star className="h-3.5 w-3.5" />
                    </button>
                  ) : <span />}
                  <button type="button" onClick={() => setPhotos((current) => current.filter((item) => item !== url))} className="rounded-md bg-background/85 p-1 text-destructive hover:bg-background" aria-label="Remover foto" title="Remover foto">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {photos.length < MAX_PHOTOS ? (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-xs font-medium text-muted-foreground transition-colors hover:border-solution/60 hover:text-foreground disabled:opacity-60"
              >
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                {uploading ? "Enviando..." : "Adicionar foto"}
              </button>
            ) : null}
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" aria-label="Escolher fotos do produto" onChange={(event) => void addPhotos(event.target.files)} />
          </div>
        </FormSection>

        <FormSection step={2} title="O que é">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="product-name">Nome</Label><Input id="product-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus placeholder={details.type==="REAL_ESTATE"?"Ex.: Casa com 3 quartos no Centro":details.type==="VEHICLE"?"Ex.: Honda Civic EXL 2022":"Ex.: Leitor de código de barras"} /></div>
            {!specialized?<div>
              <Label>É um produto ou um serviço?</Label>
              <Select value={itemType} onValueChange={(value) => setItemType(value as "product" | "service")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="product">Produto</SelectItem><SelectItem value="service">Serviço</SelectItem></SelectContent>
              </Select>
            </div>:null}
            {!specialized?<div>
              <Label>Como é cobrado?</Label>
              <Select value={billingType} onValueChange={(value) => setBillingType(value as BillingType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(BILLING_TYPE_LABEL) as BillingType[]).map((key) => <SelectItem key={key} value={key}>{BILLING_TYPE_LABEL[key]}</SelectItem>)}</SelectContent>
              </Select>
            </div>:null}
            <div><Label htmlFor="product-category">Categoria (opcional)</Label><Input id="product-category" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Ex.: Equipamentos" /></div>
            <div><Label htmlFor="product-code">Código/SKU (opcional)</Label><Input id="product-code" value={code} onChange={(event) => setCode(event.target.value)} /></div>
          </div>
        </FormSection>

        <FormSection step={3} title="Preço">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label htmlFor="product-list">{details.type==="REAL_ESTATE"?(details.realEstate?.purpose==="rent"?"Aluguel mensal":"Valor de venda"):"Preço de venda"}</Label><MoneyInput id="product-list" value={list} onChange={(event) => setList(event.target.value)} placeholder="0,00" /></div>
            <div>
              <Label htmlFor="product-min">Menor preço sem aprovação</Label>
              <MoneyInput id="product-min" value={minimum} onChange={(event) => setMinimum(event.target.value)} disabled={!isManager} placeholder={isManager ? "Sem limite" : "Definido pela gestão"} />
            </div>
            {canViewCost ? (
              <div>
                <Label htmlFor="product-cost">Quanto custa para você</Label>
                <MoneyInput id="product-cost" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="Opcional" />
                <p className="mt-1 text-[11px] text-muted-foreground">Margem: {formatBp(margin)}</p>
              </div>
            ) : null}
          </div>
        </FormSection>

        {details.type!=="REAL_ESTATE"?<FormSection step={4} title="Estoque">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5">
            <span>
              <span className="block text-sm font-medium text-foreground">Quero controlar o estoque deste produto</span>
              <span className="block text-xs text-muted-foreground">Cada venda ganha desconta do estoque; reabrir ou perder a venda devolve.</span>
            </span>
            <Switch checked={trackStock} onCheckedChange={setTrackStock} aria-label="Controlar estoque" />
          </label>
          {trackStock ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="product-stock">Quantos tenho agora</Label>
                <Input id="product-stock" disabled={details.options.length>0} value={details.options.length?"Por combinação":stock} onChange={(event) => setStock(event.target.value.replace(/[^\d.,-]/g, ""))} inputMode="decimal" placeholder="0" />
              </div>
              <div>
                <Label htmlFor="product-alert">Avisar quando chegar a</Label>
                <Input id="product-alert" value={alertAt} onChange={(event) => setAlertAt(event.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="Ex.: 5" />
              </div>
              <div>
                <Label htmlFor="product-unit">Unidade (opcional)</Label>
                <Input id="product-unit" value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="un, cx, kg, m²" />
              </div>
              <p className="text-[11px] text-muted-foreground sm:col-span-3">Ao chegar no número de aviso, a gestão recebe um alerta para comprar mais.</p>
            </div>
          ) : null}
        </FormSection>:null}

        <FormSection step={5} title="Descrição e observações">
          <Textarea id="product-description" rows={6} value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-32 resize-y leading-relaxed" placeholder="Detalhes e condições do produto. Se publicado no site, este texto ficará visível." maxLength={5000} aria-label="Descrição e observações" />
          <p className="mt-1 text-right text-[11px] text-muted-foreground tabular-nums">{description.length}/5000</p>
        </FormSection>

        <ProductEngineEditor section={section} workspaceId={workspaceId} product={product} details={details} onChange={value=>{setDetails(value);setError(undefined);}} categoryId={categoryId} onCategory={setCategoryId} brandId={brandId} onBrand={setBrandId} photos={photos} isManager={isManager} canViewCost={canViewCost}/>

        {product&&section==="geral"&&<ProductChannels workspaceId={workspaceId} productId={product.id} siteVisible={details.siteVisible}/>}
        <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 bg-popover px-1 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={handleSave} loading={busy} disabled={!name.trim() || busy || uploading}>{product ? "Salvar alterações" : "Cadastrar produto"}</Button>
        </div>
      </div></PageSubnav></FormSectionContext.Provider>
    </Modal>
  );
}

function FormSection({ step, title, hint, children }: { step: number; title: string; hint?: string; children: React.ReactNode }) {
  const section=useContext(FormSectionContext);
  if(section!==({1:"midia",2:"geral",3:"precos",4:"estoque",5:"geral"} as Record<number,string>)[step])return null;
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function formatQuantityInput(value: number): string {
  return String(value).replace(".", ",");
}

export function quantityFromInput(value: string): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const parsed = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}
