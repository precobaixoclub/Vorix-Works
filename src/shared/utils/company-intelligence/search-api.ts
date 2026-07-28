import type { CompanyKnowledgeBase, CompanySearchResult } from "../../../domain/company-intelligence/company-intelligence.model.js";

/**
 * API de busca sobre a base de conhecimento de uma empresa (seção 10). Roteamento por
 * palavra-chave (determinístico, sem LLM) sobre perguntas em PT-BR no estilo dos exemplos da
 * especificação ("Qual a tela oficial do X?", "Quais benefícios de Y?", "Qual CTA oficial?").
 * Quando nada é encontrado, `confidence: 0` e uma resposta honesta — nunca inventa dado.
 */

function findFeatureByName(base: CompanyKnowledgeBase, question: string) {
  const q = question.toLowerCase();
  return base.features.find((feature) => q.includes(feature.name.toLowerCase()) || feature.keywords.some((keyword) => q.includes(keyword)));
}

export function searchCompanyKnowledge(base: CompanyKnowledgeBase, question: string): CompanySearchResult {
  const q = question.toLowerCase();

  if (q.includes("tela") && (q.includes("oficial") || q.includes("de "))) {
    const feature = findFeatureByName(base, q);
    if (feature && feature.relatedScreenIds.length > 0) {
      const screen = base.screens.find((entry) => entry.id === feature.relatedScreenIds[0]);
      if (screen) {
        return { answer: `A tela oficial de "${feature.name}" é ${screen.sourceUrl} (categoria: ${screen.category}).`, confidence: 0.9, sourceNodeIds: [`screen:${screen.id}`] };
      }
    }
    const screenByCategory = base.screens.find((screen) => q.includes(screen.category.replace("_", " ")));
    if (screenByCategory) {
      return { answer: `A tela oficial (${screenByCategory.category}) é ${screenByCategory.sourceUrl}.`, confidence: 0.75, sourceNodeIds: [`screen:${screenByCategory.id}`] };
    }
    return { answer: "Nenhuma tela oficial capturada corresponde a essa pergunta.", confidence: 0, sourceNodeIds: [] };
  }

  if (q.includes("benefíc") || q.includes("beneficio")) {
    const feature = findFeatureByName(base, q);
    if (feature?.benefit) {
      return { answer: feature.benefit, confidence: 0.85, sourceNodeIds: [`feature:${feature.id}`] };
    }
    return { answer: "Nenhum benefício mapeado para essa funcionalidade.", confidence: 0, sourceNodeIds: [] };
  }

  if (q.includes("cta") || q.includes("chamada")) {
    if (base.profile.officialCta) {
      return { answer: base.profile.officialCta, confidence: 0.95, sourceNodeIds: ["profile:officialCta"] };
    }
    if (base.brandLanguage.ctas.length > 0) {
      return { answer: base.brandLanguage.ctas[0], confidence: 0.6, sourceNodeIds: ["profile:officialCta"] };
    }
    return { answer: "Nenhum CTA oficial identificado.", confidence: 0, sourceNodeIds: [] };
  }

  if (q.includes("cor") || q.includes("color")) {
    const color = base.profile.visualIdentity.primaryColors[0];
    return color
      ? { answer: color, confidence: 0.8, sourceNodeIds: ["profile:visualIdentity"] }
      : { answer: "Nenhuma cor principal identificada.", confidence: 0, sourceNodeIds: [] };
  }

  if (q.includes("slogan")) {
    return base.profile.slogan
      ? { answer: base.profile.slogan, confidence: 0.95, sourceNodeIds: ["profile:slogan"] }
      : { answer: "Nenhum slogan identificado.", confidence: 0, sourceNodeIds: [] };
  }

  if (q.includes("funcionalidades possuem tela") || (q.includes("funcionalidade") && q.includes("tela"))) {
    const withScreens = base.features.filter((feature) => feature.relatedScreenIds.length > 0);
    return {
      answer: withScreens.length > 0 ? withScreens.map((feature) => feature.name).join(", ") : "Nenhuma funcionalidade possui tela capturada ainda.",
      confidence: withScreens.length > 0 ? 0.85 : 0,
      sourceNodeIds: withScreens.map((feature) => `feature:${feature.id}`),
    };
  }

  const feature = findFeatureByName(base, q);
  if (feature) {
    return { answer: feature.description, confidence: 0.6, sourceNodeIds: [`feature:${feature.id}`] };
  }

  return { answer: "Não há dado coletado suficiente para responder essa pergunta.", confidence: 0, sourceNodeIds: [] };
}
