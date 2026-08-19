import type { ReferenceIntelligence } from "../../shared/utils/reference-intelligence.types.js";
import type { PerformanceCreativePlan, AdLayoutSpec } from "../../shared/utils/ad-layout.types.js";
import type { CommercialFact } from "../../shared/utils/commercial-fact-normalizer.js";
import type { ProductRenderMode } from "../../shared/utils/product-asset.types.js";

export type BiancaSupportedChannel =
  | "instagram"
  | "facebook"
  | "threads"
  | "linkedin"
  | "tiktok"
  | "pinterest"
  | "youtube"
  | "google_business"
  | "meta_ads"
  | "google_ads";

/**
 * Espelha por convenção o subconjunto de `JoaoMarketingStrategyCore` (saída real de João)
 * relevante para planejar sequência de slides e mensagens, sem importar o tipo da Skill
 * do João, para preservar o isolamento entre Skills.
 */
export type BiancaJoaoStrategySummary = {
  angle: string;
  centralPromise: string;
  keyMessages: string[];
  recommendedCta: string;
  /** Espelha `JoaoCreativeBrief` — já chega aqui em tempo de execução (`buildBiancaInput` passa o
   * objeto `strategy` inteiro), só não era lido por Bianca até agora. Fonte dos fatos comerciais
   * REAIS (`offer`/`commercialFactsSource`) que `buildPerformanceCreativePlan` usa — nunca inventa
   * um valor que não esteja aqui. */
  creativeBrief?: {
    productOrService: string;
    offer?: string;
    commercialFactsSource: "reference_image" | "registered_product" | "none";
    nonInventableInfo: string[];
    marketingObjective?: string;
    mainBenefit?: string;
    differentiator?: string;
  };
  /** Espelha `ReferenceIntelligence` — mesmo raciocínio acima. */
  referenceIntelligence?: ReferenceIntelligence;
  /** Fatos comerciais extraídos do texto livre da ideia (Commercial Fact Normalizer, Rodada 2) —
   * mesmo raciocínio acima. `buildPerformanceCreativePlan` combina isto com
   * `referenceIntelligence.commercialFacts` via `mergeCommercialFacts` — imagem sempre vence
   * quando os dois trazem o mesmo tipo de fato. */
  textCommercialFacts?: CommercialFact[];
};

/** Espelha por convenção o subconjunto de `MariaStructuredCopy` (saída real de Maria) relevante
 * pra estruturar o plano criativo — Bianca NUNCA cria copy nova a partir disto, só decide como
 * organizar visualmente o que Maria já escreveu. */
export type BiancaMariaCopySummary = {
  title: string;
  cta: string;
  imageHeadline?: string;
  claims?: Array<{ text: string; source: string }>;
};

/**
 * Espelha por convenção o formato de `SofiaArtDirectionCore` (saída real de Sofia),
 * sem importar o tipo da Skill da Sofia, para preservar o isolamento entre Skills.
 */
export type BiancaSofiaDirectionSummary = {
  visualConcept: string;
  recommendedStyle: string;
  emotionalTone: string;
  suggestedPalette: string[];
  typography: string[];
  moodboard: string[];
  designReferences: string[];
  recommendedFormat: string;
  recommendedAspectRatio: string;
  visualConstraints: string[];
  visualRisks: string[];
  observations: string[];
  nextSteps: string[];
};

/**
 * Espelha por convenção o formato de `SofiaBiancaBriefing` (saída real de Sofia,
 * já preparada pensando em Bianca), sem importar o tipo da Skill da Sofia.
 */
export type BiancaSofiaBriefing = {
  status: string;
  visualConcept: string;
  recommendedStyle: string;
  emotionalTone: string;
  suggestedPalette: string[];
  typography: string[];
  moodboard: string[];
  designReferences: string[];
  recommendedFormat: string;
  recommendedAspectRatio: string;
  visualConstraints: string[];
  channel: string;
  notes: string[];
};

export type BiancaDesignRequestInput = {
  clientId?: string;
  tenantId?: string;
  originalRequest: string;
  joaoStrategy: BiancaJoaoStrategySummary;
  sofiaDirection: BiancaSofiaDirectionSummary;
  sofiaBriefing: BiancaSofiaBriefing;
  /** Copy real da Maria — primeira vez que Bianca recebe isto (antes só via `content_request-
   * visual-only-v2`, nunca lido). Ausente em `campaign_creation` (copy/visual rodam em paralelo
   * lá) — `performanceCreativePlan` degrada graciosamente sem isto. */
  mariaCopy?: BiancaMariaCopySummary;
  channel: BiancaSupportedChannel;
  format: string;
  /**
   * Quantidade de slides/telas recomendada pelo Eduardo (mesma fonte usada para `imageCount` do
   * Pedro). Quando presente, é a autoridade única para a contagem de slides que Bianca monta —
   * substitui a heurística baseada apenas em `keyMessages.length`, evitando que Bianca e Pedro
   * cheguem a números diferentes (o que fazia o Pedro cortar o slide de fechamento/CTA em
   * silêncio). Ausente quando o formato não usa múltiplos slides (ex.: imagem única).
   */
  recommendedSlideCount?: number;
  /** Product Asset Pipeline (Rodada 2, Prioridade 1) — decisão já resolvida ANTES de Bianca rodar
   * (precisa existir antes dela decidir se inclui uma zona `heroProduct`), computada em
   * `real-skill-execution-handlers.ts` a partir da imagem de referência real. Ausente quando o
   * pipeline nunca rodou (ex.: sem `objectStorage` configurado) — degrada para o comportamento de
   * sempre (produto desenhado pelo próprio Pedro). */
  productAsset?: BiancaProductAssetSummary;
  workflowContext?: Record<string, unknown>;
};

