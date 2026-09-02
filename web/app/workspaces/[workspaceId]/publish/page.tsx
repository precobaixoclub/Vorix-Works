"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input, Label, Textarea } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { PostPreview } from "@/components/PostPreview";
import { ProgressivePanel } from "@/components/ScreenGuide";
import { SearchableCombo } from "@/components/SearchableCombo";
import { StatusBadge } from "@/components/StatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { cn } from "@/lib/utils";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { scheduleMetaPost } from "@/features/meta/api";
import { useMetaOAuthStatus, useMetaPosts } from "@/features/meta/hooks";
import { cancelUnifiedPublication } from "@/features/publication-history/api";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import { contentTypeOf, derivePublicationStatus, type UnifiedPublication } from "@/features/publication-history/types";
import { scheduleTikTokPost } from "@/features/tiktok/api";
import { useTikTokOAuthStatus, useTikTokPosts } from "@/features/tiktok/hooks";
import type { TikTokPrivacyLevel } from "@/features/tiktok/types";
import { scheduleYouTubePost } from "@/features/youtube/api";
import { useYouTubeOAuthStatus, useYouTubePosts } from "@/features/youtube/hooks";
import type { YouTubePrivacyStatus } from "@/features/youtube/types";
import { formatDateTime } from "@/lib/format";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

type Platform = "tiktok" | "instagram" | "facebook" | "youtube";
type MetaPlacement = "feed" | "story";
type PublishTiming = "now" | "schedule";

const PLATFORMS: readonly { id: Platform; label: string; icon: string }[] = [
  { id: "instagram", label: "Instagram", icon: "◎" },
  { id: "facebook", label: "Facebook", icon: "f" },
  { id: "tiktok", label: "TikTok", icon: "♪" },
  { id: "youtube", label: "YouTube Shorts", icon: "▶" },
];

const META_PLACEMENTS: readonly { id: MetaPlacement; label: string }[] = [
  { id: "feed", label: "Feed" },
  { id: "story", label: "Story" },
];

