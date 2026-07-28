import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraKnowledgeActor } from "../../application/knowledge/clara.types.js";
import type { CompanyKnowledgeBase } from "../../domain/company-intelligence/company-intelligence.model.js";

/**
 * Ponte Company Intelligence → Clara (seção 11, "Creative Context"). Nunca altera
 * `ClaraKnowledgeCenter`/`clara-knowledge.port.ts` — só chama `create()`, a mesma API pública que
 * qualquer especialista já usa. É assim que João/Bruno/Vanessa/Diego/Pedro/Nora/Sofia/Bianca (via
 * `requestContext()`, que eles já chamam hoje) passam a receber Company Profile/Brand
 * Language/Feature Library sem qualquer mudança no código de nenhum deles — desde que os módulos
 * escritos aqui coincidam com os que cada Skill já lista na própria chamada.
 *
 * Cobre BrandContext/BusinessContext/AudienceContext/ProductContext/IdentityContext — os cinco
 * módulos com mapeamento direto e honesto a partir do que a engine realmente coleta.
 * PublishingContext (redes sociais conectadas) e CampaignContext/ContentContext não têm
 * equivalente nos dados coletados e são deliberadamente deixados de fora, não preenchidos com
 * inferência forçada.
 */

const ENGINE_ACTOR: ClaraKnowledgeActor = { id: "company-intelligence-engine", type: "system", name: "Company Intelligence Engine" };

export type ClaraPublishResult = { module: string; recordId: string };

export async function publishCompanyKnowledgeToClara(
  base: CompanyKnowledgeBase,
  clientId: string,
  clara: ClaraKnowledgePort,
): Promise<ClaraPublishResult[]> {
  const { profile, brandLanguage, features } = base;
  const audit = { actor: ENGINE_ACTOR, reason: `Coleta automática de Company Intelligence para ${profile.domain}`, correlationId: `company-intelligence-${profile.domain}` };
  const results: ClaraPublishResult[] = [];

  const brand = await clara.create({
    module: "BrandContext",
    title: `Marca — ${profile.companyName}`,
    payload: {
      clientId,
      brandName: profile.companyName,
      positioning: brandLanguage.positioning || undefined,
      promise: brandLanguage.promises[0],
      toneOfVoice: brandLanguage.tone,
      preferredCtas: brandLanguage.ctas,
      importantLinks: [`https://${profile.domain}`],
      keywords: profile.keywords,
    },
    tags: ["company-intelligence", profile.domain],
    audit,
  });
  results.push({ module: "BrandContext", recordId: brand.id });

  const business = await clara.create({
    module: "BusinessContext",
    title: `Negócio — ${profile.companyName}`,
    payload: {
      clientId,
      businessName: profile.companyName,
      segment: profile.segment,
      description: profile.valueProposition || undefined,
      marketingObjectives: profile.objectives,
      keywords: profile.keywords,
    },
    tags: ["company-intelligence", profile.domain],
    audit,
  });
  results.push({ module: "BusinessContext", recordId: business.id });

  if (profile.targetAudience) {
    const audience = await clara.create({
      module: "AudienceContext",
      title: `Público — ${profile.companyName}`,
      payload: { clientId, targetAudience: profile.targetAudience, keywords: profile.keywords },
      tags: ["company-intelligence", profile.domain],
      audit,
    });
    results.push({ module: "AudienceContext", recordId: audience.id });
  }

  const product = await clara.create({
    module: "ProductContext",
    title: `Produto — ${profile.companyName}`,
    payload: {
      clientId,
      productName: profile.companyName,
      description: profile.valueProposition || profile.companyName,
      benefits: profile.keyBenefits,
      differentiators: profile.keyDifferentiators,
      features: features.map((feature) => feature.name),
      keywords: profile.keywords,
    },
    tags: ["company-intelligence", profile.domain],
    audit,
  });
  results.push({ module: "ProductContext", recordId: product.id });

  const identity = await clara.create({
    module: "IdentityContext",
    title: `Identidade Visual — ${profile.companyName}`,
    payload: {
      clientId,
      colors: [...profile.visualIdentity.primaryColors, ...profile.visualIdentity.secondaryColors],
      fonts: profile.visualIdentity.fontFamilies,
      logoUri: profile.visualIdentity.logoUrls[0],
      keywords: profile.keywords,
    },
    tags: ["company-intelligence", profile.domain],
    audit,
  });
  results.push({ module: "IdentityContext", recordId: identity.id });

  return results;
}