export type BiancaProductAssetSummary = {
  mode: ProductRenderMode;
  reasoning: string;
  /** URL do recorte real do produto (fundo já neutralizado) — só presente quando
   * `mode === "original_asset"`. */
  heroProductAssetUrl?: string;
};

export type BiancaTypographyScale = {
  headline: string;
  subheadline: string;
  body: string;
  caption: string;
  cta: string;
};

/**
 * Decisões de Bianca como Diretora de Arte (não apenas layout) para um slide específico — o que
 * domina a tela, quanto espaço ocupa, para onde o olho vai primeiro, que emoção a imagem transmite
 * antes de qualquer leitura, quanto tempo leva para compreender a mensagem, e se há tensão,
 * equilíbrio e contraste suficientes. Sempre preenchido pela heurística determinística de Bianca
 * (`buildHookSlide`/`buildMessageSlide`/`buildCtaSlide`/`buildSingleSlide`), garantindo que todo
 * slide já nasça com julgamento de direção de arte, independente de apoio de IA.
 */
export type BiancaArtDirectorAssessment = {
  dominantElement: string;
  dominantElementScreenShare: string;
  eyeFlowFirstFocus: string;
  emotionBeforeReading: string;
  timeToUnderstand: string;
  visualTension: string;
  balance: string;
  contrastAssessment: string;
};

export type BiancaSlideDesign = {
  slideIndex: number;
  role: string;
  focalPoint: string;
  visualWeightOrder: string[];
  headlineSize: string;
  subheadlineSize: string;
  bodyTextSize: string;
  alignment: string;
  margins: string;
  breathingRoom: string;
  supportingElements: string[];
  emphasis: string;
  secondaryElements: string;
  logoPlacement: string;
  /** Posição do CTA neste slide especificamente; ausente/vazio quando o slide não tem CTA. */
  ctaPlacement?: string;
  /** Bianca como Diretora de Arte — ver `BiancaArtDirectorAssessment`. */
  artDirection: BiancaArtDirectorAssessment;
};

export type BiancaCarouselFlow = {
  totalSlides: number;
  readingFlow: string;
  sequenceNotes: string[];
  consistencyRules: string[];
};

export type BiancaDesignCore = {
  designConcept: string;
  visualConcept: string;
  emotionalObjective: string;
  desiredFeeling: string;
  minimalismLevel: string;
  visualStyle: string;
  recommendedStyle: string;
  suggestedPalette: string[];
  recommendedFormat: string;
  recommendedAspectRatio: string;
  gridSystem: string;
  visualHierarchyStrategy: string;
  typographyScale: BiancaTypographyScale;
  compositionStrategy: string;
  lightingStrategy: string;
  depthStrategy: string;
  contrastStrategy: string;
  colorApplication: string;
  spacingSystem: string;
  componentStyle: string[];
  illustrationStyle: string;
  mockupStyle: string;
  iconographyUsage: string[];
  mockupUsage: string[];
  photographyUsage: string[];
  illustrationUsage: string[];
  cardUsage: string[];
  colorBlockUsage: string[];
  photoTreatment: string;
  decorativeElements: string[];
  logoPlacement: string;
  instagramSafeArea: string;
  logoSizing: string;
  titleSizing: string;
  subtitleSizing: string;
  supportTextSizing: string;
  buttonSizing: string;
  elementSpacingRules: string[];
  alignmentRules: string[];
  shadowRules: string[];
  /** Posição e nível de destaque do CTA na peça — política geral; cada slide pode refinar via `BiancaSlideDesign.ctaPlacement`. */
  ctaPlacement: string;
  /** Só populado quando o formato pede uma capa de Reels; ausente para os demais formatos. */
  reelsCoverComposition?: string;
  coverRules: string[];
  internalSlideRules: string[];
  finalCtaRules: string[];
  reelsCoverRules: string[];
  /** Regras dedicadas de contraste (texto/fundo, CTA/fundo) — distintas de `colorApplication`, que descreve a aplicação da paleta, não o contraste em si. */
  contrastRules: string[];
  /** Regras dedicadas de acessibilidade visual (leitura para daltonismo, tamanho mínimo de fonte, texto alternativo). */
  accessibilityGuidelines: string[];
  /** Regras de padronização visual sempre presentes — para carrossel, cobre consistência entre slides; para peça única, cobre consistência com as demais peças da marca. */
  visualStandardizationRules: string[];
  slides: BiancaSlideDesign[];
  carouselFlow?: BiancaCarouselFlow;
  designConstraints: string[];
  designRisks: string[];
  observations: string[];
  nextSteps: string[];
  technicalJustification: string;
  /** Plano criativo de performance (Fase 2) — transforma creative_brief + fatos comerciais + copy
   * numa estratégia visual de conversão. `undefined` quando não há sinal comercial algum
   * disponível (sem `creativeBrief`/`referenceIntelligence`/`mariaCopy`) — degrada para o
   * comportamento de sempre (só o design-spec em prosa). */
  performanceCreativePlan?: PerformanceCreativePlan;
  /** Layout estruturado (Fase 5-6) — zonas com tipo/prioridade/posição, derivado do plano acima.
   * `undefined` nas mesmas condições de `performanceCreativePlan`. */
  adLayoutSpec?: AdLayoutSpec;
};

