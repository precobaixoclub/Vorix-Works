"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { updateAsset } from "../api";
import { deriveAssetKind } from "../derive-kind";
import {
  ASSET_MATERIAL_TYPES,
  ASSET_MATERIAL_TYPE_LABEL,
  ASSET_USAGE_PRIORITIES,
  ASSET_USAGE_PRIORITY_LABEL,
  type Asset,
  type AssetMaterialType,
  type AssetUsagePriority,
} from "../types";

const SELECT_CLASSES = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-accent-soft";

/** Edita nome, tipo e tags de um material já cadastrado — não substitui o arquivo em si, que
 * continua o mesmo no Object Storage (reenviar exige excluir e cadastrar de novo). Migração
 * "Marca & Materiais": a categoria técnica (`AssetKind`) deixou de ser um seletor visível — "Tipo
 * do material" é o único conceito de classificação na interface, com `AssetKind` re-derivado a
 * partir dele (preservando o arquivo original quando o tipo escolhido não muda a natureza dele,
 * ex.: vídeo continua vídeo mesmo se reclassificado como "Outro"). */
export function EditAssetModal({
  asset,
  onClose,
  onUpdated,
}: {
  asset: Asset;
  onClose: () => void;
  onUpdated: (asset: Asset) => void;
}) {
  const [name, setName] = useState(asset.name);
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [materialType, setMaterialType] = useState<AssetMaterialType | "">(asset.materialType ?? "");
  const [aiInstructions, setAiInstructions] = useState(asset.aiInstructions ?? "");
  const [usageRule, setUsageRule] = useState(asset.usageRule ?? "");
  const [usagePriority, setUsagePriority] = useState<AssetUsagePriority | "">(asset.usagePriority ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const kind = deriveAssetKind(materialType, asset.storageRef?.metadata?.contentType, asset.kind);
      const updated = await updateAsset(asset.id, {
        name: name.trim(),
        kind,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        materialType: materialType || undefined,
        aiInstructions: aiInstructions.trim() || undefined,
        usageRule: usageRule.trim() || undefined,
        usagePriority: usagePriority || undefined,
      });
      onUpdated(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar as alterações.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Editar material" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="asset-edit-name">Nome</Label>
          <Input id="asset-edit-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <Label htmlFor="asset-edit-material-type">Tipo do material</Label>
          <select id="asset-edit-material-type" value={materialType} onChange={(e) => setMaterialType(e.target.value as AssetMaterialType | "")} className={SELECT_CLASSES}>
            <option value="">Não classificado</option>
            {ASSET_MATERIAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {ASSET_MATERIAL_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="asset-edit-tags">Tags (separadas por vírgula)</Label>
          <Input id="asset-edit-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ex.: campanha, verão" />
        </div>

        <div className="border-t border-border pt-3">
          <div>
            <Label htmlFor="asset-edit-usage-priority">Prioridade</Label>
            <select id="asset-edit-usage-priority" value={usagePriority} onChange={(e) => setUsagePriority(e.target.value as AssetUsagePriority | "")} className={SELECT_CLASSES}>
              <option value="">Automático (padrão)</option>
              {ASSET_USAGE_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {ASSET_USAGE_PRIORITY_LABEL[priority]}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3">
            <Label htmlFor="asset-edit-ai-instructions">Como a IA deve usar este material?</Label>
            <Textarea
              id="asset-edit-ai-instructions"
              rows={3}
              value={aiInstructions}
              onChange={(e) => setAiInstructions(e.target.value)}
              placeholder='Ex.: "Use este screenshot real dentro de notebook ou smartphone quando o objetivo for demonstrar o funcionamento do site."'
            />
          </div>

          <div className="mt-3">
            <Label htmlFor="asset-edit-usage-rule">Regra de uso</Label>
            <Textarea
              id="asset-edit-usage-rule"
              rows={2}
              value={usageRule}
              onChange={(e) => setUsageRule(e.target.value)}
              placeholder='Ex.: "Nunca redesenhar, não alterar proporção e não mudar cores."'
            />
          </div>
        </div>

        <p className="text-xs text-ink-faint">Para trocar o arquivo em si, exclua este material e envie um novo.</p>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="w-full sm:w-auto" disabled={submitting || !name.trim()}>
            {submitting ? "Salvando…" : "Salvar alterações"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
