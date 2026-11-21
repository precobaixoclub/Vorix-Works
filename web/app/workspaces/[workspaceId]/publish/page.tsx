"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Check, Clock3, Eye, ImageIcon, ImagePlus, Library, Loader2, Send, Sparkles, UsersRound, Video, Zap } from "lucide-react";
import { Input, Textarea } from "@/components/Field";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StudioMedia } from "@/features/publishing-studio/StudioMedia";
import { StudioPreview } from "@/features/publishing-studio/StudioPreview";
import styles from "@/features/publishing-studio/studio.module.css";
import { checkPublicationSubmission, type PublicationSubmissionResult } from "@/features/publishing-studio/submission-result";
import { zonedToUtc } from "@/features/social/presentation";
import { ChannelIcon } from "@/components/ChannelIcon";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { scheduleMetaPost } from "@/features/meta/api";
import { useMetaOAuthStatus, useMetaPosts } from "@/features/meta/hooks";
import { cancelUnifiedPublication } from "@/features/publication-history/api";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import { contentTypeOf, derivePublicationStatus, type UnifiedPublication } from "@/features/publication-history/types";
import { scheduleTikTokPost } from "@/features/tiktok/api";
import { useTikTokCreatorInfo, useTikTokOAuthStatus, useTikTokPosts } from "@/features/tiktok/hooks";
import { EMPTY_TIKTOK_OPTIONS, TikTokPostSettings, tiktokPostingBlocker } from "@/features/tiktok/TikTokPostSettings";
import { scheduleYouTubePost } from "@/features/youtube/api";
import { useYouTubeOAuthStatus, useYouTubePosts } from "@/features/youtube/hooks";
import type { YouTubePrivacyStatus } from "@/features/youtube/types";
import { formatDateTime } from "@/lib/format";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const TIMEZONE_OPTIONS = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Fortaleza",
  "America/Recife",
  "America/Cuiaba",
  "America/Rio_Branco",
  "UTC",
];

type Platform = "tiktok" | "instagram" | "facebook" | "youtube";
type MetaPlacement = "feed" | "story";
type PublishTiming = "now" | "schedule";

const PLATFORMS: readonly { id: Platform; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
  { id: "youtube", label: "YouTube Shorts" },
];

