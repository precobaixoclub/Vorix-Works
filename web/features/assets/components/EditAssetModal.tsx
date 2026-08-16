"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { updateAsset } from "../api";
import { ASSET_KINDS, ASSET_KIND_LABEL, type Asset, type AssetKind } from "../types";

/** Edita nome, tipo e tags de um material já cadastrado — não substitui o arquivo em si, que
 * continua o mesmo no Object Storage (reenviar exige excluir e cadastrar de novo). */
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
          <Label htmlFor="asset-edit-kind">Tipo</Label>
          <select
            id="asset-edit-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as AssetKind)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
          >
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
