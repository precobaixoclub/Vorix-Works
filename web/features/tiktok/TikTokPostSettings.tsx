"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { TikTokCreatorInfo, TikTokPrivacyLevel } from "./types";
import styles from "@/features/publishing-studio/studio.module.css";

export type TikTokPostOptions = {
  privacyLevel: TikTokPrivacyLevel | "";
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  autoAddMusic: boolean;
  commercialContent: boolean;
  brandOrganic: boolean;
  brandContent: boolean;
  musicUsageAccepted: boolean;
};
export const EMPTY_TIKTOK_OPTIONS: TikTokPostOptions = {
  privacyLevel: "", disableComment: true, disableDuet: true, disableStitch: true, autoAddMusic: false,
  commercialContent: false, brandOrganic: false, brandContent: false, musicUsageAccepted: false,
};
const PRIVACY_LABELS: Record<TikTokPrivacyLevel, string> = { PUBLIC_TO_EVERYONE: "Todos", MUTUAL_FOLLOW_FRIENDS: "Amigos", FOLLOWER_OF_CREATOR: "Seguidores", SELF_ONLY: "Só eu" };
const MUSIC_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const BRAND_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";

export function tiktokPostingBlocker(options: TikTokPostOptions, creator: TikTokCreatorInfo | undefined, video: boolean, duration?: number): string | undefined {
  if (!creator) return "Aguarde a consulta às permissões da conta TikTok.";
  if (!options.privacyLevel || !creator.privacyLevelOptions.includes(options.privacyLevel)) return "Escolha a privacidade do TikTok.";
  if (creator.sandbox && options.privacyLevel !== "SELF_ONLY") return "Para este teste, escolha “Só eu” na privacidade do TikTok.";
  if (options.commercialContent && !options.brandOrganic && !options.brandContent) return "Informe se o conteúdo promove sua marca, outra marca ou ambas.";
  if (options.brandContent && options.privacyLevel === "SELF_ONLY") return "Parcerias com outras marcas não podem usar “Só eu”.";
  if (video && (!Number.isFinite(duration) || (duration ?? 0) <= 0)) return "Aguarde a verificação da duração do vídeo.";
  if (video && duration! > creator.maxVideoPostDurationSec) return `Esta conta TikTok permite vídeos de até ${creator.maxVideoPostDurationSec} segundos.`;
  if (!options.musicUsageAccepted) return "Confirme os termos do TikTok para publicar.";
}

