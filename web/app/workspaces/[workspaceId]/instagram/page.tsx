"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Textarea } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { beginMetaOAuth, cancelInstagramPost, disconnectMetaAccount, scheduleInstagramPost } from "@/features/instagram/api";
import { useMetaOAuthStatus, useInstagramPosts } from "@/features/instagram/hooks";
import type { MetaTarget } from "@/features/instagram/types";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { formatDateTime } from "@/lib/format";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export default function InstagramPage() {
  const workspace = useCurrentWorkspace();
  const { data: oauth, mutate: mutateOAuth } = useMetaOAuthStatus(workspace.id);
  const { data: posts, isLoading, error, mutate: mutatePosts } = useInstagramPosts(workspace.id);

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [target, setTarget] = useState<MetaTarget>("instagram");
  const [placement, setPlacement] = useState<"feed" | "story">("feed");
  const [mediaKind, setMediaKind] = useState<"image" | "video" | "none">("image");
  const [videoUrl, setVideoUrl] = useState("");
  const [imageUrls, setImageUrls] = useState("");
  const [caption, setCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [credentialReferenceId, setCredentialReferenceId] = useState("");

  const accounts = oauth?.accounts ?? [];
  const connected = oauth?.connected ?? false;
  const accountsForTarget = accounts.filter((account) => account.providerId === target);

  async function connectAccount() {
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await beginMetaOAuth(workspace.id);
      // O callback do Meta volta sem contexto de workspace — guardamos para retomar a página certa.
      window.sessionStorage.setItem("instagram:return-workspace", workspace.id);
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      setFeedback(messageOf(cause));
      setBusy(false);
    }
  }

  async function disconnectAccount(credentialId: string) {
    setBusy(true);
    setFeedback(undefined);
    try {
      await disconnectMetaAccount(workspace.id, credentialId);
      await mutateOAuth();
      setFeedback("Conta desconectada.");
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
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
    try {
      const images = imageUrls.split(/[\n,]/).map((url) => url.trim()).filter(Boolean);
      const result = await scheduleInstagramPost({
        workspaceId: workspace.id,
        target,
        placement,
        caption,
        videoUrl: mediaKind === "video" ? videoUrl.trim() : undefined,
        imageUrls: mediaKind === "image" ? images : undefined,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        timezone: scheduledAt ? timezone : undefined,
        credentialReferenceId: credentialReferenceId || accountsForTarget[0]?.credentialReferenceId,
      });
      setFeedback(result.scheduledAt ? `Post agendado para ${formatDateTime(result.scheduledAt)}.` : "Post enviado para publicação.");
      setCaption("");
      setVideoUrl("");
      setImageUrls("");
      setScheduledAt("");
      await mutatePosts();
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function cancelPost(publicationId: string) {
    setBusy(true);
    setFeedback(undefined);
    try {
      await cancelInstagramPost(workspace.id, publicationId);
      await mutatePosts();
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader title="Instagram" description="Conecte a conta do cliente (Instagram e/ou Página do Facebook) e publique feed, carrossel, reels ou posts na Página." />

      {feedback ? <Card className="mb-6 p-4"><p className="text-sm text-ink">{feedback}</p></Card> : null}

      <Card className="mb-6 p-5">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">Conta conectada</p>
            <p className="text-xs text-ink-muted">
              {oauth?.configured === false
                ? "Integração ainda não configurada no servidor (META_APP_ID/META_APP_SECRET/META_INSTAGRAM_ENABLED)."
                : connected
                  ? "As publicações deste workspace vão para as contas abaixo."
                  : "Nenhuma conta do Instagram/Facebook conectada a este workspace."}
            </p>
          </div>
          <Button disabled={busy || oauth?.configured === false} onClick={connectAccount}>
            {connected ? "Conectar outra conta" : "Conectar conta do Meta"}
          </Button>
        </div>

        {accounts.length === 0 ? null : (
          <div className="space-y-2">
            {accounts.map((account) => (
              <div key={account.credentialReferenceId} className="flex items-center justify-between gap-4 rounded border border-border px-3 py-2">
                <div>
                  <p className="text-sm text-ink">
                    <span className="mr-2 text-xs uppercase text-ink-muted">{account.providerId === "instagram" ? "Instagram" : "Página"}</span>
                    {account.displayName ?? account.providerSubjectId}
                  </p>
                  <p className="text-xs text-ink-muted">{account.scopes.join(", ") || "sem escopos"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={account.status} />
                  <Button variant="secondary" disabled={busy} onClick={() => disconnectAccount(account.credentialReferenceId)}>Desconectar</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mb-6 p-5">
        <p className="mb-4 text-sm font-medium text-ink">Nova publicação</p>
        <form className="space-y-4" onSubmit={submitPost}>
          <div className="flex gap-2">
            <Button type="button" variant={target === "instagram" ? "primary" : "secondary"} onClick={() => setTarget("instagram")}>Instagram</Button>
            <Button type="button" variant={target === "facebook" ? "primary" : "secondary"} onClick={() => setTarget("facebook")}>Página do Facebook</Button>
          </div>

          <div>
            <Label htmlFor="meta-placement">Onde publicar</Label>
            <div className="flex gap-2">
              <Button type="button" id="meta-placement" variant={placement === "feed" ? "primary" : "secondary"} onClick={() => setPlacement("feed")}>Feed</Button>
              <Button type="button" variant={placement === "story" ? "primary" : "secondary"} onClick={() => setPlacement("story")}>Story</Button>
            </div>
            {placement === "story" ? (
              <p className="mt-1 text-xs text-ink-muted">
                Story aceita só uma imagem ou um vídeo (sem carrossel, sem legenda exibida no Story).
                {target === "facebook" ? " Story de vídeo na Página ainda não é suportado — use foto." : ""}
              </p>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button type="button" variant={mediaKind === "image" ? "primary" : "secondary"} onClick={() => setMediaKind("image")}>Imagem{placement === "feed" ? "/carrossel" : ""}</Button>
            <Button type="button" variant={mediaKind === "video" ? "primary" : "secondary"} onClick={() => setMediaKind("video")}>{placement === "feed" ? "Vídeo/Reels" : "Vídeo"}</Button>
            {target === "facebook" && placement === "feed" ? (
              <Button type="button" variant={mediaKind === "none" ? "primary" : "secondary"} onClick={() => setMediaKind("none")}>Somente texto</Button>
            ) : null}
          </div>

          {mediaKind === "video" ? (
            <div>
              <Label htmlFor="meta-video-url">URL do vídeo (HTTPS pública)</Label>
              <Input id="meta-video-url" type="url" required value={videoUrl} placeholder="https://cdn.exemplo.com/video.mp4" onChange={(event) => setVideoUrl(event.target.value)} />
              <p className="mt-1 text-xs text-ink-muted">
                ou envie um arquivo:{" "}
                <input type="file" accept="video/mp4,video/quicktime" disabled={uploading} onChange={(event) => event.target.files?.[0] && uploadVideoFile(event.target.files[0])} />
                {uploading ? " enviando..." : ""}
              </p>
            </div>
          ) : mediaKind === "image" ? (
            <div>
              <Label htmlFor="meta-image-urls">{placement === "story" ? "URL da imagem" : "URLs das imagens (uma por linha — mais de uma vira carrossel)"}</Label>
              <Textarea id="meta-image-urls" required rows={placement === "story" ? 1 : 3} value={imageUrls} placeholder={placement === "story" ? "https://cdn.exemplo.com/1.jpg" : "https://cdn.exemplo.com/1.jpg\nhttps://cdn.exemplo.com/2.jpg"} onChange={(event) => setImageUrls(event.target.value)} />
              <p className="mt-1 text-xs text-ink-muted">
                ou envie um arquivo:{" "}
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => event.target.files?.[0] && uploadImageFile(event.target.files[0])} />
                {uploading ? " enviando..." : ""}
              </p>
            </div>
          ) : null}

          <div>
            <Label htmlFor="meta-caption">Legenda</Label>
            <Textarea id="meta-caption" required rows={4} maxLength={4000} value={caption} onChange={(event) => setCaption(event.target.value)} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="meta-scheduled-at">Agendar para (vazio publica agora)</Label>
              <Input id="meta-scheduled-at" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="meta-timezone">Fuso horário</Label>
              <Input id="meta-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
            </div>
          </div>

          {accountsForTarget.length > 1 ? (
            <div>
              <Label htmlFor="meta-account">Publicar na conta</Label>
              <select
                id="meta-account"
                className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={credentialReferenceId || accountsForTarget[0].credentialReferenceId}
                onChange={(event) => setCredentialReferenceId(event.target.value)}
              >
                {accountsForTarget.map((account) => <option key={account.credentialReferenceId} value={account.credentialReferenceId}>{account.displayName ?? account.providerSubjectId}</option>)}
              </select>
            </div>
          ) : null}

          <Button type="submit" disabled={busy || accountsForTarget.length === 0}>{scheduledAt ? "Agendar publicação" : "Publicar agora"}</Button>
          {accountsForTarget.length === 0 ? <p className="text-xs text-ink-muted">Conecte uma conta do {target === "instagram" ? "Instagram" : "Facebook"} para habilitar a publicação.</p> : null}
        </form>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-14"><Spinner /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutatePosts()} />
      ) : !posts || posts.length === 0 ? (
        <EmptyState title="Nenhuma publicação no Instagram/Facebook" description="Agende o primeiro post usando o formulário acima." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-medium">Destino</th>
                <th className="px-4 py-3 font-medium">Onde</th>
                <th className="px-4 py-3 font-medium">Legenda</th>
                <th className="px-4 py-3 font-medium">Mídia</th>
                <th className="px-4 py-3 font-medium">Agendado</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.publicationId} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-xs text-ink-muted">{post.target === "instagram" ? "Instagram" : "Página"}</td>
                  <td className="px-4 py-3 text-xs text-ink-muted">{post.placement === "story" ? "Story" : "Feed"}</td>
                  <td className="max-w-xs px-4 py-3 text-ink">{post.caption || "—"}</td>
                  <td className="px-4 py-3 text-xs text-ink-muted">{post.media.videoUrl ? "Vídeo" : post.media.imageUrls.length > 0 ? `${post.media.imageUrls.length} imagem(ns)` : "Texto"}</td>
                  <td className="px-4 py-3 text-xs text-ink-muted">{post.scheduledAt ? `${formatDateTime(post.scheduledAt)}${post.timezone ? ` (${post.timezone})` : ""}` : "Imediato"}</td>
                  <td className="px-4 py-3"><StatusBadge status={post.state} /></td>
                  <td className="px-4 py-3">
                    {post.state === "published" || post.state === "cancelled" ? null : (
                      <Button variant="secondary" disabled={busy} onClick={() => cancelPost(post.publicationId)}>Cancelar</Button>
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
