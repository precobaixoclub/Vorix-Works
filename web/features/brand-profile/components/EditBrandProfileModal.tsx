"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { updateBrandProfile } from "../api";
import type { BrandProfile } from "../types";

/** Escreve só os 4 campos com fonte real de persistência hoje (Clara por baixo, via
 * `updateBrandProfile` no backend) — produtos/diferenciais/identidade visual continuam só
 * leitura nesta etapa, sem nenhuma fonte de escrita real ainda. */
export function EditBrandProfileModal({
  workspaceId,
  profile,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  profile: BrandProfile | null;
  onClose: () => void;
  onSaved: (profile: BrandProfile | null) => void;
}) {
  const [positioning, setPositioning] = useState(profile?.positioning ?? "");
  const [businessDescription, setBusinessDescription] = useState(profile?.businessDescription ?? "");
  const [targetAudience, setTargetAudience] = useState(profile?.targetAudience ?? "");
  const [toneOfVoice, setToneOfVoice] = useState(profile?.toneOfVoice ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const updated = await updateBrandProfile(workspaceId, {
        positioning: positioning.trim() || undefined,
        businessDescription: businessDescription.trim() || undefined,
        targetAudience: targetAudience.trim() || undefined,
        toneOfVoice: toneOfVoice.trim() || undefined,
      });
      onSaved(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o perfil da marca.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Editar perfil da marca" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="brand-description">Descrição do negócio</Label>
          <Textarea
            id="brand-description"
            rows={3}
            value={businessDescription}
            onChange={(e) => setBusinessDescription(e.target.value)}
            placeholder="Ex.: Loja online de calçados esportivos com foco em corrida de rua."
          />
        </div>
        <div>
          <Label htmlFor="brand-positioning">Posicionamento</Label>
          <Textarea
            id="brand-positioning"
            rows={3}
            value={positioning}
            onChange={(e) => setPositioning(e.target.value)}
            placeholder="Ex.: Marca acessível que entrega qualidade de performance sem o preço de uma marca premium."
          />
        </div>
        <div>
          <Label htmlFor="brand-audience">Público-alvo</Label>
          <Input
            id="brand-audience"
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            placeholder="Ex.: corredores amadores de 25 a 45 anos"
          />
        </div>
        <div>
          <Label htmlFor="brand-tone">Tom de voz</Label>
          <Input
            id="brand-tone"
            value={toneOfVoice}
            onChange={(e) => setToneOfVoice(e.target.value)}
            placeholder="Ex.: direto, motivador e sem jargão técnico"
          />
        </div>

        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
            {saving ? "Salvando…" : "Salvar perfil"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
