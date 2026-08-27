"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Textarea } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { cancelMetaPost, scheduleMetaPost } from "@/features/meta/api";
import { useMetaOAuthStatus, useMetaPosts } from "@/features/meta/hooks";
import type { MetaPost, MetaTarget } from "@/features/meta/types";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { formatDateTime } from "@/lib/format";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/**
 * Compartilhado por `/workspaces/[workspaceId]/instagram` e `.../facebook` — as duas telas usam o
 * mesmo fluxo OAuth (uma conexão do Meta resolve Instagram e Página juntos), só filtram pelo
 * `target` fixo da tela. Conectar/desconectar agora é só em `/connections`. Ver `docs/instagram-publishing.md`.
 */
export function MetaPostPage({ target }: { target: MetaTarget }) {
  const workspace = useCurrentWorkspace();
  const { data: oauth } = useMetaOAuthStatus(workspace.id);
  const { data: allPosts, isLoading, error, mutate: mutatePosts } = useMetaPosts(workspace.id);
  const posts = allPosts?.filter((post) => post.target === target);

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [placement, setPlacement] = useState<"feed" | "story">("feed");
  const [mediaKind, setMediaKind] = useState<"image" | "video" | "none">("image");
  const [videoUrl, setVideoUrl] = useState("");
  const [imageUrls, setImageUrls] = useState("");
  const [caption, setCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [credentialReferenceId, setCredentialReferenceId] = useState("");
  const [postToCancel, setPostToCancel] = useState<MetaPost | undefined>();

  const accounts = (oauth?.accounts ?? []).filter((account) => account.providerId === target);
  const connected = accounts.some((account) => account.status === "active");

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
      const result = await scheduleMetaPost({
        workspaceId: workspace.id,
        target,
        placement,
        caption,
        videoUrl: mediaKind === "video" ? videoUrl.trim() : undefined,
        imageUrls: mediaKind === "image" ? images : undefined,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        timezone: scheduledAt ? timezone : undefined,
        credentialReferenceId: credentialReferenceId || accounts[0]?.credentialReferenceId,
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

  async function confirmCancelPost() {
    if (!postToCancel) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      await cancelMetaPost(workspace.id, postToCancel.publicationId);
      await mutatePosts();
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
      setPostToCancel(undefined);
    }
  }

  const label = target === "instagram" ? "Instagram" : "Página do Facebook";

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title={target === "instagram" ? "Instagram" : "Facebook"}
        description={target === "instagram"
          ? "Conecte a conta do cliente e publique feed, carrossel, reels ou Stories no Instagram."
          : "Conecte a Página do Facebook do cliente e publique feed, foto, vídeo, texto ou Stories."}
      />

      <ScreenGuide
        title={`Publicar no ${label}`}
        description="Use esta tela para posts manuais. Para uma linha automática com sequência e horários, use Produção."
        items={[
          "Confira se a conta conectada é a correta.",
          "Escolha Feed ou Story.",
          "Envie imagem, carrossel, vídeo ou texto conforme a rede permitir.",
          "Defina data e hora ou deixe vazio para publicar agora.",
        ]}
        aside={<p>Quando houver várias contas conectadas, o seletor Publicar na conta define exatamente onde o post será enviado.</p>}
      />

      {feedback ? <Card className="mb-6 p-4"><p className="text-sm text-foreground">{feedback}</p></Card> : null}

      <Card className="mb-6 flex items-center justify-between gap-4 p-4">
        <p className="text-sm text-muted-foreground">
          {oauth?.configured === false
            ? "Integração ainda não configurada no servidor."
            : connected
              ? `Publicando na conta: ${accounts[0]?.displayName ?? accounts[0]?.providerSubjectId}${accounts.length > 1 ? ` (+${accounts.length - 1})` : ""}`
              : `Nenhuma conta do ${label} conectada a este workspace.`}
        </p>
        <Link href={`/workspaces/${workspace.id}/connections`} className="text-sm font-medium text-primary hover:underline">
          Gerenciar conexão →
        </Link>
      </Card>

      <Card className="mb-6 p-5">
        <p className="mb-4 text-sm font-medium text-foreground">Nova publicação</p>
        <form className="space-y-4" onSubmit={submitPost}>
          <div>
            <Label htmlFor="meta-placement">Onde publicar</Label>
            <ToggleGroup
              id="meta-placement"
              type="single"
              variant="outline"
              className="justify-start"
              value={placement}
              onValueChange={(value) => value && setPlacement(value as "feed" | "story")}
            >
              <ToggleGroupItem value="feed" className="px-4">Feed</ToggleGroupItem>
              <ToggleGroupItem value="story" className="px-4">Story</ToggleGroupItem>
            </ToggleGroup>
            {placement === "story" ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Story aceita só uma imagem ou um vídeo (sem carrossel, sem legenda exibida no Story).
                {target === "facebook" ? " Story de vídeo na Página ainda não é suportado — use foto." : ""}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="meta-media-kind">Tipo de mídia</Label>
            <ToggleGroup
              id="meta-media-kind"
              type="single"
              variant="outline"
              className="justify-start"
              value={mediaKind}
              onValueChange={(value) => value && setMediaKind(value as "image" | "video" | "none")}
            >
              <ToggleGroupItem value="image" className="px-4">Imagem{placement === "feed" ? (target === "instagram" ? "/carrossel" : "(ns)") : ""}</ToggleGroupItem>
              <ToggleGroupItem value="video" className="px-4">{placement === "feed" && target === "instagram" ? "Vídeo/Reels" : "Vídeo"}</ToggleGroupItem>
              {target === "facebook" && placement === "feed" ? (
                <ToggleGroupItem value="none" className="px-4">Somente texto</ToggleGroupItem>
              ) : null}
            </ToggleGroup>
          </div>

          {mediaKind === "video" ? (
            <div>
              <Label htmlFor="meta-video-url">URL do vídeo (HTTPS pública)</Label>
              <Input id="meta-video-url" type="url" required value={videoUrl} placeholder="https://cdn.exemplo.com/video.mp4" onChange={(event) => setVideoUrl(event.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">
                ou envie um arquivo:{" "}
                <input type="file" accept="video/mp4,video/quicktime" disabled={uploading} onChange={(event) => event.target.files?.[0] && uploadVideoFile(event.target.files[0])} />
                {uploading ? " enviando..." : ""}
              </p>
            </div>
          ) : mediaKind === "image" ? (
            <div>
              <Label htmlFor="meta-image-urls">{placement === "story" ? "URL da imagem" : "URLs das imagens (uma por linha — mais de uma vira carrossel/multi-foto)"}</Label>
              <Textarea id="meta-image-urls" required rows={placement === "story" ? 1 : 3} value={imageUrls} placeholder={placement === "story" ? "https://cdn.exemplo.com/1.jpg" : "https://cdn.exemplo.com/1.jpg\nhttps://cdn.exemplo.com/2.jpg"} onChange={(event) => setImageUrls(event.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">
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

          {accounts.length > 1 ? (
            <div>
              <Label htmlFor="meta-account">Publicar na conta</Label>
              <Select
                value={credentialReferenceId || accounts[0].credentialReferenceId}
                onValueChange={(value) => setCredentialReferenceId(value)}
              >
                <SelectTrigger id="meta-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.credentialReferenceId} value={account.credentialReferenceId}>
                      {account.displayName ?? account.providerSubjectId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <Button type="submit" disabled={busy || accounts.length === 0}>{scheduledAt ? "Agendar publicação" : "Publicar agora"}</Button>
          {accounts.length === 0 ? <p className="text-xs text-muted-foreground">Conecte uma conta do {label} para habilitar a publicação.</p> : null}
        </form>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-14"><Spinner /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutatePosts()} />
      ) : !posts || posts.length === 0 ? (
        <EmptyState title={`Nenhuma publicação no ${label}`} description="Agende o primeiro post usando o formulário acima." />
      ) : (
        <Card className="overflow-x-auto">
          <Table className="min-w-[680px]">
            <TableHeader>
              <TableRow>
                <TableHead>Onde</TableHead>
                <TableHead>Legenda</TableHead>
                <TableHead>Mídia</TableHead>
                <TableHead>Agendado</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((post) => (
                <TableRow key={post.publicationId}>
                  <TableCell className="text-xs text-muted-foreground">{post.placement === "story" ? "Story" : "Feed"}</TableCell>
                  <TableCell className="max-w-xs">{post.caption || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{post.media.videoUrl ? "Vídeo" : post.media.imageUrls.length > 0 ? `${post.media.imageUrls.length} imagem(ns)` : "Texto"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{post.scheduledAt ? `${formatDateTime(post.scheduledAt)}${post.timezone ? ` (${post.timezone})` : ""}` : "Imediato"}</TableCell>
                  <TableCell><StatusBadge status={post.state} /></TableCell>
                  <TableCell>
                    {post.state === "published" || post.state === "cancelled" ? null : (
                      <Button variant="secondary" disabled={busy} onClick={() => setPostToCancel(post)}>Cancelar</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(postToCancel)}
        title="Cancelar publicação"
        description={postToCancel ? `Tem certeza que deseja cancelar a publicação "${postToCancel.caption || "sem legenda"}" no ${label}? Esta ação não pode ser desfeita.` : ""}
        confirmLabel="Cancelar publicação"
        cancelLabel="Voltar"
        variant="danger"
        busy={busy}
        onConfirm={confirmCancelPost}
        onCancel={() => setPostToCancel(undefined)}
      />
    </main>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Não foi possível concluir a operação.";
}
