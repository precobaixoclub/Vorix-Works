import type { AICostReport, AITokenUsage } from "../../application/ports/ai-provider.port.js";
import type { SkillArtifact } from "../../domain/skills/skill.contract.js";
import type { EnrichedVisualScene } from "../../shared/utils/visual-reference-library.js";
import type { CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";
import type { AdLayoutSpec, PerformanceCreativePlan } from "../../shared/utils/ad-layout.types.js";

/**
 * Saída do estágio interno "Visual Enrichment" de Pedro (`buildVisualEnrichments`, em
 * `pedro-image-generation.skill.ts`) — não é uma Skill nem uma etapa nova do `ExecutionPlan`,
 * apenas uma transformação pura que roda dentro do próprio Pedro antes da montagem do prompt
 * final, para que nenhum conceito visual simples ("caixa de presente") vire imagem sem antes
 * ganhar cena, luz, profundidade e material reais. Tipo re-exportado (não copiado) de
 * `EnrichedVisualScene` porque `src/shared` não é uma Skill — importar de lá diretamente não
 * viola o isolamento entre Skills (ADR 0002), o mesmo padrão já usado por
 * `content-format-classification.ts`.
 */
export type PedroVisualEnrichment = EnrichedVisualScene;

export type PedroSupportedChannel =
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

export type PedroTypographyScale = {
  headline: string;
  subheadline: string;
  body: string;
  caption: string;
  cta: string;
};

/**
 * Espelha por convenção o formato de `BiancaArtDirectorAssessment` (saída real de Bianca),
 * sem importar o tipo da Skill da Bianca, para preservar o isolamento entre Skills.
 */
export type PedroArtDirectorAssessment = {
  dominantElement: string;
  dominantElementScreenShare: string;
  eyeFlowFirstFocus: string;
  emotionBeforeReading: string;
  timeToUnderstand: string;
  visualTension: string;
  balance: string;
  contrastAssessment: string;
};

export type PedroSlideDesign = {
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
  ctaPlacement?: string;
  /** Bianca como Diretora de Arte para este slide — ver `PedroArtDirectorAssessment`. */
  artDirection?: PedroArtDirectorAssessment;
};

export type PedroCarouselFlow = {
  totalSlides: number;
  readingFlow: string;
  sequenceNotes: string[];
  consistencyRules: string[];
};

/**
 * Espelha por convenção o formato de `BiancaDesignCore` (saída real de Bianca),
 * sem importar o tipo da Skill da Bianca, para preservar o isolamento entre Skills.
 */
export type PedroBiancaDesignSummary = {
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
  typographyScale: PedroTypographyScale;
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
  slides: PedroSlideDesign[];
  carouselFlow?: PedroCarouselFlow;
  designConstraints: string[];
  designRisks: string[];
  observations: string[];
  nextSteps: string[];
  technicalJustification: string;
};

/**
 * Espelha por convenção o formato de `BiancaPedroBriefing` (saída real de Bianca,
 * já preparada pensando no Pedro), sem importar o tipo da Skill da Bianca.
 */
export type PedroBiancaBriefing = {
  status: string;
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
  typographyScale: PedroTypographyScale;
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
  slides: PedroSlideDesign[];
  carouselFlow?: PedroCarouselFlow;
  designConstraints: string[];
  designRisks: string[];
  observations: string[];
  nextSteps: string[];
  technicalJustification: string;
  channel: string;
  notes: string[];
  /**
   * Reaproveitado diretamente de `src/shared/utils/ad-layout.types.ts` — não é uma Skill,
   * mesmo padrão já usado por `PedroVisualEnrichment` (ADR 0002 permite importar de `shared`).
   * Pedro não lê estes campos diretamente hoje (a instrução de área limpa chega via
   * `workflowContext.cleanZoneInstruction`); declarados aqui só para manter o contrato
   * espelhado com `BiancaPedroBriefing`.
   */
  performanceCreativePlan?: PerformanceCreativePlan;
  adLayoutSpec?: AdLayoutSpec;
};

export type PedroImageGenerationRequestInput = {
  clientId?: string;
  tenantId?: string;
  originalRequest: string;
  biancaDesign: PedroBiancaDesignSummary;
  biancaPedroBriefing: PedroBiancaBriefing;
  channel: PedroSupportedChannel;
  format: string;
  imageCount: number;
  desiredAspectRatio: string;
  workflowContext?: Record<string, unknown>;
};

/**
 * `ai_provider` (padrão): Pedro pede a imagem ao Ícaro (`IcaroBrainPort`), que pode estar
 * configurado com um provider real ou com o fake determinístico usado em testes.
 * `developer_assisted`: Pedro nunca chama o Ícaro para gerar pixels — em vez disso, monta um
 * prompt técnico e o caminho exato onde a imagem deve ser salva, e sinaliza
 * `needs_assisted_generation` até que o arquivo exista fisicamente em disco. É o modo oficial da
 * CLI local (ver `docs/pedro-image-generation.md` e `src/interfaces/cli/README.md`), já que não
 * existe geração de imagem nativa no Claude Code nem provider externo configurado nesta fase.
 */
export type PedroImageGenerationMode = "ai_provider" | "developer_assisted";

export type PedroAssistedImageRequest = {
  index: number;
  fileName: string;
  expectedRelativePath: string;
  expectedAbsolutePath?: string;
  mimeType: string;
  width: number;
  height: number;
  prompt: string;
};

export type PedroAssistedGenerationOutput = {
  mode: "developer_assisted";
  instruction: string;
  pendingImages: PedroAssistedImageRequest[];
  resumeCommand: string;
};

export type PedroGeneratedImage = {
  id: string;
  index: number;
  fileName?: string;
  altText?: string;
  mimeType: string;
  extension: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  sizeBytes?: number;
  uri?: string;
  relativePath?: string;
  downloadHref?: string;
  localPath?: string;
  prompt: string;
};

export type PedroDeliveryArtifacts = {
  rootPath: string;
  htmlPath: string;
  htmlRelativePath: string;
  imagePaths: string[];
  imageRelativePaths: string[];
  promptPaths: string[];
  promptRelativePaths: string[];
  captionPath?: string;
  captionRelativePath?: string;
  metadataPath: string;
  metadataRelativePath: string;
  zipPath?: string;
  zipRelativePath?: string;
  downloadInstructions: string;
};

export type PedroAgencyQualityChecklist = {
  premiumLayoutPotential: boolean;
  hierarchyReady: boolean;
  whitespaceGuided: boolean;
  gridReady: boolean;
  alignmentReady: boolean;
  contrastGuided: boolean;
  typographyGuided: boolean;
  ctaGuided: boolean;
  carouselStorytellingReady: boolean;
  premiumBrandFitReady: boolean;
  accessibilityGuided: boolean;
  visualStandardizationGuided: boolean;
};

export type PedroProductionReadinessReport = {
  status: "ready" | "ready_with_warnings" | "needs_more_context";
  score: number;
  blockingIssues: string[];
  warnings: string[];
  strengths: string[];
  upstreamRecommendations: string[];
  agencyChecklist: PedroAgencyQualityChecklist;
};

export type PedroImageGenerationOutput = {
  generationSummary: string;
  finalPrompt: string;
  qualityReport: PedroProductionReadinessReport;
  imageCount: number;
  images: PedroGeneratedImage[];
  artifacts: SkillArtifact[];
  delivery?: PedroDeliveryArtifacts;
  /**
   * Diferencia explicitamente a origem da imagem: `ai_provider` (Ícaro — real ou fake
   * determinístico de teste, distinguível por `providerUsed`) ou `developer_assisted`
   * (intervenção assistida da IA desenvolvedora, sem custo de IA e sem provider).
   */
  generationMode: PedroImageGenerationMode;
  providerUsed?: string;
  modelUsed?: string;
  cost: AICostReport;
  usage: AITokenUsage;
  executionDurationMs: number;
  warnings: string[];
  observations: string[];
  nextSteps: string[];
  /** Uma cena por imagem gerada, na mesma ordem de `images` — ver `PedroVisualEnrichment`. */
  visualEnrichments: PedroVisualEnrichment[];
  /** Identidade criativa da campanha (Creative Director Engine) — enriquece o prompt, nunca decide layout sozinha. */
  creativeDna: CampaignCreativeDNA;
};

export type PedroRawGeneratedImage = {
  altText?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  data?: string;
  uri?: string;
};

/**
 * Espelha, de forma genérica, o resumo de Skills já concluídas que o Caio injeta em
 * `workflowContext.upstreamSkillsReport` (ver `caio.executor.ts`). Não representa nenhuma Skill
 * específica — apenas nome, id e estado — para alimentar a seção "Relatório das Skills utilizadas"
 * da página de entrega sem que Pedro precise conhecer o formato de saída de outra Skill.
 */
export type PedroUpstreamSkillReportEntry = {
  skillId?: string;
  name: string;
  state: string;
};
