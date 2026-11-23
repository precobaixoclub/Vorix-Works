import type { Asset } from "@/features/assets/types";
import type { BrandIdentity } from "@/features/brand-identity/types";
import type { BrandProfile } from "@/features/brand-profile/types";

/**
 * Visão geral de "Marca e identidade" (Fase 5): as 8 partes da identidade, se já estão preenchidas
 * e em qual aba se configura cada uma. Só LÊ os dados que já existem (perfil da marca, identidade
 * visual estruturada, materiais e diretrizes) — nada aqui muda como o motor criativo os interpreta.
 */

export type BrandTab = "profile" | "identity" | "guidelines" | "materials";
export type BrandCheckStatus = "done" | "pending" | "unknown";

export type BrandCheckItem = {
  key: "company" | "positioning" | "logo" | "colors" | "typography" | "materials" | "guidelines" | "rules";
  label: string;
  description: string;
  tab: BrandTab;
  /** Essencial para as peças saírem com a cara da marca. */
  required: boolean;
  status: BrandCheckStatus;
  detail?: string;
};

export type BrandChecklistInput = {
  profile?: BrandProfile | null;
  identity?: BrandIdentity | null;
  assets?: readonly Asset[];
  guidelines?: string | null;
  /** Fontes ainda carregando (ou com erro): o item fica "unknown", nunca "pendente" falso. */
  loaded: { profile: boolean; identity: boolean; assets: boolean; guidelines: boolean };
};

const filled = (value: string | undefined | null) => Boolean(value && value.trim());

export function brandChecklist(input: BrandChecklistInput): BrandCheckItem[] {
  const { profile, identity, assets, loaded } = input;
  const activeAssets = (assets ?? []).filter((asset) => asset.status === "active");
  const logos = activeAssets.filter((asset) => asset.kind === "logo");
  const otherMaterials = activeAssets.filter((asset) => asset.kind !== "logo");
  const colors = identity?.colors.filter((color) => color.role !== "FORBIDDEN") ?? [];
  const profileColors = profile?.brandColors ?? [];
  const rules = (identity?.forbiddenPatterns.length ?? 0) + (identity?.preferredPatterns.length ?? 0) + (identity?.colors.filter((color) => color.role === "FORBIDDEN").length ?? 0) + (filled(identity?.notes) ? 1 : 0);
  const status = (ready: boolean, done: boolean): BrandCheckStatus => (!ready ? "unknown" : done ? "done" : "pending");

  return [
    { key: "company", label: "Informações da empresa", description: "Nome, o que a empresa faz e o que vende.", tab: "profile", required: true, status: status(loaded.profile, filled(profile?.brandName) || filled(profile?.businessDescription)) },
    { key: "positioning", label: "Posicionamento e público", description: "Para quem a marca fala, tom de voz e diferenciais.", tab: "profile", required: false, status: status(loaded.profile, filled(profile?.positioning) || filled(profile?.targetAudience)) },
    { key: "logo", label: "Logotipo e versões", description: "Logo principal e versões para fundo claro e escuro.", tab: "identity", required: true, status: status(loaded.assets && loaded.identity, logos.length > 0 || (identity?.logos.length ?? 0) > 0), detail: logos.length ? `${logos.length} logo(s)` : undefined },
    { key: "colors", label: "Cores da marca", description: "Cor principal, de apoio e de destaque.", tab: "identity", required: true, status: status(loaded.identity && loaded.profile, colors.length > 0 || profileColors.length > 0), detail: colors.length || profileColors.length ? `${colors.length || profileColors.length} cor(es)` : undefined },
    { key: "typography", label: "Tipografia e estilo visual", description: "Estilo das letras e o jeito das peças.", tab: "identity", required: false, status: status(loaded.identity, Boolean(identity?.typography || identity?.style || identity?.imageStyles.length)) },
    { key: "materials", label: "Materiais e referências", description: "Fotos de produto, telas e referências visuais.", tab: "materials", required: false, status: status(loaded.assets, otherMaterials.length > 0), detail: otherMaterials.length ? `${otherMaterials.length} material(is)` : undefined },
    { key: "guidelines", label: "Diretrizes criativas", description: "Orientações para a IA ao criar suas peças.", tab: "guidelines", required: false, status: status(loaded.guidelines, filled(input.guidelines)) },
    { key: "rules", label: "Regras de utilização", description: "O que nunca usar: cores, padrões e cuidados.", tab: "identity", required: false, status: status(loaded.identity, rules > 0) },
  ];
}

/** Cores para a prévia: as da identidade estruturada (sem as proibidas) ou, na falta, as do perfil. */
export function brandSwatches(identity: BrandIdentity | null | undefined, profile: BrandProfile | null | undefined): string[] {
  const fromIdentity = (identity?.colors ?? []).filter((color) => color.role !== "FORBIDDEN").map((color) => color.hex);
  const list = fromIdentity.length ? fromIdentity : (profile?.brandColors ?? []);
  return list.filter((hex) => /^#[0-9A-Fa-f]{6}$/.test(hex)).slice(0, 8);
}

export function brandProgress(items: readonly BrandCheckItem[]): { done: number; total: number; missingRequired: number } {
  return {
    done: items.filter((item) => item.status === "done").length,
    total: items.length,
    missingRequired: items.filter((item) => item.required && item.status === "pending").length,
  };
}
