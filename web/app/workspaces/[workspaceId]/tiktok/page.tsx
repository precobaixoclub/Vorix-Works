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
import { beginTikTokOAuth, cancelTikTokPost, disconnectTikTokAccount, scheduleTikTokPost } from "@/features/tiktok/api";
import { useTikTokOAuthStatus, useTikTokPosts } from "@/features/tiktok/hooks";
import type { TikTokPrivacyLevel } from "@/features/tiktok/types";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { formatDateTime } from "@/lib/format";

const PRIVACY_OPTIONS: readonly { value: TikTokPrivacyLevel; label: string }[] = [
  { value: "PUBLIC_TO_EVERYONE", label: "Público" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Amigos" },
  { value: "FOLLOWER_OF_CREATOR", label: "Seguidores" },
  { value: "SELF_ONLY", label: "Somente eu" },
];

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export default function TikTokPage() {
  const workspace = useCurrentWorkspace();
  const { data: oauth, mutate: mutateOAuth } = useTikTokOAuthStatus(workspace.id);
  const { data: posts, isLoading, error, mutate: mutatePosts } = useTikTokPosts(workspace.id);

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [mediaKind, setMediaKind] = useState<"video" | "photo">("video");
  const [videoUrl, setVideoUrl] = useState("");
  const [imageUrls, setImageUrls] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [privacyLevel, setPrivacyLevel] = useState<TikTokPrivacyLevel>("PUBLIC_TO_EVERYONE");
  const [credentialReferenceId, setCredentialReferenceId] = useState("");

  const accounts = oauth?.accounts ?? [];
  const connected = oauth?.connected ?? false;

  async function connectAccount() {
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await beginTikTokOAuth(workspace.id);
      // O callback do TikTok volta sem contexto de workspace — guardamos para retomar a página certa.
      window.sessionStorage.setItem("tiktok:return-workspace", workspace.id);
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
      await disconnectTikTokAccount(workspace.id, credentialId);
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
      const result = await scheduleTikTokPost({
        workspaceId: workspace.id,
        description,
        videoUrl: mediaKind === "video" ? videoUrl.trim() : undefined,
        imageUrls: mediaKind === "photo" ? images : undefined,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        timezone: scheduledAt ? timezone : undefined,
        privacyLevel,
        credentialReferenceId: credentialReferenceId || accounts[0]?.credentialReferenceId,
      });
      setFeedback(result.scheduledAt ? `Post agendado para ${formatDateTime(result.scheduledAt)}.` : "Post enviado para publicação.");
      setDescription("");
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
      await cancelTikTokPost(workspace.id, publicationId);
      await mutatePosts();
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader title="TikTok" description="Conecte a conta do cliente e agende publicações de vídeo ou foto com descrição." />

      {feedback ? <Card className="mb-6 p-4"><p className="text-sm text-ink">{feedback}</p></Card> : null}

      <Card className="mb-6 p-5">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">Conta conectada</p>
            <p className="text-xs text-ink-muted">
              {oauth?.configured === false
                ? "Integração ainda não configurada no servidor (TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET)."
                : connected
                  ? "As publicações deste workspace vão para a conta abaixo."
                  : "Nenhuma conta do TikTok conectada a este workspace."}
            </p>
          </div>
          <Button disabled={busy || oauth?.configured === false} onClick={connectAccount}>
            {connected ? "Conectar outra conta" : "Conectar conta do TikTok"}
          </Button>
        </div>

        {accounts.length === 0 ? null : (
          <div className="space-y-2">
            {accounts.map((account) => (
              <div key={account.credentialReferenceId} className="flex items-center justify-between gap-4 rounded border border-border px-3 py-2">
                <div>
                  <p className="text-sm text-ink">{account.displayName ?? account.openId}</p>
                  <p className="text-xs text-ink-muted">
                    {account.scopes.join(", ") || "sem escopos"}
                    {account.expiresAt ? ` · token expira em ${formatDateTime(account.expiresAt)}` : ""}
                  </p>
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
            <Button type="button" variant={mediaKind === "video" ? "primary" : "secondary"} onClick={() => setMediaKind("video")}>Vídeo</Button>
            <Button type="button" variant={mediaKind === "photo" ? "primary" : "secondary"} onClick={() => setMediaKind("photo")}>Foto</Button>
          </div>

          {mediaKind === "video" ? (
            <div>
              <Label htmlFor="tiktok-video-url">URL do vídeo (HTTPS pública)</Label>
              <Input id="tiktok-video-url" type="url" required value={videoUrl} placeholder="https://cdn.exemplo.com/video.mp4" onChange={(event) => setVideoUrl(event.target.value)} />
              <p className="mt-1 text-xs text-ink-muted">
                ou envie um arquivo:{" "}
                <input type="file" accept="video/mp4,video/quicktime" disabled={uploading} onChange={(event) => event.target.files?.[0] && uploadVideoFile(event.target.files[0])} />
                {uploading ? " enviando..." : ""}
              </p>
            </div>
          ) : (
            <div>
              <Label htmlFor="tiktok-image-urls">URLs das imagens (uma por linha)</Label>
              <Textarea id="tiktok-image-urls" required rows={3} value={imageUrls} placeholder={"https://cdn.exemplo.com/1.jpg\nhttps://cdn.exemplo.com/2.jpg"} onChange={(event) => setImageUrls(event.target.value)} />
              <p className="mt-1 text-xs text-ink-muted">
                ou envie um arquivo:{" "}
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => event.target.files?.[0] && uploadImageFile(event.target.files[0])} />
                {uploading ? " enviando..." : ""}
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="tiktok-description">Descrição</Label>
            <Textarea id="tiktok-description" required rows={4} maxLength={2200} value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="tiktok-scheduled-at">Agendar para (vazio publica agora)</Label>
              <Input id="tiktok-scheduled-at" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="tiktok-timezone">Fuso horário</Label>
              <Input id="tiktok-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="tiktok-privacy">Privacidade</Label>
              <select
                id="tiktok-privacy"
                className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={privacyLevel}
                onChange={(event) => setPrivacyLevel(event.target.value as TikTokPrivacyLevel)}
              >
                {PRIVACY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>

          {accounts.length > 1 ? (
            <div>
              <Label htmlFor="tiktok-account">Publicar na conta</Label>
              <select
                id="tiktok-account"
                className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink"
                value={credentialReferenceId || accounts[0].credentialReferenceId}
                onChange={(event) => setCredentialReferenceId(event.target.value)}
              >
                {accounts.map((account) => <option key={account.credentialReferenceId} value={account.credentialReferenceId}>{account.displayName ?? account.openId}</option>)}
              </select>
            </div>
          ) : null}

          <Button type="submit" disabled={busy || !connected}>{scheduledAt ? "Agendar publicação" : "Publicar agora"}</Button>
          {connected ? null : <p className="text-xs text-ink-muted">Conecte uma conta do TikTok para habilitar a publicação.</p>}
        </form>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-14"><Spinner /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutatePosts()} />
      ) : !posts || posts.length === 0 ? (
        <EmptyState title="Nenhuma publicação no TikTok" description="Agende o primeiro post usando o formulário acima." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-medium">Descrição</th>
                <th className="px-4 py-3 font-medium">Mídia</th>
                <th className="px-4 py-3 font-medium">Agendado</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.publicationId} className="border-b border-border last:border-0">
                  <td className="max-w-xs px-4 py-3 text-ink">{post.description || "—"}</td>
                  <td className="px-4 py-3 text-xs text-ink-muted">{post.media.videoUrl ? "Vídeo" : `${post.media.imageUrls.length} imagem(ns)`}</td>
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
