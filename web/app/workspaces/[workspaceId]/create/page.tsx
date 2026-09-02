"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, FolderOpen, ImageIcon, Paperclip, Video, X } from "lucide-react";
import { Button } from "@/components/Button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useAssets } from "@/features/assets/hooks";
import type { Asset, AssetMaterialType } from "@/features/assets/types";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { CHANNEL_LABEL } from "@/features/production-line/defaults";
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
import { useProductionSettings } from "@/features/production-settings/hooks";
import { useTenantCredits } from "@/features/workspace/hooks";

type ComposerFormat = Exclude<ProductionFormat, "video">;
type ContentTypeId = "publicacao" | "anuncio" | "story" | "carrossel";

const CONTENT_TYPES: { id: ContentTypeId; label: string; format: ComposerFormat; aspectRatio: ProductionAspectRatio }[] = [
  { id: "publicacao", label: "Publicação", format: "single_image", aspectRatio: "4:5" },
  { id: "anuncio", label: "Anúncio", format: "single_image", aspectRatio: "1:1" },
  { id: "story", label: "Story", format: "single_image", aspectRatio: "9:16" },
  { id: "carrossel", label: "Carrossel", format: "carousel", aspectRatio: "4:5" },
];

const ASPECT_RATIOS: { value: ProductionAspectRatio; label: string; w: number; h: number }[] = [
  { value: "4:5", label: "Feed", w: 4, h: 5 },
  { value: "1:1", label: "Quadrado", w: 1, h: 1 },
  { value: "9:16", label: "Story/Reels", w: 9, h: 16 },
];

const CHANNELS: ProductionChannel[] = ["instagram", "facebook", "tiktok", "youtube"];

const MATERIAL_ROLES: { value: ReferenceAssetRole; label: string }[] = [
  { value: "product_photo", label: "Produto" },
  { value: "screenshot", label: "Screenshot" },
  { value: "reference_style", label: "Referência visual" },
  { value: "other", label: "Outro" },
];

const MATERIAL_TYPE_TO_ROLE: Partial<Record<AssetMaterialType, ReferenceAssetRole>> = {
  logo_principal: "logo",
  logo_secundaria: "logo",
  screenshot_site: "screenshot",
  screenshot_app: "screenshot",
  produto: "product_photo",
  referencia_visual: "reference_style",
};

const GENERATING_MESSAGES = ["Analisando seu pedido…", "Selecionando materiais…", "Planejando a criação…", "Gerando sua peça…", "Finalizando…"];

function newId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}

function isProductionFormat(value: string | null): value is ComposerFormat {
  return value === "single_image" || value === "carousel";
}
function isAspectRatio(value: string | null): value is ProductionAspectRatio {
  return value === "1:1" || value === "4:5" || value === "9:16" || value === "16:9";
}
function isChannel(value: string | null): value is ProductionChannel {
  return value === "instagram" || value === "facebook" || value === "tiktok" || value === "youtube";
}

/**
 * Redesign "IA-first / composer-first" (Etapa 2) — ponto oficial de nova criação. A Home mantém a
 * versão rápida (mesmo composer simples); esta tela é a versão completa, com referências, tipo de
 * conteúdo/formato/canal, contexto automático do workspace visível e painel de marca. Reusa
 * exatamente a mesma chamada de geração (`generateFromIdea`/poll/retry) e o mesmo tanque local que
 * já existiam — nenhuma mudança de API, Creative Engine, banco ou regra de negócio.
 */
