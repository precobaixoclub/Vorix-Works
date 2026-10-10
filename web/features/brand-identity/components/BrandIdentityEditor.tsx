"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Select, SelectItem, Textarea } from "@/components/Field";
import { Spinner } from "@/components/Spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { useAssets } from "@/features/assets/hooks";
import type { Asset } from "@/features/assets/types";
import { saveBrandIdentity, suggestColorsFromLogo } from "../api";
import { useBrandIdentity } from "../hooks";
import {
  COLOR_ROLES,
  COLOR_ROLE_LABEL,
  COMMERCIAL_LABEL,
  CONTRAST_LABEL,
  DENSITY_LABEL,
  EMPTY_IDENTITY,
  FORBIDDEN_PATTERNS,
  FORBIDDEN_PATTERN_LABEL,
  IMAGE_STYLES,
  IMAGE_STYLE_LABEL,
  LOGO_BACKGROUNDS,
  LOGO_BACKGROUND_LABEL,
  LOGO_VARIANTS,
  LOGO_VARIANT_LABEL,
  PREFERRED_PATTERNS,
  PREFERRED_PATTERN_LABEL,
  STYLES,
  STYLE_LABEL,
  validateIdentityDraft,
  type BrandColorSuggestion,
  type BrandIdentityInput,
  type ColorRole,
  type Level,
  type Shape,
  type Typography,
} from "../types";

const NONE = "none";
const HEX = /^#[0-9A-Fa-f]{6}$/;

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}

function OptionSelect<T extends string>({ id, label, value, options, labels, onChange, allowEmpty }: { id: string; label: string; value: T | undefined; options: readonly T[]; labels: Record<T, string>; onChange: (value: T | undefined) => void; allowEmpty?: boolean }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value ?? NONE} onValueChange={(next) => onChange(next === NONE ? undefined : (next as T))}>
        {allowEmpty !== false ? <SelectItem value={NONE}>Não definido</SelectItem> : null}
        {options.map((option) => (
          <SelectItem key={option} value={option}>{labels[option]}</SelectItem>
        ))}
      </Select>
    </div>
  );
}

function CheckList<T extends string>({ options, labels, selected, onChange, max }: { options: readonly T[]; labels: Record<T, string>; selected: T[]; onChange: (next: T[]) => void; max?: number }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {options.map((option) => {
        const checked = selected.includes(option);
        const disabled = !checked && max !== undefined && selected.length >= max;
        return (
          <label key={option} className={`flex items-center gap-2 text-sm ${disabled ? "text-muted-foreground" : "text-foreground"}`}>
            <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value ? [...selected, option] : selected.filter((item) => item !== option))} />
            {labels[option]}
          </label>
        );
      })}
    </div>
  );
}

function isLogoAsset(asset: Asset): boolean {
  return asset.status === "active" && Boolean(asset.storageRef) && (asset.kind === "logo" || asset.materialType === "logo_principal" || asset.materialType === "logo_secundaria" || asset.kind === "visual_identity");
}

/**
 * Identidade visual ESTRUTURADA da marca (Brand Profile). Linguagem de negócio/design — a pessoa não
 * precisa saber de provenance, skins ou densidade interna. Logos vêm SÓ da biblioteca de materiais
 * deste workspace (nenhum segundo sistema de arquivos). Sugestões a partir da logo nunca gravam
 * sozinhas: entram no rascunho e só valem quando a pessoa salva.
 */