export function TikTokPostSettings({ value, onChange, creator, loading, error, retry, video, duration, busy }: {
  value: TikTokPostOptions; onChange: (value: TikTokPostOptions) => void; creator?: TikTokCreatorInfo;
  loading: boolean; error?: string; retry: () => void; video: boolean; duration?: number; busy: boolean;
}) {
  const update = (patch: Partial<TikTokPostOptions>) => onChange({ ...value, ...patch, musicUsageAccepted: false });
  const disabled = busy || loading || !creator || Boolean(error);
  return <div className={styles.networkSettings} aria-label="Configurações da publicação TikTok">
    <p className={styles.settingsTitle}>Opções do TikTok</p>
    {loading ? <p role="status" className={styles.helper}>Consultando as permissões da conta TikTok…</p> : null}
    {error ? <div role="alert" className="mb-3 rounded-lg border border-destructive/40 p-3 text-sm"><p>{error}</p><button type="button" className={`${styles.textButton} mt-2`} onClick={retry}>Atualizar permissões</button></div> : null}
    {creator && !error ? <div className="mb-4 space-y-1 text-sm"><p>Publicando como <strong>{creator.creatorNickname}</strong>{creator.creatorUsername ? ` (@${creator.creatorUsername})` : ""}</p>{creator.sandbox ? <p className={styles.helper}>Ambiente de teste: use uma conta privada e escolha “Só eu”.</p> : null}{video ? <p className={styles.helper}>Limite desta conta: {creator.maxVideoPostDurationSec} segundos.{duration ? ` Seu vídeo: ${Math.ceil(duration)} segundos.` : " Verificando duração…"}</p> : null}</div> : null}
    <label htmlFor="tiktok-privacy" className={styles.label}>Quem pode ver?</label>
    <Select value={value.privacyLevel} onValueChange={(privacyLevel) => update({ privacyLevel: privacyLevel as TikTokPrivacyLevel })} disabled={disabled}><SelectTrigger id="tiktok-privacy"><SelectValue placeholder="Selecione a privacidade" /></SelectTrigger><SelectContent>{creator?.privacyLevelOptions.map(option => <SelectItem key={option} value={option} disabled={(creator.sandbox && option !== "SELF_ONLY") || (value.brandContent && option === "SELF_ONLY")}>{PRIVACY_LABELS[option]}</SelectItem>)}</SelectContent></Select>
    {value.brandContent ? <p className={`${styles.helper} mt-2`}>Parcerias com outras marcas não podem ter visibilidade “Só eu”.</p> : null}
    <div className={styles.switchGrid}>
      <Toggle id="tiktok-comment" label="Permitir comentários" checked={!value.disableComment} disabled={disabled || creator?.commentDisabled} onChange={allow => update({ disableComment: !allow })} locked={creator?.commentDisabled} />
      {video ? <><Toggle id="tiktok-duet" label="Permitir Duet" checked={!value.disableDuet} disabled={disabled || creator?.duetDisabled} onChange={allow => update({ disableDuet: !allow })} locked={creator?.duetDisabled} /><Toggle id="tiktok-stitch" label="Permitir Stitch" checked={!value.disableStitch} disabled={disabled || creator?.stitchDisabled} onChange={allow => update({ disableStitch: !allow })} locked={creator?.stitchDisabled} /></> : <Toggle id="tiktok-auto-music" label="Adicionar música automaticamente" checked={value.autoAddMusic} disabled={disabled} onChange={autoAddMusic => update({ autoAddMusic })} />}
      <Toggle id="tiktok-commercial" label="Este conteúdo promove uma marca, produto ou serviço" checked={value.commercialContent} disabled={disabled} onChange={commercialContent => update({ commercialContent, brandContent: false, brandOrganic: false })} />
    </div>
    {value.commercialContent ? <fieldset className="mt-3 space-y-3 rounded-xl border border-border p-4"><legend className="px-1 text-sm font-semibold">Identificação comercial</legend>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={value.brandOrganic} disabled={disabled} onChange={e => update({ brandOrganic: e.target.checked })} /><span>Sua marca<span className="block text-xs text-muted-foreground">Você promove sua própria empresa ou produto.</span></span></label>
      <label className={`flex items-start gap-3 text-sm ${value.privacyLevel === "SELF_ONLY" ? "opacity-60" : ""}`}><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={value.brandContent} disabled={disabled || value.privacyLevel === "SELF_ONLY" || creator?.sandbox} onChange={e => update({ brandContent: e.target.checked })} /><span>Parceria com outra marca<span className="block text-xs text-muted-foreground">{value.privacyLevel === "SELF_ONLY" || creator?.sandbox ? "Indisponível para publicações com visibilidade “Só eu”." : "Você promove uma marca de terceiros."}</span></span></label>
      <p className={styles.helper}>{value.brandContent ? "Sua publicação será identificada como “Parceria paga”." : value.brandOrganic ? "Sua publicação será identificada como “Conteúdo promocional”." : "Selecione sua marca, outra marca ou ambas para continuar."}</p>
    </fieldset> : null}
    <div className="mt-4 rounded-xl border border-border bg-background/40 p-4 text-sm leading-relaxed">
      <label className="flex items-start gap-3"><input id="tiktok-music-consent" type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={value.musicUsageAccepted} disabled={disabled} onChange={e => onChange({ ...value, musicUsageAccepted: e.target.checked })} /><span>Ao publicar, concordo com a <a href={MUSIC_URL} target="_blank" rel="noopener noreferrer" className="text-primary underline">Confirmação de Uso de Músicas do TikTok</a>{value.brandContent ? <> e com a <a href={BRAND_URL} target="_blank" rel="noopener noreferrer" className="text-primary underline">Política de Conteúdo de Marca</a></> : null}.</span></label>
    </div>
    <p className={`${styles.helper} mt-3`}>Após o envio, o TikTok pode levar alguns minutos para processar o conteúdo e exibi-lo no perfil. Acompanhe a confirmação em Publicações.</p>
  </div>;
}

function Toggle({ id, label, checked, disabled, onChange, locked }: { id: string; label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; locked?: boolean }) {
  return <label htmlFor={id} className={`${styles.switchRow} ${disabled ? "opacity-60" : ""}`}><span>{label}{locked ? <small className="block text-xs text-muted-foreground">Desativado nas configurações da conta TikTok.</small> : null}</span><Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} /></label>;
}
