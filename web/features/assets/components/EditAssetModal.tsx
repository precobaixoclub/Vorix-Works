"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { updateAsset } from "../api";
import {
  ASSET_KINDS,
  ASSET_KIND_LABEL,
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

/** Edita nome, tipo e tags de um material já cadastrado — não substitui o arquivo em si, que
 * continua o mesmo no Object Storage (reenviar exige excluir e cadastrar de novo). Migração
 * "Prompt Persistente de Produção + Materiais com Contexto para o GPT" adicionou 4 campos
 * semânticos (tipo de material, instrução para IA, regra de uso, prioridade de uso) — é isto que
 * o motor GPT usa para saber COMO/QUANDO usar cada material, não só o arquivo em si. */
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
  const [kind, setKind] = useState<AssetKind>(asset.kind);
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
    <Modal title="Editar Material da Marca" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="asset-edit-name">Nome do arquivo</Label>
          <Input id="asset-edit-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <Label htmlFor="asset-edit-kind">Tipo (categoria de arquivo)</Label>
          <select id="asset-edit-kind" value={kind} onChange={(e) => setKind(e.target.value as AssetKind)} className={SELECT_CLASSES}>
            {ASSET_KINDS.map((k) => (
              <option key={k} value={k}>
                {ASSET_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="asset-edit-tags">Tags (separadas por vírgula)</Label>
          <Input id="asset-edit-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ex.: campanha, verão" />
        </div>

        <div className="border-t border-border pt-3">
          <p className="mb-3 text-xs font-medium text-ink-muted">Contexto para o motor de geração (GPT)</p>

          <div>
            <Label htmlFor="asset-edit-material-type">Papel do material</Label>
            <select id="asset-edit-material-type" value={materialType} onChange={(e) => setMaterialType(e.target.value as AssetMaterialType | "")} className={SELECT_CLASSES}>
              <option value="">Não classificado</option>
              {ASSET_MATERIAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ASSET_MATERIAL_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3">
            <Label htmlFor="asset-edit-usage-priority">Prioridade de uso</Label>
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
            <Label htmlFor="asset-edit-ai-instructions">Observação para IA</Label>
            <Textarea
              id="asset-edit-ai-instructions"
              rows={3}
              value={aiInstructions}
              onChange={(e) => setAiInstructions(e.target.value)}
              placeholder='Ex.: "Use este screenshot real dentro de notebook ou smartphone quando o objetivo for demonstrar o funcionamento do site."'
            />
            <p className="mt-1 text-xs text-ink-faint">Explica QUANDO/COMO o motor de geração deve usar este material.</p>
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
            <p className="mt-1 text-xs text-ink-faint">Restrição categórica de como este material pode ser tratado.</p>
          </div>
        </div>

        <p className="text-xs text-ink-faint">Para trocar o arquivo em si, exclua este material e envie um novo.</p>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
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
