"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { Input, Label, Textarea } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { CHANNEL_LABEL, FORMAT_LABEL } from "@/features/production-line/defaults";
import {
  deriveObjective,
  extractExecutionRunFailure,
  generateFromIdea,
  isUnrecoverableSemanticOcclusionFailure,
  MAX_IDEA_TEXT_LENGTH,
  waitForExecutionRunTerminal,
} from "@/features/production-line/api";
import { recordGeneration } from "@/features/production-line/generation-log";
import { readProductionConfig, writeProductionConfig } from "@/features/production-line/storage";
import type { ContentBlueprint, ProductionAspectRatio, ProductionChannel, ProductionFormat, ReferenceAssetRole } from "@/features/production-line/types";

const CHANNELS: ProductionChannel[] = ["instagram", "facebook", "tiktok", "youtube"];
const FORMATS: Exclude<ProductionFormat, "video">[] = ["single_image", "carousel"];
const ASPECT_RATIO_OPTIONS: ProductionAspectRatio[] = ["1:1", "4:5", "9:16", "16:9"];
const REFERENCE_ASSET_ROLE_OPTIONS: { value: ReferenceAssetRole; label: string }[] = [
  { value: "product_photo", label: "Foto do produto" },
  { value: "screenshot", label: "Print de tela" },
  { value: "logo", label: "Logo" },
  { value: "reference_style", label: "Referência de estilo" },
  { value: "other", label: "Outro" },
];

function newId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}

/**
 * Redesign "SaaS moderno + IA-first" — porta de entrada "composer-first": descreva a ideia em
 * linguagem natural e gere direto, sem passar pelo tanque de Produção. Reusa exatamente o mesmo
 * `generateFromIdea`/poll/retry de `production/page.tsx` (`handleGenerateRealImage`) — mesma
 * chamada de API, sem nenhuma mudança de comportamento — e grava a ideia no mesmo tanque local
 * (`readProductionConfig`/`writeProductionConfig`) como avulsa, para que ela continue aparecendo
 * em Produção mesmo tendo sido criada por aqui. Aditivo: o fluxo de modal em Produção continua
 * existindo, inalterado.
 */
