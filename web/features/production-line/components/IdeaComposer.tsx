"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { CHANNEL_LABEL } from "../defaults";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import {
  deriveObjective,
  extractExecutionRunFailure,
  generateFromIdea,
  isUnrecoverableSemanticOcclusionFailure,
  MAX_IDEA_TEXT_LENGTH,
  waitForExecutionRunTerminal,
} from "../api";
import { recordGeneration } from "../generation-log";
import { readProductionConfig, writeProductionConfig } from "../storage";
import type { ContentBlueprint, ProductionAspectRatio, ProductionChannel, ProductionFormat } from "../types";

type PresetId = "publicacao" | "anuncio" | "story" | "carrossel";
type ComposerFormat = Exclude<ProductionFormat, "video">;

const PRESETS: { id: PresetId; label: string; icon: string; format: ComposerFormat; aspectRatio: ProductionAspectRatio }[] = [
  { id: "publicacao", label: "Publicação", icon: "▤", format: "single_image", aspectRatio: "4:5" },
  { id: "anuncio", label: "Anúncio", icon: "◎", format: "single_image", aspectRatio: "1:1" },
  { id: "story", label: "Story", icon: "▯", format: "single_image", aspectRatio: "9:16" },
  { id: "carrossel", label: "Carrossel", icon: "▥", format: "carousel", aspectRatio: "4:5" },
];

const CHANNELS: ProductionChannel[] = ["instagram", "facebook", "tiktok", "youtube"];
const ASPECT_RATIOS: ProductionAspectRatio[] = ["1:1", "4:5", "9:16", "16:9"];

function newId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}

/**
 * Redesign da Home "IA-first / composer-first" — o elemento dominante da tela. Reusa exatamente a
 * mesma chamada de geração (`generateFromIdea`/poll/retry) e o mesmo tanque local (`localStorage`)
 * que `/create` e `/production` já usam, sem tocar nenhum dos dois arquivos: este é um componente
 * novo e autocontido, não uma extração deles. Os 4 atalhos (Publicação/Anúncio/Story/Carrossel)
 * só ajustam `format`/`aspectRatio` — os mesmos campos que o formulário manual já expõe, nenhum
 * conceito novo no backend.
 */
