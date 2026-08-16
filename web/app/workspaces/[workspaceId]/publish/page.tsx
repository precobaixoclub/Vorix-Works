"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input, Label, Textarea } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { PostPreview } from "@/components/PostPreview";
import { ProgressivePanel, ScreenGuide } from "@/components/ScreenGuide";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { scheduleTikTokPost } from "@/features/tiktok/api";
import { useTikTokOAuthStatus, useTikTokPosts } from "@/features/tiktok/hooks";
import type { TikTokPrivacyLevel } from "@/features/tiktok/types";
import { scheduleMetaPost } from "@/features/meta/api";
import { useMetaOAuthStatus, useMetaPosts } from "@/features/meta/hooks";
import { scheduleYouTubePost } from "@/features/youtube/api";
import { useYouTubeOAuthStatus, useYouTubePosts } from "@/features/youtube/hooks";
import type { YouTubePrivacyStatus } from "@/features/youtube/types";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { cancelUnifiedPublication } from "@/features/publication-history/api";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import { derivePublicationStatus, type UnifiedPublication } from "@/features/publication-history/types";
import { formatDateTime } from "@/lib/format";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

type Platform = "tiktok" | "instagram" | "facebook" | "youtube";
type MetaPlacement = "feed" | "story";

const PLATFORMS: readonly { id: Platform; label: string; icon: string }[] = [
  { id: "tiktok", label: "TikTok", icon: "🎵" },
  { id: "instagram", label: "Instagram", icon: "📷" },
  { id: "facebook", label: "Facebook", icon: "👍" },
  { id: "youtube", label: "YouTube Shorts", icon: "▶" },
];

const META_PLACEMENTS: readonly { id: MetaPlacement; label: string }[] = [
  { id: "feed", label: "Feed" },
  { id: "story", label: "Story" },
];

