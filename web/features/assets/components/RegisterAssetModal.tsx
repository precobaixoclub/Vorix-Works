"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { registerAsset, uploadAssetFile } from "../api";
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

const SELECT_CLASSES = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

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

  useEffect(() => {
    if (!file?.type.startsWith("image/")) {
      setLocalPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pickFile(selected: File | undefined) {
    setFile(selected);
    if (selected && !name.trim()) setName(selected.name);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    if (fileRequired && !file) {
      setError("Envie um arquivo para cadastrar este material.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
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
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar o material.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="asset-file">Arquivo</Label>
          <input
            id="asset-file"
            type="file"
            accept={isLogoMode ? "image/png,image/svg+xml,image/webp" : "image/jpeg,image/png,image/webp,image/svg+xml,video/mp4,video/quicktime,application/pdf,font/ttf,font/otf,font/woff,font/woff2"}
            required={fileRequired}
            onChange={(e) => pickFile(e.target.files?.[0])}
            className="w-full text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent"
          />
          <p className="mt-1 text-xs text-ink-muted">
            {isLogoMode ? (
              "PNG com fundo transparente (recomendado), SVG ou WEBP. Formato quadrado (1:1), pelo menos 512×512px."
            ) : (
              <>JPEG, PNG, WEBP, SVG, MP4, MOV, PDF ou fontes (TTF/OTF/WOFF).{fileRequired ? " Obrigatório para este tipo de material." : " Opcional."}</>
            )}
          </p>
          {localPreviewUrl ? (
            <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface-sunken">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={localPreviewUrl} alt="Prévia do material selecionado" className="max-h-56 w-full object-contain" />
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
            <select id="asset-material-type" value={materialType} onChange={(e) => setMaterialType(e.target.value as AssetMaterialType | "")} className={SELECT_CLASSES}>
              <option value="">Não classificado</option>
              {ASSET_MATERIAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ASSET_MATERIAL_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <Label htmlFor="asset-tags">Tags (separadas por vírgula)</Label>
          <Input id="asset-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ex.: campanha, verão" />
        </div>

        <div className="border-t border-border pt-3">
          <div>
            <Label htmlFor="asset-usage-priority">Prioridade</Label>
            <select id="asset-usage-priority" value={usagePriority} onChange={(e) => setUsagePriority(e.target.value as AssetUsagePriority | "")} className={SELECT_CLASSES}>
              <option value="">Automático (padrão)</option>
              {ASSET_USAGE_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {ASSET_USAGE_PRIORITY_LABEL[priority]}
                </option>
              ))}
            </select>
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