export function IdeaComposer({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [ideaText, setIdeaText] = useState("");
  const [format, setFormat] = useState<ComposerFormat>("single_image");
  const [aspectRatio, setAspectRatio] = useState<ProductionAspectRatio>("4:5");
  const [channels, setChannels] = useState<ProductionChannel[]>(["instagram"]);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<"idle" | "generating" | "retrying">("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = status !== "idle";
  const activePreset = PRESETS.find((preset) => preset.format === format && preset.aspectRatio === aspectRatio)?.id;
  const overLimit = ideaText.length > MAX_IDEA_TEXT_LENGTH;
  const canGenerate = ideaText.trim().length > 0 && !overLimit && !busy;

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setFormat(preset.format);
    setAspectRatio(preset.aspectRatio);
  }

  function toggleChannel(channel: ProductionChannel) {
    setChannels((prev) => {
      if (prev.includes(channel)) return prev.length === 1 ? prev : prev.filter((item) => item !== channel);
      return [...prev, channel];
    });
  }

  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await Promise.all(Array.from(files).map((file) => uploadPublicationMedia(workspaceId, file)));
      setReferenceImages((prev) => [...prev, ...uploaded.map((item) => item.url)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível anexar o material.");
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(url: string) {
    setReferenceImages((prev) => prev.filter((item) => item !== url));
  }

  async function handleGenerate() {
    setError(null);
    setStatus("generating");

    const name = ideaText.trim().slice(0, 60) || "Ideia sem nome";
    const objective = deriveObjective(undefined, ideaText);
    const generateInput = {
      workspaceId,
      name,
      objective,
      ideaText,
      format,
      channel: channels[0] ?? ("instagram" as ProductionChannel),
      referenceImages,
      aspectRatio,
      referenceAssets: referenceImages.length > 0 ? referenceImages.map((url) => ({ url, role: "product_photo" as const })) : undefined,
    };

    try {
      const first = await generateFromIdea(generateInput);
      let detail = await waitForExecutionRunTerminal(workspaceId, first.executionRunId);
      let executionRunId = first.executionRunId;

      if (detail.run.state === "failed") {
        const { code, message } = extractExecutionRunFailure(detail);
        if (code === "QUALITY_GATE_NOT_PASSED" && !isUnrecoverableSemanticOcclusionFailure(message)) {
          setStatus("retrying");
          const retry = await generateFromIdea(generateInput);
          executionRunId = retry.executionRunId;
          detail = await waitForExecutionRunTerminal(workspaceId, retry.executionRunId);
        }
      }

      // Mesmo comportamento de `/create`: grava a ideia como avulsa no tanque local, para que ela
      // continue aparecendo em Produção mesmo tendo sido criada pela Home.
      const blueprintId = newId("blueprint");
      const usedAt = detail.run.state === "failed" ? undefined : new Date().toISOString();
      const blueprint: ContentBlueprint = {
        id: blueprintId,
        name,
        format,
        ideaText,
        objective,
        theme: "",
        captionDirection: "",
        creativeDirection: "",
        mediaCount: format === "carousel" ? 3 : 1,
        channels,
        approvalMode: "manual",
        sourceLinks: [],
        referenceImages,
        aspectRatio,
        status: usedAt ? "used" : "available",
        productionMode: "standalone",
        usedAt,
      };
      const config = readProductionConfig(workspaceId);
      writeProductionConfig(workspaceId, { ...config, blueprints: [...config.blueprints, blueprint] });

      if (detail.run.state === "failed") {
        const { message } = extractExecutionRunFailure(detail);
        setError(message || "A geração falhou. Tente novamente.");
        setStatus("idle");
        return;
      }
      if (detail.run.state !== "completed" && detail.run.state !== "waiting_for_approval") {
        setError("A geração está demorando mais que o esperado. Confira em Revisão em alguns minutos.");
        setStatus("idle");
        return;
      }

      recordGeneration(workspaceId, { ...generateInput, executionRunId, ideaId: blueprintId, createdAt: new Date().toISOString() });
      router.push(`/workspaces/${workspaceId}/review`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível iniciar a geração.");
      setStatus("idle");
    }
  }

  return (
    <div className="space-y-3">
      <section className="rounded-2xl bg-surface-raised p-5 sm:p-8">
        <h1 className="font-display text-2xl font-semibold text-ink sm:text-3xl">O que vamos criar hoje?</h1>

        <textarea
          rows={3}
          value={ideaText}
          maxLength={MAX_IDEA_TEXT_LENGTH}
          onChange={(event) => setIdeaText(event.target.value)}
          disabled={busy}
          placeholder="Descreva a ideia — ex.: um post anunciando nosso site, tom direto, CTA para visitar agora."
          className="mt-4 w-full resize-none border-0 bg-transparent text-base text-ink placeholder:text-ink-faint outline-none disabled:opacity-60 sm:text-lg"
        />

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <div className="inline-flex rounded-lg bg-surface-sunken p-1">
            {(["single_image", "carousel"] as ComposerFormat[]).map((option) => (
              <button
                key={option}
                type="button"
                disabled={busy}
                onClick={() => setFormat(option)}
                className={`min-h-8 rounded-md px-3 text-xs font-medium transition-colors disabled:opacity-60 ${
                  format === option ? "bg-primary text-white" : "text-ink-muted hover:text-ink"
                }`}
              >
                {option === "single_image" ? "Imagem" : "Carrossel"}
              </button>
            ))}
          </div>

          <select
            aria-label="Proporção"
            value={aspectRatio}
            disabled={busy}
            onChange={(event) => setAspectRatio(event.target.value as ProductionAspectRatio)}
            className="min-h-8 rounded-lg bg-surface-sunken px-2.5 text-xs font-medium text-ink-muted outline-none disabled:opacity-60"
          >
            {ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>{ratio}</option>
            ))}
          </select>

          <div className="inline-flex flex-wrap gap-1">
            {CHANNELS.map((channel) => (
              <button
                key={channel}
                type="button"
                disabled={busy}
                onClick={() => toggleChannel(channel)}
                className={`min-h-8 rounded-lg px-2.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                  channels.includes(channel) ? "bg-surface-sunken text-ink" : "text-ink-faint hover:text-ink-muted"
                }`}
              >
                {CHANNEL_LABEL[channel]}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={busy || uploading}
            onClick={() => fileInputRef.current?.click()}
            className="ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-60"
          >
            <span aria-hidden="true">📎</span>
            {uploading ? "Enviando…" : "Anexar materiais"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
            className="hidden"
            onChange={(event) => {
              attachFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {referenceImages.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {referenceImages.map((url) => (
              <span key={url} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-sunken px-2 py-1 text-xs text-ink-muted">
                {url.split("/").pop()?.slice(0, 22) || "arquivo"}
                <button type="button" onClick={() => removeAttachment(url)} aria-label="Remover anexo" className="text-ink-faint hover:text-danger">×</button>
              </span>
            ))}
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <p className="text-xs text-ink-faint">{ideaText.length}/{MAX_IDEA_TEXT_LENGTH} · chama a IA de verdade, gera custo real</p>
          <Button className="px-6 py-3 text-base" disabled={!canGenerate} onClick={handleGenerate}>
            {status === "generating" ? "Gerando…" : status === "retrying" ? "Tentando de novo…" : "Gerar"}
          </Button>
        </div>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-4 sm:overflow-visible">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={busy}
            onClick={() => applyPreset(preset)}
            className={`flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors disabled:opacity-60 sm:shrink ${
              activePreset === preset.id ? "border-primary bg-accent-soft text-primary" : "border-border/60 bg-surface-raised text-ink-muted hover:text-ink"
            }`}
          >
            <span aria-hidden="true">{preset.icon}</span>
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
