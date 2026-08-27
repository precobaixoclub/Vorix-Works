"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { updateWorkspace } from "../api";
import type { Workspace } from "../types";

export function EditWorkspaceModal({
  workspace,
  onClose,
  onUpdated,
}: {
  workspace: Workspace;
  onClose: () => void;
  onUpdated: (workspace: Workspace) => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [logoUrl, setLogoUrl] = useState(workspace.settings.logoUrl ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const trimmedName = name.trim();
  const unchanged = trimmedName === workspace.name && logoUrl === (workspace.settings.logoUrl ?? "");

  function handleLogoChange(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Envie uma imagem em PNG, JPG, WebP ou SVG.");
      return;
    }
    if (file.size > 1_000_000) {
      setError("A logo precisa ter até 1 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setLogoUrl(typeof reader.result === "string" ? reader.result : "");
      setError(undefined);
    };
    reader.onerror = () => setError("Não foi possível carregar a logo.");
    reader.readAsDataURL(file);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmedName) {
      setError("Nome é obrigatório.");
      return;
    }
    if (unchanged) {
      onClose();
      return;
    }

    setSubmitting(true);
    setError(undefined);
    try {
      const updated = await updateWorkspace(workspace.id, { name: trimmedName, settings: { ...workspace.settings, logoUrl } });
      onUpdated(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível editar o espaço de trabalho.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Editar Espaço de Trabalho" onClose={onClose} maxWidthClass="sm:max-w-2xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="edit-workspace-name">Nome</Label>
          <Input
            id="edit-workspace-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome do espaço"
            autoFocus
          />
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-sunken">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="h-full w-full object-contain p-2" />
              ) : (
                <span className="text-2xl font-semibold text-primary">{trimmedName.slice(0, 1).toUpperCase() || "V"}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">Logo do espaço</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                Ideal: imagem quadrada 512 x 512 px, fundo transparente, até 1 MB.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken">
                  Escolher logo
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="sr-only"
                    onChange={(event) => handleLogoChange(event.target.files?.[0])}
                  />
                </label>
                {logoUrl ? (
                  <Button type="button" variant="ghost" className="min-h-9 px-3 py-2" onClick={() => setLogoUrl("")}>
                    Remover logo
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="w-full sm:w-auto" disabled={submitting || !trimmedName || unchanged}>
            {submitting ? "Salvando..." : "Salvar nome"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
