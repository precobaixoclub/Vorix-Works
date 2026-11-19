"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { cn } from "@/lib/utils";
import { updateBrandProfile } from "../api";
import type { BrandProfile } from "../types";

/** Limites reais do backend (`brand-profile.route.ts`) — o contador e o travamento seguem estes
 * números, pra nunca chegar a validação do servidor ("must NOT have more than N characters"). */
const LIMITS = { businessDescription: 2000, positioning: 2000, targetAudience: 2000, toneOfVoice: 500 } as const;

/** Cabeçalho do campo: rótulo à esquerda + contador "usados/limite" à direita, que fica âmbar ao
 * se aproximar e vermelho ao estourar. `tabular-nums` pra o número não "dançar" ao digitar. */
function FieldHeader({ htmlFor, label, length, max }: { htmlFor: string; label: string; length: number; max: number }) {
  const over = length > max;
  const near = !over && length >= Math.floor(max * 0.9);
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <span
        className={cn("text-[11px] tabular-nums", over ? "font-medium text-rose-500" : near ? "text-amber-500" : "text-muted-foreground/70")}
        aria-live="polite"
      >
        {length.toLocaleString("pt-BR")}/{max.toLocaleString("pt-BR")}
      </span>
    </div>
  );
}

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
  // Diferenciais são uma LISTA — editados como texto, um por linha.
  const initialDifferentiators = (profile?.differentiators ?? []).join("\n");
  const [differentiators, setDifferentiators] = useState(initialDifferentiators);
  const [toneOfVoice, setToneOfVoice] = useState(profile?.toneOfVoice ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const differentiatorItems = differentiators.split("\n").map((item) => item.trim()).filter(Boolean);
  const differentiatorsChanged = differentiators !== initialDifferentiators;
  const differentiatorsOverLimit = differentiatorItems.length > 20 || differentiatorItems.some((item) => item.length > 200);

  // Campos que estouraram o limite (acontece quando o valor já veio grande do backend; o
  // `maxLength` impede DIGITAR além, mas não corta um valor pré-carregado).
  const overLimitLabels = [
    businessDescription.length > LIMITS.businessDescription ? "Descrição do negócio" : null,
    positioning.length > LIMITS.positioning ? "Posicionamento" : null,
    targetAudience.length > LIMITS.targetAudience ? "Público-alvo" : null,
    differentiatorsOverLimit ? "Diferenciais" : null,
    toneOfVoice.length > LIMITS.toneOfVoice ? "Tom de voz" : null,
  ].filter((label): label is string => label !== null);
  const hasOverLimit = overLimitLabels.length > 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (hasOverLimit) return;
    setSaving(true);
    setError(undefined);
    try {
      const updated = await updateBrandProfile(workspaceId, {
        positioning: positioning.trim() || undefined,
        businessDescription: businessDescription.trim() || undefined,
        targetAudience: targetAudience.trim() || undefined,
        toneOfVoice: toneOfVoice.trim() || undefined,
        ...(differentiatorsChanged ? { differentiators: differentiatorItems } : {}),
      });
      onSaved(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o perfil da marca.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Editar perfil da marca" onClose={onClose} maxWidthClass="sm:max-w-lg">
      <p className="-mt-1 mb-1 text-xs text-muted-foreground">
        Estas informações orientam a IA a gerar conteúdo com a cara da marca. Capriche na descrição e no posicionamento.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <FieldHeader htmlFor="brand-description" label="Descrição do negócio" length={businessDescription.length} max={LIMITS.businessDescription} />
          <Textarea
            id="brand-description"
            rows={4}
            maxLength={LIMITS.businessDescription}
            value={businessDescription}
            onChange={(e) => setBusinessDescription(e.target.value)}
            placeholder="Ex.: Loja online de calçados esportivos com foco em corrida de rua."
          />
        </div>
        <div>
          <FieldHeader htmlFor="brand-positioning" label="Posicionamento" length={positioning.length} max={LIMITS.positioning} />
          <Textarea
            id="brand-positioning"
            rows={4}
            maxLength={LIMITS.positioning}
            value={positioning}
            onChange={(e) => setPositioning(e.target.value)}
            placeholder="Ex.: Marca acessível que entrega qualidade de performance sem o preço de uma marca premium."
          />
        </div>
        <div>
          <FieldHeader htmlFor="brand-audience" label="Público-alvo" length={targetAudience.length} max={LIMITS.targetAudience} />
          <Textarea
            id="brand-audience"
            rows={2}
            maxLength={LIMITS.targetAudience}
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            placeholder="Ex.: corredores amadores de 25 a 45 anos"
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label htmlFor="brand-differentiators" className="text-xs font-medium text-muted-foreground">
              Diferenciais
            </label>
            <span className={cn("text-[11px] tabular-nums", differentiatorsOverLimit ? "font-medium text-rose-500" : "text-muted-foreground/70")}>
              {differentiatorItems.length}/20
            </span>
          </div>
          <Textarea
            id="brand-differentiators"
            rows={3}
            value={differentiators}
            onChange={(e) => setDifferentiators(e.target.value)}
            placeholder={"Um diferencial por linha. Ex.:\nSite de casamento grátis para criar\nPresentes via Pix sem comissão da plataforma"}
          />
          <p className="mt-1 text-[11px] text-muted-foreground/80">Um por linha. Até 20 itens, 200 caracteres cada.</p>
        </div>
        <div>
          <FieldHeader htmlFor="brand-tone" label="Tom de voz" length={toneOfVoice.length} max={LIMITS.toneOfVoice} />
          <Textarea
            id="brand-tone"
            rows={2}
            maxLength={LIMITS.toneOfVoice}
            value={toneOfVoice}
            onChange={(e) => setToneOfVoice(e.target.value)}
            placeholder="Ex.: direto, motivador e sem jargão técnico"
          />
        </div>

        {hasOverLimit ? (
          <p className="text-xs text-rose-500">
            {overLimitLabels.length === 1
              ? `O campo “${overLimitLabels[0]}” passou do limite. Reduza o texto para salvar.`
              : `Alguns campos passaram do limite (${overLimitLabels.join(", ")}). Reduza o texto para salvar.`}
          </p>
        ) : error ? (
          <p className="text-xs text-danger">{error}</p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            className="w-full sm:w-auto"
            disabled={saving || hasOverLimit}
            title={hasOverLimit ? "Reduza os campos acima do limite para salvar." : undefined}
          >
            {saving ? "Salvando…" : "Salvar perfil"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