export default function CreatePage() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: productionSettings } = useProductionSettings(workspace.id);
  const { data: assets } = useAssets(workspace.id);
  const { data: credits } = useTenantCredits();

  const activeAssets = (assets ?? []).filter((asset) => asset.status === "active" && asset.storageRef?.metadata?.url);
  const hasLogo = activeAssets.some((asset) => asset.kind === "logo");
  const hasGuidelines = Boolean(productionSettings?.productionPrompt?.trim());

  const [ideaText, setIdeaText] = useState(() => searchParams.get("draft")?.slice(0, MAX_IDEA_TEXT_LENGTH) ?? "");
  const [format, setFormat] = useState<ComposerFormat>(() => (isProductionFormat(searchParams.get("format")) ? (searchParams.get("format") as ComposerFormat) : "single_image"));
  const [aspectRatio, setAspectRatio] = useState<ProductionAspectRatio>(() => (isAspectRatio(searchParams.get("aspectRatio")) ? (searchParams.get("aspectRatio") as ProductionAspectRatio) : "4:5"));
  const [channels, setChannels] = useState<ProductionChannel[]>(() => (isChannel(searchParams.get("channel")) ? [searchParams.get("channel") as ProductionChannel] : ["instagram"]));

  const [objective, setObjective] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [forbiddenElements, setForbiddenElements] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);

  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [referenceRoles, setReferenceRoles] = useState<Record<string, ReferenceAssetRole>>({});
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const [status, setStatus] = useState<"idle" | "generating" | "retrying">("idle");
  const [error, setError] = useState<string | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);
  const [savingToTank, setSavingToTank] = useState(false);
  const [tankMessage, setTankMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = status !== "idle";
  const formDisabled = busy || savingToTank;
  const contentTypeId = CONTENT_TYPES.find((type) => type.format === format && type.aspectRatio === aspectRatio)?.id;

  // Mensagens genéricas por tempo — não existe telemetria real de etapa (o backend só devolve
  // "rodando"/"terminou"), então isto é só percepção de progresso, nunca precisão simulada.
  useEffect(() => {
    if (!busy) {
      setMessageIndex(0);
      return;
    }
    const interval = window.setInterval(() => {
      setMessageIndex((current) => Math.min(current + 1, GENERATING_MESSAGES.length - 1));
    }, 14_000);
    return () => window.clearInterval(interval);
  }, [busy]);

  const overLimit = ideaText.length > MAX_IDEA_TEXT_LENGTH;
  const canGenerate = ideaText.trim().length > 0 && !overLimit && !busy && !savingToTank;
  const canSaveToTank = ideaText.trim().length > 0 && !overLimit && !busy && !savingToTank;

  function selectContentType(type: (typeof CONTENT_TYPES)[number]) {
    setFormat(type.format);
    setAspectRatio(type.aspectRatio);
  }

  function toggleChannel(channel: ProductionChannel) {
    setChannels((prev) => {
      if (prev.includes(channel)) return prev.length === 1 ? prev : prev.filter((item) => item !== channel);
      return [...prev, channel];
    });
  }

  async function attachFiles(files: FileList | File[] | null) {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await Promise.all(list.map((file) => uploadPublicationMedia(workspace.id, file)));
      setReferenceImages((prev) => [...prev, ...uploaded.map((item) => item.url)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível anexar o material.");
    } finally {
      setUploading(false);
    }
  }

  function attachFromLibrary(asset: Asset) {
    const url = asset.storageRef?.metadata?.url;
    if (!url) return;
    setReferenceImages((prev) => (prev.includes(url) ? prev : [...prev, url]));
    const role = (asset.materialType && MATERIAL_TYPE_TO_ROLE[asset.materialType]) || "product_photo";
    setReferenceRoles((prev) => ({ ...prev, [url]: role }));
    setLibraryOpen(false);
  }

  function removeReference(url: string) {
    setReferenceImages((prev) => prev.filter((item) => item !== url));
  }

  async function handleGenerate() {
    setError(null);
    setStatus("generating");

    const name = ideaText.trim().slice(0, 60) || "Ideia sem nome";
    const derivedObjective = deriveObjective(objective.trim() || undefined, ideaText);
    const forbiddenList = forbiddenElements.split(",").map((item) => item.trim()).filter(Boolean);
    const referenceAssets = referenceImages.map((url) => ({ url, role: referenceRoles[url] ?? ("product_photo" as const) }));

    const generateInput = {
      workspaceId: workspace.id,
      name,
      objective: derivedObjective,
      ideaText,
      format,
      channel: channels[0] ?? ("instagram" as ProductionChannel),
      targetAudience: targetAudience.trim() || undefined,
      referenceImages,
      aspectRatio,
      referenceAssets: referenceAssets.length > 0 ? referenceAssets : undefined,
      forbiddenElements: forbiddenList.length > 0 ? forbiddenList : undefined,
    };

    try {
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

      const blueprintId = newId("blueprint");
      const usedAt = detail.run.state === "failed" ? undefined : new Date().toISOString();
      const blueprint: ContentBlueprint = {
        id: blueprintId,
        name,
        format,
        ideaText,
        objective: derivedObjective,
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
        aspectRatio,
        forbiddenElements: forbiddenElements.trim() || undefined,
        status: usedAt ? "used" : "available",
        productionMode: "routine",
        usedAt,
      };
      const config = readProductionConfig(workspace.id);
      writeProductionConfig(workspace.id, { ...config, blueprints: [...config.blueprints, blueprint] });

      if (detail.run.state === "failed") {
        const { message } = extractExecutionRunFailure(detail);
        setError(message || "A geração falhou. Tente novamente.");
        setStatus("idle");
        return;
      }
      recordGeneration(workspace.id, { ...generateInput, executionRunId, ideaId: blueprintId, createdAt: new Date().toISOString() });

      if (detail.run.state !== "completed" && detail.run.state !== "waiting_for_approval") {
        // Ainda rodando depois do tempo máximo de espera — o lugar certo para acompanhar é
        // Produção, não um erro; Revisão só faz sentido quando já há peça pronta para decidir.
        router.push(`/workspaces/${workspace.id}/production`);
        return;
      }

      router.push(`/workspaces/${workspace.id}/review`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível iniciar a geração.");
      setStatus("idle");
    }
  }

  /**
   * "Guardar no tanque" — reaproveita exatamente os mesmos campos de `handleGenerate` (mesma
   * validação de tamanho, mesmo mapeamento pra `ContentBlueprint`), mas nunca chama
   * `generateFromIdea`: só grava a ideia como pendente (`status: "available"`,
   * `productionMode: "routine"`) pra entrar no sorteio da rotina automática — sem gastar
   * geração/crédito agora. Logo e diretrizes do workspace continuam se aplicando sozinhas na hora
   * que a rotina (ou "Abrir" no tanque) efetivamente gerar a peça; não são um campo por ideia.
   */
  function handleSaveToTank() {
    setError(null);
    setTankMessage(null);
    setSavingToTank(true);
    try {
      const name = ideaText.trim().slice(0, 60) || "Ideia sem nome";
      const derivedObjective = deriveObjective(objective.trim() || undefined, ideaText);
      const blueprint: ContentBlueprint = {
        id: newId("blueprint"),
        name,
        format,
        ideaText,
        objective: derivedObjective,
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
        aspectRatio,
        forbiddenElements: forbiddenElements.trim() || undefined,
        status: "available",
        productionMode: "routine",
      };
      const config = readProductionConfig(workspace.id);
      writeProductionConfig(workspace.id, { ...config, blueprints: [...config.blueprints, blueprint] });

      setTankMessage(`"${name}" guardada no tanque — ela entra no sorteio da rotina automática.`);
      setIdeaText("");
      setObjective("");
      setTargetAudience("");
      setForbiddenElements("");
      setReferenceImages([]);
      setReferenceRoles({});
    } finally {
      setSavingToTank(false);
    }
  }

  const brandContextContent = (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-xs font-medium text-muted-foreground/70">Marca ativa</p>
        <Link href={`/workspaces/${workspace.id}/knowledge?tab=profile`} className="mt-1.5 flex items-center gap-2 hover:underline">
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={activeAssets.find((asset) => asset.kind === "logo")?.storageRef?.metadata?.url} alt="" className="h-7 w-7 rounded-md object-contain" />
          ) : (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground/70" aria-hidden="true">
              <ImageIcon className="h-4 w-4" />
            </span>
          )}
          <span className="truncate text-foreground">{workspace.name}</span>
        </Link>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground/70">Diretrizes</p>
        {hasGuidelines ? (
          <p className="mt-1 text-muted-foreground">Diretrizes Criativas configuradas.</p>
        ) : (
          <p className="mt-1 text-muted-foreground/70">Nenhuma diretriz personalizada configurada.</p>
        )}
        <Link href={`/workspaces/${workspace.id}/knowledge?tab=guidelines`} className="text-xs font-medium text-primary hover:underline">
          {hasGuidelines ? "Editar" : "Configurar"}
        </Link>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground/70">Materiais disponíveis</p>
        {activeAssets.length > 0 ? (
          <>
            <div className="mt-1.5 flex gap-1.5">
              {activeAssets.slice(0, 4).map((asset) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={asset.id} src={asset.storageRef?.metadata?.url} alt="" className="h-9 w-9 rounded-md object-cover" />
              ))}
            </div>
            <p className="mt-1.5 text-muted-foreground">{activeAssets.length} {activeAssets.length === 1 ? "material" : "materiais"}</p>
          </>
        ) : (
          <p className="mt-1 text-muted-foreground/70">Nenhum material cadastrado ainda.</p>
        )}
        <Link href={`/workspaces/${workspace.id}/knowledge?tab=materials`} className="text-xs font-medium text-primary hover:underline">
          Gerenciar materiais
        </Link>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground/70">Formato atual</p>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="block rounded-sm bg-muted" style={{ width: 22, aspectRatio: aspectRatio.replace(":", "/") }} aria-hidden="true" />
          <span className="text-muted-foreground">{aspectRatio} · {format === "carousel" ? "Carrossel" : "Imagem"}</span>
        </div>
      </div>
    </div>
  );

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="min-w-0 space-y-5">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Criar conteúdo</h1>
            <p className="mt-1 text-sm text-muted-foreground">Descreva sua ideia, envie referências e deixe a IA montar a criação.</p>
          </div>

          <Card
            className={cn("p-5 transition-colors sm:p-7", dragOver && "ring-2 ring-primary")}
            onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              attachFiles(event.dataTransfer.files);
            }}
          >
            <Label htmlFor="create-idea">O que você quer criar?</Label>
            <textarea
              id="create-idea"
              rows={5}
              autoFocus
              value={ideaText}
              maxLength={MAX_IDEA_TEXT_LENGTH}
              disabled={formDisabled}
              onChange={(event) => setIdeaText(event.target.value)}
              placeholder="Ex.: Crie uma publicação impactante para divulgar nosso site, com visual moderno e destaque para as principais vantagens."
              className="mt-2 w-full resize-none border-0 bg-transparent text-base text-foreground placeholder:text-muted-foreground/70 outline-none disabled:opacity-60 sm:text-lg"
            />
            <p className={`text-right text-xs ${overLimit ? "text-destructive" : "text-muted-foreground/70"}`}>{ideaText.length}/{MAX_IDEA_TEXT_LENGTH}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3.5">
              <button
                type="button"
                disabled={busy || uploading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 active:bg-muted/70 disabled:opacity-60"
              >
                <Paperclip className="h-4 w-4" aria-hidden="true" /> {uploading ? "Enviando…" : "Enviar arquivo"}
              </button>
              <button
                type="button"
                disabled={formDisabled}
                onClick={() => setLibraryOpen(true)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 active:bg-muted/70 disabled:opacity-60"
              >
                <FolderOpen className="h-4 w-4" aria-hidden="true" /> Da biblioteca
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                className="hidden"
                onChange={(event) => { attachFiles(event.target.files); event.target.value = ""; }}
              />
              <p className="text-xs text-muted-foreground/70">ou arraste imagens para aqui</p>
            </div>

            {referenceImages.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {referenceImages.map((url) => (
                  <div key={url} className="flex items-center gap-1.5 rounded-lg bg-muted p-1.5">
                    {/\.(png|jpe?g|webp)$/i.test(url) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt="" className="h-10 w-10 rounded-md object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-card text-muted-foreground" aria-hidden="true">
                        <Video className="h-4 w-4" />
                      </span>
                    )}
                    <Select
                      value={referenceRoles[url] ?? "product_photo"}
                      disabled={formDisabled}
                      onValueChange={(value) => setReferenceRoles((prev) => ({ ...prev, [url]: value as ReferenceAssetRole }))}
                    >
                      <SelectTrigger
                        aria-label="Categoria do material"
                        className="h-auto w-auto gap-1 border-0 bg-transparent px-0 py-0 text-xs text-muted-foreground shadow-none hover:text-foreground disabled:opacity-60 [&>svg]:h-3 [&>svg]:w-3"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MATERIAL_ROLES.map((role) => (
                          <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button type="button" disabled={formDisabled} onClick={() => removeReference(url)} aria-label="Remover" className="rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-60">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground/70">Nenhum material cadastrado. Você ainda pode gerar normalmente.</p>
            )}
          </Card>

          <section className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Tipo de conteúdo</p>
              <div className="flex flex-wrap gap-2">
                {CONTENT_TYPES.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    disabled={formDisabled}
                    onClick={() => selectContentType(type)}
                    className={cn(
                      "min-h-9 rounded-lg px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-60",
                      contentTypeId === type.id ? "bg-primary/10 text-primary active:bg-primary/15" : "bg-card text-muted-foreground hover:text-foreground active:bg-muted/70",
                    )}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Formato</p>
              <div className="flex flex-wrap gap-2">
                {ASPECT_RATIOS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={formDisabled}
                    onClick={() => setAspectRatio(option.value)}
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-60",
                      aspectRatio === option.value ? "bg-primary/10 text-primary active:bg-primary/15" : "bg-card text-muted-foreground hover:text-foreground active:bg-muted/70",
                    )}
                  >
                    <span
                      className={`block rounded-[2px] ${aspectRatio === option.value ? "bg-primary" : "bg-muted-foreground/70"}`}
                      style={{ width: option.w >= option.h ? 16 : Math.round((16 * option.w) / option.h), height: option.h >= option.w ? 16 : Math.round((16 * option.h) / option.w) }}
                      aria-hidden="true"
                    />
                    {option.value} <span className="text-muted-foreground/70">· {option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Canal</p>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    disabled={formDisabled}
                    onClick={() => toggleChannel(channel)}
                    className={cn(
                      "min-h-9 rounded-lg px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-60",
                      channels.includes(channel) ? "bg-primary/10 text-primary active:bg-primary/15" : "bg-card text-muted-foreground hover:text-foreground active:bg-muted/70",
                    )}
                  >
                    {CHANNEL_LABEL[channel]}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border/60 bg-card">
            <button type="button" onClick={() => setContextOpen((prev) => !prev)} className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
              <span className="text-sm font-medium text-foreground">A IA já vai considerar</span>
              <ChevronRight aria-hidden="true" className={`h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform ${contextOpen ? "rotate-90" : ""}`} />
            </button>
            {contextOpen ? (
              <ul className="space-y-1.5 px-4 pb-4 text-sm text-muted-foreground">
                <li>• {hasGuidelines ? "Diretrizes Criativas da marca" : <span className="text-muted-foreground/70">Diretrizes Criativas da marca (não configurada)</span>}</li>
                <li>• {hasLogo ? "Logo oficial do workspace" : <span className="text-muted-foreground/70">Logo oficial (não cadastrada)</span>}</li>
                <li>• {activeAssets.length > 0 ? `${activeAssets.length} materiais relevantes da biblioteca` : <span className="text-muted-foreground/70">Materiais relevantes (nenhum cadastrado)</span>}</li>
              </ul>
            ) : null}
          </section>

          <details className="rounded-xl border border-border/60 bg-card lg:hidden" open={brandOpen} onToggle={(event) => setBrandOpen((event.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/40">Contexto da marca</summary>
            <div className="px-4 pb-4">{brandContextContent}</div>
          </details>

          <section className="border-t border-border/60 pt-4">
            <button type="button" onClick={() => setAdvancedOpen((prev) => !prev)} className="flex w-full items-center justify-between rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
              <span>Detalhes avançados</span>
              <ChevronRight aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${advancedOpen ? "rotate-90" : ""}`} />
            </button>
            {advancedOpen ? (
              <div className="mt-3 space-y-3">
                <div>
                  <Label htmlFor="create-objective">Objetivo</Label>
                  <Input id="create-objective" value={objective} disabled={formDisabled} placeholder="Ex.: gerar cliques para o site" onChange={(event) => setObjective(event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="create-audience">Público-alvo</Label>
                  <Input id="create-audience" value={targetAudience} disabled={formDisabled} placeholder="Ex.: mulheres de 25-40 anos" onChange={(event) => setTargetAudience(event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="create-forbidden">O que evitar</Label>
                  <Input id="create-forbidden" value={forbiddenElements} disabled={formDisabled} placeholder="Ex.: logo de concorrente, preço antigo" onChange={(event) => setForbiddenElements(event.target.value)} />
                </div>
              </div>
            ) : null}
          </section>

          {error ? (
            <div className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <p>{error}</p>
              <button type="button" onClick={handleGenerate} className="mt-1.5 font-medium underline">Tentar novamente</button>
            </div>
          ) : null}

          {tankMessage ? (
            <div className="rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary">
              <p>{tankMessage}</p>
              <Link href={`/workspaces/${workspace.id}/production?mode=configure`} className="mt-1.5 inline-block font-medium underline">Ver tanque de ideias →</Link>
            </div>
          ) : null}

          {busy ? <p className="text-sm text-muted-foreground">{GENERATING_MESSAGES[messageIndex]}</p> : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
            <p className="text-xs text-muted-foreground/70">{credits ? `Você tem ${credits.remainingCredits.toLocaleString("pt-BR")} créditos disponíveis.` : "Chama a IA de verdade — gera custo real."}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="lg" loading={savingToTank} disabled={!canSaveToTank} onClick={handleSaveToTank} title="Guarda a ideia sem gerar agora — a rotina automática a produz conforme as regras configuradas.">
                Guardar no tanque
              </Button>
              <Button size="xl" loading={status === "generating" || status === "retrying"} disabled={!canGenerate} onClick={handleGenerate}>
                {status === "retrying" ? "Tentando de novo…" : "Gerar conteúdo"}
              </Button>
            </div>
          </div>
        </div>

        <Card className="hidden p-5 lg:sticky lg:top-5 lg:block" role="complementary" aria-label="Contexto da marca">
          <p className="mb-3 text-sm font-semibold text-foreground">Contexto da marca</p>
          {brandContextContent}
        </Card>
      </div>

      {libraryOpen ? (
        <Modal title="Escolher da biblioteca" onClose={() => setLibraryOpen(false)}>
          {activeAssets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum material cadastrado ainda.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {activeAssets.map((asset) => (
                <button key={asset.id} type="button" onClick={() => attachFromLibrary(asset)} className="overflow-hidden rounded-lg bg-muted text-left hover:ring-2 hover:ring-primary">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.storageRef?.metadata?.url} alt="" className="aspect-square w-full object-cover" />
                  <p className="truncate px-1.5 py-1 text-[11px] text-muted-foreground">{asset.name}</p>
                </button>
              ))}
            </div>
          )}
        </Modal>
      ) : null}
    </main>
  );
}
