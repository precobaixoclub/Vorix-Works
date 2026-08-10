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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const trimmedName = name.trim();
  const unchanged = trimmedName === workspace.name;

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
      const updated = await updateWorkspace(workspace.id, { name: trimmedName });
      onUpdated(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível editar o espaço de trabalho.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Editar Espaço de Trabalho" onClose={onClose}>
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
