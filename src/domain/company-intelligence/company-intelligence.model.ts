/**
 * COMPANY INTELLIGENCE ENGINE — modelos de domínio (seções 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14).
 * Vive em `src/domain/` (conceitos estáveis, nunca dependem de application/infraestrutura) —
 * diferente do módulo `coverage/` de uma sprint anterior, este módulo não precisa de nenhum tipo
 * de `application/ports`, então pode legitimamente ficar na camada de domínio mais pura do
 * projeto, como o README de `src/domain/` pede.
 *
 * Nenhuma Skill importa nada daqui diretamente — só a camada de infraestrutura/orquestração desta
 * sprint, que depois traduz este conhecimento para o vocabulário que Clara e o Product Screen
 * Catalog (ambos protegidos, nunca alterados) já sabem consumir.
 */

// -------------------------------------------------------------------------------------------
// 1. COMPANY PROFILE
// -------------------------------------------------------------------------------------------

export type VisualIdentity = {
  logoUrls: string[];
  iconUrls: string[];
  primaryColors: string[];
  secondaryColors: string[];
  fontFamilies: string[];
};

export type CompanyProfile = {
  id: string;
  companyName: string;
  domain: string;
  segment: string;
  subsegment?: string;
  language: string;
  market: string;
  valueProposition: string;
  toneOfVoice: string;
  visualIdentity: VisualIdentity;
  targetAudience: string;
  objectives: string[];
  keyDifferentiators: string[];
  painPointsSolved: string[];
  keyBenefits: string[];
  identifiedCompetitors: string[];
  keywords: string[];
  slogan?: string;
  officialCta?: string;
  discoveredAt: string;
  updatedAt: string;
};

// -------------------------------------------------------------------------------------------
// 2. WEBSITE DISCOVERY
// -------------------------------------------------------------------------------------------

export const PAGE_CATEGORIES = [
  "home", "menu", "page", "landing_page", "blog", "faq", "contact", "policy",
  "plans", "features", "resources", "integrations", "documentation", "demo", "unknown",
] as const;
export type PageCategory = (typeof PAGE_CATEGORIES)[number];

export type DiscoveredPage = {
  url: string;
  path: string;
  category: PageCategory;
  title?: string;
  discoveredVia: "nav_link" | "sitemap" | "seed" | "internal_link";
  fetchedAt?: string;
  contentHash?: string;
  httpStatus?: number;
};

// -------------------------------------------------------------------------------------------
// 3. CONTENT EXTRACTION
// -------------------------------------------------------------------------------------------

export type ExtractedFaqItem = { question: string; answer: string };
export type ExtractedPlan = { name: string; price?: string; period?: string; description?: string; features: string[] };
export type ExtractedTestimonial = { author?: string; text: string };

export type ExtractedContent = {
  pageUrl: string;
  headlines: string[];
  subheadlines: string[];
  paragraphs: string[];
  lists: string[][];
  faq: ExtractedFaqItem[];
  benefits: string[];
  features: string[];
  ctas: string[];
  testimonials: ExtractedTestimonial[];
  plans: ExtractedPlan[];
  differentiators: string[];
};

// -------------------------------------------------------------------------------------------
// 4. SCREEN CAPTURE
// -------------------------------------------------------------------------------------------

export const SCREEN_CATEGORIES = [
  "home", "rsvp", "gift_list", "timeline", "album", "couple_page",
  "confirmation", "invitation", "guest_area", "table_lookup", "party_actions", "unknown",
] as const;
export type ScreenCategory = (typeof SCREEN_CATEGORIES)[number];

export type CapturedScreen = {
  id: string;
  sourceUrl: string;
  category: ScreenCategory;
  absolutePath: string;
  width: number;
  height: number;
  capturedAt: string;
};

// -------------------------------------------------------------------------------------------
// 5. VISUAL ASSET LIBRARY / 9. COMPANY MEDIA LIBRARY
// -------------------------------------------------------------------------------------------

export const MEDIA_ITEM_CATEGORIES = [
  "logo", "icon", "image", "video", "svg", "banner", "background", "mockup", "screen_capture", "color_swatch", "font",
] as const;
export type MediaItemCategory = (typeof MEDIA_ITEM_CATEGORIES)[number];

export type MediaLibraryItem = {
  id: string;
  category: MediaItemCategory;
  description: string;
  tags: string[];
  origin: string;
  license: string;
  sourceUrl?: string;
  absolutePath?: string;
  date: string;
  relatedFeatureIds: string[];
};

// -------------------------------------------------------------------------------------------
// 6. FEATURE DISCOVERY
// -------------------------------------------------------------------------------------------

export type Feature = {
  id: string;
  name: string;
  description: string;
  benefit: string;
  painPointSolved: string;
  category: string;
  keywords: string[];
  relatedScreenIds: string[];
};

// -------------------------------------------------------------------------------------------
// 7. BRAND LANGUAGE
// -------------------------------------------------------------------------------------------

export type BrandLanguage = {
  tone: string;
  style: string;
  vocabulary: string[];
  recurringExpressions: string[];
  ctas: string[];
  promises: string[];
  positioning: string;
};

// -------------------------------------------------------------------------------------------
// 8. KNOWLEDGE GRAPH
// -------------------------------------------------------------------------------------------

export const KNOWLEDGE_NODE_TYPES = ["feature", "benefit", "problem", "screen", "asset", "page", "cta", "audience"] as const;
export type KnowledgeNodeType = (typeof KNOWLEDGE_NODE_TYPES)[number];

export type KnowledgeNode = { id: string; type: KnowledgeNodeType; label: string };
export type KnowledgeEdge = { from: string; to: string; relation: string };
export type KnowledgeGraph = { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] };

// -------------------------------------------------------------------------------------------
// 10. SEARCH API
// -------------------------------------------------------------------------------------------

export type CompanySearchResult = { answer: string; confidence: number; sourceNodeIds: string[] };

// -------------------------------------------------------------------------------------------
// 13/14. QUALITY REPORT + CONTINUOUS LEARNING
// -------------------------------------------------------------------------------------------

export type CompanyQualityReport = {
  domain: string;
  generatedAt: string;
  pagesFound: number;
  featuresIdentified: number;
  ctasFound: number;
  assetsCollected: number;
  screensCaptured: number;
  benefitsFound: number;
  painPointsSolved: number;
  brandScore: number;
  coverageScore: number;
  pendingItems: string[];
};

/** Base viva completa de uma empresa — o que fica persistido e disponível para toda Skill (seção 11), sempre por trás da mesma API, nunca exposta diretamente aos tipos de nenhuma Skill. */
export type CompanyKnowledgeBase = {
  profile: CompanyProfile;
  pages: DiscoveredPage[];
  content: ExtractedContent[];
  screens: CapturedScreen[];
  mediaLibrary: MediaLibraryItem[];
  features: Feature[];
  brandLanguage: BrandLanguage;
  graph: KnowledgeGraph;
  qualityReport: CompanyQualityReport;
};
