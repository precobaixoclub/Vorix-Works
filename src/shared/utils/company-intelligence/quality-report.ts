import type { CompanyKnowledgeBase, CompanyQualityReport } from "../../../domain/company-intelligence/company-intelligence.model.js";

/**
 * Relatório de qualidade da coleta (seção 14): o que foi encontrado, o que ficou pendente, e
 * dois scores (0-100) — Brand Score (o quanto a linguagem de marca foi capturada) e Coverage
 * Score (o quanto do produto tem tela real associada). Nenhum dos dois é aleatório: cada ponto
 * vem de uma condição explícita, listada nos comentários abaixo, para o score ser auditável.
 */

export function buildQualityReport(base: CompanyKnowledgeBase): CompanyQualityReport {
  const pendingItems: string[] = [];

  let brandScore = 0;
  if (base.brandLanguage.tone) brandScore += 15;
  if (base.brandLanguage.style) brandScore += 15;
  if (base.brandLanguage.vocabulary.length > 0) brandScore += 15;
  if (base.brandLanguage.ctas.length > 0) brandScore += 15; else pendingItems.push("Nenhum CTA identificado.");
  if (base.brandLanguage.promises.length > 0) brandScore += 15; else pendingItems.push("Nenhuma promessa de marca identificada.");
  if (base.brandLanguage.positioning) brandScore += 15; else pendingItems.push("Nenhum posicionamento/slogan identificado.");
  if (base.profile.visualIdentity.primaryColors.length > 0) brandScore += 10; else pendingItems.push("Nenhuma cor de marca identificada.");

  const featuresWithScreens = base.features.filter((feature) => feature.relatedScreenIds.length > 0).length;
  const featureScreenRatio = base.features.length > 0 ? featuresWithScreens / base.features.length : 0;
  let coverageScore = 0;
  coverageScore += Math.round(featureScreenRatio * 40);
  coverageScore += base.screens.length > 0 ? 20 : 0;
  coverageScore += base.mediaLibrary.length > 0 ? 20 : 0;
  coverageScore += base.pages.length >= 3 ? 20 : Math.round((base.pages.length / 3) * 20);

  if (featuresWithScreens < base.features.length) {
    pendingItems.push(`${base.features.length - featuresWithScreens} de ${base.features.length} funcionalidades ainda sem tela real associada.`);
  }
  if (base.screens.length === 0) pendingItems.push("Nenhuma tela real capturada.");
  if (base.mediaLibrary.length === 0) pendingItems.push("Nenhum asset visual coletado.");
  if (!base.profile.targetAudience) pendingItems.push("Público-alvo não inferido automaticamente — requer curadoria humana.");
  if (base.profile.identifiedCompetitors.length === 0) pendingItems.push("Nenhum concorrente identificado automaticamente.");

  return {
    domain: base.profile.domain,
    generatedAt: new Date().toISOString(),
    pagesFound: base.pages.length,
    featuresIdentified: base.features.length,
    ctasFound: base.brandLanguage.ctas.length,
    assetsCollected: base.mediaLibrary.length,
    screensCaptured: base.screens.length,
    benefitsFound: base.profile.keyBenefits.length,
    painPointsSolved: base.profile.painPointsSolved.length,
    brandScore,
    coverageScore,
    pendingItems,
  };
}
