"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input, Label, Textarea } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { PostPreview } from "@/components/PostPreview";
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

const PLATFORMS: readonly { id: Platform; label: string; icon: string }[] = [
  { id: "tiktok", label: "TikTok", icon: "🎵" },
  { id: "instagram", label: "Instagram", icon: "📷" },
  { id: "facebook", label: "Facebook", icon: "👍" },
  { id: "youtube", label: "YouTube Shorts", icon: "▶" },
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
  const [placement, setPlacement] = useState<"feed" | "story">("feed");
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
  const anyConnected = Object.values(connectedByPlatform).some(Boolean);
  const hasStoryUnsupported = selected.has("tiktok") && placement === "story";
  const youtubeNeedsVideo = selected.has("youtube") && mediaKind !== "video";

  function togglePlatform(platform: Platform) {
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
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setUploading(false);
    }
  }

  async function uploadImageFile(file: File) {
    setUploading(true);
    setFeedback(undefined);
    try {
      const uploaded = await uploadPublicationMedia(workspace.id, file);
      setImageUrls((current) => (current.trim() ? `${current.trim()}\n${uploaded.url}` : uploaded.url));
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

    if (youtubeNeedsVideo) {
      setFeedback("YouTube Shorts só publica vídeo — desmarque YouTube ou troque a mídia para Vídeo.");
      return;
    }

    setBusy(true);
    const images = imageUrls.split(/[\n,]/).map((url) => url.trim()).filter(Boolean);
    const scheduledAtIso = scheduledAt ? new Date(scheduledAt).toISOString() : undefined;
    const targets = PLATFORMS.filter((platform) => selected.has(platform.id));

    const outcomes = await Promise.allSettled(targets.map((platform) => {
      if (platform.id === "tiktok") {
        return scheduleTikTokPost({
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
        });
      }
      if (platform.id === "youtube") {
        return scheduleYouTubePost({
          workspaceId: workspace.id,
          title: caption.split(/\r?\n/).find((line) => line.trim())?.slice(0, 100) || "Short",
          description: caption,
          videoUrl: videoUrl.trim(),
          scheduledAt: scheduledAtIso,
          timezone: scheduledAtIso ? timezone : undefined,
          privacyStatus: youtubePrivacy,
          tags: ["Shorts"],
        });
      }
      return scheduleMetaPost({
        workspaceId: workspace.id,
        target: platform.id as "instagram" | "facebook",
        placement,
        caption,
        videoUrl: mediaKind === "video" ? videoUrl.trim() : undefined,
        imageUrls: mediaKind === "image" ? images : undefined,
        thumbnailUrl: thumbnailUrl.trim() || undefined,
        scheduledAt: scheduledAtIso,
        timezone: scheduledAtIso ? timezone : undefined,
      });
    }));

    const summary = outcomes.map((outcome, index) => {
      const platform = targets[index].label;
      if (outcome.status === "fulfilled") return `${platform}: ok`;
      return `${platform}: ${messageOf(outcome.reason)}`;
    }).join(" · ");
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
    <main className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader title="Publicar" description="Envie o conteúdo, marque em quais redes vai publicar e agende data e horário." />

      {feedback ? <Card className="mb-6 p-4"><p className="text-sm text-ink">{feedback}</p></Card> : null}

      {!anyConnected ? (
        <Card className="mb-6 p-4">
          <p className="text-sm text-ink">
            Nenhuma rede social conectada ainda.{" "}
            <Link href={`/workspaces/${workspace.id}/connections`} className="font-medium text-accent hover:underline">Conectar uma conta →</Link>
          </p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px]">
        <Card className="p-5">
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
                    onClick={() => togglePlatform(platform.id)}
                    title={connectedByPlatform[platform.id] ? undefined : "Conecte esta conta em Conexões primeiro"}
                  >
                    {platform.icon} {platform.label}{connectedByPlatform[platform.id] ? "" : " (desconectado)"}
                  </Button>
                ))}
              </div>
            </div>

            {selected.has("instagram") || selected.has("facebook") ? (
              <div>
                <Label htmlFor="publish-placement">Feed ou Story (Instagram/Facebook)</Label>
                <div id="publish-placement" className="flex gap-2">
                  <Button type="button" variant={placement === "feed" ? "primary" : "secondary"} onClick={() => setPlacement("feed")}>Feed</Button>
                  <Button type="button" variant={placement === "story" ? "primary" : "secondary"} onClick={() => setPlacement("story")}>Story</Button>
                </div>
                {placement === "story" ? (
                  <p className="mt-1 text-xs text-ink-muted">
                    Story aceita só uma imagem ou um vídeo, sem carrossel e sem legenda visível.
                    {selected.has("facebook") ? " Story de vídeo no Facebook ainda não é suportado — use foto." : ""}
                  </p>
                ) : null}
                {hasStoryUnsupported ? <p className="mt-1 text-xs text-ink-muted">TikTok não tem Story — o post do TikTok sempre vai pro feed.</p> : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button type="button" variant={mediaKind === "image" ? "primary" : "secondary"} disabled={selected.has("youtube")} onClick={() => setMediaKind("image")}>Imagem/carrossel</Button>
              <Button type="button" variant={mediaKind === "video" ? "primary" : "secondary"} onClick={() => setMediaKind("video")}>Vídeo</Button>
            </div>
            {selected.has("youtube") ? <p className="-mt-2 text-xs text-ink-muted">YouTube Shorts só publica vídeo. Use vídeo vertical curto para o YouTube reconhecer como Short.</p> : null}

            {mediaKind === "video" ? (
              <div>
                <Label htmlFor="publish-video-url">URL do vídeo (HTTPS pública)</Label>
                <Input id="publish-video-url" type="url" required value={videoUrl} placeholder="https://cdn.exemplo.com/video.mp4" onChange={(event) => setVideoUrl(event.target.value)} />
                <p className="mt-1 text-xs text-ink-muted">
                  ou envie um arquivo:{" "}
                  <input type="file" accept="video/mp4,video/quicktime" disabled={uploading} onChange={(event) => event.target.files?.[0] && uploadVideoFile(event.target.files[0])} />
                  {uploading ? " enviando..." : ""}
                </p>
              </div>
            ) : (
              <div>
                <Label htmlFor="publish-image-urls">URLs das imagens (uma por linha)</Label>
                <Textarea id="publish-image-urls" required rows={3} value={imageUrls} placeholder={"https://cdn.exemplo.com/1.jpg\nhttps://cdn.exemplo.com/2.jpg"} onChange={(event) => setImageUrls(event.target.value)} />
                <p className="mt-1 text-xs text-ink-muted">
                  ou envie um arquivo:{" "}
                  <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => event.target.files?.[0] && uploadImageFile(event.target.files[0])} />
                  {uploading ? " enviando..." : ""}
                </p>
              </div>
            )}

            {mediaKind === "video" ? (
              <div>
                <Label htmlFor="publish-thumbnail-url">Capa do vídeo (JPG) — opcional</Label>
                <Input id="publish-thumbnail-url" type="url" value={thumbnailUrl} placeholder="https://cdn.exemplo.com/capa.jpg" onChange={(event) => setThumbnailUrl(event.target.value)} />
                <p className="mt-1 text-xs text-ink-muted">
                  ou envie um arquivo:{" "}
                  <input type="file" accept="image/jpeg" disabled={uploading} onChange={(event) => event.target.files?.[0] && uploadThumbnailFile(event.target.files[0])} />
                  {uploading ? " enviando..." : ""}
                </p>
              </div>
            ) : null}

            <div>
              <Label htmlFor="publish-caption">Legenda/descrição</Label>
              <Textarea id="publish-caption" required rows={4} maxLength={2200} value={caption} onChange={(event) => setCaption(event.target.value)} />
            </div>

            {selected.has("tiktok") ? (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Opções do TikTok</p>
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
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={tiktokAutoAddMusic} onChange={(e) => setTiktokAutoAddMusic(e.target.checked)} className="h-4 w-4" />
                      Adicionar música automaticamente
                    </label>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={tiktokDisableComment} onChange={(e) => setTiktokDisableComment(e.target.checked)} className="h-4 w-4" />
                      Desativar comentários
                    </label>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={tiktokDisableDuet} onChange={(e) => setTiktokDisableDuet(e.target.checked)} className="h-4 w-4" />
                      Desativar Duet
                    </label>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={tiktokDisableStitch} onChange={(e) => setTiktokDisableStitch(e.target.checked)} className="h-4 w-4" />
                      Desativar Stitch
                    </label>
                  </div>
                </div>
              </div>
            ) : null}

            {selected.has("youtube") ? (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Opções do YouTube</p>
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

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="publish-scheduled-at">Agendar para (vazio publica agora)</Label>
                <Input id="publish-scheduled-at" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
              </div>
              <div>
                <Label htmlFor="publish-timezone">Fuso horário</Label>
                <Input id="publish-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
              </div>
            </div>

            <Button type="submit" disabled={busy || selected.size === 0}>{scheduledAt ? "Agendar publicação" : "Publicar agora"}</Button>
            {selected.size === 0 ? <p className="text-xs text-ink-muted">Marque ao menos uma rede social conectada para publicar.</p> : null}
          </form>
        </Card>

        <div className="flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Prévia</p>
          {selected.size === 0 ? (
            <p className="text-sm text-ink-muted">Marque uma rede social pra ver como o post vai ficar.</p>
          ) : (
            <div className="flex flex-col gap-6">
              {PLATFORMS.filter((platform) => selected.has(platform.id)).map((platform) => (
                <PostPreview
                  key={platform.id}
                  network={platform.id}
                  placement={platform.id === "tiktok" || platform.id === "youtube" ? "feed" : placement}
                  caption={caption}
                  mediaKind={mediaKind}
                  imageUrls={images}
                  videoUrl={videoUrl.trim() || undefined}
                  thumbnailUrl={thumbnailUrl.trim() || undefined}
                  autoAddMusic={platform.id === "tiktok" ? tiktokAutoAddMusic : undefined}
                  accountLabel={accountLabelByPlatform[platform.id]}
                />
              ))}
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
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 font-medium">Rede</th>
                  <th className="px-4 py-3 font-medium">Conteúdo</th>
                  <th className="px-4 py-3 font-medium">Agendado</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((post) => {
                  const status = derivePublicationStatus(post);
                  return (
                    <tr key={`${post.network}-${post.id}`} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-xs text-ink-muted">{PLATFORMS.find((p) => p.id === post.network)?.icon} {PLATFORMS.find((p) => p.id === post.network)?.label}</td>
                      <td className="max-w-xs px-4 py-3 text-ink">{post.text || "—"}</td>
                      <td className="px-4 py-3 text-xs text-ink-muted">{post.scheduledAt ? `${formatDateTime(post.scheduledAt)}${post.timezone ? ` (${post.timezone})` : ""}` : "Imediato"}</td>
                      <td className="px-4 py-3"><StatusBadge status={status} /></td>
                      <td className="px-4 py-3">
                        {status === "published" || status === "cancelled" ? null : (
                          <Button variant="secondary" disabled={busy} onClick={() => cancelPost(post)}>Cancelar</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </main>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Não foi possível concluir a operação.";
}