/**
 * Deliberadamente um literal plano (não uma interseção com `BiancaDesignCore`) para que
 * este documento continue autocontido e o espelhamento de campos com `PedroBiancaBriefing`
 * (definido de forma independente no Pedro) permaneça verificável campo a campo.
 */
export type BiancaPedroBriefing = {
  status: "structured";
  designConcept: string;
  visualConcept: string;
  emotionalObjective: string;
  desiredFeeling: string;
  minimalismLevel: string;
  visualStyle: string;
  recommendedStyle: string;
  suggestedPalette: string[];
  recommendedFormat: string;
  recommendedAspectRatio: string;
  gridSystem: string;
  visualHierarchyStrategy: string;
  typographyScale: BiancaTypographyScale;
  compositionStrategy: string;
  lightingStrategy: string;
  depthStrategy: string;
  contrastStrategy: string;
  colorApplication: string;
  spacingSystem: string;
  componentStyle: string[];
  illustrationStyle: string;
  mockupStyle: string;
  iconographyUsage: string[];
  mockupUsage: string[];
  photographyUsage: string[];
  illustrationUsage: string[];
  cardUsage: string[];
  colorBlockUsage: string[];
  photoTreatment: string;
  decorativeElements: string[];
  logoPlacement: string;
  instagramSafeArea: string;
  logoSizing: string;
  titleSizing: string;
  subtitleSizing: string;
  supportTextSizing: string;
  buttonSizing: string;
  elementSpacingRules: string[];
  alignmentRules: string[];
  shadowRules: string[];
  ctaPlacement: string;
  reelsCoverComposition?: string;
  coverRules: string[];
  internalSlideRules: string[];
  finalCtaRules: string[];
  reelsCoverRules: string[];
  contrastRules: string[];
  accessibilityGuidelines: string[];
  visualStandardizationRules: string[];
  slides: BiancaSlideDesign[];
  carouselFlow?: BiancaCarouselFlow;
  designConstraints: string[];
  designRisks: string[];
  observations: string[];
  nextSteps: string[];
  technicalJustification: string;
  performanceCreativePlan?: PerformanceCreativePlan;
  adLayoutSpec?: AdLayoutSpec;
  channel: BiancaSupportedChannel;
  notes: string[];
};

export type BiancaDesignOutput = BiancaDesignCore & {
  pedroBriefing: BiancaPedroBriefing;
  aiSupportUsed: boolean;
  /** `provider.id` do Ícaro quando `aiSupportUsed` é `true` — ver `JoaoMarketingStrategyOutput.aiProviderId`. */
  aiProviderId?: string;
};

export type BiancaDesignEnhancement = {
  gridSystem?: string;
  visualHierarchyStrategy?: string;
  compositionStrategy?: string;
  lightingStrategy?: string;
  depthStrategy?: string;
  contrastStrategy?: string;
  colorApplication?: string;
  componentStyle?: string[];
  illustrationStyle?: string;
  iconographyUsage?: string[];
  mockupUsage?: string[];
  photographyUsage?: string[];
  illustrationUsage?: string[];
  cardUsage?: string[];
  colorBlockUsage?: string[];
  photoTreatment?: string;
  decorativeElements?: string[];
  elementSpacingRules?: string[];
  alignmentRules?: string[];
  shadowRules?: string[];
  coverRules?: string[];
  internalSlideRules?: string[];
  finalCtaRules?: string[];
  reelsCoverRules?: string[];
  technicalJustification?: string;
  contrastRules?: string[];
  accessibilityGuidelines?: string[];
  reelsCoverComposition?: string;
  mockupStyle?: string;
};
