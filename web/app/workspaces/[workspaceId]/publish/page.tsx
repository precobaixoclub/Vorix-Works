"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Textarea } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { cancelTikTokPost, scheduleTikTokPost } from "@/features/tiktok/api";
import { useTikTokOAuthStatus, useTikTokPosts } from "@/features/tiktok/hooks";
import { cancelMetaPost, scheduleMetaPost } from "@/features/meta/api";
import { useMetaOAuthStatus, useMetaPosts } from "@/features/meta/hooks";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { formatDateTime } from "@/lib/format";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

type Platform = "tiktok" | "instagram" | "facebook";

const PLATFORMS: readonly { id: Platform; label: string; icon: string }[] = [
  { id: "tiktok", label: "TikTok", icon: "🎵" },
  { id: "instagram", label: "Instagram", icon: "📷" },
  { id: "facebook", label: "Facebook", icon: "👍" },
];

/** Linha normalizada pra combinar posts do TikTok e do Meta numa lista só. */
type UnifiedPost = {
  id: string;
  platform: Platform;
  placement: "feed" | "story";
  text: string;
  media: { videoUrl?: string; imageUrls: readonly string[] };
  scheduledAt?: string;
  timezone?: string;
  state: string;
  createdAt: string;
};

/**
 * Tela única de publicação: escolha o conteúdo, marque em quais redes vai publicar e agende —
 * cada rede recebe seu próprio post (mesmo conteúdo, adaptado às regras de cada uma). Pra ajustes
 * finos por rede (privacidade do TikTok, conta específica), use a tela dedicada de cada uma.
 */
export default function PublishPage() {
  const workspace = useCurrentWorkspace();
  const { data: tiktokOAuth } = useTikTokOAuthStatus(workspace.id);
  const { data: metaOAuth } = useMetaOAuthStatus(workspace.id);
  const { data: tiktokPosts, mutate: mutateTikTokPosts } = useTikTokPosts(workspace.id);
  const { data: metaPosts, isLoading: metaLoading, error: metaError, mutate: mutateMetaPosts } = useMetaPosts(workspace.id);

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [selected, setSelected] = useState<Set<Platform>>(new Set());
  const [placement, setPlacement] = useState<"feed" | "story">("feed");
  const [mediaKind, setMediaKind] = useState<"image" | "video">("image");
  const [videoUrl, setVideoUrl] = useState("");
  const [imageUrls, setImageUrls] = useState("");
  const [caption, setCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);

  const connectedByPlatform: Record<Platform, boolean> = {
    tiktok: tiktokOAuth?.connected ?? false,
    instagram: (metaOAuth?.accounts ?? []).some((a) => a.providerId === "instagram" && a.status === "active"),
    facebook: (metaOAuth?.accounts ?? []).some((a) => a.providerId === "facebook" && a.status === "active"),
  };
  const anyConnected = Object.values(connectedByPlatform).some(Boolean);
  const hasStoryUnsupported = selected.has("tiktok") && placement === "story";

  function togglePlatform(platform: Platform) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
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

  async function submitPost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(undefined);

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
        });
      }
      return scheduleMetaPost({
        workspaceId: workspace.id,
        target: platform.id as "instagram" | "facebook",
        placement,
        caption,
        videoUrl: mediaKind === "video" ? videoUrl.trim() : undefined,
        imageUrls: mediaKind === "image" ? images : undefined,
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
      setScheduledAt("");
      await Promise.all([mutateTikTokPosts(), mutateMetaPosts()]);
    }
    setBusy(false);
  }

  async function cancelPost(post: UnifiedPost) {
    setBusy(true);
    setFeedback(undefined);
    try {
      if (post.platform === "tiktok") await cancelTikTokPost(workspace.id, post.id);
      else await cancelMetaPost(workspace.id, post.id);
      await Promise.all([mutateTikTokPosts(), mutateMetaPosts()]);
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  const unified: UnifiedPost[] = [
    ...(tiktokPosts ?? []).map((post): UnifiedPost => ({
      id: post.publicationId,
      platform: "tiktok",
      placement: "feed",
      text: post.description,
      media: post.media,
      scheduledAt: post.scheduledAt,
      timezone: post.timezone,
      state: post.state,
      createdAt: post.createdAt,
    })),
    ...(metaPosts ?? []).map((post): UnifiedPost => ({
      id: post.publicationId,
      platform: post.target,
      placement: post.placement,
      text: post.caption,
      media: post.media,
      scheduledAt: post.scheduledAt,
      timezone: post.timezone,
      state: post.state,
      createdAt: post.createdAt,
    })),
  ].sort((a, b) => (b.scheduledAt ?? b.createdAt).localeCompare(a.scheduledAt ?? a.createdAt));

  const platformIcon: Record<Platform, string> = { tiktok: "🎵", instagram: "📷", facebook: "👍" };

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
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

      <Card className="mb-6 p-5">
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
            <Button type="button" variant={mediaKind === "image" ? "primary" : "secondary"} onClick={() => setMediaKind("image")}>Imagem/carrossel</Button>
            <Button type="button" variant={mediaKind === "video" ? "primary" : "secondary"} onClick={() => setMediaKind("video")}>Vídeo</Button>
          </div>

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

          <div>
            <Label htmlFor="publish-caption">Legenda/descrição</Label>
            <Textarea id="publish-caption" required rows={4} maxLength={2200} value={caption} onChange={(event) => setCaption(event.target.value)} />
          </div>

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

      {metaLoading ? (
        <div className="flex justify-center py-14"><Spinner /></div>
      ) : metaError ? (
        <ErrorState error={metaError} onRetry={() => mutateMetaPosts()} />
      ) : unified.length === 0 ? (
        <EmptyState title="Nenhuma publicação ainda" description="Publique o primeiro conteúdo usando o formulário acima." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-medium">Rede</th>
                <th className="px-4 py-3 font-medium">Onde</th>
                <th className="px-4 py-3 font-medium">Conteúdo</th>
                <th className="px-4 py-3 font-medium">Mídia</th>
                <th className="px-4 py-3 font-medium">Agendado</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {unified.map((post) => (
                <tr key={`${post.platform}-${post.id}`} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-xs text-ink-muted">{platformIcon[post.platform]} {post.platform === "tiktok" ? "TikTok" : post.platform === "instagram" ? "Instagram" : "Facebook"}</td>
                  <td className="px-4 py-3 text-xs text-ink-muted">{post.placement === "story" ? "Story" : "Feed"}</td>
                  <td className="max-w-xs px-4 py-3 text-ink">{post.text || "—"}</td>
                  <td className="px-4 py-3 text-xs text-ink-muted">{post.media.videoUrl ? "Vídeo" : post.media.imageUrls.length > 0 ? `${post.media.imageUrls.length} imagem(ns)` : "Texto"}</td>
                  <td className="px-4 py-3 text-xs text-ink-muted">{post.scheduledAt ? `${formatDateTime(post.scheduledAt)}${post.timezone ? ` (${post.timezone})` : ""}` : "Imediato"}</td>
                  <td className="px-4 py-3"><StatusBadge status={post.state} /></td>
                  <td className="px-4 py-3">
                    {post.state === "published" || post.state === "cancelled" ? null : (
                      <Button variant="secondary" disabled={busy} onClick={() => cancelPost(post)}>Cancelar</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Não foi possível concluir a operação.";
}
