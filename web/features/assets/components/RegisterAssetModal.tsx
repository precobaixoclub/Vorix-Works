"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { registerAsset } from "../data";
import { ASSET_KINDS, ASSET_KIND_LABEL, type Asset, type AssetKind } from "../types";

/**
 * "Enviar" — sem upload real nesta sprint (Fase 4: "ainda sem upload real"). Registra só
 * nome/tipo/tags, do mesmo jeito que `registerAsset` já faz no backend.
 */
export function RegisterAssetModal({
  workspaceId,
  onClose,
  onRegistered,
}: {
  workspaceId: string;
  onClose: () => void;
  onRegistered: (asset: Asset) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssetKind>("photo");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const asset = await registerAsset(workspaceId, {
        kind,
        name: name.trim(),
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      onRegistered(asset);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Novo Ativo" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
          Upload de arquivo ainda não está disponível — isto registra só o nome e o tipo do ativo.
        </p>
        <div>
          <Label htmlFor="asset-name">Nome do arquivo</Label>
          <Input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: logo-principal.svg" autoFocus />
        </div>
        <div>
          <Label htmlFor="asset-kind">Tipo</Label>
          <select
            id="asset-kind"
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
          <Label htmlFor="asset-tags">Tags (separadas por vírgula)</Label>
          <Input id="asset-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ex.: campanha, verão" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Registrando…" : "Registrar Ativo"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
