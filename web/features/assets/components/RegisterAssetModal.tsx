"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { registerAsset, uploadAssetFile } from "../api";
import { ASSET_KINDS, ASSET_KIND_LABEL, type Asset, type AssetKind } from "../types";

const FILE_REQUIRED_KINDS = new Set<AssetKind>(["logo", "photo", "video", "product", "mockup", "visual_identity"]);

/** Envia o arquivo pro Object Storage (`POST /v1/assets/upload`) e só depois registra o material
 * com o `storageRef` real — antes disso só existia o registro de metadados, sem nenhum arquivo. */
export function RegisterAssetModal({
  workspaceId,
  onClose,
  onRegistered,
}: {
  workspaceId: string;
  onClose: () => void;
  onRegistered: (asset: Asset) => void;
}) {
  const [file, setFile] = useState<File | undefined>();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssetKind>("photo");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const fileRequired = FILE_REQUIRED_KINDS.has(kind);
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
      setError(`Envie um arquivo para cadastrar ${ASSET_KIND_LABEL[kind].toLowerCase()}.`);
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const upload = file ? await uploadAssetFile(workspaceId, file) : undefined;
      const asset = await registerAsset(workspaceId, {
        kind,
        name: name.trim(),
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        upload,
      });
      onRegistered(asset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar o material.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Novo Material da Marca" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="asset-file">Arquivo</Label>
          <input
            id="asset-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/svg+xml,video/mp4,video/quicktime,application/pdf,font/ttf,font/otf,font/woff,font/woff2"
            required={fileRequired}
            onChange={(e) => pickFile(e.target.files?.[0])}
            className="w-full text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent"
          />
          <p className="mt-1 text-xs text-ink-muted">
            JPEG, PNG, WEBP, SVG, MP4, MOV, PDF ou fontes (TTF/OTF/WOFF).
            {fileRequired ? " Obrigatório para este tipo." : " Opcional para documentos e referências."}
          </p>
          {localPreviewUrl ? (
            <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface-sunken">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={localPreviewUrl} alt="Prévia do material selecionado" className="max-h-56 w-full object-contain" />
            </div>
          ) : null}
        </div>
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
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="w-full sm:w-auto" disabled={submitting || !name.trim() || (fileRequired && !file)}>
            {submitting ? (file ? "Enviando…" : "Registrando…") : "Registrar Material"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
