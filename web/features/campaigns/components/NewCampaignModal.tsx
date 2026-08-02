"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { createCampaign } from "../data";
import type { Campaign, CampaignFormat } from "../types";

const FORMATS: { value: CampaignFormat; label: string }[] = [
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "carousel", label: "Carrossel" },
  { value: "story", label: "Story" },
  { value: "reel", label: "Reel" },
];

export function NewCampaignModal({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  onClose: () => void;
  onCreated: (campaign: Campaign) => void;
}) {
  const [name, setName] = useState("");
  const [format, setFormat] = useState<CampaignFormat>("image");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const campaign = await createCampaign(workspaceId, { name: name.trim(), format });
      onCreated(campaign);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Nova Campanha" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
          Sem geração de conteúdo por IA ainda — isto só cria a estrutura da campanha, como rascunho.
        </p>
        <div>
          <Label htmlFor="campaign-name">Nome</Label>
          <Input id="campaign-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Lançamento de verão" autoFocus />
        </div>
        <div>
          <Label htmlFor="campaign-format">Formato</Label>
          <select
            id="campaign-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as CampaignFormat)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
          >
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Criando…" : "Criar Campanha"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