const META_PLACEMENTS: readonly { id: MetaPlacement; label: string }[] = [
  { id: "feed", label: "Feed" },
  { id: "story", label: "Story" },
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

  const [tiktokOptions, setTiktokOptions] = useState({ ...EMPTY_TIKTOK_OPTIONS });
  const [videoDuration, setVideoDuration] = useState<{ url: string; seconds?: number; error?: boolean }>();
  const [youtubePrivacy, setYouTubePrivacy] = useState<YouTubePrivacyStatus>("public");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewNetwork, setPreviewNetwork] = useState<Platform>("instagram");
  const [previewPlacement, setPreviewPlacement] = useState<MetaPlacement>("feed");
  const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);
  const [postPendingCancel, setPostPendingCancel] = useState<UnifiedPublication | undefined>();

  useEffect(() => {
    if (feedback) document.getElementById("publish-feedback")?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [feedback]);

  const connectedByPlatform: Record<Platform, boolean> = {
    tiktok: tiktokOAuth?.connected ?? false,
    instagram: (metaOAuth?.accounts ?? []).some((account) => account.providerId === "instagram" && account.status === "active"),
    facebook: (metaOAuth?.accounts ?? []).some((account) => account.providerId === "facebook" && account.status === "active"),
    youtube: youtubeOAuth?.connected ?? false,
  };

  const accountLabelByPlatform: Partial<Record<Platform, string>> = {
    tiktok: tiktokOAuth?.accounts.find((account) => account.status === "active")?.displayName,
    instagram: metaOAuth?.accounts.find((account) => account.providerId === "instagram" && account.status === "active")?.displayName,
    facebook: metaOAuth?.accounts.find((account) => account.providerId === "facebook" && account.status === "active")?.displayName,
    youtube: youtubeOAuth?.accounts.find((account) => account.status === "active")?.displayName,
  };

  const credentialReferenceByPlatform: Partial<Record<Platform, string>> = {
    tiktok: tiktokOAuth?.accounts.find((account) => account.status === "active")?.credentialReferenceId,
    instagram: metaOAuth?.accounts.find((account) => account.providerId === "instagram" && account.status === "active")?.credentialReferenceId,
    facebook: metaOAuth?.accounts.find((account) => account.providerId === "facebook" && account.status === "active")?.credentialReferenceId,
    youtube: youtubeOAuth?.accounts.find((account) => account.status === "active")?.credentialReferenceId,
  };
  const tiktokCredential = credentialReferenceByPlatform.tiktok;
  const { data: creatorInfo, error: creatorError, isValidating: creatorLoading, mutate: refreshCreator } = useTikTokCreatorInfo(workspace.id, tiktokCredential, selected.has("tiktok"));
  if (creatorInfo && !creatorError) accountLabelByPlatform.tiktok = creatorInfo.creatorNickname;

  useEffect(() => { setTiktokOptions({ ...EMPTY_TIKTOK_OPTIONS }); }, [workspace.id, tiktokCredential]);
  useEffect(() => {
    if (!creatorInfo) return;
    setTiktokOptions(current => ({ ...current,
      privacyLevel: creatorInfo.privacyLevelOptions.includes(current.privacyLevel as typeof creatorInfo.privacyLevelOptions[number]) ? current.privacyLevel : "",
      disableComment: current.disableComment || creatorInfo.commentDisabled,
      disableDuet: current.disableDuet || creatorInfo.duetDisabled,
      disableStitch: current.disableStitch || creatorInfo.stitchDisabled,
    }));
  }, [creatorInfo]);
  useEffect(() => { setTiktokOptions(current => ({ ...current, musicUsageAccepted: false })); }, [videoUrl, imageUrls, caption]);
  useEffect(() => {
    if (!videoUrl || mediaKind !== "video" || !selected.has("tiktok")) return;
    let cancelled = false;
    const video = document.createElement("video");
    const done = (seconds?: number) => { if (!cancelled) setVideoDuration({ url: videoUrl, seconds, error: !seconds }); };
    video.preload = "metadata";
    const timeout = window.setTimeout(() => done(), 20_000);
    video.onloadedmetadata = () => { clearTimeout(timeout); done(Number.isFinite(video.duration) ? video.duration : undefined); };
    video.onerror = () => { clearTimeout(timeout); done(); };
    video.src = videoUrl;
    return () => { cancelled = true; clearTimeout(timeout); video.onloadedmetadata = null; video.onerror = null; video.removeAttribute("src"); video.load(); };
  }, [videoUrl, mediaKind, selected.has("tiktok")]);
  const videoDurationSec = videoDuration?.url === videoUrl ? videoDuration.seconds : undefined;

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

  useEffect(() => {
    if (queryApplied || !unified) return;
    const params = new URLSearchParams(window.location.search);
    const network = params.get("network") as Platform | null;
    const source = params.get("source");
    const connectionStatus = { tiktok: tiktokOAuth, instagram: metaOAuth, facebook: metaOAuth, youtube: youtubeOAuth };
    // A cached content feed can arrive before OAuth status on client navigation. Wait before
    // consuming the query, or the original network will never become selected.
    if (network && PLATFORMS.some(platform => platform.id === network) && connectionStatus[network] === undefined) return;
    if (source) {
      const post = unified.find((item) => sourceKey(item) === source);
      if (post) applyContent(post);
    }
    if (network && PLATFORMS.some((platform) => platform.id === network) && connectedByPlatform[network]) {
      setSelected((current) => new Set([...current, network]));
      setPreviewNetwork(network);
    }
    setQueryApplied(true);
  }, [queryApplied, unified, connectedByPlatform, tiktokOAuth, metaOAuth, youtubeOAuth]);

  function applyContent(post: UnifiedPublication) {
    setFeedback(undefined);
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

  async function uploadImageFiles(files: readonly File[]) {
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

  async function submitPost() {
    if (busy || uploading || blocker) return;
    setFeedback(undefined);
    if (publishTiming === "schedule" && zonedToUtc(scheduledAt, timezone).getTime() <= Date.now()) {
      setFeedback({ tone: "error", message: "Escolha uma data e um horário no futuro." });
      return;
    }

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
    const scheduledAtIso = publishTiming === "schedule" && scheduledAt ? zonedToUtc(scheduledAt, timezone).toISOString() : undefined;
    const targets = PLATFORMS.filter((platform) => selected.has(platform.id));
    const skippedSummaries: string[] = [];
    const publicationTasks: { label: string; run: () => Promise<PublicationSubmissionResult> }[] = [];

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
            ...tiktokOptions,
            privacyLevel: tiktokOptions.privacyLevel || undefined,
            videoDurationSec: mediaKind === "video" ? videoDurationSec : undefined,
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

    const outcomes = await Promise.allSettled(publicationTasks.map(async (task) => checkPublicationSubmission(workspace.id, await task.run())));
    const summary = outcomes.map((outcome, index) => {
      const label = publicationTasks[index].label;
      if (outcome.status === "fulfilled") return `${label}: ${outcome.value.message}`;
      return `${label}: ${messageOf(outcome.reason)}`;
    }).concat(skippedSummaries).join(" · ");
    const fulfilledCount = outcomes.filter((outcome) => outcome.status === "fulfilled").length;
    const processing = outcomes.some((outcome) => outcome.status === "fulfilled" && outcome.value.status === "processing");
    const tone = fulfilledCount === 0 ? "error" : fulfilledCount === outcomes.length && skippedSummaries.length === 0 && !processing ? "success" : "warning";
    setFeedback({ tone, message: summary });

    if (fulfilledCount === outcomes.length && skippedSummaries.length === 0) {
      setCaption("");
      setVideoUrl("");
      setImageUrls("");
      setThumbnailUrl("");
      setScheduledAt("");
      setPublishTiming("now");
      setSelectedSourceId("");
    }
    await Promise.allSettled([mutateTikTokPosts(), mutateMetaPosts(), mutateYouTubePosts(), mutateUnified()]);
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

  async function inspectPostFailure(post: UnifiedPublication) {
    setBusy(true);
    try {
      await checkPublicationSubmission(workspace.id, { publicationId: post.id, state: post.state });
    } catch (cause) {
      setFeedback({ tone: "error", message: messageOf(cause) });
    } finally {
      setBusy(false);
    }
  }

  const library = useMemo(() => Array.from(new Map((unified ?? []).map((post) => [post.id, post])).values()), [unified]);
  const filteredLibrary = library.filter((post) => titleOf(post).toLocaleLowerCase("pt-BR").includes(librarySearch.toLocaleLowerCase("pt-BR")));
  const selectedPlatforms = PLATFORMS.filter((platform) => selected.has(platform.id));
  let scheduleDate: Date | undefined;
  try { if (scheduledAt) scheduleDate = zonedToUtc(scheduledAt, timezone); } catch { /* Invalid input is shown before submission. */ }
  const scheduleValid = publishTiming === "now" || Boolean(scheduleDate && Number.isFinite(scheduleDate.getTime()) && scheduleDate.getTime() > Date.now());
  const tiktokBlocker = creatorError ? messageOf(creatorError) : creatorLoading ? "Atualizando as permissões da conta TikTok…" : mediaKind === "video" && videoDuration?.url === videoUrl && videoDuration.error ? "Não foi possível verificar o vídeo. Envie o arquivo novamente." : tiktokPostingBlocker(tiktokOptions, creatorInfo, mediaKind === "video", videoDurationSec);
  const blocker = !hasMedia ? "Adicione uma imagem ou vídeo para começar." : selected.size === 0 ? "Selecione as contas que receberão o post." : !caption.trim() ? "Escreva a legenda da publicação." : youtubeNeedsVideo ? "YouTube Shorts precisa de um vídeo." : !scheduleValid ? "Escolha uma data e um horário no futuro." : selected.has("tiktok") ? tiktokBlocker : undefined;
  const canSubmit = !busy && !uploading && !blocker;
  const destinationLabel = selectedPlatforms.map((item) => item.label).join(", ");
  const previewProps = { network: previewNetwork, onNetworkChange: setPreviewNetwork, caption, images: previewPlacement === "story" && (previewNetwork === "instagram" || previewNetwork === "facebook") ? images.slice(0, 1) : images, videoUrl, thumbnailUrl, mediaKind, accountLabel: accountLabelByPlatform[previewNetwork] || workspace.name, placement: previewPlacement, onPlacementChange: setPreviewPlacement, showPlacements: feedSelected && storySelected };

  return (
    <main className={styles.studio}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}><Sparkles size={14} aria-hidden />Seu conteúdo vai mais longe</p>
          <h1 className={styles.heading}>Vamos publicar?</h1>
          <p className={styles.subtitle}>Uma ideia. Suas redes. Tudo no lugar.</p>
        </div>
        <nav className={styles.headerActions} aria-label="Atalhos de publicação">
          <Link className={styles.quietButton} href={`/workspaces/${workspace.id}/campaigns`}><Library aria-hidden />Conteúdos</Link>
          <Link className={styles.quietButton} href={`/workspaces/${workspace.id}/calendar`}><CalendarDays aria-hidden />Calendário</Link>
          <button type="button" className={`${styles.quietButton} ${styles.mobilePreview}`} onClick={() => setPreviewOpen(true)}><Eye aria-hidden />Prévia</button>
        </nav>
      </header>

      {feedback ? <div id="publish-feedback" role={feedback.tone === "error" ? "alert" : "status"} className={styles.feedback} data-tone={feedback.tone}>{feedback.message}</div> : null}

      <form onSubmit={(event) => { event.preventDefault(); if (canSubmit) setConfirmPublishOpen(true); }} aria-label="Criar publicação">
        <div className={styles.workbench}>
          <div className={styles.editor}>
            <section className={`${styles.panel} ${styles.panelBody}`} aria-labelledby="publish-accounts-heading">
              <div className={styles.sectionHead}><h2 id="publish-accounts-heading" className={styles.sectionTitle}><UsersRound aria-hidden />Onde vamos publicar?</h2><span className={styles.sectionNote}>{selected.size > 0 ? `${selected.size} ${selected.size === 1 ? "rede selecionada" : "redes selecionadas"}` : "Selecione suas contas"}</span></div>
              <div className={styles.accountGrid}>
                {PLATFORMS.map((platform) => <div key={platform.id} className={styles.account} data-selected={selected.has(platform.id)}>
                  <button type="button" role="checkbox" aria-checked={selected.has(platform.id)} aria-label={`Selecionar ${platform.label}`} disabled={!connectedByPlatform[platform.id] || busy} className={styles.accountButton} onClick={() => { togglePlatform(platform.id); setPreviewNetwork(platform.id); }}>
                    <span className={styles.accountIcon}><ChannelIcon channel={platform.id} /></span>
                    <span className={styles.accountCopy}><span className={styles.accountName}>{platform.label}</span><span className={styles.accountLabel}>{connectedByPlatform[platform.id] ? accountLabelByPlatform[platform.id] || "Conta conectada" : "Conta não conectada"}</span></span>
                    <span className={styles.check} aria-hidden>{selected.has(platform.id) ? <Check /> : null}</span>
                  </button>
                  {!connectedByPlatform[platform.id] ? <Link href={`/workspaces/${workspace.id}/social/integrations`} className={styles.connect}>Conectar conta</Link> : null}
                </div>)}
              </div>
              {hasMetaSelection ? <div className={styles.placement}><span>Publicar no</span><div className={styles.segmented}>{META_PLACEMENTS.map((item) => <button key={item.id} type="button" aria-pressed={metaPlacements.has(item.id)} disabled={busy} onClick={() => { const next = new Set(metaPlacements); if (next.has(item.id) && next.size > 1) next.delete(item.id); else next.add(item.id); setMetaPlacements(next); setPreviewPlacement(next.has(item.id) ? item.id : [...next][0]); }}>{item.label === "Story" ? "Stories" : item.label}</button>)}</div></div> : null}
              {hasStoryUnsupported ? <p className={`${styles.helper} mt-3`}>Stories serão enviados ao Instagram e Facebook. TikTok e YouTube recebem uma publicação normal.</p> : null}
            </section>

            <section className={`${styles.panel} ${styles.panelBody}`} aria-labelledby="publish-content-heading">
              <div className={styles.sectionHead}><h2 id="publish-content-heading" className={styles.sectionTitle}><ImagePlus aria-hidden />O que vamos compartilhar?</h2><button type="button" disabled={busy || uploading} className={styles.textButton} onClick={() => setLibraryOpen(true)}>Escolher da biblioteca</button></div>
              <div className={styles.mediaTabs}>
                <div className={styles.segmented} aria-label="Tipo de conteúdo"><button type="button" aria-pressed={mediaKind === "image"} disabled={selected.has("youtube") || busy || uploading} onClick={() => setMediaKind("image")}><ImageIcon aria-hidden />Imagem</button><button type="button" aria-pressed={mediaKind === "video"} disabled={busy || uploading} onClick={() => setMediaKind("video")}><Video aria-hidden />Vídeo</button></div>
                <span className={styles.sectionNote}>{selectedSource ? "Conteúdo da biblioteca" : mediaKind === "image" && images.length > 1 ? "Carrossel" : "Novo conteúdo"}</span>
              </div>
              {mediaKind === "image" ? <StudioMedia kind="image" urls={images} uploading={uploading || busy} onPick={uploadImageFiles} onRemove={(index) => { setImageUrls(images.filter((_, itemIndex) => itemIndex !== index).join("\n")); setSelectedSourceId(""); }} /> : <StudioMedia kind="video" urls={videoUrl ? [videoUrl] : []} uploading={uploading || busy} onPick={(files) => { if (files[0]) void uploadVideoFile(files[0]); }} onRemove={() => { setVideoUrl(""); setSelectedSourceId(""); }} />}
              {mediaKind === "video" ? <details className="mt-4"><summary className="cursor-pointer text-sm text-muted-foreground">Personalizar a capa do vídeo</summary><div className="mt-3"><StudioMedia kind="image" cover urls={thumbnailUrl ? [thumbnailUrl] : []} uploading={uploading || busy} onPick={(files) => { if (files[0]) void uploadThumbnailFile(files[0]); }} onRemove={() => setThumbnailUrl("")} /></div></details> : null}
              {!hasMedia && mostRecent ? <div className={styles.reuse}><ContentThumb post={mostRecent} /><div className={styles.reuseCopy}><span className={styles.sectionNote}>Continuar com seu último conteúdo</span><p>{titleOf(mostRecent)}</p></div><button type="button" className={styles.textButton} disabled={busy || uploading} onClick={() => applyContent(mostRecent)}>Usar</button></div> : null}
              {selected.has("youtube") ? <p className={`${styles.helper} mt-3`}>Para Shorts, use um vídeo vertical ou quadrado de até 3 minutos.</p> : null}
              <div className={styles.captionArea}>
                <div className={styles.labelRow}><label htmlFor="publish-caption" className="text-sm font-semibold">A legenda que acompanha</label><span className={styles.sectionNote}>{caption.length.toLocaleString("pt-BR")} / 2.200</span></div>
                <Textarea id="publish-caption" className={styles.captionInput} required rows={5} maxLength={2200} disabled={busy} value={caption} placeholder="Conte a história por trás do seu conteúdo…" onChange={(event) => setCaption(event.target.value)} />
                <div className={styles.captionBottom}><p className={styles.helper}>A mesma legenda nas redes selecionadas.</p><span className="text-sm text-muted-foreground" aria-hidden>#</span></div>
              </div>
            </section>

            <section className={`${styles.panel} ${styles.panelBody}`} aria-labelledby="publish-timing-heading">
              <div className={styles.sectionHead}><h2 id="publish-timing-heading" className={styles.sectionTitle}><Clock3 aria-hidden />O momento certo</h2><span className={styles.sectionNote}>Você decide quando</span></div>
              <div className={styles.timingGrid}>
                <button type="button" className={styles.timing} aria-pressed={publishTiming === "now"} disabled={busy} onClick={() => { setPublishTiming("now"); setScheduledAt(""); }}><Zap aria-hidden /><span><strong>Publicar agora</strong><small>Pronto? Envie para suas redes.</small></span></button>
                <button type="button" className={styles.timing} aria-pressed={publishTiming === "schedule"} disabled={busy} onClick={() => setPublishTiming("schedule")}><CalendarDays aria-hidden /><span><strong>Agendar</strong><small>Escolha o melhor dia e horário.</small></span></button>
              </div>
              {publishTiming === "schedule" ? <div className={styles.scheduleFields}>
                <div><label htmlFor="publish-scheduled-at" className={styles.label}>Data e horário</label><Input id="publish-scheduled-at" type="datetime-local" required disabled={busy} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></div>
                <div><label htmlFor="publish-timezone" className={styles.label}>Fuso horário</label><Select value={timezone} onValueChange={setTimezone} disabled={busy}><SelectTrigger id="publish-timezone"><SelectValue /></SelectTrigger><SelectContent>{TIMEZONE_OPTIONS.map((value) => <SelectItem key={value} value={value}>{value === "America/Sao_Paulo" ? "Brasília (São Paulo)" : value.replace("America/", "").replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div>
              </div> : null}
              {selected.has("tiktok") ? <TikTokPostSettings value={tiktokOptions} onChange={setTiktokOptions} creator={creatorInfo} loading={creatorLoading} error={creatorError ? messageOf(creatorError) : undefined} retry={() => { void refreshCreator(); }} video={mediaKind === "video"} duration={videoDurationSec} busy={busy} /> : null}
              {selected.has("youtube") ? <div className={styles.networkSettings}><p className={styles.settingsTitle}>Opções do YouTube Shorts</p><label htmlFor="youtube-privacy" className={styles.label}>Visibilidade</label><Select value={youtubePrivacy} onValueChange={(value) => setYouTubePrivacy(value as YouTubePrivacyStatus)} disabled={busy}><SelectTrigger id="youtube-privacy"><SelectValue /></SelectTrigger><SelectContent>{YOUTUBE_PRIVACY_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div> : null}
            </section>
          </div>

          <aside className={styles.aside} aria-label="Prévia e atividade">
            <StudioPreview {...previewProps} />
            <section className={`${styles.panel} ${styles.recent}`}>
              <div className={styles.sectionHead}><h2 className="text-sm font-semibold">Últimas publicações</h2><Link href={`/workspaces/${workspace.id}/campaigns`} className={styles.textButton}>Ver todas</Link></div>
              {recentPublications.length === 0 ? <p className={styles.helper}>Seus próximos posts começam aqui.</p> : recentPublications.slice(0, 2).map((post) => <div key={sourceKey(post)} className={styles.recentItem}><ContentThumb post={post} /><div className={styles.recentCopy}><p>{titleOf(post)}</p><small>{formatDateTime(post.publishedAt ?? post.scheduledAt ?? post.createdAt)}</small></div><div className="flex shrink-0 flex-col items-end gap-2"><StatusBadge status={derivePublicationStatus(post)} />{derivePublicationStatus(post) === "failed" ? <button type="button" disabled={busy} className="text-xs font-medium text-primary" onClick={() => void inspectPostFailure(post)}>Ver motivo</button> : null}{derivePublicationStatus(post) === "scheduled" ? <button type="button" disabled={busy} className="text-xs text-muted-foreground" onClick={() => setPostPendingCancel(post)}>Cancelar</button> : null}</div></div>)}
            </section>
          </aside>
        </div>

        <footer className={styles.actionBar}>
          <div className={styles.actionSummary}><strong>{busy ? "Preparando sua publicação…" : uploading ? "Enviando seus arquivos…" : blocker ? "Seu próximo post começa aqui" : publishTiming === "schedule" ? "Tudo pronto para agendar" : "Tudo pronto para publicar"}</strong><small role="status">{busy ? "Aguarde a confirmação de envio." : uploading ? "Aguarde o upload terminar." : blocker || `${selected.size} ${selected.size === 1 ? "rede" : "redes"} · ${destinationLabel}`}</small></div>
          <button type="submit" className={styles.primaryButton} disabled={!canSubmit}>{busy || uploading ? <Loader2 className={styles.spin} aria-hidden /> : publishTiming === "schedule" ? <CalendarDays aria-hidden /> : <Send aria-hidden />}{busy ? "Enviando…" : publishTiming === "schedule" ? "Agendar publicação" : "Publicar agora"}</button>
        </footer>
      </form>

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}><DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-2xl"><DialogHeader><DialogTitle>Escolha seu conteúdo</DialogTitle><DialogDescription>Reutilize uma publicação e ajuste o que quiser antes de enviar.</DialogDescription></DialogHeader><Input aria-label="Buscar na biblioteca" placeholder="Buscar por título ou legenda…" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} /><div className={styles.libraryGrid}>{filteredLibrary.map((post) => <button key={post.id} type="button" className={styles.libraryItem} onClick={() => { applyContent(post); setLibraryOpen(false); }}><span className={styles.libraryArt}>{post.media.imageUrls[0] || post.media.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.media.imageUrls[0] || post.media.thumbnailUrl} alt="" />
      ) : <Video className="text-muted-foreground" />}<span className="sr-only">Usar conteúdo: </span></span><strong>{titleOf(post)}</strong><small>{formatDateTime(post.createdAt)}</small></button>)}</div>{filteredLibrary.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{unified === undefined ? "Carregando sua biblioteca…" : "Nenhum conteúdo encontrado."}</p> : null}</DialogContent></Dialog>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}><DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl p-0"><DialogHeader className="sr-only"><DialogTitle>Prévia da publicação</DialogTitle><DialogDescription>Confira o conteúdo na rede selecionada.</DialogDescription></DialogHeader><StudioPreview {...previewProps} /></DialogContent></Dialog>
      <ConfirmDialog open={confirmPublishOpen} title={publishTiming === "schedule" ? "Agendar esta publicação?" : "Publicar este conteúdo?"} description={`${publishTiming === "schedule" && scheduleDate ? `Agendamento para ${new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(scheduleDate)} (${timezone}).` : "O envio começa assim que você confirmar."} Contas: ${selectedPlatforms.map((platform) => `${platform.label} (${accountLabelByPlatform[platform.id] || "conta conectada"})`).join(", ")}.`} confirmLabel={publishTiming === "schedule" ? "Confirmar agendamento" : "Confirmar publicação"} cancelLabel="Continuar editando" busy={busy} onConfirm={() => { setConfirmPublishOpen(false); void submitPost(); }} onCancel={() => setConfirmPublishOpen(false)} />
      <ConfirmDialog open={Boolean(postPendingCancel)} title="Cancelar publicação" description={postPendingCancel ? `Cancelar a publicação “${titleOf(postPendingCancel)}”?` : ""} confirmLabel="Cancelar publicação" cancelLabel="Voltar" variant="danger" busy={busy} onConfirm={confirmCancelPost} onCancel={() => setPostPendingCancel(undefined)} />
    </main>
  );
}

function ContentThumb({ post }: { post: UnifiedPublication }) {
  const image = post.media.imageUrls[0] || post.media.thumbnailUrl;
  return <span className={styles.thumb}>{image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image} alt="" />
  ) : <Video size={18} />}</span>;
}

function sourceKey(post: UnifiedPublication): string { return `${post.network}:${post.id}`; }
function titleOf(post: UnifiedPublication): string { return post.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 120) || "Publicação sem legenda"; }
function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : "Não foi possível concluir a operação."; }
