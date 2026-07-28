import type { BrandLanguage, CompanyProfile, ExtractedContent, Feature, VisualIdentity } from "../../../domain/company-intelligence/company-intelligence.model.js";
import { classifySegment } from "./segment-classification.js";

/**
 * Monta o Company Profile (seção 1) a partir do que foi coletado automaticamente — nunca
 * preenche um campo com um valor inventado: quando a heurística não encontra evidência, o campo
 * fica vazio/array vazio, e isso aparece no relatório de qualidade como item pendente.
 */

export type CompanyProfileBuilderInput = {
  domain: string;
  homeTitle?: string;
  language?: string;
  content: ExtractedContent[];
  features: Feature[];
  visualIdentity: VisualIdentity;
  brandLanguage: BrandLanguage;
  now?: Date;
};

export function buildCompanyProfile(input: CompanyProfileBuilderInput): CompanyProfile {
  const now = (input.now ?? new Date()).toISOString();
  const allText = input.content.flatMap((entry) => [...entry.headlines, ...entry.subheadlines, ...entry.paragraphs]).join(" ");
  const companyName = input.homeTitle?.split(/[-|–—]/)[0]?.trim() || input.domain;

  const objectives = Array.from(new Set(input.content.flatMap((entry) => entry.ctas))).slice(0, 5);
  const keyDifferentiators = Array.from(new Set(input.content.flatMap((entry) => entry.differentiators)));
  const painPointsSolved = Array.from(new Set(input.features.map((feature) => feature.painPointSolved).filter(Boolean)));
  const keyBenefits = Array.from(new Set(input.content.flatMap((entry) => entry.benefits)));

  return {
    id: `company-${input.domain.replace(/\./g, "-")}`,
    companyName,
    domain: input.domain,
    segment: classifySegment(`${allText} ${input.domain}`),
    subsegment: undefined,
    language: input.language ?? "pt-BR",
    market: "Brasil",
    valueProposition: input.content[0]?.headlines[0] ?? "",
    toneOfVoice: input.brandLanguage.tone,
    visualIdentity: input.visualIdentity,
    targetAudience: "",
    objectives,
    keyDifferentiators,
    painPointsSolved,
    keyBenefits,
    identifiedCompetitors: [],
    keywords: input.brandLanguage.vocabulary,
    slogan: input.brandLanguage.positioning || undefined,
    officialCta: input.brandLanguage.ctas[0],
    discoveredAt: now,
    updatedAt: now,
  };
}