export function BrandIdentityEditor({ workspaceId, onGoToMaterials }: { workspaceId: string; onGoToMaterials: () => void }) {
  const { data, error, isLoading, mutate } = useBrandIdentity(workspaceId);
  const { data: assets } = useAssets(workspaceId);
  const logoAssets = useMemo(() => (assets ?? []).filter(isLogoAsset), [assets]);
  const [draft, setDraft] = useState<BrandIdentityInput>(EMPTY_IDENTITY);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [savedVersion, setSavedVersion] = useState<number | undefined>();
  const [suggestions, setSuggestions] = useState<BrandColorSuggestion[] | undefined>();
  const [suggesting, setSuggesting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!data) return;
    const identity = data.identity;
    setDraft(identity ? { colors: identity.colors, logos: identity.logos, style: identity.style, density: identity.density, contrast: identity.contrast, typography: identity.typography, shape: identity.shape, imageStyles: identity.imageStyles, commercialIntensity: identity.commercialIntensity, forbiddenPatterns: identity.forbiddenPatterns, preferredPatterns: identity.preferredPatterns, notes: identity.notes } : EMPTY_IDENTITY);
  }, [data]);

  const errors = validateIdentityDraft(draft);
  const set = (patch: Partial<BrandIdentityInput>): void => setDraft((current) => ({ ...current, ...patch }));

  async function save(identity: BrandIdentityInput = draft) {
    setSaving(true);
    setSaveError(undefined);
    try {
      const view = await saveBrandIdentity(workspaceId, identity);
      setSavedVersion(view.identity?.version);
      setSuggestions(undefined);
      await mutate(view, { revalidate: false });
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Não foi possível salvar a identidade da marca.");
    } finally {
      setSaving(false);
    }
  }

  async function suggest(assetId: string) {
    setSuggesting(true);
    try {
      const result = await suggestColorsFromLogo(workspaceId, assetId);
      setSuggestions(result.suggestions);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Não foi possível analisar a logo.");
    } finally {
      setSuggesting(false);
    }
  }

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (error) return <ErrorState error={error} onRetry={() => void mutate()} />;

  const primary = draft.colors.find((color) => color.role === "PRIMARY" && HEX.test(color.hex))?.hex;
  const accent = draft.colors.find((color) => color.role === "ACCENT" && HEX.test(color.hex))?.hex ?? primary;
  const neutrals = draft.colors.filter((color) => color.role === "NEUTRAL" && HEX.test(color.hex)).map((color) => color.hex);
  const corners = draft.shape?.corners;
  const radius = corners === "SHARP" ? "2px" : corners === "SOFT" ? "10px" : corners === "ROUNDED" ? "18px" : corners === "PILL" ? "999px" : undefined;
  const headlineFont = draft.typography?.family === "SERIF" ? "Georgia, 'Times New Roman', serif" : undefined;
  const upper = draft.typography?.headlineCase === "UPPERCASE" && !draft.forbiddenPatterns.includes("NO_ALL_CAPS");

  return (
    <div className="space-y-5">
      <Section title="Prévia" description="Como a identidade aparece nas peças — a estrutura do Vorix se mantém, a linguagem visual muda com a marca.">
        <div className="rounded-lg border border-border p-6" style={{ background: neutrals[neutrals.length - 1] ?? undefined }}>
          <p className="text-2xl font-bold text-foreground" style={{ fontFamily: headlineFont, textTransform: upper ? "uppercase" : undefined, color: neutrals[0] }}>Sua mensagem principal</p>
          <p className="mt-1 text-sm text-muted-foreground">Subtítulo de apoio da peça.</p>
          <span className="mt-4 inline-block bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground" style={{ background: accent, borderRadius: radius, textTransform: draft.forbiddenPatterns.includes("NO_ALL_CAPS") ? undefined : "uppercase" }}>Chamada</span>
        </div>
        {!data?.identity ? <p className="text-xs text-muted-foreground">Ainda não configurada — o Vorix usa o estilo padrão até você salvar.</p> : <p className="text-xs text-muted-foreground tabular-nums">Versão {data.identity.version} · salva em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(data.identity.updatedAt))}</p>}
      </Section>

      <Section title="Logos" description="Versões da logo enviadas na biblioteca de materiais. O Vorix escolhe a versão certa para cada fundo; sem uma versão adequada, aplica um tratamento discreto.">
        {logoAssets.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">Nenhuma logo na biblioteca deste workspace.</p>
            <Button variant="secondary" onClick={onGoToMaterials}>Enviar logo em Materiais</Button>
          </div>
        ) : null}
        {draft.logos.map((logo, index) => {
          const asset = logoAssets.find((item) => item.id === logo.assetId);
          return (
            <div key={`${logo.assetId}-${index}`} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[96px_1fr]">
              <div className="flex h-20 items-center justify-center rounded-md bg-muted">
                {asset?.storageRef?.metadata?.url ? <img src={asset.storageRef.metadata.url} alt="" className="max-h-16 max-w-full object-contain" /> : <span className="text-xs text-muted-foreground">—</span>}
              </div>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`logo-asset-${index}`}>Arquivo</Label>
                    <Select id={`logo-asset-${index}`} value={logo.assetId || NONE} onValueChange={(value) => set({ logos: draft.logos.map((item, i) => (i === index ? { ...item, assetId: value === NONE ? "" : value } : item)) })}>
                      <SelectItem value={NONE}>Escolher…</SelectItem>
                      {logoAssets.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                    </Select>
                  </div>
                  <OptionSelect id={`logo-variant-${index}`} label="Tipo" value={logo.variant} options={LOGO_VARIANTS} labels={LOGO_VARIANT_LABEL} allowEmpty={false} onChange={(value) => value && set({ logos: draft.logos.map((item, i) => (i === index ? { ...item, variant: value } : item)) })} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Funciona sobre</p>
                  <CheckList options={LOGO_BACKGROUNDS} labels={LOGO_BACKGROUND_LABEL} selected={logo.backgrounds} onChange={(next) => set({ logos: draft.logos.map((item, i) => (i === index ? { ...item, backgrounds: next } : item)) })} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={!logo.assetId || suggesting} onClick={() => void suggest(logo.assetId)}>{suggesting ? "Analisando…" : "Sugerir cores desta logo"}</Button>
                  <Button variant="ghost" onClick={() => set({ logos: draft.logos.filter((_, i) => i !== index) })}>Remover</Button>
                </div>
              </div>
            </div>
          );
        })}
        {logoAssets.length > 0 ? <Button variant="secondary" disabled={draft.logos.length >= 8} onClick={() => set({ logos: [...draft.logos, { assetId: "", variant: draft.logos.length === 0 ? "PRIMARY" : "LIGHT", backgrounds: draft.logos.length === 0 ? ["LIGHT"] : ["DARK"], priority: draft.logos.length + 1 }] })}>Adicionar versão da logo</Button> : null}
      </Section>

      <Section title="Cores" description="Defina a função de cada cor: o que pode dominar, o que é só destaque e o que nunca deve aparecer.">
        {suggestions && suggestions.length > 0 ? (
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-sm font-medium text-foreground">Sugestões a partir da logo</p>
            <p className="text-xs text-muted-foreground">Só entram na identidade se você adicionar e salvar.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button key={suggestion.hex} type="button" className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground" disabled={draft.colors.some((color) => color.hex.toUpperCase() === suggestion.hex)} onClick={() => set({ colors: [...draft.colors, { hex: suggestion.hex, role: suggestion.role, name: suggestion.name, provenance: "ASSET_EXTRACTED" }] })} title={suggestion.reason}>
                  <span className="h-4 w-4 rounded-sm border border-border" style={{ background: suggestion.hex }} />
                  {suggestion.name} · {COLOR_ROLE_LABEL[suggestion.role].split(" —")[0]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {draft.colors.map((color, index) => (
          <div key={index} className="grid items-end gap-3 sm:grid-cols-[auto_120px_1fr_1fr_auto]">
            <input aria-label="Escolher cor" type="color" value={HEX.test(color.hex) ? color.hex : "#000000"} onChange={(event) => set({ colors: draft.colors.map((item, i) => (i === index ? { ...item, hex: event.target.value.toUpperCase() } : item)) })} className="h-10 w-12 cursor-pointer rounded-md border border-border bg-background" />
            <div className="space-y-1">
              <Label htmlFor={`color-hex-${index}`}>Código</Label>
              <Input id={`color-hex-${index}`} value={color.hex} maxLength={7} onChange={(event) => set({ colors: draft.colors.map((item, i) => (i === index ? { ...item, hex: event.target.value.trim().toUpperCase() } : item)) })} aria-invalid={!HEX.test(color.hex)} />
            </div>
            <OptionSelect id={`color-role-${index}`} label="Função" value={color.role} options={COLOR_ROLES} labels={COLOR_ROLE_LABEL} allowEmpty={false} onChange={(value) => value && set({ colors: draft.colors.map((item, i) => (i === index ? { ...item, role: value as ColorRole } : item)) })} />
            <div className="space-y-1">
              <Label htmlFor={`color-name-${index}`}>Nome (opcional)</Label>
              <Input id={`color-name-${index}`} value={color.name ?? ""} maxLength={40} onChange={(event) => set({ colors: draft.colors.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)) })} />
            </div>
            <Button variant="ghost" onClick={() => set({ colors: draft.colors.filter((_, i) => i !== index) })}>Remover</Button>
          </div>
        ))}
        <Button variant="secondary" disabled={draft.colors.length >= 12} onClick={() => set({ colors: [...draft.colors, { hex: "#000000", role: draft.colors.length === 0 ? "PRIMARY" : "SECONDARY" }] })}>Adicionar cor</Button>
      </Section>

      <Section title="Estilo" description="A personalidade visual da marca e o quanto as peças podem ser comerciais.">
        <div className="grid gap-4 sm:grid-cols-2">
          <OptionSelect id="style-primary" label="Estilo principal" value={draft.style?.primary} options={STYLES} labels={STYLE_LABEL} onChange={(value) => set({ style: value ? { primary: value, traits: (draft.style?.traits ?? []).filter((trait) => trait !== value) } : undefined })} />
          <OptionSelect<Level> id="density" label="Densidade" value={draft.density} options={["LOW", "MEDIUM", "HIGH"]} labels={DENSITY_LABEL} onChange={(value) => set({ density: value })} />
          <OptionSelect<Level> id="commercial" label="Intensidade comercial" value={draft.commercialIntensity} options={["LOW", "MEDIUM", "HIGH"]} labels={COMMERCIAL_LABEL} onChange={(value) => set({ commercialIntensity: value })} />
          <OptionSelect id="contrast" label="Contraste" value={draft.contrast} options={["SOFT", "BALANCED", "HIGH"] as const} labels={CONTRAST_LABEL} onChange={(value) => set({ contrast: value })} />
        </div>
        {draft.style ? (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Traços complementares (até 3)</p>
            <CheckList options={STYLES.filter((style) => style !== draft.style?.primary)} labels={STYLE_LABEL} selected={draft.style.traits} max={3} onChange={(next) => set({ style: { primary: draft.style!.primary, traits: next } })} />
          </div>
        ) : null}
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Estilo de imagem (até 4)</p>
          <CheckList options={IMAGE_STYLES} labels={IMAGE_STYLE_LABEL} selected={draft.imageStyles} max={4} onChange={(next) => set({ imageStyles: next })} />
        </div>
        <p className="text-xs text-muted-foreground">A intensidade comercial muda o destaque de preço e chamada — o Vorix nunca cria preço, desconto ou urgência que não tenham sido informados.</p>
      </Section>

      <Section title="Tipografia" description="Não precisa de fonte própria: o Vorix usa uma família compatível com a personalidade escolhida.">
        <div className="grid gap-4 sm:grid-cols-3">
          <OptionSelect id="type-family" label="Letra" value={draft.typography?.family} options={["SERIF", "SANS"] as const} labels={{ SERIF: "Com serifa (clássica, editorial)", SANS: "Sem serifa (moderna, direta)" }} onChange={(value) => set({ typography: value ? { ...(draft.typography ?? {}), family: value } as Typography : undefined })} />
          <OptionSelect id="type-weight" label="Peso dos títulos" value={draft.typography?.weight} options={["LIGHT", "REGULAR", "BOLD", "HEAVY"] as const} labels={{ LIGHT: "Leve", REGULAR: "Regular", BOLD: "Negrito", HEAVY: "Extra forte" }} onChange={(value) => draft.typography && set({ typography: { ...draft.typography, weight: value } })} />
          <OptionSelect id="type-case" label="Títulos" value={draft.typography?.headlineCase} options={["SENTENCE", "UPPERCASE"] as const} labels={{ SENTENCE: "Frase normal", UPPERCASE: "Caixa alta" }} onChange={(value) => draft.typography && set({ typography: { ...draft.typography, headlineCase: value } })} />
          <OptionSelect id="type-era" label="Época" value={draft.typography?.era} options={["MODERN", "CLASSIC"] as const} labels={{ MODERN: "Moderna", CLASSIC: "Clássica" }} onChange={(value) => draft.typography && set({ typography: { ...draft.typography, era: value } })} />
          <OptionSelect id="type-construction" label="Desenho" value={draft.typography?.construction} options={["GEOMETRIC", "HUMANIST", "NEUTRAL"] as const} labels={{ GEOMETRIC: "Geométrico", HUMANIST: "Humanista", NEUTRAL: "Neutro" }} onChange={(value) => draft.typography && set({ typography: { ...draft.typography, construction: value } })} />
          <OptionSelect id="type-voice" label="Voz" value={draft.typography?.voice} options={["EDITORIAL", "COMMERCIAL"] as const} labels={{ EDITORIAL: "Editorial", COMMERCIAL: "Comercial" }} onChange={(value) => draft.typography && set({ typography: { ...draft.typography, voice: value } })} />
        </div>
      </Section>

      <Section title="Formas" description="Cantos de botões e cartões, linhas e sombras.">
        <div className="grid gap-4 sm:grid-cols-3">
          <OptionSelect id="shape-corners" label="Cantos" value={draft.shape?.corners} options={["SHARP", "SOFT", "ROUNDED", "PILL"] as const} labels={{ SHARP: "Retos", SOFT: "Levemente suaves", ROUNDED: "Arredondados", PILL: "Pílula" }} onChange={(value) => set({ shape: value ? { ...(draft.shape ?? {}), corners: value } as Shape : undefined })} />
          <OptionSelect id="shape-lines" label="Linhas" value={draft.shape?.lines} options={["NONE", "HAIRLINE", "OUTLINED"] as const} labels={{ NONE: "Sem linhas", HAIRLINE: "Fios finos", OUTLINED: "Contornos" }} onChange={(value) => draft.shape && set({ shape: { ...draft.shape, lines: value } })} />
          <OptionSelect id="shape-shadow" label="Sombras" value={draft.shape?.shadow} options={["NONE", "SUBTLE", "PRONOUNCED"] as const} labels={{ NONE: "Sem sombra", SUBTLE: "Sutil", PRONOUNCED: "Marcante" }} onChange={(value) => draft.shape && set({ shape: { ...draft.shape, shadow: value } })} />
        </div>
      </Section>

      <Section title="Preferências visuais" description="O que a marca evita e o que deve se repetir. Restrições da marca valem mesmo se um pedido pontual disser o contrário.">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Evitar</p>
          <CheckList options={FORBIDDEN_PATTERNS} labels={FORBIDDEN_PATTERN_LABEL} selected={draft.forbiddenPatterns} onChange={(next) => set({ forbiddenPatterns: next })} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Preferir</p>
          <CheckList options={PREFERRED_PATTERNS} labels={PREFERRED_PATTERN_LABEL} selected={draft.preferredPatterns} onChange={(next) => set({ preferredPatterns: next })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="brand-notes">Observações (opcional)</Label>
          <Textarea id="brand-notes" rows={3} maxLength={1000} value={draft.notes ?? ""} onChange={(event) => set({ notes: event.target.value })} />
        </div>
      </Section>

      {errors.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
          {errors.map((item) => <li key={item}>• {item}</li>)}
        </ul>
      ) : null}
      {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
      <div className="flex items-center gap-3">
        <Button disabled={saving || errors.length > 0} onClick={() => void save(draft)} title={errors.length > 0 ? "Corrija os itens acima para salvar." : undefined}>{saving ? "Salvando…" : "Salvar identidade"}</Button>
        {data?.identity ? <Button variant="ghost" disabled={saving} onClick={() => setConfirmReset(true)}>Voltar ao padrão do Vorix</Button> : null}
        {savedVersion ? <span className="text-sm text-muted-foreground tabular-nums">Salvo — versão {savedVersion}. As próximas peças já usam esta identidade.</span> : null}
      </div>
      <ConfirmDialog
        open={confirmReset}
        title="Voltar ao padrão do Vorix?"
        description="A identidade visual desta marca será limpa (cores, logos, estilo e preferências). As próximas peças usam o estilo padrão; peças já geradas não mudam. A versão anterior continua registrada nas peças que a usaram."
        confirmLabel="Limpar identidade"
        variant="danger"
        busy={saving}
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          setDraft(EMPTY_IDENTITY);
          await save(EMPTY_IDENTITY);
          setConfirmReset(false);
        }}
      />
    </div>
  );
}
