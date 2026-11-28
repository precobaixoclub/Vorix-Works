"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label, Select, SelectItem, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { registerAsset, removeImageBackground, uploadAssetFile, type UploadedAssetFile } from "../api";
import { deriveAssetKind, FILE_REQUIRED_MATERIAL_TYPES } from "../derive-kind";
import {
  ASSET_MATERIAL_TYPES,
  ASSET_MATERIAL_TYPE_LABEL,
  ASSET_USAGE_PRIORITIES,
  ASSET_USAGE_PRIORITY_LABEL,
  type Asset,
  type AssetKind,
  type AssetMaterialType,
  type AssetUsagePriority,
} from "../types";

const LOGO_WITHOUT_TRANSPARENCY_ERROR = "ASSET_UPLOAD_LOGO_WITHOUT_TRANSPARENCY";
const MAX_UPLOAD_BYTES = 100_000_000;

// Valores-sentinela para as opções "vazias" (Radix Select não aceita value=""). Traduzidos de/para
// "" na borda do componente — não muda o dado salvo, só a representação na UI.
const MATERIAL_TYPE_NONE = "__none__";
const USAGE_PRIORITY_AUTO = "__auto__";

/** Envia o arquivo pro Object Storage (`POST /v1/assets/upload`) e só depois registra o material
 * com o `storageRef` real. Migração "Marca & Materiais": a categoria técnica (`AssetKind`) deixou
 * de ser um seletor visível — "Tipo do material" (`AssetMaterialType`) é agora o único conceito de
 * classificação na interface, com `AssetKind` derivado automaticamente (ver `deriveAssetKind`). */
