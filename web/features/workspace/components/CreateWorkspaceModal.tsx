"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { createWorkspace } from "../api";
import type { Workspace } from "../types";

export function CreateWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (workspace: Workspace) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Nome é obrigatório.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const workspace = await createWorkspace({ name: name.trim(), kind: kind.trim() || undefined });
      onCreated(workspace);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o espaço de trabalho.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Novo Espaço de Trabalho" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="workspace-name">Nome</Label>
          <Input id="workspace-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Rumo ao Altar" autoFocus />
        </div>
        <div>
          <Label htmlFor="workspace-kind">Tipo (opcional)</Label>
          <Input id="workspace-kind" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="Ex.: cliente, marca" />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="w-full sm:w-auto" disabled={submitting}>
            {submitting ? "Criando…" : "Criar Espaço de Trabalho"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