const TIKTOK_PRIVACY_OPTIONS: readonly { value: TikTokPrivacyLevel; label: string }[] = [
  { value: "PUBLIC_TO_EVERYONE", label: "Todos" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Amigos" },
  { value: "FOLLOWER_OF_CREATOR", label: "Seguidores" },
  { value: "SELF_ONLY", label: "Só eu" },
];

const YOUTUBE_PRIVACY_OPTIONS: readonly { value: YouTubePrivacyStatus; label: string }[] = [
  { value: "public", label: "Público" },
  { value: "unlisted", label: "Não listado" },
  { value: "private", label: "Privado" },
];

export default function PublishPage() {
  const workspace = useCurrentWorkspace();
  const { data: tiktokOAuth } = useTikTokOAuthStatus(workspace.id);
  const { data: metaOAuth } = useMetaOAuthStatus(workspace.id);
  const { data: youtubeOAuth } = useYouTubeOAuthStatus(workspace.id);
  const { mutate: mutateTikTokPosts } = useTikTokPosts(workspace.id);
  const { mutate: mutateMetaPosts } = useMetaPosts(workspace.id);
  const { mutate: mutateYouTubePosts } = useYouTubePosts(workspace.id);
  const { data: unified, mutate: mutateUnified } = useUnifiedPublications(workspace.id);

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "warning" | "error"; message: string } | undefined>();
  const [selected, setSelected] = useState<Set<Platform>>(new Set());
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [queryApplied, setQueryApplied] = useState(false);
  const [metaPlacements, setMetaPlacements] = useState<Set<MetaPlacement>>(new Set(["feed"]));
  const [mediaKind, setMediaKind] = useState<"image" | "video">("image");
  const [videoUrl, setVideoUrl] = useState("");
  const [imageUrls, setImageUrls] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [publishTiming, setPublishTiming] = useState<PublishTiming>("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);

  const [tiktokPrivacy, setTiktokPrivacy] = useState<TikTokPrivacyLevel>("PUBLIC_TO_EVERYONE");
  const [tiktokDisableComment, setTiktokDisableComment] = useState(false);
  const [tiktokDisableDuet, setTiktokDisableDuet] = useState(false);
  const [tiktokDisableStitch, setTiktokDisableStitch] = useState(false);
  const [tiktokAutoAddMusic, setTiktokAutoAddMusic] = useState(true);
  const [youtubePrivacy, setYouTubePrivacy] = useState<YouTubePrivacyStatus>("public");
  const [networkOptionsOpen, setNetworkOptionsOpen] = useState(false);
  const [postPendingCancel, setPostPendingCancel] = useState<UnifiedPublication | undefined>();

  const connectedByPlatform: Record<Platform, boolean> = {
    tiktok: tiktokOAuth?.connected ?? false,
    instagram: (metaOAuth?.accounts ?? []).some((account) => account.providerId === "instagram" && account.status === "active"),
    facebook: (metaOAuth?.accounts ?? []).some((account) => account.providerId === "facebook" && account.status === "active"),
    youtube: youtubeOAuth?.connected ?? false,
  };

  const accountLabelByPlatform: Partial<Record<Platform, string>> = {
    tiktok: tiktokOAuth?.accounts[0]?.displayName,
    instagram: metaOAuth?.accounts.find((account) => account.providerId === "instagram")?.displayName,
    facebook: metaOAuth?.accounts.find((account) => account.providerId === "facebook")?.displayName,
    youtube: youtubeOAuth?.accounts[0]?.displayName,
  };

  const credentialReferenceByPlatform: Partial<Record<Platform, string>> = {
    tiktok: tiktokOAuth?.accounts.find((account) => account.status === "active")?.credentialReferenceId,
    instagram: metaOAuth?.accounts.find((account) => account.providerId === "instagram" && account.status === "active")?.credentialReferenceId,
    facebook: metaOAuth?.accounts.find((account) => account.providerId === "facebook" && account.status === "active")?.credentialReferenceId,
    youtube: youtubeOAuth?.accounts.find((account) => account.status === "active")?.credentialReferenceId,
  };

  const selectedMetaPlacements = META_PLACEMENTS.map((item) => item.id).filter((item) => metaPlacements.has(item));
  const hasMetaSelection = selected.has("instagram") || selected.has("facebook");
  const feedSelected = metaPlacements.has("feed");
  const storySelected = metaPlacements.has("story");
  const storyOnly = storySelected && !feedSelected;
  const hasStoryUnsupported = storySelected && (selected.has("tiktok") || selected.has("youtube"));
  const youtubeNeedsVideo = selected.has("youtube") && mediaKind !== "video";
  const images = imageUrls.split(/[\n,]/).map((url) => url.trim()).filter(Boolean);
  const hasMedia = mediaKind === "video" ? Boolean(videoUrl.trim()) : images.length > 0;
  const recentPublications = (unified ?? []).slice(0, 3);
  const mostRecent = unified?.[0];
  const selectedSource = useMemo(() => unified?.find((post) => sourceKey(post) === selectedSourceId), [selectedSourceId, unified]);
  const contentLibraryItems = useMemo(() => (unified ?? []).slice(0, 20).map((post) => ({ id: sourceKey(post), label: titleOf(post) })), [unified]);

  useEffect(() => {
    if (queryApplied || !unified) return;
    const params = new URLSearchParams(window.location.search);
    const network = params.get("network") as Platform | null;
    const source = params.get("source");
    if (source) {
      const post = unified.find((item) => sourceKey(item) === source);
      if (post) applyContent(post);
    }
    if (network && PLATFORMS.some((platform) => platform.id === network) && connectedByPlatform[network]) {
      setSelected((current) => new Set([...current, network]));
    }
    setQueryApplied(true);
  }, [queryApplied, unified, connectedByPlatform]);

  function applyContent(post: UnifiedPublication) {
    setSelectedSourceId(sourceKey(post));
    setCaption(post.text);
    setImageUrls(post.media.imageUrls.join("\n"));
    setVideoUrl(post.media.videoUrl ?? "");
    setThumbnailUrl(post.media.thumbnailUrl ?? "");
    setMediaKind(post.media.videoUrl ? "video" : "image");
  }

  function togglePlatform(platform: Platform) {
    if (!connectedByPlatform[platform]) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
    if (platform === "youtube") setMediaKind("video");
  }

  async function uploadVideoFile(file: File) {
    setUploading(true);
    setFeedback(undefined);
    try {
      const uploaded = await uploadPublicationMedia(workspace.id, file);
      setVideoUrl(uploaded.url);
      setSelectedSourceId("");
    } catch (cause) {
      setFeedback({ tone: "error", message: messageOf(cause) });
    } finally {
      setUploading(false);
    }
  }

  async function uploadImageFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setFeedback(undefined);
    try {
      const uploaded = await Promise.all(Array.from(files).map((file) => uploadPublicationMedia(workspace.id, file)));
      setImageUrls((current) => [...current.split(/[\n,]/).map((url) => url.trim()).filter(Boolean), ...uploaded.map((item) => item.url)].join("\n"));
      setSelectedSourceId("");
    } catch (cause) {
      setFeedback({ tone: "error", message: messageOf(cause) });
    } finally {
      setUploading(false);
    }
  }

  async function uploadThumbnailFile(file: File) {
    setUploading(true);
    setFeedback(undefined);
    try {
      const uploaded = await uploadPublicationMedia(workspace.id, file);
      setThumbnailUrl(uploaded.url);
    } catch (cause) {
      setFeedback({ tone: "error", message: messageOf(cause) });
    } finally {
      setUploading(false);
    }
  }

  async function submitPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(undefined);

    if (!hasMedia) {
      setFeedback({ tone: "error", message: mediaKind === "video" ? "Envie um vídeo para publicar." : "Escolha ou envie ao menos uma imagem." });
      return;
    }
    if (selected.size === 0) {
      setFeedback({ tone: "error", message: "Selecione ao menos uma rede conectada." });
      return;
    }
    if (youtubeNeedsVideo) {
      setFeedback({ tone: "error", message: "YouTube Shorts só publica vídeo. Desmarque YouTube ou troque a mídia para vídeo." });
      return;
    }

    setBusy(true);
    const scheduledAtIso = publishTiming === "schedule" && scheduledAt ? new Date(scheduledAt).toISOString() : undefined;
    const targets = PLATFORMS.filter((platform) => selected.has(platform.id));
    const skippedSummaries: string[] = [];
    const publicationTasks: { label: string; run: () => Promise<unknown> }[] = [];

    for (const platform of targets) {
      if (platform.id === "tiktok") {
        publicationTasks.push({
          label: platform.label,
          run: () => scheduleTikTokPost({
            workspaceId: workspace.id,
            description: caption,
            videoUrl: mediaKind === "video" ? videoUrl.trim() : undefined,
            imageUrls: mediaKind === "image" ? images : undefined,
            scheduledAt: scheduledAtIso,
            timezone: scheduledAtIso ? timezone : undefined,
            privacyLevel: tiktokPrivacy,
            disableComment: tiktokDisableComment,
            disableDuet: tiktokDisableDuet,
            disableStitch: tiktokDisableStitch,
            autoAddMusic: tiktokAutoAddMusic,
            credentialReferenceId: credentialReferenceByPlatform.tiktok,
          }),
        });
        continue;
      }
      if (platform.id === "youtube") {
        publicationTasks.push({
          label: platform.label,
          run: () => scheduleYouTubePost({
            workspaceId: workspace.id,
            title: caption.split(/\r?\n/).find((line) => line.trim())?.slice(0, 100) || "Short",
            description: caption,
            videoUrl: videoUrl.trim(),
            scheduledAt: scheduledAtIso,
            timezone: scheduledAtIso ? timezone : undefined,
            privacyStatus: youtubePrivacy,
            tags: ["Shorts"],
            credentialReferenceId: credentialReferenceByPlatform.youtube,
          }),
        });
        continue;
      }
      const metaTarget = platform.id as "instagram" | "facebook";
      for (const metaPlacement of selectedMetaPlacements) {
        if (metaPlacement === "story" && metaTarget === "facebook" && mediaKind === "video") {
          skippedSummaries.push("Facebook Story: ignorado porque vídeo em Story ainda não é suportado");
          continue;
        }
        const placementLabel = metaPlacement === "story" ? "Story" : "Feed";
        publicationTasks.push({
          label: `${platform.label} ${placementLabel}`,
          run: () => scheduleMetaPost({
            workspaceId: workspace.id,
            target: metaTarget,
            placement: metaPlacement,
            caption: metaPlacement === "story" ? "" : caption,
            videoUrl: mediaKind === "video" ? videoUrl.trim() : undefined,
            imageUrls: mediaKind === "image" ? (metaPlacement === "story" ? images.slice(0, 1) : images) : undefined,
            thumbnailUrl: thumbnailUrl.trim() || undefined,
            scheduledAt: scheduledAtIso,
            timezone: scheduledAtIso ? timezone : undefined,
            credentialReferenceId: credentialReferenceByPlatform[platform.id],
          }),
        });
      }
    }

    if (publicationTasks.length === 0) {
      setFeedback({ tone: "error", message: skippedSummaries.join(" · ") || "Nenhuma publicação pode ser criada com essa combinação." });
      setBusy(false);
      return;
    }

    const outcomes = await Promise.allSettled(publicationTasks.map((task) => task.run()));
    const summary = outcomes.map((outcome, index) => {
      const label = publicationTasks[index].label;
      if (outcome.status === "fulfilled") return `${label}: ok`;
      return `${label}: ${messageOf(outcome.reason)}`;
    }).concat(skippedSummaries).join(" · ");
    const fulfilledCount = outcomes.filter((outcome) => outcome.status === "fulfilled").length;
    const tone = fulfilledCount === 0 ? "error" : fulfilledCount === outcomes.length && skippedSummaries.length === 0 ? "success" : "warning";
    setFeedback({ tone, message: summary });

    if (outcomes.some((outcome) => outcome.status === "fulfilled")) {
      setCaption("");
      setVideoUrl("");
      setImageUrls("");
      setThumbnailUrl("");
      setScheduledAt("");
      setPublishTiming("now");
      setSelectedSourceId("");
      await Promise.all([mutateTikTokPosts(), mutateMetaPosts(), mutateYouTubePosts(), mutateUnified()]);
    }
    setBusy(false);
  }

  async function confirmCancelPost() {
    if (!postPendingCancel) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      await cancelUnifiedPublication(workspace.id, postPendingCancel.network, postPendingCancel.id);
      await Promise.all([mutateTikTokPosts(), mutateMetaPosts(), mutateYouTubePosts(), mutateUnified()]);
    } catch (cause) {
      setFeedback({ tone: "error", message: messageOf(cause) });
    } finally {
      setBusy(false);
      setPostPendingCancel(undefined);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Publicar"
        description="Escolha um conteúdo, selecione as redes e publique agora ou agende."
        actions={
          <>
            <Link href={`/workspaces/${workspace.id}/calendar`} className="text-sm font-medium text-primary hover:underline">Ver calendário</Link>
            <Link href={`/workspaces/${workspace.id}/campaigns`} className="text-sm font-medium text-primary hover:underline">Ver todos os conteúdos</Link>
          </>
        }
      />

      {feedback ? (
        <Card
          className={cn(
            "mb-6 p-4",
            feedback.tone === "success" && "border-status-active/30 bg-status-active-bg",
            feedback.tone === "warning" && "border-warning/30 bg-warning-bg",
            feedback.tone === "error" && "border-danger/30 bg-danger-bg",
          )}
        >
          <p className={cn(
            "text-sm",
            feedback.tone === "success" && "text-status-active",
            feedback.tone === "warning" && "text-warning",
            feedback.tone === "error" && "text-danger",
          )}>{feedback.message}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <form className="space-y-5" onSubmit={submitPost}>
          <Card className="p-4 sm:p-5">
            <SectionTitle step="1" title="Escolher conteúdo" />
            <div className="mt-4 grid gap-3">
              {mostRecent ? (
                <button type="button" onClick={() => applyContent(mostRecent)} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-3 text-left hover:border-primary">
                  <ContentThumb post={mostRecent} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Peça mais recente</p>
                    <p className="line-clamp-2 text-sm font-semibold text-foreground">{titleOf(mostRecent)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(mostRecent.createdAt)}</p>
                  </div>
                  <span className="text-xs font-medium text-primary">Usar</span>
                </button>
              ) : null}

              {unified && unified.length > 0 ? (
                <div>
                  <Label htmlFor="existing-content">Selecionar conteúdo existente</Label>
                  <SearchableCombo
                    items={contentLibraryItems}
                    value={selectedSourceId}
                    onValueChange={(value) => {
                      const post = unified.find((item) => sourceKey(item) === value);
                      if (post) applyContent(post);
                    }}
                    placeholder="Escolher da biblioteca"
                    searchPlaceholder="Buscar conteúdo..."
                    emptyText="Nenhum conteúdo encontrado."
                  />
                </div>
              ) : null}

              <div className="rounded-lg bg-muted/40 p-3">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ou enviar agora</p>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  className="mb-3 justify-start"
                  value={mediaKind}
                  onValueChange={(value) => value && setMediaKind(value as "image" | "video")}
                >
                  <ToggleGroupItem value="image" disabled={selected.has("youtube")} className="px-4">Imagem/carrossel</ToggleGroupItem>
                  <ToggleGroupItem value="video" className="px-4">Vídeo</ToggleGroupItem>
                </ToggleGroup>
                {selected.has("youtube") ? <p className="mb-3 text-xs text-muted-foreground">YouTube Shorts só publica vídeo.</p> : null}
                {mediaKind === "video" ? (
                  <MediaUploadPanel id="publish-video-file" label="Vídeo" helper="MP4 ou MOV. Para Shorts, prefira vídeo vertical curto." accept="video/mp4,video/quicktime" uploading={uploading} urls={videoUrl.trim() ? [videoUrl.trim()] : []} onPick={(files) => files?.[0] && uploadVideoFile(files[0])} onRemove={() => setVideoUrl("")} />
                ) : (
                  <MediaUploadPanel id="publish-image-files" label={storyOnly ? "Imagem" : "Imagens"} helper={storyOnly ? "Envie uma imagem JPG, PNG ou WEBP." : "Envie uma ou mais imagens. Feed usa todas; Story usa só a primeira."} accept="image/jpeg,image/png,image/webp" multiple={!storyOnly} uploading={uploading} urls={images} onPick={uploadImageFiles} onRemove={(url) => setImageUrls((current) => current.split(/[\n,]/).map((item) => item.trim()).filter((item) => item && item !== url).join("\n"))} />
                )}
                {mediaKind === "video" ? (
                  <MediaUploadPanel id="publish-thumbnail-file" label="Capa do vídeo" helper="Opcional. Use JPG se quiser definir uma capa." accept="image/jpeg" uploading={uploading} urls={thumbnailUrl.trim() ? [thumbnailUrl.trim()] : []} onPick={(files) => files?.[0] && uploadThumbnailFile(files[0])} onRemove={() => setThumbnailUrl("")} />
                ) : null}
              </div>
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <SectionTitle step="2" title="Onde publicar?" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {PLATFORMS.map((platform) => (
                <NetworkChoice
                  key={platform.id}
                  platform={platform}
                  connected={connectedByPlatform[platform.id]}
                  selected={selected.has(platform.id)}
                  accountLabel={accountLabelByPlatform[platform.id]}
                  workspaceId={workspace.id}
                  onToggle={() => togglePlatform(platform.id)}
                />
              ))}
            </div>

            {hasMetaSelection ? (
              <div className="mt-4 rounded-lg bg-muted/40 p-3">
                <Label htmlFor="publish-placement">Opções de Meta</Label>
                <ToggleGroup
                  id="publish-placement"
                  type="multiple"
                  variant="outline"
                  className="mt-2 justify-start"
                  value={selectedMetaPlacements}
                  onValueChange={(next: string[]) => { if (next.length > 0) setMetaPlacements(new Set(next as MetaPlacement[])); }}
                >
                  {META_PLACEMENTS.map((item) => (
                    <ToggleGroupItem key={item.id} value={item.id} className="flex-1 px-4 sm:flex-none">
                      {item.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {storySelected ? <p className="mt-2 text-xs text-muted-foreground">Story usa somente o formato permitido pela rede. Feed continua com legenda e carrossel quando aplicavel.</p> : null}
                {hasStoryUnsupported ? <p className="mt-1 text-xs text-muted-foreground">Story vale só para Instagram/Facebook; TikTok e YouTube seguem como publicação normal.</p> : null}
              </div>
            ) : null}
          </Card>

          <Card className="p-4 sm:p-5">
            <SectionTitle step="3" title="Legenda" />
            <div className="mt-4">
              <Label htmlFor="publish-caption">Legenda/copy</Label>
              <Textarea id="publish-caption" required rows={5} maxLength={2200} value={caption} onChange={(event) => setCaption(event.target.value)} />
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <SectionTitle step="4" title="Quando publicar?" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => { setPublishTiming("now"); setScheduledAt(""); }} className={timingClass(publishTiming === "now")}>
                <span className="text-sm font-semibold">Publicar agora</span>
                <span className="text-xs text-muted-foreground">Enviar assim que confirmar.</span>
              </button>
              <button type="button" onClick={() => setPublishTiming("schedule")} className={timingClass(publishTiming === "schedule")}>
                <span className="text-sm font-semibold">Agendar</span>
                <span className="text-xs text-muted-foreground">Definir data e horário.</span>
              </button>
            </div>
            {publishTiming === "schedule" ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="publish-scheduled-at">Data e horário</Label>
                  <Input id="publish-scheduled-at" type="datetime-local" required value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="publish-timezone">Fuso horário</Label>
                  <Input id="publish-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
                </div>
              </div>
            ) : null}
          </Card>

          {(selected.has("tiktok") || selected.has("youtube")) ? (
            <ProgressivePanel title="Opções da rede" description="Privacidade, música automática e interações quando a rede suporta." open={networkOptionsOpen} onToggle={() => setNetworkOptionsOpen(!networkOptionsOpen)}>
              <div className="grid gap-3">
                {selected.has("tiktok") ? (
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">TikTok</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="tiktok-privacy">Quem pode ver</Label>
                        <Select value={tiktokPrivacy} onValueChange={(value) => setTiktokPrivacy(value as TikTokPrivacyLevel)}>
                          <SelectTrigger id="tiktok-privacy">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TIKTOK_PRIVACY_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col justify-end gap-2">
                        <SwitchLine id="tiktok-auto-music" checked={tiktokAutoAddMusic} onChange={setTiktokAutoAddMusic} label="Adicionar música automaticamente" />
                        <SwitchLine id="tiktok-disable-comment" checked={tiktokDisableComment} onChange={setTiktokDisableComment} label="Desativar comentários" />
                        <SwitchLine id="tiktok-disable-duet" checked={tiktokDisableDuet} onChange={setTiktokDisableDuet} label="Desativar Duet" />
                        <SwitchLine id="tiktok-disable-stitch" checked={tiktokDisableStitch} onChange={setTiktokDisableStitch} label="Desativar Stitch" />
                      </div>
                    </div>
                  </div>
                ) : null}
                {selected.has("youtube") ? (
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">YouTube</p>
                    <Label htmlFor="youtube-privacy">Visibilidade</Label>
                    <Select value={youtubePrivacy} onValueChange={(value) => setYouTubePrivacy(value as YouTubePrivacyStatus)}>
                      <SelectTrigger id="youtube-privacy">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {YOUTUBE_PRIVACY_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            </ProgressivePanel>
          ) : null}

          <div className="sticky bottom-16 z-20 rounded-2xl border border-border bg-card/95 p-3 shadow-md backdrop-blur md:bottom-4">
            <Button type="submit" className="w-full" disabled={busy || uploading || selected.size === 0 || !hasMedia || (publishTiming === "schedule" && !scheduledAt)}>
              {publishTiming === "schedule" ? "Agendar publicação" : "Publicar agora"}
            </Button>
          </div>
        </form>

        <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
          <Card className="p-4 sm:p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
            {selected.size === 0 ? (
              <p className="text-sm text-muted-foreground">Selecione uma rede conectada para ver a prévia.</p>
            ) : (
              <div className="flex flex-col gap-5">
                {PLATFORMS.filter((platform) => selected.has(platform.id)).flatMap((platform) => {
                  if (platform.id === "instagram" || platform.id === "facebook") {
                    return selectedMetaPlacements.map((metaPlacement) => (
                      <PostPreview key={`${platform.id}-${metaPlacement}`} network={platform.id} placement={metaPlacement} caption={metaPlacement === "story" ? "" : caption} mediaKind={mediaKind} imageUrls={metaPlacement === "story" ? images.slice(0, 1) : images} videoUrl={videoUrl.trim() || undefined} thumbnailUrl={thumbnailUrl.trim() || undefined} accountLabel={`${accountLabelByPlatform[platform.id] ?? platform.label} · ${metaPlacement === "story" ? "Story" : "Feed"}`} />
                    ));
                  }
                  return <PostPreview key={platform.id} network={platform.id} placement="feed" caption={caption} mediaKind={mediaKind} imageUrls={images} videoUrl={videoUrl.trim() || undefined} thumbnailUrl={thumbnailUrl.trim() || undefined} autoAddMusic={platform.id === "tiktok" ? tiktokAutoAddMusic : undefined} accountLabel={accountLabelByPlatform[platform.id]} />;
                })}
              </div>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">Publicações recentes</p>
              <Link href={`/workspaces/${workspace.id}/campaigns`} className="text-xs font-medium text-primary hover:underline">Ver todos</Link>
            </div>
            {recentPublications.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma publicação ainda.</p>
            ) : (
              <div className="space-y-3">
                {recentPublications.map((post) => <RecentPublicationCard key={`${post.network}-${post.id}`} post={post} busy={busy} onCancel={() => setPostPendingCancel(post)} />)}
              </div>
            )}
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={Boolean(postPendingCancel)}
        title="Cancelar publicação"
        description={postPendingCancel ? `Tem certeza que deseja cancelar a publicação "${titleOf(postPendingCancel)}"? Esta ação não pode ser desfeita.` : ""}
        confirmLabel="Cancelar publicação"
        cancelLabel="Voltar"
        variant="danger"
        busy={busy}
        onConfirm={confirmCancelPost}
        onCancel={() => setPostPendingCancel(undefined)}
      />
    </main>
  );
}

function SectionTitle({ step, title }: { step: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{step}</span>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
    </div>
  );
}

function NetworkChoice({ platform, connected, selected, accountLabel, workspaceId, onToggle }: { platform: { id: Platform; label: string; icon: string }; connected: boolean; selected: boolean; accountLabel?: string; workspaceId: string; onToggle: () => void }) {
  return (
    <div className={`rounded-xl border p-3 ${selected ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
      <button type="button" onClick={onToggle} disabled={!connected} className="flex w-full items-start gap-3 text-left disabled:cursor-not-allowed">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-sm font-semibold text-foreground">{platform.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{platform.label}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{connected ? accountLabel ?? "Conta conectada" : "Não conectado"}</span>
        </span>
        <span className={`mt-1 h-4 w-4 rounded border ${selected ? "border-primary bg-primary" : "border-border bg-card"}`} />
      </button>
      {!connected ? <Link href={`/workspaces/${workspaceId}/connections`} className="mt-3 inline-flex text-xs font-medium text-primary hover:underline">Conectar</Link> : null}
    </div>
  );
}

function ContentThumb({ post }: { post: UnifiedPublication }) {
  const image = post.media.imageUrls[0] ?? post.media.thumbnailUrl;
  return (
    <span className="flex h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-card">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-lg text-muted-foreground">{contentTypeOf(post) === "video" ? "▶" : "▧"}</span>
      )}
    </span>
  );
}

function MediaUploadPanel({ id, label, helper, accept, multiple, uploading, urls, onPick, onRemove }: { id: string; label: string; helper: string; accept: string; multiple?: boolean; uploading: boolean; urls: readonly string[]; onPick: (files: FileList | null) => void; onRemove: (url: string) => void }) {
  return (
    <div className="mt-3">
      <Label htmlFor={id}>{label}</Label>
      <div className="rounded-lg border border-border bg-card p-3">
        <input id={id} type="file" accept={accept} multiple={multiple} disabled={uploading} onChange={(event) => { onPick(event.target.files); event.currentTarget.value = ""; }} className="w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary" />
        <p className="mt-2 text-xs text-muted-foreground">{uploading ? "Enviando arquivo..." : helper}</p>
        {urls.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {urls.map((url) => (
              <div key={url} className="flex flex-col gap-3 rounded-md border border-border bg-background p-2 sm:flex-row sm:items-center">
                {isImageUrl(url) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="h-32 w-full rounded object-contain sm:h-14 sm:w-14 sm:object-cover" />
                ) : (
                  <div className="flex h-14 w-full items-center justify-center rounded bg-muted text-lg sm:w-14">▶</div>
                )}
                <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{url}</p>
                <button type="button" className="min-h-9 text-left text-xs font-medium text-destructive hover:text-destructive/80 sm:text-center" onClick={() => onRemove(url)}>Remover</button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RecentPublicationCard({ post, busy, onCancel }: { post: UnifiedPublication; busy: boolean; onCancel: () => void }) {
  const status = derivePublicationStatus(post);
  const when = post.scheduledAt ? `${formatDateTime(post.scheduledAt)}${post.timezone ? ` (${post.timezone})` : ""}` : "Imediato";

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{titleOf(post)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{when}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      {status === "published" || status === "cancelled" ? null : <Button variant="secondary" disabled={busy} onClick={onCancel} className="mt-2 w-full">Cancelar</Button>}
    </div>
  );
}

function timingClass(active: boolean) {
  return `flex flex-col gap-1 rounded-xl border p-3 text-left transition ${active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-foreground hover:border-primary/60"}`;
}

function SwitchLine({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-3 text-sm text-foreground">
      <span>{label}</span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function isImageUrl(url: string): boolean {
  return /\.(jpe?g|png|webp)(?:\?|#|$)/i.test(url);
}

function sourceKey(post: UnifiedPublication): string {
  return `${post.network}:${post.id}`;
}

function titleOf(post: UnifiedPublication): string {
  const firstLine = post.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 96) : `${post.network} · ${contentTypeOf(post)}`;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Não foi possível concluir a operação.";
}
