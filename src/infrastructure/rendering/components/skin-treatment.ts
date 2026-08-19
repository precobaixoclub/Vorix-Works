import type { ComponentSkin } from "../../../shared/utils/brand-visual-profile.types.js";

/**
 * Tratamento visual de um skin — deltas de estilo aplicados por cima do layout já calculado por
 * cada componente (posição/tamanho continuam vindos do `adLayoutSpec`; só a APARÊNCIA muda).
 * Centralizado aqui em vez de duplicado em cada componente, para que os 6 skins produzam
 * exatamente a mesma linguagem visual em qualquer componente que os use (Prioridade 6).
 */
export type SkinTreatment = {
  /** Multiplica o raio de borda "natural" do componente (1 = sem mudança). */
  borderRadiusScale: number;
  /** Borda decorativa ADICIONADA por cima do preenchimento sólido de sempre — nunca remove o
   * fundo (o fundo garante o contraste que o quality gate de tipografia do Lucas valida; um
   * componente sem preenchimento algum sobre a foto imprevisível do Pedro arriscaria legibilidade
   * sem nenhum sinal disso chegar ao gate, mesmo achado ao vivo que motivou o scrim do Headline). */
  border?: { widthPx: number; colorSource: "accentOrText" | "text" };
  /** Multiplica o padding "natural" do componente (premium = mais respiro; marketplace = mais denso). */
  paddingScale: number;
  fontWeight: number;
  letterSpacing?: number;
  textTransform?: "uppercase";
};

const SKIN_TREATMENTS: Record<ComponentSkin, SkinTreatment> = {
  // Visual de sempre (pré-Prioridade 6) — preenchido, cantos arredondados, peso forte.
  clean: { borderRadiusScale: 1, paddingScale: 1, fontWeight: 700 },
  // Maior contraste/peso, cantos quase retos, menos respiro — "grita" mais.
  bold: { borderRadiusScale: 0.3, paddingScale: 0.85, fontWeight: 800 },
  // Cantos mais suaves, muito mais respiro, peso mais leve — sofisticação via espaço em branco.
  premium: { borderRadiusScale: 1.6, paddingScale: 1.6, fontWeight: 600, letterSpacing: 0.4 },
  // Cantos retos, borda fina discreta — tratamento editorial/revista, nunca "banner".
  editorial: { borderRadiusScale: 0, border: { widthPx: 1, colorSource: "text" }, paddingScale: 1.15, fontWeight: 500, letterSpacing: 0.6 },
  // Borda grossa colorida por cima do preenchimento — contorno como assinatura visual.
  outlined: { borderRadiusScale: 1, border: { widthPx: 2, colorSource: "accentOrText" }, paddingScale: 1, fontWeight: 700 },
  // Denso, cantos quase retos, caixa alta — linguagem de e-commerce/marketplace, nunca elegante.
  marketplace: { borderRadiusScale: 0.15, paddingScale: 0.7, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase" },
};

export function resolveSkinTreatment(skin: ComponentSkin | undefined): SkinTreatment {
  return SKIN_TREATMENTS[skin ?? "clean"];
}