export default function CreatePage() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();

  // A Home tem um composer rápido que manda pra cá com a ideia já escrita — só a primeira
  // renderização considera a query, pra não sobrescrever o que o usuário já editou aqui.
  const [ideaText, setIdeaText] = useState(() => searchParams.get("draft")?.slice(0, MAX_IDEA_TEXT_LENGTH) ?? "");
  const [format, setFormat] = useState<Exclude<ProductionFormat, "video">>("single_image");
  const [channels, setChannels] = useState<ProductionChannel[]>(["instagram"]);
  const [aspectRatio, setAspectRatio] = useState<ProductionAspectRatio | "">("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [targetAudience, setTargetAudience] = useState("");
  const [forbiddenElements, setForbiddenElements] = useState("");
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [referenceRoles, setReferenceRoles] = useState<Record<string, ReferenceAssetRole>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [status, setStatus] = useState<"idle" | "generating" | "retrying">("idle");
  const [error, setError] = useState<string | null>(null);

  const overLimit = ideaText.length > MAX_IDEA_TEXT_LENGTH;
  const canGenerate = ideaText.trim().length > 0 && !overLimit && status === "idle";

  function toggleChannel(channel: ProductionChannel) {
    setChannels((prev) => {
      if (prev.includes(channel)) return prev.length === 1 ? prev : prev.filter((item) => item !== channel);
      return [...prev, channel];
    });
  }

  async function uploadReferences(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const uploaded = await Promise.all(Array.from(files).map((file) => uploadPublicationMedia(workspace.id, file)));
      setReferenceImages((prev) => [...prev, ...uploaded.map((item) => item.url)]);
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : "Não foi possível enviar o arquivo.");
    } finally {
      setUploading(false);
    }
  }

  function removeReference(url: string) {
    setReferenceImages((prev) => prev.filter((item) => item !== url));
  }

  async function handleGenerate() {
    setError(null);
    setStatus("generating");

    const blueprint: ContentBlueprint = {
      id: newId("blueprint"),
      name: ideaText.trim().slice(0, 60) || "Ideia sem nome",
      format,
      ideaText,
      objective: deriveObjective(undefined, ideaText),
      theme: "",
      captionDirection: "",
      creativeDirection: "",
      targetAudience: targetAudience.trim() || undefined,
      mediaCount: format === "carousel" ? 3 : 1,
      channels,
      approvalMode: "manual",
      sourceLinks: [],
      referenceImages,
      referenceAssetRoles: referenceRoles,
      aspectRatio: aspectRatio || undefined,
      forbiddenElements: forbiddenElements.trim() || undefined,
      status: "available",
      productionMode: "standalone",
    };

    try {
      const referenceAssets = blueprint.referenceImages.map((url) => ({
        url,
        role: referenceRoles[url] ?? ("product_photo" as const),
      }));
      const forbiddenList = forbiddenElements
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const generateInput = {
        workspaceId: workspace.id,
        name: blueprint.name,
        objective: blueprint.objective,
        ideaText: blueprint.ideaText,
        format,
        channel: blueprint.channels[0] ?? ("instagram" as ProductionChannel),
        targetAudience: blueprint.targetAudience,
        referenceImages: blueprint.referenceImages,
        aspectRatio: blueprint.aspectRatio,
        referenceAssets: referenceAssets.length > 0 ? referenceAssets : undefined,
        forbiddenElements: forbiddenList.length > 0 ? forbiddenList : undefined,
      };

      const first = await generateFromIdea(generateInput);
      let detail = await waitForExecutionRunTerminal(workspace.id, first.executionRunId);
      let executionRunId = first.executionRunId;

      if (detail.run.state === "failed") {
        const { code, message } = extractExecutionRunFailure(detail);
        if (code === "QUALITY_GATE_NOT_PASSED" && !isUnrecoverableSemanticOcclusionFailure(message)) {
          setStatus("retrying");
          const retry = await generateFromIdea(generateInput);
          executionRunId = retry.executionRunId;
          detail = await waitForExecutionRunTerminal(workspace.id, retry.executionRunId);
        }
      }

      // Grava no tanque local como avulsa — a mesma ideia que acabou de gerar continua visível em
      // Produção (filtro "Avulsas"), com o mesmo status que teria se criada por lá.
      const config = readProductionConfig(workspace.id);
      const usedAt = detail.run.state === "failed" ? undefined : new Date().toISOString();
      writeProductionConfig(workspace.id, {
        ...config,
        blueprints: [...config.blueprints, { ...blueprint, status: usedAt ? "used" : "available", usedAt }],
      });

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

      recordGeneration(workspace.id, { ...generateInput, executionRunId, ideaId: blueprint.id, createdAt: new Date().toISOString() });
      router.push(`/workspaces/${workspace.id}/review`);
    } catch (generateFailure) {
      setError(generateFailure instanceof Error ? generateFailure.message : "Não foi possível iniciar a geração.");
      setStatus("idle");
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Criar" description="Descreva a ideia em poucas frases — a IA cuida da estratégia, da copy e da peça final." />

      <Card>
        <CardBody className="space-y-5">
          <div>
            <Label htmlFor="create-idea">O que você quer publicar?</Label>
            <Textarea
              id="create-idea"
              rows={6}
              autoFocus
              value={ideaText}
              maxLength={MAX_IDEA_TEXT_LENGTH}
              placeholder="Ex.: Criar um post anunciando nosso site, com tom direto e um CTA para visitar agora."
              onChange={(event) => setIdeaText(event.target.value)}
              disabled={status !== "idle"}
            />
            <p className={`mt-1 text-right text-xs ${overLimit ? "text-danger" : "text-ink-faint"}`}>
              {ideaText.length}/{MAX_IDEA_TEXT_LENGTH}
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-muted">Formato</p>
            <div className="grid grid-cols-2 gap-2">
              {FORMATS.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={status !== "idle"}
                  onClick={() => setFormat(option)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                    format === option ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-ink hover:bg-surface-sunken"
                  }`}
                >
                  {FORMAT_LABEL[option]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-muted">Canais</p>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((channel) => (
                <button
                  key={channel}
                  type="button"
                  disabled={status !== "idle"}
                  onClick={() => toggleChannel(channel)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                    channels.includes(channel) ? "border-ink-faint bg-surface-sunken text-ink" : "border-border bg-surface text-ink-muted hover:bg-surface-sunken"
                  }`}
                >
                  {CHANNEL_LABEL[channel]}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setAdvancedOpen((prev) => !prev)}
              className="flex w-full items-center justify-between text-sm font-medium text-ink-muted hover:text-ink"
            >
              <span>Detalhes avançados (opcional)</span>
              <span aria-hidden="true" className={`transition-transform ${advancedOpen ? "rotate-90" : ""}`}>›</span>
            </button>

            {advancedOpen ? (
              <div className="mt-3 space-y-4">
                <div>
                  <Label htmlFor="create-audience">Público-alvo</Label>
                  <Input
                    id="create-audience"
                    value={targetAudience}
                    placeholder="Ex.: mulheres de 25-40 anos interessadas em moda sustentável"
                    onChange={(event) => setTargetAudience(event.target.value)}
                    disabled={status !== "idle"}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="create-aspect-ratio">Proporção da peça</Label>
                    <select
                      id="create-aspect-ratio"
                      value={aspectRatio}
                      disabled={status !== "idle"}
                      onChange={(event) => setAspectRatio(event.target.value as ProductionAspectRatio | "")}
                      className="w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
                    >
                      <option value="">Automático (4:5)</option>
                      {ASPECT_RATIO_OPTIONS.map((ratio) => (
                        <option key={ratio} value={ratio}>{ratio}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="create-forbidden">Elementos proibidos</Label>
                    <Input
                      id="create-forbidden"
                      value={forbiddenElements}
                      placeholder="Ex.: logo de concorrente, preço antigo"
                      onChange={(event) => setForbiddenElements(event.target.value)}
                      disabled={status !== "idle"}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="create-files">Referências (opcional)</Label>
                  <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-3">
                    <input
                      id="create-files"
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                      disabled={uploading || status !== "idle"}
                      onChange={(event) => uploadReferences(event.target.files)}
                      className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
                    />
                    <p className="mt-2 text-xs text-ink-muted">Logo, print ou foto do produto — a IA usa como base real em vez de inventar.</p>
                    {uploading ? <p className="mt-2 text-xs text-accent">Enviando arquivo...</p> : null}
                    {uploadError ? <p className="mt-2 text-xs text-danger">{uploadError}</p> : null}
                  </div>
                  {referenceImages.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {referenceImages.map((url) => (
                        <div key={url} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                          <a href={url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-xs font-medium text-accent hover:underline">
                            {url.split("/").pop() || url}
                          </a>
                          <div className="flex shrink-0 items-center gap-2">
                            <select
                              aria-label="Papel da referência"
                              value={referenceRoles[url] ?? "product_photo"}
                              onChange={(event) => setReferenceRoles((prev) => ({ ...prev, [url]: event.target.value as ReferenceAssetRole }))}
                              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
                            >
                              {REFERENCE_ASSET_ROLE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            <button type="button" onClick={() => removeReference(url)} className="text-xs font-medium text-ink-muted hover:text-danger">
                              Remover
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-ink-muted">Chama a IA de verdade — gera custo real.</p>
            <Button disabled={!canGenerate} onClick={handleGenerate}>
              {status === "generating" ? "Gerando…" : status === "retrying" ? "Tentando de novo…" : "Gerar"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}