export function RegisterAssetModal({
  workspaceId,
  onClose,
  onRegistered,
  defaultKind,
  lockKind = false,
  defaultMaterialType,
  defaultUsagePriority,
  initialFile,
  title = "Adicionar material",
}: {
  workspaceId: string;
  onClose: () => void;
  onRegistered: (asset: Asset) => void;
  /** Usado só pelo `LogoConfigCard`, que sempre quer registrar como logo — trava a categoria
   * derivada em "logo" independentemente do tipo de arquivo enviado. */
  defaultKind?: AssetKind;
  lockKind?: boolean;
  defaultMaterialType?: AssetMaterialType;
  defaultUsagePriority?: AssetUsagePriority;
  /** Pré-carrega um arquivo já escolhido (drag-and-drop na grade de Materiais), pulando a etapa de
   * seleção manual do input. */
  initialFile?: File;
  title?: string;
}) {
  const isLogoMode = lockKind && defaultKind === "logo";
  const [file, setFile] = useState<File | undefined>(initialFile);
  const [name, setName] = useState(initialFile?.name ?? "");
  const [tags, setTags] = useState("");
  const [materialType, setMaterialType] = useState<AssetMaterialType | "">(defaultMaterialType ?? "");
  const [aiInstructions, setAiInstructions] = useState("");
  const [usageRule, setUsageRule] = useState("");
  const [usagePriority, setUsagePriority] = useState<AssetUsagePriority | "">(defaultUsagePriority ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const fileRequired = isLogoMode || (materialType !== "" && FILE_REQUIRED_MATERIAL_TYPES.has(materialType));
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | undefined>();
  // Oferta de "remover fundo com IA" quando o upload normal rejeita por falta de transparência —
  // nunca troca a logo sozinho: o resultado processado só é usado depois de confirmação explícita
  // (ver comentário em `openai-background-removal.ts` — um recorte errado aqui se repetiria em
  // toda peça futura da marca).
  const [needsTransparency, setNeedsTransparency] = useState(false);
  const [bgRemoval, setBgRemoval] = useState<{ status: "idle" | "processing" | "ready" | "error"; result?: UploadedAssetFile; error?: string }>({ status: "idle" });

  useEffect(() => {
    if (!file || !(file.type.startsWith("image/") || file.type.startsWith("video/"))) {
      setLocalPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pickFile(selected: File | undefined) {
    setFile(selected);
    setNeedsTransparency(false);
    setBgRemoval({ status: "idle" });
    if (selected && !name.trim()) setName(selected.name);
  }

  async function handleRemoveBackground() {
    if (!file) return;
    setBgRemoval({ status: "processing" });
    try {
      const result = await removeImageBackground(workspaceId, file);
      setBgRemoval({ status: "ready", result });
    } catch (cause) {
      setBgRemoval({ status: "error", error: cause instanceof Error ? cause.message : "Não foi possível remover o fundo automaticamente." });
    }
  }

  async function handleUseBackgroundRemovedResult() {
    if (bgRemoval.status !== "ready" || !bgRemoval.result || !name.trim()) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const kind: AssetKind = isLogoMode ? "logo" : deriveAssetKind(materialType, bgRemoval.result.contentType, "photo");
      const asset = await registerAsset(workspaceId, {
        kind,
        name: name.trim(),
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        upload: bgRemoval.result,
        materialType: materialType || undefined,
        aiInstructions: aiInstructions.trim() || undefined,
        usageRule: usageRule.trim() || undefined,
        usagePriority: usagePriority || undefined,
      });
      onRegistered(asset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o material.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    if (fileRequired && !file) {
      setError("Envie um arquivo para cadastrar este material.");
      return;
    }
    // Mesmo limite padrão da API (MEDIA_UPLOAD_MAX_BYTES): avisa antes de subir um vídeo enorme à toa.
    if (file && file.size > MAX_UPLOAD_BYTES) {
      setError(`Arquivo de ${Math.round(file.size / 1_000_000)} MB — o limite é ${MAX_UPLOAD_BYTES / 1_000_000} MB. Para vídeo, exporte em 1080p ou corte o trecho que interessa.`);
      return;
    }
    setSubmitting(true);
    setError(undefined);
    setNeedsTransparency(false);
    try {
      // Logo sem fundo transparente sai com uma caixa visível ao redor na peça final (achado ao
      // vivo — JPEG nunca tem canal alfa, não tem como "remover o fundo" depois). Vale pra
      // qualquer caminho que classifique o material como logo, não só o `LogoConfigCard`.
      const requireTransparency = isLogoMode || materialType === "logo_principal" || materialType === "logo_secundaria";
      const upload = file ? await uploadAssetFile(workspaceId, file, { requireTransparency }) : undefined;
      const contentTypeForKind = upload?.contentType ?? file?.type;
      const fallbackKind: AssetKind = contentTypeForKind?.startsWith("image/") ? "photo" : "document";
      const kind = isLogoMode ? "logo" : deriveAssetKind(materialType, contentTypeForKind, fallbackKind);
      const asset = await registerAsset(workspaceId, {
        kind,
        name: name.trim(),
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        upload,
        materialType: materialType || undefined,
        aiInstructions: aiInstructions.trim() || undefined,
        usageRule: usageRule.trim() || undefined,
        usagePriority: usagePriority || undefined,
      });
      onRegistered(asset);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível enviar o material.";
      setError(message);
      if (message.includes(LOGO_WITHOUT_TRANSPARENCY_ERROR)) setNeedsTransparency(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} maxWidthClass="sm:max-w-lg">
      <p className="-mt-1 mb-1 text-xs text-muted-foreground">
        Envie logos, fotos, vídeos, screenshots ou fontes. Quanto mais contexto você der, mais fiéis à marca ficam os conteúdos gerados pela IA.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="asset-file">Arquivo</Label>
          <input
            id="asset-file"
            type="file"
            accept={isLogoMode ? "image/png,image/svg+xml,image/webp" : "image/jpeg,image/png,image/webp,image/svg+xml,video/mp4,video/quicktime,application/pdf,font/ttf,font/otf,font/woff,font/woff2"}
            required={fileRequired}
            onChange={(e) => pickFile(e.target.files?.[0])}
            className="w-full text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary"
          />
          <p className="mt-1 text-xs text-ink-muted">
            {isLogoMode ? (
              "PNG com fundo transparente (recomendado), SVG ou WEBP. Formato quadrado (1:1), pelo menos 512×512px."
            ) : (
              <>JPEG, PNG, WEBP, SVG, vídeo MP4 ou MOV (até 100 MB), PDF ou fontes (TTF/OTF/WOFF).{fileRequired ? " Obrigatório para este tipo de material." : " Opcional."}</>
            )}
          </p>
          {localPreviewUrl ? (
            <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface-sunken">
              {file?.type.startsWith("video/") ? (
                <video src={localPreviewUrl} controls muted playsInline preload="metadata" aria-label="Prévia do vídeo selecionado" className="max-h-56 w-full bg-black object-contain" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={localPreviewUrl} alt="Prévia do material selecionado" className="max-h-56 w-full object-contain" />
              )}
            </div>
          ) : null}
        </div>
        <div>
          <Label htmlFor="asset-name">Nome</Label>
          <Input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Logo principal" autoFocus />
        </div>

        {isLogoMode ? null : (
          <div>
            <Label htmlFor="asset-material-type">Tipo do material</Label>
            <Select
              id="asset-material-type"
              value={materialType || MATERIAL_TYPE_NONE}
              onValueChange={(value) => setMaterialType(value === MATERIAL_TYPE_NONE ? "" : (value as AssetMaterialType))}
            >
              <SelectItem value={MATERIAL_TYPE_NONE}>Não classificado</SelectItem>
              {ASSET_MATERIAL_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {ASSET_MATERIAL_TYPE_LABEL[type]}
                </SelectItem>
              ))}
            </Select>
          </div>
        )}

        <div>
          <Label htmlFor="asset-tags">Tags (separadas por vírgula)</Label>
          <Input id="asset-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ex.: campanha, verão" />
        </div>

        <div className="border-t border-border pt-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Orientações para a IA (opcional)</p>
          <div>
            <Label htmlFor="asset-usage-priority">Prioridade</Label>
            <Select
              id="asset-usage-priority"
              value={usagePriority || USAGE_PRIORITY_AUTO}
              onValueChange={(value) => setUsagePriority(value === USAGE_PRIORITY_AUTO ? "" : (value as AssetUsagePriority))}
            >
              <SelectItem value={USAGE_PRIORITY_AUTO}>Automático (padrão)</SelectItem>
              {ASSET_USAGE_PRIORITIES.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {ASSET_USAGE_PRIORITY_LABEL[priority]}
                </SelectItem>
              ))}
            </Select>
          </div>

          <div className="mt-3">
            <Label htmlFor="asset-ai-instructions">Como a IA deve usar este material?</Label>
            <Textarea
              id="asset-ai-instructions"
              rows={3}
              value={aiInstructions}
              onChange={(e) => setAiInstructions(e.target.value)}
              placeholder='Ex.: "Use este screenshot real dentro de notebook ou smartphone quando o objetivo for demonstrar o funcionamento do site."'
            />
          </div>

          <div className="mt-3">
            <Label htmlFor="asset-usage-rule">Regra de uso</Label>
            <Textarea
              id="asset-usage-rule"
              rows={2}
              value={usageRule}
              onChange={(e) => setUsageRule(e.target.value)}
              placeholder='Ex.: "Nunca redesenhar, não alterar proporção e não mudar cores."'
            />
          </div>
        </div>

        {error ? <p className="text-xs text-danger">{error}</p> : null}

        {needsTransparency ? (
          <div className="rounded-lg border border-primary/30 bg-accent-soft/40 p-3">
            {bgRemoval.status === "ready" && bgRemoval.result ? (
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-ink">Fundo removido pela IA — confira antes de usar:</p>
                <div
                  className="h-32 w-32 overflow-hidden rounded-lg border border-border"
                  style={{
                    backgroundImage: "conic-gradient(var(--color-surface-sunken) 0.25turn, var(--color-surface) 0.25turn 0.5turn, var(--color-surface-sunken) 0.5turn 0.75turn, var(--color-surface) 0.75turn)",
                    backgroundSize: "16px 16px",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={bgRemoval.result.url} alt="Prévia com fundo removido" className="h-full w-full object-contain p-2" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="text-xs" disabled={submitting} onClick={handleUseBackgroundRemovedResult}>
                    {submitting ? "Salvando…" : "Usar esta versão"}
                  </Button>
                  <Button type="button" variant="secondary" className="text-xs" disabled={submitting} onClick={handleRemoveBackground}>
                    Tentar de novo
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-ink-muted">
                  Esse arquivo não tem fundo transparente. A IA pode remover o fundo automaticamente (mesmo recurso do ChatGPT) — você confere o resultado antes de usar.
                </p>
                {bgRemoval.status === "error" ? <p className="text-xs text-danger">{bgRemoval.error}</p> : null}
                <Button type="button" variant="secondary" className="text-xs" disabled={bgRemoval.status === "processing"} onClick={handleRemoveBackground}>
                  {bgRemoval.status === "processing" ? "Removendo fundo…" : "Remover fundo com IA"}
                </Button>
              </div>
            )}
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="w-full sm:w-auto" disabled={submitting || !name.trim() || (fileRequired && !file)}>
            {submitting ? (file ? "Enviando…" : "Registrando…") : "Adicionar material"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
