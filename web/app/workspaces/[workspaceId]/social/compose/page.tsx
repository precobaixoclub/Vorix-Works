"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ImagePlus, Library, Send, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Select, SelectItem, Textarea } from "@/components/Field";
import { GuardedButton } from "@/components/GuardedButton";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useAssets } from "@/features/assets/hooks";
import { useMyAccess } from "@/features/auth/access";
import { uploadPublicationMedia } from "@/features/media-upload/api";
import { createSocialPost, validateSocialPost } from "@/features/social/api";
import { AccountAvatar, NetworkMark } from "@/features/social/components";
import { useComposerOptions, useSocialSettings } from "@/features/social/hooks";
import { readMediaMetadata } from "@/features/social/media";
import {
  accountName,
  ACTION_PERMISSION,
  buildComposeRequest,
  compatibleFormats,
  composerBlockers,
  defaultFormat,
  formatSupportsCaption,
  localInputsIn,
  NETWORK_LABEL,
  networkChoices,
  previewAspect,
  splitHashtags,
  type ComposerDraft,
} from "@/features/social/presentation";
import type { SocialComposerAccount, SocialDestinationCheck, SocialMediaItem, SocialPostFormat } from "@/features/social/types";
import { cn } from "@/lib/utils";

/** Marketing → Criar publicação: uma tela, várias redes, cada destino independente. */
export default function SocialComposePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[480px] w-full rounded-xl" />}>
      <SocialComposer />
    </Suspense>
  );
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function SocialComposer() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useMyAccess();
  const options = useComposerOptions(workspace.id);
  const timezone = useSocialSettings(workspace.id).data?.timezone ?? "America/Sao_Paulo";
  const [draft, setDraft] = useState<ComposerDraft>(() => ({ caption: "", hashtags: "", media: [], destinations: [], when: { mode: "now" } }));
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [checks, setChecks] = useState<SocialDestinationCheck[]>([]);
  const [warningsToConfirm, setWarningsToConfirm] = useState<string[] | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | undefined>();
  const fileInput = useRef<HTMLInputElement>(null);

  // Conteúdo vindo do Vorix (Creative Engine): mídia + legenda já aprovadas.
  useEffect(() => {
    const media = params.getAll("media").filter((url) => /^https?:\/\//.test(url) || url.startsWith("/"));
    const caption = params.get("caption");
    const source = params.get("source");
    if (media.length === 0 && !caption) return;
    setDraft((current) => ({
      ...current,
      caption: current.caption || caption || "",
      media: current.media.length ? current.media : media.map((url) => ({ url, kind: /\.(mp4|mov|webm)(\?|$)/i.test(url) ? "video" : "image" })),
      ...(source ? { sourceExecutionRunId: source } : {}),
    }));
  }, [params]);

  const accounts = useMemo(() => options.data?.accounts ?? [], [options.data]);
  const choices = useMemo(() => networkChoices(accounts, workspace.id), [accounts, workspace.id]);
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.accountId, account])), [accounts]);

  // Formato de cada destino acompanha a mídia (só formatos que a conta suporta).
  useEffect(() => {
    setDraft((current) => {
      let changed = false;
      const destinations = current.destinations.map((destination) => {
        const account = accountById.get(destination.accountId);
        if (!account) return destination;
        const compatible = compatibleFormats(account, current.media).map((format) => format.format);
        if (destination.format && compatible.includes(destination.format)) return destination;
        const format = defaultFormat(account, current.media);
        if (format === destination.format) return destination;
        changed = true;
        return { ...destination, format };
      });
      // Sem mudança real, devolve o mesmo estado (não dispara nova renderização).
      return changed ? { ...current, destinations } : current;
    });
  }, [accountById, draft.media]);

  const scheduleDefaults = useMemo(() => localInputsIn(timezone, new Date(Date.now() + 60 * 60_000)), [timezone]);
  const blockers = composerBlockers(draft);
  const canSubmit = draft.when.mode === "now" ? can(ACTION_PERMISSION.publish_now) : can(ACTION_PERMISSION.schedule);

  function toggleAccount(account: SocialComposerAccount, selected: boolean) {
    setChecks([]);
    setDraft((current) => ({
      ...current,
      destinations: selected
        ? [...current.destinations, { accountId: account.accountId, network: account.network, format: defaultFormat(account, current.media), customize: false, caption: current.caption, hashtags: current.hashtags }]
        : current.destinations.filter((destination) => destination.accountId !== account.accountId),
    }));
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const added: SocialMediaItem[] = [];
      for (const file of Array.from(files)) {
        const metadata = await readMediaMetadata(file);
        const uploaded = await uploadPublicationMedia(workspace.id, file);
        added.push({ url: uploaded.url, kind: file.type.startsWith("video/") ? "video" : "image", mimeType: uploaded.contentType, sizeBytes: uploaded.sizeBytes, ...metadata });
      }
      setChecks([]);
      setDraft((current) => ({ ...current, media: [...current.media, ...added].slice(0, 35) }));
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit(confirmedWarnings = false) {
    const request = buildComposeRequest(workspace.id, { ...draft, when: draft.when.mode === "schedule" ? { ...draft.when, timezone } : draft.when }, idempotencyKey);
    setSubmitting(true);
    try {
      if (!confirmedWarnings) {
        const validation = await validateSocialPost(request);
        setChecks(validation.destinations);
        if (validation.destinations.some((check) => check.issues.length > 0)) {
          toast.error("Revise os pontos destacados antes de continuar.");
          return;
        }
        const warnings = validation.destinations.flatMap((check) => check.warnings.map((warning) => `${NETWORK_LABEL[check.network]}: ${warning}`));
        if (warnings.length) {
          setWarningsToConfirm(warnings);
          return;
        }
      }
      const post = await createSocialPost(request);
      toast.success(draft.when.mode === "now" ? "Publicação enviada. Acompanhe o status de cada rede." : "Publicação agendada.");
      setIdempotencyKey(newKey());
      router.push(`/workspaces/${workspace.id}/social/calendar?post=${encodeURIComponent(post.id)}`);
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setSubmitting(false);
    }
  }

  if (options.error) return <ErrorState error={options.error} onRetry={() => void options.mutate()} />;
  if (!options.data) return <Skeleton className="h-[480px] w-full rounded-xl" />;
  if (accounts.length === 0) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <PageHeader title="Criar publicação" />
        <EmptyState icon={<Send />} title="Conecte uma rede para começar" description="Conecte Instagram, Facebook ou TikTok e volte aqui para criar sua primeira publicação." action={<Button asChild><Link href={`/workspaces/${workspace.id}/social/integrations`}>Conectar minha primeira rede</Link></Button>} />
      </div>
    );
  }

  const selectedDestinations = draft.destinations.map((destination) => ({ destination, account: accountById.get(destination.accountId)! })).filter((item) => item.account);
  const previewTarget = selectedDestinations.find((item) => item.destination.accountId === previewKey) ?? selectedDestinations[0];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Criar publicação" description="Escreva uma vez, escolha as redes e ajuste o que for preciso em cada uma." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <SectionTitle step={1} title="Conteúdo" />
            <div className="space-y-2">
              <label htmlFor="social-caption" className="text-sm font-medium">Legenda</label>
              <Textarea id="social-caption" rows={5} placeholder="Escreva a legenda da publicação" value={draft.caption} onChange={(event) => setDraft({ ...draft, caption: event.target.value, destinations: draft.destinations.map((destination) => destination.customize ? destination : { ...destination, caption: event.target.value }) })} />
              <p className="text-right text-xs tabular-nums text-muted-foreground">{draft.caption.length} caracteres</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="social-hashtags" className="text-sm font-medium">Hashtags</label>
              <Input id="social-hashtags" placeholder="#promoção #novidade" value={draft.hashtags} onChange={(event) => setDraft({ ...draft, hashtags: event.target.value })} />
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <SectionTitle step={2} title="Mídia" />
            <div className="flex flex-wrap gap-2">
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple className="hidden" aria-label="Enviar arquivos" onChange={(event) => void addFiles(event.target.files)} />
              <Button variant="secondary" onClick={() => fileInput.current?.click()} loading={uploading}><Upload className="h-4 w-4" /> Enviar arquivos</Button>
              <Button variant="secondary" onClick={() => setLibraryOpen(true)}><Library className="h-4 w-4" /> Escolher da biblioteca</Button>
              <Button variant="ghost" asChild><Link href={`/workspaces/${workspace.id}/review`}><Sparkles className="h-4 w-4" /> Usar conteúdo gerado no Vorix</Link></Button>
            </div>
            {draft.media.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-8 text-sm text-muted-foreground"><ImagePlus className="h-5 w-5" /> Adicione imagens ou um vídeo.</div>
            ) : (
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4" data-testid="social-media-list">
                {draft.media.map((item, index) => (
                  <li key={`${item.url}-${index}`} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                    <MediaThumb item={item} />
                    <button type="button" className="absolute right-1 top-1 rounded-md bg-background/90 p-1 text-muted-foreground shadow-sm hover:text-foreground" aria-label="Remover mídia" onClick={() => { setChecks([]); setDraft({ ...draft, media: draft.media.filter((_, position) => position !== index) }); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    {item.kind === "video" && item.durationSec ? <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[10px] tabular-nums">{Math.round(item.durationSec)}s</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="space-y-4 p-5">
            <SectionTitle step={3} title="Redes" />
            <div className="grid gap-3 sm:grid-cols-3" data-testid="social-network-choices">
              {choices.map((choice) => (
                <div key={choice.network} className={cn("rounded-lg border p-3", choice.selectable ? "border-border" : "border-dashed border-border opacity-80")}>
                  <div className="mb-2 flex items-center gap-2"><NetworkMark network={choice.network} size="sm" /><span className="text-sm font-medium">{NETWORK_LABEL[choice.network]}</span></div>
                  {choice.selectable ? (
                    <ul className="space-y-1.5">
                      {choice.accounts.map((account) => (
                        <li key={account.accountId}>
                          <label className={cn("flex items-center gap-2 text-sm", account.publishable ? "cursor-pointer" : "cursor-not-allowed text-muted-foreground")} title={account.warning}>
                            <Checkbox disabled={!account.publishable} checked={draft.destinations.some((destination) => destination.accountId === account.accountId)} onCheckedChange={(value) => toggleAccount(account, value === true)} aria-label={`${NETWORK_LABEL[account.network]} ${accountName(account)}`} />
                            <span className="truncate">{accountName(account)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">{choice.reason}</p>
                      {choice.cta ? <Button size="sm" variant="secondary" asChild><Link href={choice.cta.href}>{choice.cta.label}</Link></Button> : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {selectedDestinations.length > 0 ? (
            <Card className="space-y-4 p-5">
              <SectionTitle step={4} title="Ajustes por rede" />
              {selectedDestinations.map(({ destination, account }) => {
                const formats = compatibleFormats(account, draft.media);
                const format = formats.find((item) => item.format === destination.format);
                const check = checks.find((item) => item.accountId === account.accountId);
                const update = (patch: Partial<ComposerDraft["destinations"][number]>) => { setChecks([]); setDraft({ ...draft, destinations: draft.destinations.map((item) => item.accountId === destination.accountId ? { ...item, ...patch } : item) }); };
                return (
                  <div key={destination.accountId} className="space-y-3 rounded-lg border border-border p-4" data-testid={`social-destination-${account.network}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2"><AccountAvatar name={accountName(account)} avatarUrl={account.avatarUrl} network={account.network} /><div><p className="text-sm font-medium">{NETWORK_LABEL[account.network]}</p><p className="text-xs text-muted-foreground">{accountName(account)}</p></div></div>
                      {formats.length > 0 ? (
                        <Select value={destination.format ?? ""} onValueChange={(value) => update({ format: value as SocialPostFormat })} className="w-48" placeholder="Formato">
                          {formats.map((item) => <SelectItem key={item.format} value={item.format}>{item.label}</SelectItem>)}
                        </Select>
                      ) : <p className="text-xs text-amber-700 dark:text-amber-400">Nenhum formato do {NETWORK_LABEL[account.network]} aceita esta mídia.</p>}
                    </div>
                    {formatSupportsCaption(format) ? (
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm">
                          <Switch checked={destination.customize} onCheckedChange={(value) => update({ customize: value, caption: destination.customize ? destination.caption : draft.caption, hashtags: destination.customize ? destination.hashtags : draft.hashtags })} aria-label={`Personalizar para ${NETWORK_LABEL[account.network]}`} />
                          Personalizar para o {NETWORK_LABEL[account.network]}
                        </label>
                        {destination.customize ? (
                          <>
                            <Textarea rows={3} value={destination.caption} onChange={(event) => update({ caption: event.target.value })} aria-label={`Legenda do ${NETWORK_LABEL[account.network]}`} />
                            <div className="flex items-center justify-between gap-2">
                              <Input value={destination.hashtags} onChange={(event) => update({ hashtags: event.target.value })} placeholder="Hashtags desta rede" aria-label={`Hashtags do ${NETWORK_LABEL[account.network]}`} />
                              <span className={cn("shrink-0 text-xs tabular-nums", format && destination.caption.length > format.maxCaptionLength ? "text-rose-600" : "text-muted-foreground")}>{destination.caption.length}/{format?.maxCaptionLength}</span>
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : format ? <p className="text-xs text-muted-foreground">{format.label} não tem legenda — o texto não é enviado.</p> : null}
                    {check?.issues.map((issue) => <p key={issue.code + issue.message} className="text-sm text-rose-600 dark:text-rose-400">{issue.message}</p>)}
                    {check?.warnings.map((warning) => <p key={warning} className="text-sm text-amber-700 dark:text-amber-400">{warning}</p>)}
                  </div>
                );
              })}
            </Card>
          ) : null}

          <Card className="space-y-4 p-5">
            <SectionTitle step={5} title="Quando publicar" />
            <ToggleGroup type="single" value={draft.when.mode} onValueChange={(value) => { if (value === "now") setDraft({ ...draft, when: { mode: "now" } }); if (value === "schedule") setDraft({ ...draft, when: { mode: "schedule", date: scheduleDefaults.date, time: scheduleDefaults.time, timezone } }); }} className="justify-start">
              <ToggleGroupItem value="now">Publicar agora</ToggleGroupItem>
              <ToggleGroupItem value="schedule">Agendar</ToggleGroupItem>
            </ToggleGroup>
            {draft.when.mode === "schedule" ? (
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-sm"><span className="block font-medium">Data</span><Input type="date" value={draft.when.date} onChange={(event) => setDraft({ ...draft, when: { ...draft.when, date: event.target.value } as ComposerDraft["when"] })} aria-label="Data" /></label>
                <label className="space-y-1 text-sm"><span className="block font-medium">Hora</span><Input type="time" value={draft.when.time} onChange={(event) => setDraft({ ...draft, when: { ...draft.when, time: event.target.value } as ComposerDraft["when"] })} aria-label="Hora" /></label>
                <p className="pb-2 text-xs text-muted-foreground">Fuso: {timezone.replace(/_/g, " ")}</p>
              </div>
            ) : null}
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {blockers.length ? <ul className="space-y-1 text-sm text-muted-foreground">{blockers.map((blocker) => <li key={blocker}>• {blocker}</li>)}</ul> : <span />}
            <GuardedButton size="lg" allowed={canSubmit} blockedReason="Você não tem permissão para publicar ou agendar." disabled={blockers.length > 0} loading={submitting} onClick={() => void submit()}>
              {draft.when.mode === "now" ? "Publicar agora" : "Agendar publicação"}
            </GuardedButton>
          </div>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card className="space-y-3 p-4">
            <p className="text-sm font-semibold">Pré-visualização</p>
            {selectedDestinations.length > 1 ? (
              <ToggleGroup type="single" value={previewTarget?.destination.accountId} onValueChange={(value) => value && setPreviewKey(value)} className="flex-wrap justify-start">
                {selectedDestinations.map(({ destination, account }) => <ToggleGroupItem key={destination.accountId} value={destination.accountId} aria-label={`Prévia ${NETWORK_LABEL[account.network]}`}><NetworkMark network={account.network} size="sm" /></ToggleGroupItem>)}
              </ToggleGroup>
            ) : null}
            {previewTarget ? <PostPreviewCard account={previewTarget.account} draft={draft} destination={previewTarget.destination} /> : <p className="text-sm text-muted-foreground">Escolha uma rede para ver como vai ficar.</p>}
          </Card>
        </aside>
      </div>

      {libraryOpen ? <LibraryPicker workspaceId={workspace.id} onClose={() => setLibraryOpen(false)} onPick={(items) => { setChecks([]); setDraft((current) => ({ ...current, media: [...current.media, ...items].slice(0, 35) })); setLibraryOpen(false); }} /> : null}

      <ConfirmDialog
        open={!!warningsToConfirm}
        title="Algumas redes precisam de atenção"
        description={(warningsToConfirm ?? []).join(" ")}
        confirmLabel={draft.when.mode === "now" ? "Publicar mesmo assim" : "Agendar mesmo assim"}
        busy={submitting}
        onConfirm={async () => { setWarningsToConfirm(undefined); await submit(true); }}
        onCancel={() => setWarningsToConfirm(undefined)}
      />
    </div>
  );
}

function SectionTitle({ step, title }: { step: number; title: string }) {
  return <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs tabular-nums">{step}</span>{title}</p>;
}

function MediaThumb({ item }: { item: SocialMediaItem }) {
  // eslint-disable-next-line @next/next/no-img-element
  return item.kind === "video" ? <video src={item.url} className="h-full w-full object-cover" muted playsInline preload="metadata" /> : <img src={item.url} alt="" className="h-full w-full object-cover" />;
}

/** Prévia aproximada: proporção do formato, mídia e legenda como a rede vai receber. */
function PostPreviewCard({ account, draft, destination }: { account: SocialComposerAccount; draft: ComposerDraft; destination: ComposerDraft["destinations"][number] }) {
  const format = account.formats.find((item) => item.format === destination.format);
  const caption = destination.customize ? destination.caption : draft.caption;
  const tags = splitHashtags(destination.customize ? destination.hashtags : draft.hashtags).map((tag) => `#${tag}`).join(" ");
  const media = draft.media[0];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background" data-testid="social-preview">
      <div className="flex items-center gap-2 p-3">
        <AccountAvatar name={accountName(account)} avatarUrl={account.avatarUrl} network={account.network} />
        <div className="min-w-0"><p className="truncate text-sm font-medium">{accountName(account)}</p><p className="text-xs text-muted-foreground">{NETWORK_LABEL[account.network]} · {format?.label ?? "Formato"}</p></div>
      </div>
      <div className="relative w-full bg-muted" style={{ aspectRatio: previewAspect(destination.format, draft.media) }}>
        {media ? <div className="absolute inset-0"><MediaThumb item={media} /></div> : <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Sem mídia</div>}
        {draft.media.length > 1 ? <span className="absolute right-2 top-2 rounded-full bg-background/90 px-2 text-[11px] tabular-nums">1/{draft.media.length}</span> : null}
      </div>
      {formatSupportsCaption(format) ? <p className="line-clamp-4 whitespace-pre-wrap p-3 text-sm">{caption || <span className="text-muted-foreground">Sua legenda aparece aqui.</span>}{tags ? <span className="block text-sky-600 dark:text-sky-400">{tags}</span> : null}</p> : <p className="p-3 text-xs text-muted-foreground">Sem legenda neste formato.</p>}
    </div>
  );
}

function LibraryPicker({ workspaceId, onClose, onPick }: { workspaceId: string; onClose: () => void; onPick: (items: SocialMediaItem[]) => void }) {
  const { data, error } = useAssets(workspaceId);
  const [selected, setSelected] = useState<string[]>([]);
  const usable = (data ?? []).filter((asset) => asset.status === "active" && asset.storageRef?.metadata?.url && /^(image|video)\//.test(asset.storageRef.metadata.contentType ?? "image/"));
  return (
    <Modal title="Escolher da biblioteca" onClose={onClose} maxWidthClass="sm:max-w-2xl">
      {error ? <ErrorState error={error} /> : !data ? <Skeleton className="h-40 w-full" /> : usable.length === 0 ? (
        <EmptyState compact icon={<Library />} title="Biblioteca vazia" description="Envie imagens e vídeos para a biblioteca de mídia e use-os aqui." />
      ) : (
        <div className="space-y-4">
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {usable.map((asset) => {
              const url = asset.storageRef!.metadata!.url!;
              const checked = selected.includes(asset.id);
              return (
                <li key={asset.id}>
                  <button type="button" onClick={() => setSelected(checked ? selected.filter((id) => id !== asset.id) : [...selected, asset.id])} className={cn("relative block aspect-square w-full overflow-hidden rounded-lg border", checked ? "border-primary ring-2 ring-primary/40" : "border-border")} aria-pressed={checked} aria-label={asset.name}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {(asset.storageRef?.metadata?.contentType ?? "").startsWith("video/") ? <video src={url} className="h-full w-full object-cover" muted /> : <img src={url} alt="" className="h-full w-full object-cover" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button disabled={selected.length === 0} onClick={() => onPick(usable.filter((asset) => selected.includes(asset.id)).map((asset) => ({ url: asset.storageRef!.metadata!.url!, kind: (asset.storageRef?.metadata?.contentType ?? "").startsWith("video/") ? "video" : "image", ...(asset.storageRef?.metadata?.contentType ? { mimeType: asset.storageRef.metadata.contentType } : {}) })))}>Usar {selected.length || ""} {selected.length === 1 ? "mídia" : "mídias"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Algo deu errado. Tente novamente.";
}