const TIKTOK_PRIVACY_OPTIONS: readonly { value: TikTokPrivacyLevel; label: string }[] = [
  { value: "PUBLIC_TO_EVERYONE", label: "Todos" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Amigos (seguem um ao outro)" },
  { value: "FOLLOWER_OF_CREATOR", label: "Seguidores" },
  { value: "SELF_ONLY", label: "Só eu" },
];

/**
 * Tela única de publicação: escolha o conteúdo, marque em quais redes vai publicar e agende —
 * cada rede recebe seu próprio post (mesmo conteúdo, adaptado às regras de cada uma). A prévia ao
 * lado mostra como cada post vai aparecer na rede de destino, e as opções do TikTok (privacidade,
 * comentário/duet/stitch, música) ficam expostas aqui — antes só existiam no backend, sem
 * controle nenhum na tela. O histórico completo de tudo que já foi publicado/agendado vive em
 * "Publicações" (`/campaigns`); aqui mostramos só os últimos como referência rápida.
 */
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
  const [feedback, setFeedback] = useState<string | undefined>();
  const [selected, setSelected] = useState<Set<Platform>>(new Set());
  const [metaPlacements, setMetaPlacements] = useState<Set<MetaPlacement>>(new Set(["feed"]));
  const [mediaKind, setMediaKind] = useState<"image" | "video">("image");
  const [videoUrl, setVideoUrl] = useState("");
  const [imageUrls, setImageUrls] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);

  // Opções do TikTok — existiam no backend desde sempre, mas nunca tinham controle na tela.
  const [tiktokPrivacy, setTiktokPrivacy] = useState<TikTokPrivacyLevel>("PUBLIC_TO_EVERYONE");
  const [tiktokDisableComment, setTiktokDisableComment] = useState(false);
  const [tiktokDisableDuet, setTiktokDisableDuet] = useState(false);
  const [tiktokDisableStitch, setTiktokDisableStitch] = useState(false);
  const [tiktokAutoAddMusic, setTiktokAutoAddMusic] = useState(true);
  const [youtubePrivacy, setYouTubePrivacy] = useState<YouTubePrivacyStatus>("public");
  const [networkOptionsOpen, setNetworkOptionsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const connectedByPlatform: Record<Platform, boolean> = {
    tiktok: tiktokOAuth?.connected ?? false,
    instagram: (metaOAuth?.accounts ?? []).some((a) => a.providerId === "instagram" && a.status === "active"),
    facebook: (metaOAuth?.accounts ?? []).some((a) => a.providerId === "facebook" && a.status === "active"),
    youtube: youtubeOAuth?.connected ?? false,
  };
  const accountLabelByPlatform: Partial<Record<Platform, string>> = {
    tiktok: tiktokOAuth?.accounts[0]?.displayName,
    instagram: metaOAuth?.accounts.find((a) => a.providerId === "instagram")?.displayName,
    facebook: metaOAuth?.accounts.find((a) => a.providerId === "facebook")?.displayName,
    youtube: youtubeOAuth?.accounts[0]?.displayName,
  };
  const credentialReferenceByPlatform: Partial<Record<Platform, string>> = {
    tiktok: tiktokOAuth?.accounts.find((a) => a.status === "active")?.credentialReferenceId,
    instagram: metaOAuth?.accounts.find((a) => a.providerId === "instagram" && a.status === "active")?.credentialReferenceId,
    facebook: metaOAuth?.accounts.find((a) => a.providerId === "facebook" && a.status === "active")?.credentialReferenceId,
    youtube: youtubeOAuth?.accounts.find((a) => a.status === "active")?.credentialReferenceId,
  };
  const anyConnected = Object.values(connectedByPlatform).some(Boolean);
  const hasMetaSelection = selected.has("instagram") || selected.has("facebook");
  const selectedMetaPlacements = META_PLACEMENTS.map((item) => item.id).filter((item) => metaPlacements.has(item));
  const feedSelected = metaPlacements.has("feed");
  const storySelected = metaPlacements.has("story");
  const storyOnly = storySelected && !feedSelected;
  const hasStoryUnsupported = storySelected && (selected.has("tiktok") || selected.has("youtube"));
  const youtubeNeedsVideo = selected.has("youtube") && mediaKind !== "video";
  const hasMedia = mediaKind === "video" ? Boolean(videoUrl.trim()) : imageUrls.split(/[\n,]/).some((url) => url.trim().length > 0);

  function togglePlatform(platform: Platform) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
    if (platform === "youtube") setMediaKind("video");
  }

  function toggleMetaPlacement(placement: MetaPlacement) {
    setMetaPlacements((current) => {
      const next = new Set(current);
      if (next.has(placement) && next.size > 1) next.delete(placement);
      else next.add(placement);
      return next;
    });
  }

  async function uploadVideoFile(file: File) {
    setUploading(true);
    setFeedback(undefined);
    try {
      const uploaded = await uploadPublicationMedia(workspace.id, file);
      setVideoUrl(uploaded.url);
    } catch (cause) {
      setFeedback(messageOf(cause));
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
    } catch (cause) {
      setFeedback(messageOf(cause));
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
      setFeedback(messageOf(cause));
    } finally {
      setUploading(false);
    }
  }

  async function submitPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(undefined);

    if (!hasMedia) {
      setFeedback(mediaKind === "video" ? "Envie um vídeo para publicar." : "Envie ao menos uma imagem para publicar.");
      return;
    }

    if (youtubeNeedsVideo) {
      setFeedback("YouTube Shorts só publica vídeo — desmarque YouTube ou troque a mídia para Vídeo.");
      return;
    }

    setBusy(true);
    const images = imageUrls.split(/[\n,]/).map((url) => url.trim()).filter(Boolean);
    const scheduledAtIso = scheduledAt ? new Date(scheduledAt).toISOString() : undefined;
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
          skippedSummaries.push("Facebook Story: ignorado (vídeo em Story ainda não é suportado)");
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
      setFeedback(skippedSummaries.join(" · ") || "Nenhuma publicação pôde ser criada com essa combinação.");
      setBusy(false);
      return;
    }

    const outcomes = await Promise.allSettled(publicationTasks.map((task) => task.run()));

    const summary = outcomes.map((outcome, index) => {
      const label = publicationTasks[index].label;
      if (outcome.status === "fulfilled") return `${label}: ok`;
      return `${label}: ${messageOf(outcome.reason)}`;
    }).concat(skippedSummaries).join(" · ");
    setFeedback(summary);

    if (outcomes.some((outcome) => outcome.status === "fulfilled")) {
      setCaption("");
      setVideoUrl("");
      setImageUrls("");
      setThumbnailUrl("");
      setScheduledAt("");
      await Promise.all([mutateTikTokPosts(), mutateMetaPosts(), mutateYouTubePosts(), mutateUnified()]);
    }
    setBusy(false);
  }

  async function cancelPost(post: UnifiedPublication) {
    setBusy(true);
    setFeedback(undefined);
    try {
      await cancelUnifiedPublication(workspace.id, post.network, post.id);
      await Promise.all([mutateTikTokPosts(), mutateMetaPosts(), mutateYouTubePosts(), mutateUnified()]);
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  const images = imageUrls.split(/[\n,]/).map((url) => url.trim()).filter(Boolean);
  const recent = (unified ?? []).slice(0, 5);

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Publicar" description="Envie o conteúdo, marque em quais redes vai publicar e agende data e horário." />

      <ScreenGuide
        title="Publicação manual"
        description="Use esta tela quando você já tem a mídia pronta e quer publicar ou agendar diretamente."
        items={[
          "Escolha as redes conectadas.",
          "Envie imagem, carrossel ou vídeo.",
          "Revise a legenda e as opções específicas de cada rede.",
          "Use a prévia para conferir antes de publicar.",
        ]}
        aside={<p>Para produção automática por sequência, use a tela Produção. Esta tela é para uma postagem pontual.</p>}
      />

      {feedback ? <Card className="mb-6 p-4"><p className="text-sm text-ink">{feedback}</p></Card> : null}

      {!anyConnected ? (
        <Card className="mb-6 p-4">
          <p className="text-sm text-ink">
            Nenhuma rede social conectada ainda.{" "}
            <Link href={`/workspaces/${workspace.id}/connections`} className="font-medium text-accent hover:underline">Conectar uma conta →</Link>
          </p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(240px,280px)]">
        <Card className="p-4 sm:p-5">
          <form className="space-y-4" onSubmit={submitPost}>
            <div>
              <Label htmlFor="publish-platforms">Onde publicar</Label>
              <div id="publish-platforms" className="flex flex-wrap gap-2">
                {PLATFORMS.map((platform) => (
                  <Button
                    key={platform.id}
                    type="button"
                    variant={selected.has(platform.id) ? "primary" : "secondary"}
                    disabled={!connectedByPlatform[platform.id]}
                    className="flex-1 min-w-0 sm:flex-none"
                    onClick={() => togglePlatform(platform.id)}
                    title={connectedByPlatform[platform.id] ? undefined : "Conecte esta conta em Conexões primeiro"}
                  >
                    {platform.icon} {platform.label}{connectedByPlatform[platform.id] ? "" : " (desconectado)"}
                  </Button>
                ))}
              </div>
            </div>

            {hasMetaSelection ? (
              <div>
                <Label htmlFor="publish-placement">Feed e/ou Story (Instagram/Facebook)</Label>
                <div id="publish-placement" className="flex gap-2">
                  {META_PLACEMENTS.map((item) => (
                    <Button
                      key={item.id}
                      type="button"
                      className="flex-1 sm:flex-none"
                      variant={metaPlacements.has(item.id) ? "primary" : "secondary"}
                      onClick={() => toggleMetaPlacement(item.id)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
                {storySelected ? (
                  <p className="mt-1 text-xs text-ink-muted">
                    Story vai usar só o que é permitido: primeira imagem ou vídeo, sem legenda visível e sem carrossel.
                    {selected.has("facebook") && mediaKind === "video" ? " O Facebook Story de vídeo será ignorado porque ainda não é suportado." : ""}
                  </p>
                ) : null}
                {hasStoryUnsupported ? <p className="mt-1 text-xs text-ink-muted">Story vale só para Instagram/Facebook. TikTok e YouTube continuam como publicação normal.</p> : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" className="flex-1 sm:flex-none" variant={mediaKind === "image" ? "primary" : "secondary"} disabled={selected.has("youtube")} onClick={() => setMediaKind("image")}>Imagem/carrossel</Button>
              <Button type="button" className="flex-1 sm:flex-none" variant={mediaKind === "video" ? "primary" : "secondary"} onClick={() => setMediaKind("video")}>Vídeo</Button>
            </div>
            {selected.has("youtube") ? <p className="-mt-2 text-xs text-ink-muted">YouTube Shorts só publica vídeo. Use vídeo vertical curto para o YouTube reconhecer como Short.</p> : null}

            {mediaKind === "video" ? (
              <MediaUploadPanel
                id="publish-video-file"
                label="Vídeo"
                helper="MP4 ou MOV. Para YouTube Shorts, use vídeo vertical curto."
                accept="video/mp4,video/quicktime"
                uploading={uploading}
                urls={videoUrl.trim() ? [videoUrl.trim()] : []}
                onPick={(files) => files?.[0] && uploadVideoFile(files[0])}
                onRemove={() => setVideoUrl("")}
              />
            ) : (
              <MediaUploadPanel
                id="publish-image-files"
                label={storyOnly ? "Imagem" : "Imagens"}
                helper={storyOnly ? "Envie uma imagem JPG, PNG ou WEBP." : "Envie uma ou mais imagens. Feed usa todas; Story usa só a primeira."}
                accept="image/jpeg,image/png,image/webp"
                multiple={!storyOnly}
                uploading={uploading}
                urls={images}
                onPick={uploadImageFiles}
                onRemove={(url) => setImageUrls((current) => current.split(/[\n,]/).map((item) => item.trim()).filter((item) => item && item !== url).join("\n"))}
              />
            )}

            {mediaKind === "video" ? (
              <MediaUploadPanel
                id="publish-thumbnail-file"
                label="Capa do vídeo"
                helper="Opcional. Use JPG se quiser definir uma capa para redes que aceitam thumbnail."
                accept="image/jpeg"
                uploading={uploading}
                urls={thumbnailUrl.trim() ? [thumbnailUrl.trim()] : []}
                onPick={(files) => files?.[0] && uploadThumbnailFile(files[0])}
                onRemove={() => setThumbnailUrl("")}
              />
            ) : null}

            <div>
              <Label htmlFor="publish-caption">Legenda/descrição</Label>
              <Textarea id="publish-caption" required rows={4} maxLength={2200} value={caption} onChange={(event) => setCaption(event.target.value)} />
            </div>

            {selected.has("tiktok") || selected.has("youtube") ? (
              <ProgressivePanel
                title="Opções avançadas das redes"
                description="Abra apenas se quiser mudar privacidade, música automática ou interação."
                open={networkOptionsOpen}
                onToggle={() => setNetworkOptionsOpen(!networkOptionsOpen)}
              >
                <div className="grid gap-3">
                  {selected.has("tiktok") ? (
                    <div className="rounded-lg border border-border bg-surface p-3">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">TikTok</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="tiktok-privacy">Quem pode ver</Label>
                          <select
                            id="tiktok-privacy"
                            value={tiktokPrivacy}
                            onChange={(event) => setTiktokPrivacy(event.target.value as TikTokPrivacyLevel)}
                            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                          >
                            {TIKTOK_PRIVACY_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-col justify-end gap-1.5">
                          <CheckboxLine checked={tiktokAutoAddMusic} onChange={setTiktokAutoAddMusic} label="Adicionar música automaticamente" />
                          <CheckboxLine checked={tiktokDisableComment} onChange={setTiktokDisableComment} label="Desativar comentários" />
                          <CheckboxLine checked={tiktokDisableDuet} onChange={setTiktokDisableDuet} label="Desativar Duet" />
                          <CheckboxLine checked={tiktokDisableStitch} onChange={setTiktokDisableStitch} label="Desativar Stitch" />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {selected.has("youtube") ? (
                    <div className="rounded-lg border border-border bg-surface p-3">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">YouTube</p>
                      <Label htmlFor="youtube-privacy">Visibilidade</Label>
                      <select
                        id="youtube-privacy"
                        value={youtubePrivacy}
                        onChange={(event) => setYouTubePrivacy(event.target.value as YouTubePrivacyStatus)}
                        className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                      >
                        <option value="public">Público</option>
                        <option value="unlisted">Não listado</option>
                        <option value="private">Privado</option>
                      </select>
                    </div>
                  ) : null}
                </div>
              </ProgressivePanel>
            ) : null}

            <ProgressivePanel
              title={scheduledAt ? "Agendamento configurado" : "Agendar para depois"}
              description={scheduledAt ? "Abra para alterar data, horário ou fuso." : "Deixe fechado para publicar agora."}
              open={scheduleOpen}
              onToggle={() => setScheduleOpen(!scheduleOpen)}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="publish-scheduled-at">Data e horário</Label>
                  <Input id="publish-scheduled-at" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="publish-timezone">Fuso horário</Label>
                  <Input id="publish-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
                </div>
              </div>
            </ProgressivePanel>

            <Button type="submit" className="w-full sm:w-auto" disabled={busy || uploading || selected.size === 0 || !hasMedia}>{scheduledAt ? "Agendar publicação" : "Publicar agora"}</Button>
            {selected.size === 0 ? <p className="text-xs text-ink-muted">Marque ao menos uma rede social conectada para publicar.</p> : null}
            {!hasMedia ? <p className="text-xs text-ink-muted">Envie a mídia antes de publicar ou agendar.</p> : null}
          </form>
        </Card>

        <div className="flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Prévia</p>
          {selected.size === 0 ? (
            <p className="text-sm text-ink-muted">Marque uma rede social pra ver como o post vai ficar.</p>
          ) : (
            <div className="flex flex-col gap-6">
              {PLATFORMS.filter((platform) => selected.has(platform.id)).flatMap((platform) => {
                if (platform.id === "instagram" || platform.id === "facebook") {
                  return selectedMetaPlacements.map((metaPlacement) => (
                    <PostPreview
                      key={`${platform.id}-${metaPlacement}`}
                      network={platform.id}
                      placement={metaPlacement}
                      caption={metaPlacement === "story" ? "" : caption}
                      mediaKind={mediaKind}
                      imageUrls={metaPlacement === "story" ? images.slice(0, 1) : images}
                      videoUrl={videoUrl.trim() || undefined}
                      thumbnailUrl={thumbnailUrl.trim() || undefined}
                      accountLabel={`${accountLabelByPlatform[platform.id] ?? platform.label} · ${metaPlacement === "story" ? "Story" : "Feed"}`}
                    />
                  ));
                }
                return (
                  <PostPreview
                    key={platform.id}
                    network={platform.id}
                    placement="feed"
                    caption={caption}
                    mediaKind={mediaKind}
                    imageUrls={images}
                    videoUrl={videoUrl.trim() || undefined}
                    thumbnailUrl={thumbnailUrl.trim() || undefined}
                    autoAddMusic={platform.id === "tiktok" ? tiktokAutoAddMusic : undefined}
                    accountLabel={accountLabelByPlatform[platform.id]}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">Últimas publicações</p>
          <Link href={`/workspaces/${workspace.id}/campaigns`} className="text-xs font-medium text-accent hover:underline">Ver histórico completo →</Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-ink-muted">Nenhuma publicação ainda — o que você agendar acima aparece aqui.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {recent.map((post) => (
              <RecentPublicationCard key={`${post.network}-${post.id}`} post={post} busy={busy} onCancel={() => cancelPost(post)} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Não foi possível concluir a operação.";
}

function MediaUploadPanel({
  id,
  label,
  helper,
  accept,
  multiple,
  uploading,
  urls,
  onPick,
  onRemove,
}: {
  id: string;
  label: string;
  helper: string;
  accept: string;
  multiple?: boolean;
  uploading: boolean;
  urls: readonly string[];
  onPick: (files: FileList | null) => void;
  onRemove: (url: string) => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="rounded-lg border border-border bg-surface-sunken p-3">
        <input
          id={id}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={uploading}
          onChange={(event) => {
            onPick(event.target.files);
            event.currentTarget.value = "";
          }}
          className="w-full text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-accent"
        />
        <p className="mt-2 text-xs text-ink-muted">{uploading ? "Enviando arquivo..." : helper}</p>
        {urls.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {urls.map((url) => (
              <div key={url} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-2 sm:flex-row sm:items-center">
                {isImageUrl(url) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="h-32 w-full rounded object-contain sm:h-14 sm:w-14 sm:object-cover" />
                ) : (
                  <div className="flex h-14 w-full items-center justify-center rounded bg-surface-raised text-lg sm:w-14">▶</div>
                )}
                <p className="min-w-0 flex-1 truncate text-xs text-ink-muted">{url}</p>
                <button type="button" className="min-h-9 text-left text-xs font-medium text-red-600 hover:text-red-700 sm:text-center" onClick={() => onRemove(url)}>
                  Remover
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function isImageUrl(url: string): boolean {
  return /\.(jpe?g|png|webp)(?:\?|#|$)/i.test(url);
}

function CheckboxLine({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4" />
      {label}
    </label>
  );
}

function RecentPublicationCard({ post, busy, onCancel }: { post: UnifiedPublication; busy: boolean; onCancel: () => void }) {
  const status = derivePublicationStatus(post);
  const platform = PLATFORMS.find((item) => item.id === post.network);
  const when = post.scheduledAt ? `${formatDateTime(post.scheduledAt)}${post.timezone ? ` (${post.timezone})` : ""}` : "Imediato";

  return (
    <Card className="p-3">
      <div className="mb-2 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{platform?.icon} {platform?.label ?? post.network}</p>
          <p className="mt-0.5 text-xs text-ink-muted">{when}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <p className="line-clamp-3 min-h-[3.75rem] break-words text-sm text-ink">{post.text || "Sem legenda"}</p>
      {status === "published" || status === "cancelled" ? null : (
        <Button variant="secondary" disabled={busy} onClick={onCancel} className="mt-3 w-full">Cancelar</Button>
      )}
    </Card>
  );
}
