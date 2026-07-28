import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ArthurOrchestrator } from "../../application/orchestration/index.js";
// AUTONOMOUS EXECUTION ENGINE — importado dinamicamente (ver `runAutonomousExecution`/
// `simulateAutonomousExecution` abaixo), nunca estaticamente: os arquivos de ação em
// `action-registry.ts` importam funções deste mesmo módulo (`acquireMediaForExecution`,
// `productScreenScan` etc.), então um `import` estático aqui criaria uma dependência circular
// (run-command -> action-registry -> actions/* -> run-command) que quebra a ordem de
// inicialização de módulos ESM sempre que algo importa o motor autônomo antes deste arquivo
// terminar de carregar (reproduzido em testes que importam uma ação diretamente). `import()`
// dinâmico adia a resolução para o momento da chamada, quando este módulo já está completamente
// inicializado — só tipos são importados estaticamente (apagados na compilação, nunca geram um
// import de runtime).
import type { AutonomousEngineOutcome, Blocker } from "../../application/orchestration/autonomous/autonomous-types.js";
import type { WorkflowExecutionReport, WorkflowHumanApprovalInput } from "../../application/workflows/caio.types.js";
import { CaioWorkflowExecutor } from "../../application/workflows/index.js";
import { ClaraKnowledgeCenter, syncEditorialLibrary, syncQualityFeedbackToClara } from "../../application/knowledge/index.js";
import { QualityFeedbackCenter } from "../../application/quality-feedback/index.js";
import type {
  QualityFeedbackCategory,
  QualityFeedbackCategoryRating,
  QualityFeedbackQuery,
  QualityFeedbackRatingInput,
  QualityFeedbackRecord,
  QualityFeedbackReport,
} from "../../application/quality-feedback/index.js";
import { CampaignManager } from "../../application/campaign/index.js";
import type {
  CampaignContentExecutionPlanResult,
  CampaignContentStatus,
  CampaignPlan,
  CampaignQuery,
  CampaignStatusSummary,
} from "../../application/campaign/index.js";
import { HelenaSkillManager, SkillManifestValidator, SkillRegistry } from "../../application/skills/index.js";
import { ValentinaTenantManager } from "../../application/tenancy/index.js";
import type { SocialPostDraft, SocialPublicationResult, SocialPublisherPort } from "../../application/ports/social-publisher.port.js";
import type { VisualAssetMetadata, VisualAssetSearchQuery, VisualAssetResolved, VisualAssetCreationPackage, VisualSequenceRole } from "../../application/ports/visual-asset-provider.port.js";
import { isAssetQualityProfile, DEFAULT_ASSET_DIVERSITY_REQUIREMENTS, type AssetQualityProfile } from "../../application/ports/asset-quality-profile.js";
import { buildCoverageGraph, deriveVideoElevatedShotIds } from "../../shared/utils/coverage/coverage-graph.js";
import { canStartProductCompositing } from "../../shared/utils/coverage/product-compositing-gate.js";
import {
  buildCoverageMatrix,
  coverageByCategory,
  coverageByScene,
  coverageOverall,
  formatCategoryGroupLabel,
  type CoverageFraction,
  type CoverageMatrixRow,
} from "../../shared/utils/coverage/coverage-matrix.js";
import { decomposeShot } from "../../shared/utils/scene-composition/shot-decomposer.js";
import type { MicroShot } from "../../shared/utils/scene-composition/microshot.model.js";
import { composeScene, type ComposedScene } from "../../shared/utils/scene-composition/cinematic-composer.js";
import { computeSceneCoverage, type SceneCoverageResult } from "../../shared/utils/scene-composition/scene-coverage.js";
import { computeSceneScore, type SceneScore } from "../../shared/utils/scene-composition/scene-score.js";
import { evaluateSceneQualityGate, type SceneQualityIssue } from "../../shared/utils/scene-composition/scene-quality-gate.js";
import { retrieveCandidatesForAllMicroShots, type MicroShotCandidates } from "../../infrastructure/scene-composition/multi-asset-retrieval.js";
import { DeterministicFakeIcaroProvider, DeveloperAssistedIcaroProvider } from "../../infrastructure/ai/index.js";
import { LocalArtifactDelivery } from "../../infrastructure/artifacts/index.js";
import {
  LocalJsonCampaignRepository,
  LocalJsonCampaignWorkspaceRepository,
  LocalJsonClaraKnowledgeRepository,
  LocalJsonCompanyKnowledgeRepository,
  LocalJsonQualityFeedbackRepository,
  LocalJsonValentinaTenantRepository,
} from "../../infrastructure/storage/index.js";
import { FfmpegVideoRenderingAdapter } from "../../infrastructure/video-rendering/index.js";
import { LocalVisualAssetLibrary, ManifestFreeVisualAssetProvider, VisualAssetResolver } from "../../infrastructure/visual-assets/index.js";
import { MediaCatalogRepository, MediaCatalogVisualAssetProvider } from "../../infrastructure/media-catalog/index.js";
import type {
  MediaApprovalStatus,
  MediaAssetRecord,
  MediaAssetType,
  MediaCollectionRecord,
  MediaCollectionStats,
  MediaGapAnalysisResult,
  MediaHealthReport,
  MediaScanResult,
  MediaShotPlanEntry,
} from "../../application/ports/media-catalog.port.js";
import type { MediaProviderPort, MediaProviderSearchHit } from "../../application/ports/media-provider.port.js";
import { PexelsMediaProvider, PEXELS_DOWNLOAD_HOSTS } from "../../infrastructure/media-providers/index.js";
import {
  acquireAssetFromHit,
  acquireForShotPlan,
  MediaAcquisitionLogRepository,
  type AcquisitionRunReport,
  type AcquisitionLogEntry,
} from "../../infrastructure/media-catalog/index.js";
import type { DownloadLimits } from "../../infrastructure/media-catalog/media-download-security.js";
import { ProductScreenCatalogRepository } from "../../infrastructure/product-screens/product-screen-catalog.repository.js";
import type {
  ProductScreenRecord,
  ProductScreenApprovalStatus,
  ProductScreenScanResult,
} from "../../application/ports/product-screen-catalog.port.js";
import { FfmpegProductCompositingAdapter } from "../../infrastructure/product-compositing/ffmpeg-product-compositing-adapter.js";
import type {
  ScreenPlacementContract,
  ScreenMarkingAssistedPackage,
  ScreenMarkingResponse,
  ProductCompositingCapabilityReport,
} from "../../application/ports/product-compositing.port.js";
import { computeProductCoverageBreakdown, type ProductCoverageBreakdown } from "../../shared/utils/product-coverage.js";
import { inferDeviceFromText, type ShotIntent } from "../../shared/utils/shot-intent.js";
import { computeFileHash } from "../../infrastructure/media-catalog/media-hash.js";
import { readVideoMetadata } from "../../infrastructure/visual-assets/visual-asset-metadata.js";
import { FileSystemSkillDiscovery, FileSystemSkillModuleLoader } from "../../infrastructure/skills/index.js";
import { DEFAULT_ZUNO_RUNTIME_MODE, type ZunoRuntimeMode } from "../../application/runtime/zuno-runtime-mode.js";
import { addWorkflowDeliveryToSummary, createWorkflowDeliveryPage } from "./final-delivery-page.js";
// COMPANY INTELLIGENCE ENGINE — camada nova, aditiva: nenhum destes imports altera nenhum dos
// arquivos acima. A ponte para Clara/Product Screen Catalog usa só as APIs públicas já
// importadas (`clara.create`, `ProductScreenCatalogRepository.upsert`).
import { CompanyIntelligenceEngine } from "../../infrastructure/company-intelligence/company-intelligence-engine.js";
import { publishCompanyKnowledgeToClara } from "../../infrastructure/company-intelligence/clara-bridge.js";
import { publishCapturedScreensToProductCatalog } from "../../infrastructure/company-intelligence/product-screen-bridge.js";
import { searchCompanyKnowledge } from "../../shared/utils/company-intelligence/search-api.js";
import type { CompanyKnowledgeBase } from "../../domain/company-intelligence/company-intelligence.model.js";
// CAMPAIGN INTELLIGENCE ENGINE — mesmo raciocínio aditivo do Company Intelligence: só usa as APIs
// públicas já existentes de Clara/Product Screen Catalog através das próprias pontes desta sprint.
import { CampaignIntelligenceEngine } from "../../infrastructure/campaign-intelligence/campaign-intelligence-engine.js";
import { publishCampaignWorkspaceToClara } from "../../infrastructure/campaign-intelligence/clara-bridge.js";
import { publishCampaignScreensToProductCatalog } from "../../infrastructure/campaign-intelligence/product-screen-bridge.js";
import { searchFrames } from "../../shared/utils/campaign-intelligence/frame-search.js";
import { findReusableMaterial } from "../../shared/utils/campaign-intelligence/reuse-engine.js";
import type { CampaignWorkspace } from "../../domain/campaign-intelligence/campaign-intelligence.model.js";
// LOCAL OFFICIAL ASSET QUALIFICATION — camada aditiva: reaproveita `analyzeVisualCandidate`/
// `simulatePreComposition` (Visual Candidate Validator) e `canStartProductCompositing` (Unified
// Coverage Model) exatamente como já existiam, nunca os reimplementa.
import { validateLocalAsset } from "../../infrastructure/local-asset-qualification/local-asset-validator.js";
import { validateLocalAssetsForCampaign } from "../../infrastructure/local-asset-qualification/batch-local-asset-validator.js";
import { assertCompositingSourceEligible } from "../../shared/utils/local-asset-qualification/compositing-source-eligibility.js";
// OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY — camada aditiva de classificação/ranking; nunca
// altera Visual Candidate Validator, Asset Diversity Gate, Production Readiness, Unified Coverage
// Model, Lucas ou Product Compositing (só o RESOLVER e o carimbo de proveniência do composite).
import { classifyComposite, classifyMediaAssetRecord, classifyProductScreenById } from "../../shared/utils/asset-authenticity-policy/composite-provenance.js";
import { checkResolutionStaleness, computeCatalogFingerprint } from "../../shared/utils/asset-authenticity-policy/resolution-metadata.js";
import { RANKING_POLICY_VERSION } from "../../shared/utils/asset-authenticity-policy/ranking-policy-version.js";
import { LOCAL_ASSET_VALIDATOR_VERSION } from "../../shared/utils/local-asset-qualification/validator-version.js";

const DEMO_CLIENT_ID = "client-rumo";

/**
 * Diferente de Arthur/Caio/Helena (cujos ids sequenciais só precisam ser únicos dentro de uma
 * única execução do processo Node), Quality Feedback e Campaign Manager acumulam um histórico
 * entre invocações separadas da CLI — cada `--rate`/`--campaign*` roda em um processo novo. Um
 * gerador sequencial reiniciando em 1 a cada processo faria todo registro colidir com o mesmo id
 * e sobrescrever o anterior no arquivo local. Por isso, só aqui (armazenamento local persistente
 * entre processos), o id combina tempo e aleatoriedade em vez de um contador sequencial.
 */
class TimestampRandomIdGenerator {
  create(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * Publisher de demonstração: nenhuma credencial real da Meta está configurada nesta fase
 * (ADR 0003), então este adaptador só é tocado se alguém forçar `publishMode: "publish_now"`
 * manualmente — o padrão da CLI é sempre `dry_run`, que a Ana nunca chega a chamar esta porta.
 */
class DemoSocialPublisher implements SocialPublisherPort {
  readonly capabilities = { supportsScheduling: false };

  async publish(draft: SocialPostDraft): Promise<SocialPublicationResult> {
    return {
      channel: draft.channel,
      status: "failed",
      error: {
        code: "NO_REAL_PROVIDER_CONFIGURED",
        message: "Nenhuma integração real de publicação está configurada nesta fase do Zuno.",
        retryable: false,
      },
    };
  }

  async schedule(draft: SocialPostDraft): Promise<SocialPublicationResult> {
    return this.publish(draft);
  }
}

export function projectPaths() {
  const cliDir = dirname(fileURLToPath(import.meta.url));
  const distDir = resolve(cliDir, "..", "..");
  const projectRoot = resolve(distDir, "..");
  // ZUNO_DATA_DIR/ZUNO_ARTIFACTS_DIR existem para isolar execuções em testes automatizados
  // (ver tests/cli.smoke.test.mjs) e para quem quiser apontar a CLI para outro diretório de
  // trabalho; sem elas, o padrão é sempre relativo ao próprio projeto/diretório atual.
  const dataDir = process.env.ZUNO_DATA_DIR ? resolve(process.env.ZUNO_DATA_DIR) : join(projectRoot, ".zuno-data");
  const artifactsDir = process.env.ZUNO_ARTIFACTS_DIR ? resolve(process.env.ZUNO_ARTIFACTS_DIR) : join(projectRoot, "artifacts");
  return {
    projectRoot,
    skillsRoot: join(distDir, "skills"),
    dataDir,
    executionsDir: join(dataDir, "executions"),
    artifactsDir,
    visualAssetsDir: join(projectRoot, "assets", "visual"),
    visualAssetsLibraryDir: join(projectRoot, "assets", "visual", "library"),
    freeVisualAssetsManifestPath: join(projectRoot, "assets", "visual", "free", "manifest.json"),
    freeVisualAssetsCacheDir: join(projectRoot, "assets", "visual", ".cache"),
    // MEDIA INTELLIGENCE ENGINE — o catálogo varre `assets/` inteiro por padrão (cobre a estrutura
    // legada `assets/visual/library` e `assets/audio` já existentes, e a nova estrutura sugerida
    // `assets/media/...` quando/se for adotada), sem exigir que a organização física seja a única
    // fonte de classificação — o catálogo em si é `dataDir/media-catalog.json`.
    mediaLibraryRoot: join(projectRoot, "assets"),
    mediaCatalogAssetsPath: join(dataDir, "media-catalog.json"),
    mediaCatalogCollectionsPath: join(dataDir, "media-collections.json"),
    // REAL FOOTAGE ACQUISITION — arquivos baixados de providers externos entram direto na
    // biblioteca reutilizável (`assets/media/acquired/`), não em `artifacts/` (que é por execução
    // e efêmero), porque o objetivo da sprint é alimentar a biblioteca PERMANENTE do Zuno.
    mediaAcquiredDir: join(projectRoot, "assets", "media", "acquired"),
    // FOOTAGE VISUAL VALIDATION 2.0 (seção 7) — artefatos de revisão (frame anotado + zoom)
    // gerados pelo Pre-composition Simulator, um subdiretório por asset. Permanente (não em
    // `artifacts/`) pelo mesmo motivo de `mediaAcquiredDir`: a fila de revisão humana precisa
    // conseguir abrir essas imagens depois, não só durante a execução que as gerou.
    footageReviewArtifactsDir: join(projectRoot, "assets", "media", "review-artifacts"),
    mediaAcquisitionLogPath: join(dataDir, "media-acquisition-log.json"),
    // PRODUCT COMPOSITING ENGINE — mesmo espírito de `mediaAcquiredDir`: saída composta é
    // permanente (reaproveitável entre execuções que precisem da mesma combinação
    // footage+tela), não efêmera em `artifacts/`.
    productScreenCatalogPath: join(dataDir, "product-screen-catalog.json"),
    compositedFootageDir: join(projectRoot, "assets", "media", "composited"),
    assistedPackagesDir: join(dataDir, "product-compositing-assisted-packages"),
    // COMPANY INTELLIGENCE ENGINE — base de conhecimento persistida por domínio, e capturas de
    // tela reais permanentes (mesmo raciocínio de `mediaAcquiredDir`: reaproveitáveis entre
    // execuções, não efêmeras em `artifacts/`).
    companyKnowledgeCatalogPath: join(dataDir, "company-knowledge-catalog.json"),
    companyScreenshotsDir: join(projectRoot, "assets", "media", "company-screenshots"),
    // CAMPAIGN INTELLIGENCE ENGINE — um Workspace por campanha; uploads e frames extraídos são
    // permanentes (mesmo raciocínio de `mediaAcquiredDir`/`companyScreenshotsDir`), organizados em
    // subpastas por campaignId dentro do próprio motor.
    campaignWorkspaceCatalogPath: join(dataDir, "campaign-workspace-catalog.json"),
    campaignUploadsDir: join(projectRoot, "assets", "media", "campaign-uploads"),
    campaignFramesDir: join(projectRoot, "assets", "media", "campaign-frames"),
  };
}

const VIDEO_RENDERING_MODES = ["local_render", "developer_assisted"] as const;
type VideoRenderingMode = (typeof VIDEO_RENDERING_MODES)[number];

/**
 * `ZUNO_VIDEO_RENDER_MODE` é validada contra uma allowlist estrita de dois valores fixos — nunca
 * um comando, caminho ou argumento arbitrário (ao contrário do que `ffmpeg-static` faz com
 * `FFMPEG_BIN`, ver `src/infrastructure/video-rendering/ffmpeg-binary.ts`). Qualquer valor fora
 * da allowlist é ignorado e o padrão (`local_render`) é usado. Existe para permitir que
 * `tests/cli.smoke.test.mjs` valide os dois caminhos (renderização local automática e Developer
 * Assisted Mode) de ponta a ponta pela CLI — não para configuração de produção.
 */
function resolveVideoRenderingMode(): VideoRenderingMode {
  const raw = process.env.ZUNO_VIDEO_RENDER_MODE;
  return (VIDEO_RENDERING_MODES as readonly string[]).includes(raw ?? "") ? (raw as VideoRenderingMode) : "local_render";
}

const ICARO_MODES = ["developer_assisted", "fake"] as const;
type IcaroMode = (typeof ICARO_MODES)[number];

/**
 * `ZUNO_ICARO_MODE` é validada contra uma allowlist estrita de dois valores fixos, seguindo o
 * mesmo raciocínio de segurança de `resolveVideoRenderingMode()` — nunca um comando ou caminho
 * arbitrário. Diferente de `ZUNO_VIDEO_RENDER_MODE` (cujo padrão preserva o comportamento
 * automático existente), aqui o padrão é `"developer_assisted"`: em LOCAL_PRODUCTION, João, Maria,
 * Sofia, Bianca, Bruno, Vanessa, Diego e Lucas devem ser apoiados pela IA desenvolvedora real do
 * VS Code, não pelo `DeterministicFakeIcaroProvider` (que existe apenas para testes automatizados
 * e demonstrações explícitas — por isso os testes que precisam de conteúdo determinístico definem
 * `ZUNO_ICARO_MODE=fake` explicitamente).
 */
function resolveIcaroMode(): IcaroMode {
  const raw = process.env.ZUNO_ICARO_MODE;
  return (ICARO_MODES as readonly string[]).includes(raw ?? "") ? (raw as IcaroMode) : "developer_assisted";
}

/** MEDIA INTELLIGENCE ENGINE — uma única instância de repositório por invocação da CLI, mesmo espírito de `buildRuntime()`. */
function buildMediaCatalog(paths: ReturnType<typeof projectPaths>): MediaCatalogRepository {
  return new MediaCatalogRepository({
    assetsFilePath: paths.mediaCatalogAssetsPath,
    collectionsFilePath: paths.mediaCatalogCollectionsPath,
    defaultRoots: [paths.mediaLibraryRoot],
    legacyManifestPaths: [join(paths.visualAssetsLibraryDir, "manifest.json")],
  });
}

/** PRODUCT COMPOSITING ENGINE — uma única instância de repositório por invocação da CLI, mesmo espírito de `buildMediaCatalog()`. */
function buildProductScreenCatalog(paths: ReturnType<typeof projectPaths>): ProductScreenCatalogRepository {
  return new ProductScreenCatalogRepository({
    filePath: paths.productScreenCatalogPath,
    libraryRoot: paths.visualAssetsLibraryDir,
  });
}

/** COMPANY INTELLIGENCE ENGINE — uma única instância por invocação da CLI, mesmo espírito de `buildMediaCatalog()`. */
function buildCompanyIntelligenceEngine(paths: ReturnType<typeof projectPaths>): CompanyIntelligenceEngine {
  return new CompanyIntelligenceEngine({
    repository: new LocalJsonCompanyKnowledgeRepository(paths.companyKnowledgeCatalogPath),
    screenshotsDir: paths.companyScreenshotsDir,
  });
}

/** CAMPAIGN INTELLIGENCE ENGINE — uma única instância por invocação da CLI, mesmo espírito de `buildCompanyIntelligenceEngine()`. */
function buildCampaignIntelligenceEngine(paths: ReturnType<typeof projectPaths>): CampaignIntelligenceEngine {
  return new CampaignIntelligenceEngine({
    repository: new LocalJsonCampaignWorkspaceRepository(paths.campaignWorkspaceCatalogPath),
    uploadsDir: paths.campaignUploadsDir,
    framesDir: paths.campaignFramesDir,
  });
}

/**
 * REAL FOOTAGE ACQUISITION — único ponto de construção de provider externo. Só `pexels` está
 * implementado nesta sprint; qualquer outro valor de `MEDIA_PROVIDER` falha com uma mensagem
 * clara em vez de silenciosamente usar Pexels. Sem `MEDIA_PROVIDER`/`MEDIA_PROVIDER_API_KEY`
 * configurados, `PexelsMediaProvider.isConfigured()` retorna `false` e `search()`/`getById()`
 * lançam a instrução de configuração — nunca falha silenciosamente, nunca baixa nada.
 */
function buildMediaProvider(): MediaProviderPort {
  const providerName = process.env.MEDIA_PROVIDER;
  if (!providerName || providerName === "pexels") return new PexelsMediaProvider();
  throw new Error(`MEDIA_PROVIDER="${providerName}" não é suportado nesta versão do Zuno. Providers implementados: pexels.`);
}

function buildDownloadLimits(): DownloadLimits {
  return {
    timeoutMs: 20_000,
    maxBytes: 200 * 1024 * 1024,
    maxRedirects: 3,
    allowedHosts: PEXELS_DOWNLOAD_HOSTS,
    maxRetries: 2,
  };
}

/**
 * ASSET DIVERSITY GATE — perfil de qualidade de resolução de assets visuais (ver
 * `src/application/ports/asset-quality-profile.ts`). `explicitFlag` (vindo de `--asset-quality`
 * na CLI) sempre vence quando presente e válido. Na ausência dele, o padrão segue exatamente a
 * regra pedida: `LOCAL_PRODUCTION` real usa `"premium"`; testes/demonstração (`ZUNO_ICARO_MODE=fake`,
 * o mesmo sinal que já distingue execução real de teste automatizado nesta CLI) usam `"draft"`;
 * qualquer outro caso cai em `"standard"` como meio-termo seguro.
 */
function resolveAssetQualityProfile(mode: ZunoRuntimeMode, explicitFlag?: string): AssetQualityProfile {
  if (isAssetQualityProfile(explicitFlag)) return explicitFlag;
  if (resolveIcaroMode() === "fake") return "draft";
  if (mode === "LOCAL_PRODUCTION") return "premium";
  return "standard";
}

async function buildRuntime(mode: ZunoRuntimeMode = DEFAULT_ZUNO_RUNTIME_MODE, assetQualityFlag?: string) {
  const paths = projectPaths();
  await mkdir(paths.dataDir, { recursive: true });
  await mkdir(paths.executionsDir, { recursive: true });

  const valentina = new ValentinaTenantManager({
    repository: new LocalJsonValentinaTenantRepository(join(paths.dataDir, "tenants.json")),
  });
  const clara = new ClaraKnowledgeCenter({
    repository: new LocalJsonClaraKnowledgeRepository(join(paths.dataDir, "knowledge.json")),
  });
  const artifactDelivery = new LocalArtifactDelivery({ rootDir: paths.artifactsDir });
  const localVisualAssetLibrary = new LocalVisualAssetLibrary({
    rootDir: paths.visualAssetsLibraryDir,
    manifestPath: join(paths.visualAssetsLibraryDir, "manifest.json"),
  });
  const manifestFreeVisualAssetProvider = new ManifestFreeVisualAssetProvider({
    manifestPath: paths.freeVisualAssetsManifestPath,
    cacheDir: paths.freeVisualAssetsCacheDir,
  });
  // MEDIA INTELLIGENCE ENGINE — o VisualAssetResolver consulta o catálogo exatamente como consulta
  // qualquer outro provider (`VisualAssetProviderPort` genérica já existente), sem recriar catálogo
  // próprio. Adicionado por último de propósito: candidatos do catálogo (quando indexados/aprovados)
  // enriquecem a lista, nunca a substituem — a biblioteca legada continua funcionando sozinha se o
  // catálogo ainda não tiver sido escaneado (`--media-scan`).
  const mediaCatalog = buildMediaCatalog(paths);
  const mediaCatalogVisualAssetProvider = new MediaCatalogVisualAssetProvider(mediaCatalog);
  const visualAssetResolver = new VisualAssetResolver({
    providers: [localVisualAssetLibrary, manifestFreeVisualAssetProvider, mediaCatalogVisualAssetProvider],
    artifactsRootDir: paths.artifactsDir,
  });
  // ASSET DIVERSITY GATE — perfil de qualidade sob o qual Rafa resolve e valida assets visuais
  // nesta execução (ver `resolveAssetQualityProfile`). Construído uma única vez por invocação da
  // CLI, no mesmo espírito de `resolveVideoRenderingMode()`/`resolveIcaroMode()`.
  const assetQualityProfile = resolveAssetQualityProfile(mode, assetQualityFlag);
  // Modo oficial LOCAL_PRODUCTION: João, Maria, Sofia, Bianca, Bruno, Vanessa, Diego e Lucas nunca
  // recebem conteúdo determinístico/fixo em uso real (ver `docs/developer-ai-assistance.md`) —
  // o `DeterministicFakeIcaroProvider` só é usado quando `ZUNO_ICARO_MODE=fake` é definido
  // explicitamente (testes automatizados e demonstrações, nunca produção real).
  const icaro = resolveIcaroMode() === "fake"
    ? new DeterministicFakeIcaroProvider()
    : new DeveloperAssistedIcaroProvider({ artifactDelivery });
  const socialPublisher = new DemoSocialPublisher();
  const qualityFeedback = new QualityFeedbackCenter({
    repository: new LocalJsonQualityFeedbackRepository(join(paths.dataDir, "quality-feedback.json")),
    idGenerator: new TimestampRandomIdGenerator(),
  });

  const helena = new HelenaSkillManager({
    discovery: new FileSystemSkillDiscovery({ rootDirectories: [paths.skillsRoot] }),
    loader: new FileSystemSkillModuleLoader({
      runtimeDependencies: {
        valentina,
        clara,
        icaro,
        socialPublisher,
        // Consultada apenas pelo Eduardo (dependência opcional, mesmo padrão do Ícaro) para
        // influenciar recomendações a partir do histórico de avaliações — nunca decide sozinha.
        qualityFeedback,
        // Modo oficial LOCAL_PRODUCTION: Pedro nunca chama IA para gerar pixels (não existe geração
        // de imagem nativa no Claude Code nem provider externo configurado nesta fase — ver ADR
        // 0003 e docs/pedro-image-generation.md). Em vez disso, monta prompt técnico + caminho
        // esperado e aguarda a IA desenvolvedora salvar o arquivo real em disco.
        imageGenerationMode: "developer_assisted",
        artifactDelivery,
        visualAssetResolver,
        // ASSET DIVERSITY GATE — mesmo padrão de `imageGenerationMode`: um valor de configuração
        // simples injetado no bag genérico de dependências, sem passar por Arthur/Caio/Helena.
        assetQualityProfile,
        artifactsRootDir: paths.artifactsDir,
        // Rafa prefere renderização automática local (ver `docs/video-rendering.md`) e só cai para
        // Developer Assisted Mode quando faltar um asset explicitamente pedido ou a renderização
        // falhar. `videoRendering` fica de fora quando `resolveVideoRenderingMode()` decide manter
        // só o modo assistido (ex.: `ZUNO_VIDEO_RENDER_MODE=developer_assisted`, usado nos testes
        // que precisam validar o fluxo assistido de ponta a ponta) — Rafa se comporta exatamente
        // como antes quando essa dependência está ausente (mesmo padrão de `artifactDelivery?`).
        ...(resolveVideoRenderingMode() === "local_render"
          ? { videoRendering: new FfmpegVideoRenderingAdapter({ artifactsRootDir: paths.artifactsDir }) }
          : {}),
      },
    }),
    validator: new SkillManifestValidator(),
    registry: new SkillRegistry(),
  });
  await helena.discoverAndLoadSkills();

  // Mesmo raciocínio do Quality Feedback e do Campaign Manager (ver comentário acima de
  // `TimestampRandomIdGenerator`): cada invocação da CLI é um processo Node novo, e um id
  // sequencial reiniciando em 1 a cada processo fazia execuções de workflow completamente
  // distintas colidirem no mesmo `workflow-execution-0001`, reaproveitando silenciosamente
  // estado e artefatos (imagens/vídeos) de uma execução anterior não relacionada.
  const caio = new CaioWorkflowExecutor({ helena, tenants: valentina, idGenerator: new TimestampRandomIdGenerator() });
  const arthur = new ArthurOrchestrator({ tenants: valentina });
  // Campaign Manager funciona ACIMA do Arthur: chama `arthur.planFromText` sob demanda para cada
  // conteúdo, mas nunca participa do ExecutionPlan nem é convocado por Caio/Helena.
  const campaignManager = new CampaignManager({
    valentina,
    arthur,
    clara,
    repository: new LocalJsonCampaignRepository(join(paths.dataDir, "campaigns.json")),
    idGenerator: new TimestampRandomIdGenerator(),
  });

  return { paths, valentina, clara, qualityFeedback, campaignManager, caio, arthur, mode };
}

async function ensureDemoClient(valentina: InstanceType<typeof ValentinaTenantManager>, clara: InstanceType<typeof ClaraKnowledgeCenter>): Promise<void> {
  const existing = await valentina.getTenant({ clientId: DEMO_CLIENT_ID, status: "all" });
  if (existing) return;

  const actor = { id: "zuno-cli", type: "system" as const, name: "Zuno CLI" };
  const audit = (reason: string) => ({ actor, reason, correlationId: "cli-seed" });

  const tenant = await valentina.createTenant({
    clientId: DEMO_CLIENT_ID,
    displayName: "Rumo ao Altar",
    plan: "PRO",
    subscriptionStatus: "active",
    timezone: "America/Sao_Paulo",
    language: "pt-BR",
    country: "BR",
    environment: "development",
    niche: "wedding tech",
    mainObjectives: ["captar noivos", "explicar presentes via Pix", "gerar visitas para o site"],
    preferences: { aiPriority: "balanced", approvalRequired: true },
    audit: audit("Cliente de demonstração semeado automaticamente pela CLI do Zuno."),
  });
  await valentina.activateTenant({ tenantId: tenant.id, audit: audit("Ativação automática da CLI.") });
  await valentina.connectIntegration({
    tenantId: tenant.id,
    network: "instagram",
    tokenReference: "demo-instagram-token",
    scopes: ["content_publish"],
    audit: audit("Integração de demonstração."),
  });
  await valentina.connectIntegration({
    tenantId: tenant.id,
    network: "facebook",
    tokenReference: "demo-facebook-token",
    scopes: ["pages_manage_posts"],
    audit: audit("Integração de demonstração."),
  });

  await clara.create({
    module: "BrandContext",
    title: "Marca Rumo ao Altar",
    payload: {
      clientId: DEMO_CLIENT_ID,
      brandId: "brand-rumo-ao-altar",
      brandName: "Rumo ao Altar",
      positioning: "Plataforma para noivos criarem site de casamento, presentes via Pix e experiências para convidados.",
      promise: "Casamentos digitais organizados com leveza, humor e controle para os noivos.",
      toneOfVoice: "leve divertido persuasivo",
      preferredHashtags: ["#casamento", "#noivos", "#presentes"],
      forbiddenHashtags: ["#spam"],
      preferredCtas: ["Conheça o Rumo ao Altar"],
      mandatoryWords: ["Rumo ao Altar"],
      forbiddenWords: ["garantia absoluta"],
      importantLinks: ["https://rumoaoaltar.com.br"],
      keywords: ["casamento", "pix", "presentes", "noivos"],
    },
    tags: ["marca", "casamento"],
    audit: audit("Cadastro automático de demonstração."),
  });
  await clara.create({
    module: "AudienceContext",
    title: "Público de noivos",
    payload: {
      clientId: DEMO_CLIENT_ID,
      targetAudience: "Noivos que querem organizar o casamento com praticidade e convidados que preferem presentear por Pix.",
      keywords: ["noivos", "convidados", "presente via pix"],
    },
    tags: ["público"],
    audit: audit("Cadastro automático de demonstração."),
  });
  await clara.create({
    module: "IdentityContext",
    title: "Identidade visual",
    payload: {
      clientId: DEMO_CLIENT_ID,
      brandId: "brand-rumo-ao-altar",
      colors: ["#C97F91", "#111111", "#FFFFFF"],
      fonts: ["Playfair Display", "Inter"],
      imageStyle: "editorial romântico com humor leve",
      visualGuidelines: [
        "Usar fotos com casal real ou mockups elegantes.",
        "Aplicar contraste limpo e espaço para texto.",
        "Evitar visual poluído ou promessa exagerada.",
      ],
      keywords: ["visual", "marca", "romântico"],
    },
    tags: ["identidade"],
    audit: audit("Cadastro automático de demonstração."),
  });
  await clara.create({
    module: "PublishingContext",
    title: "Regras de publicação",
    payload: {
      clientId: DEMO_CLIENT_ID,
      connectedSocialNetworks: [
        { network: "instagram", status: "connected" },
        { network: "facebook", status: "connected" },
      ],
      approvalFlow: "Publicar somente após revisão do Lucas e aprovação humana.",
    },
    tags: ["publicação"],
    audit: audit("Cadastro automático de demonstração."),
  });
}

async function persistExecution(executionsDir: string, report: WorkflowExecutionReport): Promise<void> {
  await writeFile(join(executionsDir, `${report.executionId}.json`), JSON.stringify(report, null, 2), "utf8");
}

async function loadPersistedExecution(executionsDir: string, executionId: string): Promise<WorkflowExecutionReport> {
  const raw = await readFile(join(executionsDir, `${executionId}.json`), "utf8");
  return JSON.parse(raw) as WorkflowExecutionReport;
}

async function attachFinalDeliveryPage(paths: ReturnType<typeof projectPaths>, report: WorkflowExecutionReport): Promise<WorkflowExecutionReport> {
  if (report.state !== "COMPLETED") return report;
  const delivery = await createWorkflowDeliveryPage(report, { artifactsDir: paths.artifactsDir });
  report.artifactSummary = addWorkflowDeliveryToSummary(report.artifactSummary, delivery);
  return report;
}

export type RunZunoCommandOptions = {
  command: string;
  clientId?: string;
  mode?: ZunoRuntimeMode;
  /** Caminho absoluto de uma música local já validada pela CLI (ver `validateLocalMusicPath`), a ser usada por Rafa na etapa de renderização de vídeo, quando existir uma no plano. */
  musicFilePath?: string;
  /** ASSET DIVERSITY GATE — valor bruto de `--asset-quality` (draft|standard|premium), já validado pela CLI. Ver `resolveAssetQualityProfile`. */
  assetQualityProfile?: string;
};

export async function runZunoCommand(options: RunZunoCommandOptions): Promise<WorkflowExecutionReport> {
  const mode = options.mode ?? DEFAULT_ZUNO_RUNTIME_MODE;
  const { paths, valentina, clara, caio, arthur } = await buildRuntime(mode, options.assetQualityProfile);
  const clientId = options.clientId ?? DEMO_CLIENT_ID;
  if (clientId === DEMO_CLIENT_ID) {
    await ensureDemoClient(valentina, clara);
  }

  const { executionPlan } = await arthur.planFromText({ command: options.command, clientId, musicFilePath: options.musicFilePath });
  const report = await attachFinalDeliveryPage(paths, await caio.execute({ plan: executionPlan, dryRun: true, mode }));
  await persistExecution(paths.executionsDir, report);
  return report;
}

export type ResumeZunoExecutionOptions = {
  executionId: string;
  approval: WorkflowHumanApprovalInput;
  mode?: ZunoRuntimeMode;
  /** ASSET DIVERSITY GATE — ver `RunZunoCommandOptions.assetQualityProfile`. */
  assetQualityProfile?: string;
};

export async function resumeZunoExecution(options: ResumeZunoExecutionOptions): Promise<WorkflowExecutionReport> {
  const { paths, caio } = await buildRuntime(options.mode ?? DEFAULT_ZUNO_RUNTIME_MODE, options.assetQualityProfile);
  const persisted = await loadPersistedExecution(paths.executionsDir, options.executionId);
  caio.hydrateExecution(persisted);

  const report = await attachFinalDeliveryPage(paths, await caio.resume(options.executionId, options.approval));
  if (report.state === "COMPLETED" || report.state === "FAILED" || report.state === "CANCELLED") {
    await rm(join(paths.executionsDir, `${report.executionId}.json`), { force: true });
  } else {
    await persistExecution(paths.executionsDir, report);
  }
  return report;
}

export type ContinueZunoExecutionOptions = {
  executionId: string;
  mode?: ZunoRuntimeMode;
  /** Caminho absoluto de uma música local já validada pela CLI, informada só agora (ver `RunZunoCommandOptions.musicFilePath`). Só tem efeito se a etapa de renderização de vídeo ainda não tiver sido concluída. */
  musicFilePath?: string;
  /** ASSET DIVERSITY GATE — ver `RunZunoCommandOptions.assetQualityProfile`. */
  assetQualityProfile?: string;
};

/**
 * Retoma um workflow pausado em `WAITING_ASSISTED_GENERATION` (Pedro/Rafa em modo
 * developer_assisted aguardando a IA desenvolvedora salvar imagem/vídeo) ou em
 * `WAITING_DEVELOPER_AI` (qualquer Skill dependente de `IcaroBrainPort` aguardando a IA
 * desenvolvedora salvar a resposta de texto/estratégia/análise/direção criativa). Reexecuta a
 * mesma etapa, que verifica se o arquivo esperado já existe; se ainda não existir (ou for
 * inválido), o workflow pausa de novo com a mesma mensagem.
 */
export async function continueZunoExecution(options: ContinueZunoExecutionOptions): Promise<WorkflowExecutionReport> {
  const { paths, caio } = await buildRuntime(options.mode ?? DEFAULT_ZUNO_RUNTIME_MODE, options.assetQualityProfile);
  const persisted = await loadPersistedExecution(paths.executionsDir, options.executionId);
  caio.hydrateExecution(persisted);

  if (options.musicFilePath) {
    const applied = caio.applyLocalMusicAsset(options.executionId, options.musicFilePath);
    if (!applied.applied) {
      console.error(`[zuno] Aviso: --music informado, mas não pôde ser aplicado. ${applied.reason ?? ""}`.trim());
    }
  }

  const resumed = persisted.state === "WAITING_DEVELOPER_AI"
    ? await caio.resumeDeveloperAI(options.executionId)
    : await caio.resumeAssistedGeneration(options.executionId);
  const report = await attachFinalDeliveryPage(paths, resumed);
  if (report.state === "COMPLETED" || report.state === "FAILED" || report.state === "CANCELLED") {
    await rm(join(paths.executionsDir, `${report.executionId}.json`), { force: true });
  } else {
    await persistExecution(paths.executionsDir, report);
  }
  return report;
}

export type RerunAssetResolutionResult = {
  report: WorkflowExecutionReport;
  staleness: ReturnType<typeof checkResolutionStaleness>;
  previousResolvedAssetIds: string[];
  newResolvedAssetIds: string[];
};

/**
 * OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 12) — invalida SÓ a resolução de assets
 * (nunca a execução inteira): reaproveita o MESMO mecanismo de `continueZunoExecution`
 * (`resumeAssistedGeneration`, que já reseta a etapa para PENDING e reexecuta a Skill do zero —
 * `RafaVideoRenderingSkill.execute()` chama `visualAssetResolver.resolve()` sem cache algum, ver
 * auditoria da seção 1/4 do relatório), mas SÓ quando a execução está pausada exatamente na etapa
 * de renderização de vídeo — nunca um alias genérico para `--continue` (isso alteraria o
 * comportamento normal de `--continue`, proibido pela seção 12). Preserva briefing, roteiro,
 * respostas anteriores de todas as Skills e decisões já aprovadas: nada disso é tocado, porque
 * `resumeAssistedGeneration` só mexe na etapa atualmente pausada.
 */
export async function rerunAssetResolution(executionId: string, mode: ZunoRuntimeMode = DEFAULT_ZUNO_RUNTIME_MODE): Promise<RerunAssetResolutionResult> {
  const paths = projectPaths();
  const persisted = await loadPersistedExecution(paths.executionsDir, executionId);

  if (persisted.state !== "WAITING_ASSISTED_GENERATION") {
    throw new Error(`--rerun-asset-resolution só funciona quando a execução está pausada em "Renderização de vídeo" aguardando geração assistida (estado atual: ${persisted.state}). Use --continue para os demais casos.`);
  }
  const waitingStep = persisted.steps.find((step) => step.stepId === persisted.waitingForStepId);
  if (!waitingStep || waitingStep.skillCapability !== "video_rendering") {
    throw new Error(`--rerun-asset-resolution só se aplica à etapa de renderização de vídeo (Rafa). Etapa pausada atual: "${waitingStep?.name ?? persisted.waitingForStepId}".`);
  }

  // Seção 13 — diagnóstico de obsolescência ANTES de reexecutar (informativo; esta chamada em si
  // já é a autorização explícita do operador para gerar uma nova resolução, nunca automática).
  let staleness: ReturnType<typeof checkResolutionStaleness> = { stale: false };
  let previousResolvedAssetIds: string[] = [];
  try {
    const reportPath = join(paths.artifactsDir, executionId, "visual-assets", "asset-report.json");
    const previousReport = JSON.parse(await readFile(reportPath, "utf8")) as { resolved?: Array<{ asset?: { id?: string } }>; resolutionMetadata?: import("../../application/ports/visual-asset-provider.port.js").AssetResolutionMetadata };
    previousResolvedAssetIds = (previousReport.resolved ?? []).map((entry) => entry.asset?.id).filter((id): id is string => Boolean(id));
    if (previousReport.resolutionMetadata) {
      const catalog = buildMediaCatalog(paths);
      const currentAssets = await catalog.list();
      const currentHash = computeCatalogFingerprint(currentAssets.map((asset) => ({ id: asset.assetId, hash: asset.hash, approvalStatus: asset.approvalStatus, validationDate: asset.validationDate })));
      staleness = checkResolutionStaleness(previousReport.resolutionMetadata, {
        catalogHash: currentHash,
        rankingPolicyVersion: RANKING_POLICY_VERSION,
        validatorVersion: LOCAL_ASSET_VALIDATOR_VERSION,
      });
    }
  } catch {
    // Sem relatório anterior legível — segue sem diagnóstico de staleness, nunca bloqueia o rerun.
  }

  const { caio } = await buildRuntime(mode);
  caio.hydrateExecution(persisted);
  const resumed = await caio.resumeAssistedGeneration(executionId);
  const report = await attachFinalDeliveryPage(paths, resumed);

  if (report.state === "COMPLETED" || report.state === "FAILED" || report.state === "CANCELLED") {
    await rm(join(paths.executionsDir, `${report.executionId}.json`), { force: true });
  } else {
    await persistExecution(paths.executionsDir, report);
  }

  let newResolvedAssetIds: string[] = [];
  try {
    const reportPath = join(paths.artifactsDir, executionId, "visual-assets", "asset-report.json");
    const newReport = JSON.parse(await readFile(reportPath, "utf8")) as { resolved?: Array<{ asset?: { id?: string } }> };
    newResolvedAssetIds = (newReport.resolved ?? []).map((entry) => entry.asset?.id).filter((id): id is string => Boolean(id));
  } catch {
    // Sem relatório novo legível (ex.: ainda pendente de geração assistida) — lista vazia, nunca inventada.
  }

  return { report, staleness, previousResolvedAssetIds, newResolvedAssetIds };
}

export type RebalanceTimelineResult = RerunAssetResolutionResult & {
  rebalanceRecords: unknown[];
  unresolvedShotIds: string[];
};

/**
 * NARRATIVE TIMING REBALANCING (seção 15) — operação explícita e nomeada para o caso de uso desta
 * sprint, mas reaproveita EXATAMENTE `rerunAssetResolution` por baixo (nunca um caminho de código
 * paralelo): a realocação de duração já acontece automaticamente dentro de
 * `RafaVideoRenderingSkill.execute()` sempre que o resolver reporta `timingDeficits` — esta função
 * só chama o mesmo rerun e depois lê `timing-rebalance-report.json` (seção 14) para expor o plano
 * aplicado, se algum foi.
 */
export async function rebalanceTimeline(executionId: string, mode: ZunoRuntimeMode = DEFAULT_ZUNO_RUNTIME_MODE): Promise<RebalanceTimelineResult> {
  const result = await rerunAssetResolution(executionId, mode);
  const paths = projectPaths();
  let rebalanceRecords: unknown[] = [];
  let unresolvedShotIds: string[] = [];
  try {
    const reportPath = join(paths.artifactsDir, executionId, "visual-assets", "timing-rebalance-report.json");
    const report = JSON.parse(await readFile(reportPath, "utf8")) as { records?: unknown[]; unresolvedShotIds?: string[] };
    rebalanceRecords = report.records ?? [];
    unresolvedShotIds = report.unresolvedShotIds ?? [];
  } catch {
    // Nenhum plano foi aplicado nesta chamada (sem déficit, ou déficit sem doador válido) — nunca inventado.
  }
  return { ...result, rebalanceRecords, unresolvedShotIds };
}

export async function listPendingExecutions(): Promise<string[]> {
  const { executionsDir } = projectPaths();
  try {
    const files = await readdir(executionsDir);
    return files.filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// AUTONOMOUS EXECUTION ENGINE — só a CLI conhece `AutonomousExecutionEngine`/`ACTION_REGISTRY`;
// nenhuma Skill importa nada de `src/application/orchestration/autonomous/`. O motor só reage a
// `WorkflowExecutionReport` (o mesmo contrato público já usado acima) e chama `continueZunoExecution`
// para retomar — é essa retomada que faz Rafa/Lucas recalcularem tudo do zero (seção 8 da sprint).
// ---------------------------------------------------------------------------------------------

export type AutonomousExecutionOptions = {
  /** Comando em texto livre, para iniciar uma execução NOVA (mutuamente exclusivo com `executionId`). */
  command?: string;
  /** ID de uma execução já pausada em WAITING_ASSISTED_GENERATION, para retomar (mutuamente exclusivo com `command`). */
  executionId?: string;
  clientId?: string;
  mode?: ZunoRuntimeMode;
  musicFilePath?: string;
  assetQualityProfile?: string;
  /** MODO DRY RUN (seção 12) — roda toda a lógica de decisão, nunca baixa arquivo, nunca altera catálogo, nunca chama `continueZunoExecution` de verdade. */
  dryRun?: boolean;
  maxTotalIterations?: number;
};

export async function runAutonomousExecution(options: AutonomousExecutionOptions): Promise<AutonomousEngineOutcome> {
  if (!options.command && !options.executionId) {
    throw new Error('Informe --autonomous "<comando>" (nova execução) ou --autonomous-continue <executionId> (execução existente).');
  }

  const initialReport = options.command
    ? await runZunoCommand({
        command: options.command,
        clientId: options.clientId,
        mode: options.mode,
        musicFilePath: options.musicFilePath,
        assetQualityProfile: options.assetQualityProfile,
      })
    : await loadPersistedExecution(projectPaths().executionsDir, options.executionId as string);

  const { AutonomousExecutionEngine } = await import("../../application/orchestration/autonomous/autonomous-execution-engine.js");
  const { ACTION_REGISTRY } = await import("../../application/orchestration/autonomous/action-registry.js");
  const { DEFAULT_ENGINE_CONFIG } = await import("../../application/orchestration/autonomous/autonomous-types.js");

  const engine = new AutonomousExecutionEngine({
    registry: ACTION_REGISTRY,
    config: {
      dryRun: options.dryRun ?? DEFAULT_ENGINE_CONFIG.dryRun,
      maxTotalIterations: options.maxTotalIterations ?? DEFAULT_ENGINE_CONFIG.maxTotalIterations,
    },
    continueExecution: (executionId) =>
      continueZunoExecution({ executionId, mode: options.mode, musicFilePath: options.musicFilePath, assetQualityProfile: options.assetQualityProfile }),
  });

  return engine.run(initialReport);
}

export type AutonomousSimulationCandidate = { id: string; name: string; resolves: string[]; maxAttempts: number; prerequisites: string[]; limitations: string[] };

export type AutonomousSimulationPreview = {
  executionId: string;
  state: string;
  blocker?: Blocker;
  candidateActions: AutonomousSimulationCandidate[];
};

/**
 * SIMULAÇÃO (seção 11) — nenhuma ação real é executada; só classifica o bloqueio já persistido em
 * disco e lista as ações candidatas na ordem em que o Engine as tentaria, para auditoria.
 */
export async function simulateAutonomousExecution(executionId: string): Promise<AutonomousSimulationPreview> {
  const paths = projectPaths();
  const report = await loadPersistedExecution(paths.executionsDir, executionId);
  const { classifyBlocker } = await import("../../application/orchestration/autonomous/blocker-classifier.js");
  const { selectActionsForBlocker } = await import("../../application/orchestration/autonomous/autonomous-execution-engine.js");
  const { ACTION_REGISTRY } = await import("../../application/orchestration/autonomous/action-registry.js");
  const { DEFAULT_ENGINE_CONFIG } = await import("../../application/orchestration/autonomous/autonomous-types.js");
  const blocker = classifyBlocker(report);
  const candidateActions = blocker ? selectActionsForBlocker(blocker, ACTION_REGISTRY, DEFAULT_ENGINE_CONFIG.actionPriority) : [];
  return {
    executionId,
    state: report.state,
    blocker,
    candidateActions: candidateActions.map((action) => ({
      id: action.id,
      name: action.name,
      resolves: action.resolves,
      maxAttempts: action.maxAttempts,
      prerequisites: action.prerequisites,
      limitations: action.limitations,
    })),
  };
}

export type VisualAssetsCliReport = {
  assets: VisualAssetMetadata[];
  warnings: string[];
  summary: {
    total: number;
    byProvider: Record<string, number>;
    byOrigin: Record<string, number>;
    byLicense: Record<string, number>;
  };
};

export async function scanVisualAssets(): Promise<VisualAssetsCliReport> {
  const paths = projectPaths();
  const providers = [
    new LocalVisualAssetLibrary({
      rootDir: paths.visualAssetsLibraryDir,
      manifestPath: join(paths.visualAssetsLibraryDir, "manifest.json"),
    }),
    new ManifestFreeVisualAssetProvider({
      manifestPath: paths.freeVisualAssetsManifestPath,
      cacheDir: paths.freeVisualAssetsCacheDir,
    }),
  ];
  const query = buildAssetInspectionQuery();
  const assets: VisualAssetMetadata[] = [];
  const warnings: string[] = [];
  for (const provider of providers) {
    const result = await provider.search(query);
    assets.push(...result.assets);
    warnings.push(...result.warnings.map((warning) => `${provider.providerId}: ${warning}`));
  }
  return { assets, warnings, summary: summarizeVisualAssets(assets) };
}

export async function listVisualAssets(): Promise<VisualAssetsCliReport> {
  return scanVisualAssets();
}

export async function getVisualAssetsReport(): Promise<VisualAssetsCliReport> {
  return scanVisualAssets();
}

// ---------------------------------------------------------------------------------------------
// MEDIA INTELLIGENCE ENGINE — comandos standalone `--media-*`. Cada função constrói seu próprio
// `MediaCatalogRepository` diretamente (mesmo padrão de `scanVisualAssets`), sem passar por
// `ArthurOrchestrator`/`CaioWorkflowExecutor` — não são passos de workflow, são operações diretas
// sobre o catálogo.
// ---------------------------------------------------------------------------------------------

export async function scanMediaCatalog(): Promise<MediaScanResult> {
  const paths = projectPaths();
  return buildMediaCatalog(paths).scan();
}

export async function listMediaAssets(filter?: { type?: MediaAssetType; approvalStatus?: MediaApprovalStatus }): Promise<MediaAssetRecord[]> {
  const paths = projectPaths();
  return buildMediaCatalog(paths).list(filter);
}

export async function showMediaAsset(assetId: string): Promise<MediaAssetRecord | undefined> {
  const paths = projectPaths();
  return buildMediaCatalog(paths).get(assetId);
}

export async function getMediaHealthReport(): Promise<MediaHealthReport> {
  const paths = projectPaths();
  return buildMediaCatalog(paths).healthReport();
}

export async function tagMediaAsset(assetIdOrPath: string, tags: string[]): Promise<MediaAssetRecord> {
  const paths = projectPaths();
  return buildMediaCatalog(paths).tag(assetIdOrPath, tags);
}

export async function approveMediaAsset(assetId: string, note?: string): Promise<MediaAssetRecord> {
  const paths = projectPaths();
  return buildMediaCatalog(paths).approve(assetId, note);
}

export async function rejectMediaAsset(assetId: string, reason?: string): Promise<MediaAssetRecord> {
  const paths = projectPaths();
  return buildMediaCatalog(paths).reject(assetId, reason);
}

export async function removeMediaAsset(assetId: string): Promise<void> {
  const paths = projectPaths();
  return buildMediaCatalog(paths).remove(assetId);
}

/**
 * UNIFIED COVERAGE MODEL — corrige a causa raiz comprovada do diagnóstico contraditório
 * ("Gap Analysis: nenhum vídeo faltando" vs. "Production Readiness: Video Coverage 0%"): antes,
 * a elevação de um Shot para "precisa virar vídeo real" só acontecia DENTRO de Rafa (Asset
 * Diversity Gate), nunca escrita de volta em `asset-report.json` — Footage Acquisition nunca via
 * essa decisão. Agora `deriveVideoElevatedShotIds` (mesmo cálculo usado por Production Readiness/
 * Asset Diversity Gate, `shared/utils/coverage/coverage-graph.ts`) roda ANTES de montar o
 * `shotPlan`, e os Shots elevados entram com `desiredType: "video"`/`requiresRealFootage: true` —
 * as duas perguntas ("o que falta" e "quanto cobre") nascem do mesmo cálculo.
 */
export async function mediaGapAnalysisForExecution(executionId: string, qualityProfile: AssetQualityProfile = "premium"): Promise<{ gap: MediaGapAnalysisResult; shotPlan: MediaShotPlanEntry[] }> {
  const paths = projectPaths();
  const reportPath = join(paths.artifactsDir, executionId, "visual-assets", "asset-report.json");
  const raw = await readFile(reportPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  // `asset-report.json` (escrito por VisualAssetResolver.writeVisualAssetReport) tem os Shots
  // resolvidos em `.resolved` — nunca `.shots` (isso é só como alguns scripts de depuração ad-hoc
  // desta sessão chamavam a variável local, não o nome real do campo no arquivo).
  const entries = Array.isArray(parsed) ? parsed : (parsed as { resolved?: unknown[] }).resolved ?? [];
  const pendingEntries = Array.isArray(parsed) ? [] : (parsed as { pending?: unknown[] }).pending ?? [];
  const requirements = DEFAULT_ASSET_DIVERSITY_REQUIREMENTS[qualityProfile];
  const elevatedToVideo = deriveVideoElevatedShotIds({
    resolved: entries as VisualAssetResolved[],
    pending: pendingEntries as VisualAssetCreationPackage[],
    minVideoRatio: requirements.minVideoRatio,
  });
  const shotPlan: MediaShotPlanEntry[] = (entries as Array<Record<string, unknown>>)
    .filter((entry) => typeof entry.shotId === "string")
    .map((entry) => {
      const query = (entry.query ?? {}) as Record<string, unknown>;
      const humanRequirement = query.humanRequirement as { subject?: string; strict?: boolean } | undefined;
      const productRequirement = query.productRequirement as { productName?: string; strict?: boolean } | undefined;
      const mockupRequirement = query.mockupRequirement as { what?: string; strict?: boolean } | undefined;
      const screenshotRequirement = query.screenshotRequirement as { interface?: string; strict?: boolean } | undefined;
      const strict = Boolean(humanRequirement?.strict || productRequirement?.strict || mockupRequirement?.strict || screenshotRequirement?.strict);
      const desiredKind = String(query.desiredKind ?? "photo");
      // O `kind` REALMENTE resolvido (`entry.asset.kind`) pode ter sido elevado para vídeo pelo
      // Asset Diversity Gate/Production Readiness depois do planejamento original de Bruno/Vanessa
      // (`query.desiredKind` fica congelado no valor planejado) — sempre que o asset resolvido é
      // vídeo/b-roll, o Shot exige filmagem real de verdade, mesmo que o plano original pedisse foto.
      // `elevatedToVideo` cobre o caso em que NENHUM asset resolvido é vídeo ainda, mas a cobertura
      // agregada da campanha exige que ESTE Shot específico vire um.
      const resolvedAsset = (entry.asset ?? {}) as Record<string, unknown>;
      const resolvedKind = typeof resolvedAsset.kind === "string" ? resolvedAsset.kind : desiredKind;
      const shotIsElevated = elevatedToVideo.has(entry.shotId as string);
      const mappedType: MediaAssetType = shotIsElevated ? "video" : resolvedKind === "b_roll" ? "b_roll" : resolvedKind === "video" ? "video" : resolvedKind === "mockup" ? "mockup" : resolvedKind === "cinemagraph" ? "cinemagraph" : "photo";
      const requiredTags = Array.isArray(query.requiredTags) ? (query.requiredTags as string[]) : [];
      const theme = typeof query.theme === "string" ? query.theme : "";
      // INTENT-BASED FOOTAGE ACQUISITION — a exigência de tela visível/produto é a MESMA condição
      // já usada para "strict" (produto/mockup/screenshot presentes), confirmada empiricamente
      // (sprint anterior) em todos os Shots reais desta campanha que pediam dispositivo.
      const screenVisibleRequired = Boolean(productRequirement || mockupRequirement || screenshotRequirement);
      return {
        shotId: entry.shotId as string,
        sceneOrder: Number(entry.sceneOrder ?? 0),
        desiredType: mappedType,
        themes: requiredTags,
        emotion: typeof query.emotion === "string" ? query.emotion : undefined,
        requiresHuman: Boolean(humanRequirement),
        requiresRealFootage: shotIsElevated || desiredKind === "video" || desiredKind === "b_roll" || resolvedKind === "video" || resolvedKind === "b_roll",
        strict: strict || shotIsElevated,
        subjectLabel: humanRequirement?.subject ?? productRequirement?.productName ?? mockupRequirement?.what ?? screenshotRequirement?.interface,
        environment: typeof query.sceneName === "string" ? query.sceneName : undefined,
        coupleKey: humanRequirement?.subject ? humanRequirement.subject.trim().toLowerCase() : undefined,
        narrativeGoal: typeof query.narrativeFunction === "string" ? query.narrativeFunction : undefined,
        mainObject: productRequirement?.productName ?? mockupRequirement?.what ?? screenshotRequirement?.interface,
        device: inferDeviceFromText(`${theme} ${requiredTags.join(" ")}`),
        deviceOrientationRequired: screenVisibleRequired ? "front" : "any",
        screenVisibleRequired,
        framing: typeof query.framing === "string" ? query.framing : undefined,
        movement: typeof query.movement === "string" ? query.movement : undefined,
        compositingRequired: screenVisibleRequired,
      };
    });

  const catalog = buildMediaCatalog(paths);
  const gap = await catalog.gapAnalysis(shotPlan);
  return { gap, shotPlan };
}

export async function createMediaCollection(input: { name: string; description?: string; assetIds: string[] }): Promise<MediaCollectionRecord> {
  const paths = projectPaths();
  return buildMediaCatalog(paths).createCollection(input);
}

export async function showMediaCollectionStats(collectionId: string): Promise<MediaCollectionStats | undefined> {
  const paths = projectPaths();
  return buildMediaCatalog(paths).collectionStats(collectionId);
}

// ---------------------------------------------------------------------------------------------
// REAL FOOTAGE ACQUISITION — busca/aquisição via provider externo. Nenhuma destas funções é
// chamada pelo VisualAssetResolver nem por nenhuma Skill; só a CLI. O resolver continua
// consultando apenas o catálogo (`MediaCatalogVisualAssetProvider`), nunca o provider diretamente.
// ---------------------------------------------------------------------------------------------

export type MediaSearchCliResult = { providerId: string; providerConfigured: boolean; hits: MediaProviderSearchHit[] };

export async function searchMedia(text: string, type?: "photo" | "video"): Promise<MediaSearchCliResult> {
  const provider = buildMediaProvider();
  if (!provider.isConfigured()) return { providerId: provider.providerId, providerConfigured: false, hits: [] };
  const hits = await provider.search({ text, type });
  return { providerId: provider.providerId, providerConfigured: true, hits };
}

export async function searchMediaVideo(text: string): Promise<MediaSearchCliResult> {
  return searchMedia(text, "video");
}

/** `resultId` no formato `<providerId>:<externalId>` (impresso por `--media-search-video`). Rebusca um link de download fresco antes de baixar. */
export async function acquireMediaResult(resultId: string): Promise<Awaited<ReturnType<typeof acquireAssetFromHit>>> {
  const [providerId, externalId] = resultId.split(":");
  if (!providerId || !externalId) throw new Error(`resultadoId inválido: "${resultId}". Formato esperado: <provider>:<id>, ex.: pexels:1448735.`);

  const paths = projectPaths();
  const provider = buildMediaProvider();
  if (provider.providerId !== providerId) throw new Error(`resultadoId "${resultId}" pertence ao provider "${providerId}", mas o provider configurado é "${provider.providerId}".`);
  if (!provider.isConfigured()) throw new Error(`Provider "${providerId}" não configurado — defina MEDIA_PROVIDER e MEDIA_PROVIDER_API_KEY.`);

  const hit = await provider.getById(externalId);
  if (!hit) throw new Error(`Resultado "${resultId}" não encontrado no provider (pode ter sido removido).`);

  const catalog = buildMediaCatalog(paths);
  const query = { text: externalId, type: "video" as const };
  const outcome = await acquireAssetFromHit({
    hit, query, providerId: provider.providerId, destinationDir: paths.mediaAcquiredDir,
    catalog, downloadLimits: buildDownloadLimits(),
  });
  if (outcome.status === "acquired") await catalog.indexAcquiredAsset(outcome.record);
  await new MediaAcquisitionLogRepository(paths.mediaAcquisitionLogPath).append([outcome.logEntry]);
  return outcome;
}

export async function acquireMediaForExecution(executionId: string): Promise<AcquisitionRunReport> {
  const paths = projectPaths();
  const provider = buildMediaProvider();
  if (!provider.isConfigured()) {
    throw new Error(
      "Provider de mídia externa não configurado. Defina MEDIA_PROVIDER=pexels e MEDIA_PROVIDER_API_KEY=<chave> " +
      "(https://www.pexels.com/api/) antes de rodar --media-acquire-for-execution. A biblioteca local continua funcionando normalmente sem isso.",
    );
  }

  const { gap, shotPlan } = await mediaGapAnalysisForExecution(executionId);
  const catalog = buildMediaCatalog(paths);
  // FOOTAGE VISUAL VALIDATION 2.0 (seção 9) — o histórico de aprendizado de rejeições vem do MESMO
  // log de aquisição já persistido (nunca um armazenamento paralelo); execuções passadas já
  // penalizam candidatos semelhantes desta execução.
  const pastRejectionHistory = (await new MediaAcquisitionLogRepository(paths.mediaAcquisitionLogPath).list())
    .filter((entry) => entry.outcome === "rejected" && entry.rejectionPattern)
    .map((entry) => ({ author: entry.author, originPageUrl: entry.originPageUrl, rejectionPattern: entry.rejectionPattern }));
  const report = await acquireForShotPlan({
    gapAnalysis: gap, shotPlan, provider, catalog,
    destinationDir: paths.mediaAcquiredDir, downloadLimits: buildDownloadLimits(), executionId,
    pastRejectionHistory, artifactsDir: paths.footageReviewArtifactsDir,
  });
  await new MediaAcquisitionLogRepository(paths.mediaAcquisitionLogPath).append(report.logEntries);
  return report;
}

export async function mediaAcquisitionReport(): Promise<AcquisitionLogEntry[]> {
  const paths = projectPaths();
  return new MediaAcquisitionLogRepository(paths.mediaAcquisitionLogPath).list();
}

export async function mediaReviewPending(): Promise<MediaAssetRecord[]> {
  const paths = projectPaths();
  return buildMediaCatalog(paths).list({ approvalStatus: "needs_review" });
}

// ---------------------------------------------------------------------------------------------
// FOOTAGE VISUAL VALIDATION 2.0 (seção 8) — fila de revisão humana em lote. Nunca aprova nada
// automaticamente: só lista/mostra/decide o que um humano já decidiu explicitamente via CLI.
// Reaproveita o MESMO `approve`/`reject` do catálogo (seção 5 da sprint anterior) — nenhuma lógica
// de aprovação nova, só uma visão mais rica sobre os candidatos que passaram pelo Visual Candidate
// Validator/Pre-composition Simulator desta sprint.
// ---------------------------------------------------------------------------------------------

/** Só candidatos que realmente passaram pelo pipeline desta sprint (`visualValidationStage` presente) — distingue da fila genérica `--media-review-pending`, que inclui qualquer coisa `needs_review` (ex.: itens só escaneados da biblioteca local, sem nenhuma validação visual em estágios). */
export async function footageReviewList(): Promise<MediaAssetRecord[]> {
  const pending = await mediaReviewPending();
  return pending.filter((asset) => asset.visualValidationStage !== undefined);
}

export async function footageReviewShow(assetId: string): Promise<MediaAssetRecord | undefined> {
  return showMediaAsset(assetId);
}

export async function footageReviewApprove(assetId: string, note?: string): Promise<MediaAssetRecord> {
  return approveMediaAsset(assetId, note);
}

export async function footageReviewReject(assetId: string, reason?: string): Promise<MediaAssetRecord> {
  return rejectMediaAsset(assetId, reason);
}

// ---------------------------------------------------------------------------------------------
// PRODUCT COMPOSITING ENGINE — insere telas reais do produto em filmagens reais já aprovadas.
// Nenhuma Skill importa `FfmpegProductCompositingAdapter`/`ProductScreenCatalogRepository`
// diretamente; só a CLI. `VisualAssetResolver` continua consumindo apenas o catálogo de mídia
// (o asset composto entra nele como qualquer outro, via `indexAcquiredAsset`).
// ---------------------------------------------------------------------------------------------

function buildProductCompositingAdapter(): FfmpegProductCompositingAdapter {
  return new FfmpegProductCompositingAdapter();
}

export async function productCompositingCapabilities(): Promise<ProductCompositingCapabilityReport[]> {
  return buildProductCompositingAdapter().capabilities();
}

export async function productScreenScan(): Promise<ProductScreenScanResult> {
  const paths = projectPaths();
  return buildProductScreenCatalog(paths).scan();
}

export async function listProductScreens(filter?: { approvalStatus?: ProductScreenApprovalStatus }): Promise<ProductScreenRecord[]> {
  const paths = projectPaths();
  return buildProductScreenCatalog(paths).list(filter);
}

export async function showProductScreen(screenId: string): Promise<ProductScreenRecord | undefined> {
  const paths = projectPaths();
  return buildProductScreenCatalog(paths).get(screenId);
}

export async function approveProductScreen(screenId: string): Promise<ProductScreenRecord> {
  const paths = projectPaths();
  return buildProductScreenCatalog(paths).approve(screenId);
}

export async function rejectProductScreen(screenId: string, reason?: string): Promise<ProductScreenRecord> {
  const paths = projectPaths();
  return buildProductScreenCatalog(paths).reject(screenId, reason);
}

export type ProductScreenReport = {
  total: number;
  approved: number;
  needsReview: number;
  rejected: number;
  byFunctionality: Record<string, number>;
  byDeviceTarget: Record<string, number>;
};

export async function productScreenReport(): Promise<ProductScreenReport> {
  const paths = projectPaths();
  const screens = await buildProductScreenCatalog(paths).list();
  const byFunctionality: Record<string, number> = {};
  const byDeviceTarget: Record<string, number> = {};
  for (const screen of screens) {
    byFunctionality[screen.functionality] = (byFunctionality[screen.functionality] ?? 0) + 1;
    byDeviceTarget[screen.deviceTarget] = (byDeviceTarget[screen.deviceTarget] ?? 0) + 1;
  }
  return {
    total: screens.length,
    approved: screens.filter((screen) => screen.approvalStatus === "approved").length,
    needsReview: screens.filter((screen) => screen.approvalStatus === "needs_review").length,
    rejected: screens.filter((screen) => screen.approvalStatus === "rejected").length,
    byFunctionality,
    byDeviceTarget,
  };
}

// ---------------------------------------------------------------------------------------------
// COMPANY INTELLIGENCE ENGINE — orquestração CLI (seções 2-15). Camada aditiva: as funções abaixo
// só chamam APIs públicas já existentes (`clara.create`, `ProductScreenCatalogRepository.upsert`)
// através das pontes em `infrastructure/company-intelligence/*-bridge.ts`, nunca alteram nenhum
// arquivo protegido desta sprint.
// ---------------------------------------------------------------------------------------------

function buildCompanyIntelligenceClara(paths: ReturnType<typeof projectPaths>): ClaraKnowledgeCenter {
  return new ClaraKnowledgeCenter({
    repository: new LocalJsonClaraKnowledgeRepository(join(paths.dataDir, "knowledge.json")),
  });
}

export type CompanyDiscoverOptions = {
  allowedPaths?: string[];
  seedPaths?: string[];
  maxPages?: number;
  requestDelayMs?: number;
};

/** Seção 2-9: executa a coleta completa (descoberta → extração → captura → análise → classificação) para um domínio. */
export async function companyDiscover(domain: string, options: CompanyDiscoverOptions = {}): Promise<CompanyKnowledgeBase> {
  const paths = projectPaths();
  const engine = buildCompanyIntelligenceEngine(paths);
  return engine.collect(domain, options);
}

/** Seção 1/14: retorna a base de conhecimento já coletada para um domínio (ou undefined se nunca coletada). */
export async function companyKnowledgeBase(domain: string): Promise<CompanyKnowledgeBase | undefined> {
  const paths = projectPaths();
  return buildCompanyIntelligenceEngine(paths).get(domain);
}

export async function listCompanyKnowledgeBases(): Promise<CompanyKnowledgeBase[]> {
  const paths = projectPaths();
  return buildCompanyIntelligenceEngine(paths).list();
}

/** Seção 10: consulta a base de conhecimento com uma pergunta em PT-BR. */
export async function companySearch(domain: string, question: string): Promise<ReturnType<typeof searchCompanyKnowledge>> {
  const base = await companyKnowledgeBase(domain);
  if (!base) {
    return { answer: `Nenhuma base de conhecimento coletada ainda para ${domain}. Rode --company-discover primeiro.`, confidence: 0, sourceNodeIds: [] };
  }
  return searchCompanyKnowledge(base, question);
}

export type CompanyPublishResult = {
  domain: string;
  clientId: string;
  claraRecords: Awaited<ReturnType<typeof publishCompanyKnowledgeToClara>>;
  productScreens: Awaited<ReturnType<typeof publishCapturedScreensToProductCatalog>>;
};

/** Seção 11/12: publica a base já coletada na Clara (Creative Context) e no Product Screen Catalog (Product Authenticity), sem alterar nenhum dos dois sistemas. */
export async function companyPublish(domain: string, clientId: string = DEMO_CLIENT_ID): Promise<CompanyPublishResult> {
  const paths = projectPaths();
  const base = await buildCompanyIntelligenceEngine(paths).get(domain);
  if (!base) {
    throw new Error(`Nenhuma base de conhecimento coletada ainda para ${domain}. Rode --company-discover primeiro.`);
  }

  const clara = buildCompanyIntelligenceClara(paths);
  const claraRecords = await publishCompanyKnowledgeToClara(base, clientId, clara);

  const catalog = buildProductScreenCatalog(paths);
  const productScreens = await publishCapturedScreensToProductCatalog(base, clientId, catalog);

  return { domain, clientId, claraRecords, productScreens };
}

// ---------------------------------------------------------------------------------------------
// CAMPAIGN INTELLIGENCE ENGINE — orquestração CLI (seções 1-17). Camada aditiva: as funções abaixo
// só chamam APIs públicas já existentes através das pontes em
// `infrastructure/campaign-intelligence/*-bridge.ts`, nunca alteram nenhum arquivo protegido.
// ---------------------------------------------------------------------------------------------

function buildCampaignIntelligenceClara(paths: ReturnType<typeof projectPaths>): ClaraKnowledgeCenter {
  return new ClaraKnowledgeCenter({
    repository: new LocalJsonClaraKnowledgeRepository(join(paths.dataDir, "knowledge.json")),
  });
}

/** Seções 1-9: ingere um ou mais arquivos (inclusive ZIP) no Workspace de uma campanha — incremental por hash, nunca reprocessa o que já existe. */
export async function campaignIngest(campaignId: string, filePaths: string[]): Promise<Awaited<ReturnType<CampaignIntelligenceEngine["ingest"]>>> {
  const paths = projectPaths();
  const engine = buildCampaignIntelligenceEngine(paths);
  return engine.ingest(campaignId, filePaths);
}

export async function campaignWorkspace(campaignId: string): Promise<CampaignWorkspace | undefined> {
  const paths = projectPaths();
  return buildCampaignIntelligenceEngine(paths).get(campaignId);
}

export async function listCampaignWorkspaces(): Promise<CampaignWorkspace[]> {
  const paths = projectPaths();
  return buildCampaignIntelligenceEngine(paths).list();
}

/** Seção 13: Frame Search — "Mostrar trecho onde aparece RSVP", "Mostrar tela de Check-in" etc. */
export async function campaignFrameSearch(campaignId: string, query: string): Promise<ReturnType<typeof searchFrames>> {
  const workspace = await campaignWorkspace(campaignId);
  if (!workspace) return [];
  return searchFrames({ query, screens: workspace.screens, videoAnalyses: workspace.videoAnalyses, imageAnalyses: workspace.imageAnalyses });
}

/** Seção 12: Reuse Engine — verifica se já existe material oficial antes de qualquer geração. */
export async function campaignReuseCheck(campaignId: string, query: string): Promise<ReturnType<typeof findReusableMaterial>> {
  const workspace = await campaignWorkspace(campaignId);
  if (!workspace) return { found: false, reason: `Nenhum Workspace coletado ainda para a campanha ${campaignId}. Rode --campaign-ingest primeiro.` };
  return findReusableMaterial({ query, features: workspace.features, screens: workspace.screens, videoAnalyses: workspace.videoAnalyses });
}

export type CampaignIntelligencePublishResult = {
  campaignId: string;
  clientId: string;
  claraRecords: Awaited<ReturnType<typeof publishCampaignWorkspaceToClara>>;
  productScreens: Awaited<ReturnType<typeof publishCampaignScreensToProductCatalog>>;
};

/** Seção 11/12/16: publica o Workspace já ingerido na Clara (Creative Context) e no Product Screen Catalog, sem alterar nenhum dos dois sistemas nem nenhuma Skill. */
export async function campaignIntelligencePublish(campaignId: string, clientId: string = DEMO_CLIENT_ID): Promise<CampaignIntelligencePublishResult> {
  const paths = projectPaths();
  const workspace = await buildCampaignIntelligenceEngine(paths).get(campaignId);
  if (!workspace) {
    throw new Error(`Nenhum Workspace coletado ainda para a campanha ${campaignId}. Rode --campaign-ingest primeiro.`);
  }

  const clara = buildCampaignIntelligenceClara(paths);
  const claraRecords = await publishCampaignWorkspaceToClara(workspace, clientId, clara);

  const catalog = buildProductScreenCatalog(paths);
  const productScreens = await publishCampaignScreensToProductCatalog(workspace, clientId, catalog);

  return { campaignId, clientId, claraRecords, productScreens };
}

// ---------------------------------------------------------------------------------------------
// LOCAL OFFICIAL ASSET QUALIFICATION — orquestração CLI. Camada aditiva: chama só
// `MediaCatalogPort` (já existente) + os módulos novos desta sprint, que por sua vez só chamam o
// Visual Candidate Validator/Pre-composition Simulator já existentes.
// ---------------------------------------------------------------------------------------------

export type ValidateLocalAssetCommandInput = {
  assetId?: string;
  filePath?: string;
  campaignId?: string;
  clientId?: string;
  device?: "phone" | "tablet" | "notebook" | "desktop" | "none";
  screenVisibleRequired?: boolean;
  interactionRequired?: boolean;
  force?: boolean;
};

/** Seções 1-4: valida um asset local oficial já catalogado com o mesmo Visual Candidate Validator do Intent-Based Footage Acquisition. */
export async function validateLocalAssetCommand(input: ValidateLocalAssetCommandInput): Promise<Awaited<ReturnType<typeof validateLocalAsset>>> {
  const paths = projectPaths();
  const catalog = buildMediaCatalog(paths);
  return validateLocalAsset(catalog, input);
}

/** Seção 8: valida em lote todos os assets locais oficiais de uma campanha (pula os já validados sem mudança de hash). */
export async function validateLocalAssetsBatchCommand(input: { campaignId?: string; clientId?: string; force?: boolean }): Promise<Awaited<ReturnType<typeof validateLocalAssetsForCampaign>>> {
  const paths = projectPaths();
  const catalog = buildMediaCatalog(paths);
  return validateLocalAssetsForCampaign(catalog, input);
}

/** Seção 5 (Product Compositing) — gera o pacote assistido (frames de referência) para um asset de vídeo já catalogado. */
export async function buildCompositingAssistedPackage(input: {
  assetId: string;
  screenType: "phone" | "tablet" | "notebook" | "desktop";
  referenceTimestamps: number[];
}): Promise<ScreenMarkingAssistedPackage> {
  const paths = projectPaths();
  const catalog = buildMediaCatalog(paths);
  const asset = await catalog.get(input.assetId);
  if (!asset) throw new Error(`Asset "${input.assetId}" não encontrado no catálogo de mídia.`);
  if (asset.type !== "video") throw new Error(`Asset "${input.assetId}" não é um vídeo (type="${asset.type}") — composição de produto exige filmagem real.`);

  const meta = await readVideoMetadata(asset.absolutePath);
  const adapter = buildProductCompositingAdapter();
  await mkdir(paths.assistedPackagesDir, { recursive: true });
  const pkg = await adapter.buildAssistedPackage({
    assetId: input.assetId,
    sourceVideoPath: asset.absolutePath,
    sourceVideoDurationSeconds: meta.durationSeconds,
    screenType: input.screenType,
    referenceTimestamps: input.referenceTimestamps,
    outputDir: paths.assistedPackagesDir,
  });
  await writeFile(join(paths.assistedPackagesDir, `${pkg.packageId}.json`), JSON.stringify(pkg, null, 2), "utf8");
  return pkg;
}

/**
 * Seção 4/6 — compõe uma tela de produto real sobre um Shot já catalogado e, se bem-sucedido,
 * registra um NOVO asset (`composited_product_footage`) no catálogo — nunca sobrescreve o
 * original. `keyframes` já validados (mode/coordenadas) pelo próprio adapter antes de compor.
 */
export async function compositeProductScreenForAsset(input: {
  sourceAssetId: string;
  productScreenId: string;
  functionality: string;
  startTime: number;
  endTime: number;
  mode: "STATIC_SCREEN" | "SIMPLE_KEYFRAME_TRACKING" | "MANUAL_ASSISTED";
  keyframes: ScreenMarkingResponse["keyframes"];
  cornerRadius?: number;
  feather?: number;
  safeMargin?: number;
  executionId?: string;
  clientId?: string;
}): Promise<
  | { status: "composited"; asset: MediaAssetRecord }
  | { status: "blocked"; reason: string; needsManualOcclusion: boolean }
> {
  const paths = projectPaths();
  const catalog = buildMediaCatalog(paths);
  const screenCatalog = buildProductScreenCatalog(paths);

  const sourceAsset = await catalog.get(input.sourceAssetId);
  if (!sourceAsset) throw new Error(`Asset de origem "${input.sourceAssetId}" não encontrado no catálogo de mídia.`);

  const screen = await screenCatalog.get(input.productScreenId);
  if (!screen) throw new Error(`Tela de produto "${input.productScreenId}" não encontrada no catálogo.`);

  // UNIFIED COVERAGE MODEL (seção 8) — gate conjunto único: Phone Screen aprovada + Real Video
  // aprovado + Interaction confirmada, ou nem começa a compor. Nunca alterado por esta sprint.
  const gate = canStartProductCompositing({ sourceAsset, productScreen: screen });
  if (!gate.allowed) throw new Error(gate.reason);

  // LOCAL OFFICIAL ASSET QUALIFICATION (seção 10) — checagem ADICIONAL, ao lado da acima: a fonte
  // precisa ter passado pelo Visual Candidate Validator reaproveitado e carregar a capacidade
  // "compositing_source" — nunca reaproveita um composite antigo construído sobre tela fictícia
  // sem essa validação real.
  const localEligibility = assertCompositingSourceEligible(sourceAsset);
  if (!localEligibility.eligible) throw new Error(localEligibility.reason);

  const meta = await readVideoMetadata(sourceAsset.absolutePath);
  const contract: ScreenPlacementContract = {
    sourceVideoPath: sourceAsset.absolutePath,
    sourceVideoDurationSeconds: meta.durationSeconds,
    productScreenId: input.productScreenId,
    startTime: input.startTime,
    endTime: input.endTime,
    mode: input.mode,
    keyframes: input.keyframes,
    interpolationMode: "linear",
    opacity: 1,
    blendMode: "normal",
    cropMode: "stretch_to_quad",
    perspectiveTransform: true,
    cornerRadius: input.cornerRadius ?? 0.05,
    screenBrightness: 0,
    screenContrast: 1,
    screenSaturation: 1,
    blur: 0,
    reflection: false,
    grain: 0,
    feather: input.feather ?? 0.015,
    safeMargin: input.safeMargin ?? 2,
  };

  const adapter = buildProductCompositingAdapter();
  await mkdir(paths.compositedFootageDir, { recursive: true });
  const outcome = await adapter.composite({
    contract,
    productScreenSourcePath: screen.sourcePath,
    productScreenContentCropRect: screen.contentCropRect,
    productScreenIsVideo: screen.sourceType === "screen_recording",
    outputDir: paths.compositedFootageDir,
    executionId: input.executionId ?? "manual",
  });

  if (outcome.status === "blocked") return outcome;

  const hash = await computeFileHash(outcome.outputAbsolutePath);
  const now = new Date().toISOString();
  const combinedLicense = sourceAsset.license && screen.license
    ? {
      name: `Derivado de "${sourceAsset.license.name}" (filmagem) + "${screen.license.name}" (tela do produto)`,
      allowsCommercialUse: sourceAsset.license.allowsCommercialUse && screen.license.allowsCommercialUse,
      requiresAttribution: sourceAsset.license.requiresAttribution || screen.license.requiresAttribution,
    }
    : undefined;

  const record: MediaAssetRecord = {
    assetId: `composited-${hash.slice(0, 16)}`,
    absolutePath: outcome.outputAbsolutePath,
    relativePath: outcome.outputAbsolutePath,
    name: outcome.outputAbsolutePath.split(/[\\/]/).pop() ?? outcome.outputAbsolutePath,
    type: "video",
    format: "mp4",
    durationSeconds: outcome.durationSeconds,
    width: outcome.width,
    height: outcome.height,
    aspectRatio: sourceAsset.aspectRatio,
    sizeBytes: outcome.sizeBytes,
    hash,
    indexedAt: now,
    origin: "developer_assisted",
    author: sourceAsset.author,
    license: combinedLicense,
    licenseStatus: combinedLicense ? "known" : "unknown",
    client: input.clientId,
    themes: sourceAsset.themes,
    people: sourceAsset.people,
    actions: sourceAsset.actions,
    objects: sourceAsset.objects,
    location: sourceAsset.location,
    emotion: sourceAsset.emotion,
    tags: [...new Set([...sourceAsset.tags, ...screen.tags, "produto-real", "composited"])],
    footageClassification: "composited_product_footage",
    scores: {},
    approvalStatus: "needs_review",
    usageHistory: [],
    duplicate: { derivedFrom: sourceAsset.assetId },
    available: true,
    // OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 11) — carimbado AGORA, no único
    // momento em que a origem real de footage+tela é conhecida com certeza; nunca re-inferido
    // depois a partir só do `footageClassification`.
    authenticityClassOverride: classifyComposite({
      sourceFootage: classifyMediaAssetRecord(sourceAsset),
      screen: classifyProductScreenById(screen.screenId),
    }),
    notes: [
      `Composição de produto: footage original "${sourceAsset.assetId}" + tela "${screen.screenId}" (${input.functionality}).`,
      `Engine: ${outcome.engineVersion} · modo: ${input.mode} · keyframes: ${outcome.keyframesApplied.length} · substeps de interpolação: ${outcome.interpolationSubsteps}.`,
    ],
    compositionProvenance: {
      sourceFootageAssetId: sourceAsset.assetId,
      productScreenId: screen.screenId,
      functionality: input.functionality,
      engineVersion: outcome.engineVersion,
      createdAt: now,
      clientId: input.clientId ?? screen.clientId,
      keyframes: input.keyframes,
    },
  };

  await catalog.indexAcquiredAsset(record);
  return { status: "composited", asset: record };
}

export async function productCoverageReport(executionId: string): Promise<ProductCoverageBreakdown> {
  const paths = projectPaths();
  const reportPath = join(paths.artifactsDir, executionId, "visual-assets", "asset-report.json");
  const raw = await readFile(reportPath, "utf8");
  const parsed = JSON.parse(raw) as { resolved?: unknown[] };
  const resolved = (parsed.resolved ?? []) as unknown as VisualAssetResolved[];
  return computeProductCoverageBreakdown(resolved);
}

export type CoverageMatrixReport = {
  executionId: string;
  matrix: CoverageMatrixRow[];
  overall: CoverageFraction;
  byScene: Array<{ sceneOrder: number } & CoverageFraction>;
  byCategory: Array<{ family: string; label: string } & CoverageFraction>;
};

/**
 * UNIFIED COVERAGE MODEL (seção 13) — `Shot | Requirement | Status | Evidence | Source`, mais
 * Coverage por Cena/Categoria/Geral. Nasce do mesmo `CoverageGraph` que Production Readiness/Asset
 * Diversity Gate/Gap Analysis usam — nunca recalcula nada por conta própria.
 */
export async function buildCoverageMatrixForExecution(executionId: string, qualityProfile: AssetQualityProfile = "premium"): Promise<CoverageMatrixReport> {
  const paths = projectPaths();
  const reportPath = join(paths.artifactsDir, executionId, "visual-assets", "asset-report.json");
  const raw = await readFile(reportPath, "utf8");
  const parsed = JSON.parse(raw) as { resolved?: unknown[]; pending?: unknown[] };
  const resolved = (parsed.resolved ?? []) as unknown as VisualAssetResolved[];
  const pending = (parsed.pending ?? []) as unknown as VisualAssetCreationPackage[];
  const requirements = DEFAULT_ASSET_DIVERSITY_REQUIREMENTS[qualityProfile];

  const graph = buildCoverageGraph({ resolved, pending, requirements });
  const matrix = buildCoverageMatrix(graph);
  const overall = coverageOverall(matrix);
  const byScene = [...coverageByScene(matrix).entries()].map(([sceneOrder, fraction]) => ({ sceneOrder, ...fraction })).sort((a, b) => a.sceneOrder - b.sceneOrder);
  const byCategory = [...coverageByCategory(matrix).entries()].map(([family, fraction]) => ({ family, label: formatCategoryGroupLabel(family), ...fraction }));

  return { executionId, matrix, overall, byScene, byCategory };
}

// ---------------------------------------------------------------------------------------------
// CINEMATIC SCENE COMPOSITION ENGINE — camada nova ENTRE a busca de assets e a renderização (nunca
// altera Arthur/Caio/Helena/Skills, Autonomous Execution Engine, Unified Coverage Model ou Lucas —
// só a CLI conhece este motor). "Ele não renderiza. Ele apenas monta a sequência" (seção 6): nunca
// baixa/adquire nada aqui, só busca candidatos (Pexels) e planeja — zero efeito colateral no
// catálogo, seguro para rodar quantas vezes quiser como preview.
// ---------------------------------------------------------------------------------------------

function shotIntentFromRawEntry(shotId: string, sceneOrder: number, query: Record<string, unknown>, resolvedKind?: string): ShotIntent {
  const humanRequirement = query.humanRequirement as { subject?: string; strict?: boolean } | undefined;
  const productRequirement = query.productRequirement as { productName?: string; strict?: boolean } | undefined;
  const mockupRequirement = query.mockupRequirement as { what?: string; strict?: boolean } | undefined;
  const screenshotRequirement = query.screenshotRequirement as { interface?: string; strict?: boolean } | undefined;
  const screenVisibleRequired = Boolean(productRequirement || mockupRequirement || screenshotRequirement);
  const theme = typeof query.theme === "string" ? query.theme : "";
  const requiredTags = Array.isArray(query.requiredTags) ? (query.requiredTags as string[]) : [];
  const desiredKind = typeof query.desiredKind === "string" ? query.desiredKind : "photo";

  return {
    shotId,
    sceneOrder,
    narrativeGoal: typeof query.narrativeFunction === "string" ? query.narrativeFunction : "objetivo não especificado",
    mainAction: theme,
    secondaryAction: undefined,
    protagonist: humanRequirement?.subject ?? productRequirement?.productName,
    mainObject: productRequirement?.productName ?? mockupRequirement?.what ?? screenshotRequirement?.interface,
    device: inferDeviceFromText(`${theme} ${requiredTags.join(" ")}`),
    deviceOrientation: screenVisibleRequired ? "front" : "any",
    screenVisibleRequired,
    emotion: typeof query.emotion === "string" ? query.emotion : undefined,
    framing: typeof query.framing === "string" ? query.framing : undefined,
    movement: typeof query.movement === "string" ? query.movement : undefined,
    minDurationSeconds: 2,
    assetType: (resolvedKind ?? desiredKind) as ShotIntent["assetType"],
    compositingRequired: screenVisibleRequired,
  };
}

export type SceneCompositionReport = {
  executionId: string;
  shotId: string;
  shotPurpose: VisualSequenceRole;
  microShots: MicroShot[];
  composed: ComposedScene;
  candidatesByMicroShot: MicroShotCandidates[];
  coverage: SceneCoverageResult;
  score: SceneScore;
  qualityIssues: SceneQualityIssue[];
};

/**
 * Compõe a cena de UM Shot já resolvido de uma execução: decompõe em MicroShots (seção 1), expande
 * consultas por microplano (seção 5), busca vários candidatos reais no provider configurado (seção
 * 4, sem baixar nada), monta a sequência cinematográfica (seção 6/9/10/11), calcula cobertura por
 * composição (seção 3/13), nota da cena (seção 12) e roda o gate de qualidade autônomo (seção 15).
 */
export async function composeSceneForShot(executionId: string, shotId: string): Promise<SceneCompositionReport> {
  const paths = projectPaths();
  const reportPath = join(paths.artifactsDir, executionId, "visual-assets", "asset-report.json");
  const raw = await readFile(reportPath, "utf8");
  const parsed = JSON.parse(raw) as { resolved?: Array<Record<string, unknown>> };
  const entry = (parsed.resolved ?? []).find((candidate) => candidate.shotId === shotId);
  if (!entry) throw new Error(`Shot "${shotId}" não encontrado nos assets resolvidos da execução ${executionId}.`);

  const query = (entry.query ?? {}) as Record<string, unknown>;
  const asset = (entry.asset ?? {}) as Record<string, unknown>;
  const sceneOrder = Number(entry.sceneOrder ?? 0);
  const shotPurpose = (typeof entry.shotPurpose === "string" ? entry.shotPurpose : "detail") as VisualSequenceRole;
  const intent = shotIntentFromRawEntry(shotId, sceneOrder, query, typeof asset.kind === "string" ? asset.kind : undefined);

  const microShots = decomposeShot(intent, shotPurpose);
  const provider = buildMediaProvider();
  const usedAuthors = new Set<string>();
  const candidatesByMicroShot = await retrieveCandidatesForAllMicroShots({ microShots, intent, provider, usedAuthors });

  const composed = composeScene(microShots);

  // Preview de cobertura: assume-se atribuído o melhor candidato de cada microplano (nenhum
  // download real acontece aqui — ver cabeçalho da seção). Sem candidato, o microplano fica sem
  // atribuição, honestamente contando como não cumprido.
  const assignments = new Map<string, VisualAssetMetadata[]>();
  for (const microShotCandidates of candidatesByMicroShot) {
    const best = microShotCandidates.candidates[0];
    if (!best) continue;
    assignments.set(microShotCandidates.microShotId, [{
      id: best.hit.externalId,
      provider: "pexels",
      origin: "free_provider",
      absolutePath: best.hit.downloadUrl,
      license: { name: best.hit.license.name, allowsCommercialUse: best.hit.license.allowsCommercialUse, requiresAttribution: best.hit.license.requiresAttribution },
      tags: [],
      width: best.hit.width ?? intent.minDurationSeconds,
      height: best.hit.height ?? 0,
      aspectRatio: "9:16",
      kind: intent.assetType,
    } as VisualAssetMetadata]);
  }

  const coverage = computeSceneCoverage(shotId, composed.sequence, assignments);
  const score = computeSceneScore({ composed, coverage: coverage.coverage, microShotFulfillments: coverage.microShotFulfillments });
  const qualityIssues = evaluateSceneQualityGate(composed);

  return { executionId, shotId, shotPurpose, microShots, composed, candidatesByMicroShot, coverage, score, qualityIssues };
}

export async function composeScenesForExecution(executionId: string, shotIds?: string[]): Promise<SceneCompositionReport[]> {
  const paths = projectPaths();
  const reportPath = join(paths.artifactsDir, executionId, "visual-assets", "asset-report.json");
  const raw = await readFile(reportPath, "utf8");
  const parsed = JSON.parse(raw) as { resolved?: Array<Record<string, unknown>> };
  const targetShotIds = shotIds ?? (parsed.resolved ?? []).map((entry) => entry.shotId as string).filter(Boolean);

  const reports: SceneCompositionReport[] = [];
  for (const shotId of targetShotIds) {
    reports.push(await composeSceneForShot(executionId, shotId));
  }
  return reports;
}

function buildAssetInspectionQuery(): VisualAssetSearchQuery {
  return {
    executionId: "asset-inspection",
    sceneOrder: 1,
    sceneName: "Inspeção da biblioteca",
    theme: "Biblioteca visual do Zuno",
    emotion: "neutro",
    narrativeFunction: "auditoria",
    desiredKind: "photo",
    requiredTags: [],
    targetWidth: 1080,
    targetHeight: 1920,
    targetAspectRatio: "9:16",
  };
}

function summarizeVisualAssets(assets: VisualAssetMetadata[]): VisualAssetsCliReport["summary"] {
  return {
    total: assets.length,
    byProvider: countBy(assets, (asset) => asset.provider),
    byOrigin: countBy(assets, (asset) => asset.origin),
    byLicense: countBy(assets, (asset) => asset.license.name),
  };
}

function countBy<T>(items: T[], selector: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = selector(item) || "desconhecido";
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

/**
 * Deriva clientId, formato, tipo de conteúdo e Skills utilizadas a partir do relatório final já
 * gravado em `artifacts/<executionId>/execution-report.json` — o mesmo arquivo que a entrega final
 * grava para o usuário baixar. Evita pedir de novo ao usuário dados que o workflow já produziu.
 */
function deriveFeedbackContext(report: WorkflowExecutionReport): { clientId: string; format: string; contentType: string; skillsUsed: string[] } {
  const skillsUsed = Array.from(new Set(report.steps.filter((step) => step.skillId).map((step) => step.skillId as string)));
  const strategyStep = report.steps.find((step) => step.skillCapability === "strategy");
  const format = readStringField(strategyStep?.response?.output, "format") ?? "desconhecido";
  const capabilities = report.planSnapshot.steps.map((step) => step.skillCapability).filter(Boolean);
  const contentType = capabilities.includes("video_rendering") ? "video" : capabilities.includes("image_generation") ? "imagem" : "texto";
  return { clientId: report.clientId, format, contentType, skillsUsed };
}

function readStringField(output: unknown, key: string): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const value = (output as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export type RecordQualityFeedbackOptions = {
  executionId: string;
  rating: QualityFeedbackRatingInput;
  categoryScores?: QualityFeedbackCategoryRating[];
  categoriesNeedingImprovement?: QualityFeedbackCategory[];
  comment?: string;
  campaignId?: string;
};

/**
 * Registra a avaliação humana de uma execução já concluída. Lê `execution-report.json` (gravado
 * pela entrega final) para derivar clientId/formato/tipo de conteúdo/Skills utilizadas — o usuário
 * só precisa informar a nota, as categorias e o comentário.
 */
export async function recordQualityFeedback(options: RecordQualityFeedbackOptions): Promise<QualityFeedbackRecord> {
  const { paths, clara, qualityFeedback, campaignManager } = await buildRuntime();
  const executionReportPath = join(paths.artifactsDir, options.executionId, "execution-report.json");

  let report: WorkflowExecutionReport;
  try {
    report = JSON.parse(await readFile(executionReportPath, "utf8")) as WorkflowExecutionReport;
  } catch {
    throw new Error(
      `Relatório de execução não encontrado para ${options.executionId}. A execução precisa estar COMPLETED (ver artifacts/${options.executionId}/execution-report.json).`,
    );
  }

  const context = deriveFeedbackContext(report);
  const record = await qualityFeedback.record({
    executionId: options.executionId,
    clientId: context.clientId,
    contentType: context.contentType,
    format: context.format,
    skillsUsed: context.skillsUsed,
    campaignId: options.campaignId,
    rating: options.rating,
    categoryScores: options.categoryScores,
    categoriesNeedingImprovement: options.categoriesNeedingImprovement,
    comment: options.comment,
    submittedBy: { id: "cli-user", type: "human" },
  });

  // Módulo 6 (Aprendizado) da Clara: sincronizado automaticamente a cada avaliação registrada, para
  // que o histórico de conteúdos bem/mal avaliados fique disponível como conhecimento estruturado,
  // não apenas como relatório do Quality Feedback. Nunca bloqueia o registro do feedback em si —
  // uma falha na sincronização é apenas logada como aviso.
  try {
    await syncQualityFeedbackToClara({ clara, qualityFeedback, clientId: context.clientId });
  } catch (error) {
    console.error(
      `[zuno] Aviso: não foi possível sincronizar o Módulo 6 (Aprendizado) da Clara para ${context.clientId}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Módulo 9 (Biblioteca Editorial) da Clara: sincronizado automaticamente a cada avaliação
  // registrada, cumulativamente (nunca substitui o histórico anterior). Quando a avaliação informa
  // um campaignId conhecido, o Campaign Manager é consultado para enriquecer o sinal de tema/CTA
  // com o dado mais autoritativo disponível. Nunca bloqueia o registro do feedback em si — uma
  // falha na sincronização é apenas logada como aviso, igual ao Módulo 6 acima.
  try {
    const campaign = options.campaignId ? await campaignManager.getCampaign(options.campaignId) : undefined;
    await syncEditorialLibrary({ clara, clientId: context.clientId, report, feedbackRecord: record, campaign });
  } catch (error) {
    console.error(
      `[zuno] Aviso: não foi possível sincronizar o Módulo 9 (Biblioteca Editorial) da Clara para ${context.clientId}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return record;
}

export async function getQualityFeedbackReport(query: QualityFeedbackQuery = {}): Promise<QualityFeedbackReport> {
  const { qualityFeedback } = await buildRuntime();
  return qualityFeedback.getReport(query);
}

export type CreateCampaignOptions = {
  objective: string;
  clientId?: string;
  durationDays?: number;
  channels?: string[];
};

export async function createCampaign(options: CreateCampaignOptions): Promise<CampaignPlan> {
  const { valentina, clara, campaignManager } = await buildRuntime();
  const clientId = options.clientId ?? DEMO_CLIENT_ID;
  if (clientId === DEMO_CLIENT_ID) {
    await ensureDemoClient(valentina, clara);
  }

  return campaignManager.createCampaign({
    clientId,
    objective: options.objective,
    durationDays: options.durationDays,
    channels: options.channels,
  });
}

export async function listCampaigns(query: CampaignQuery = {}): Promise<CampaignPlan[]> {
  const { campaignManager } = await buildRuntime();
  return campaignManager.listCampaigns(query);
}

export async function getCampaign(campaignId: string): Promise<{ plan: CampaignPlan; summary: CampaignStatusSummary } | undefined> {
  const { campaignManager } = await buildRuntime();
  const plan = await campaignManager.getCampaign(campaignId);
  if (!plan) return undefined;
  const summary = await campaignManager.getStatusSummary(campaignId);
  return { plan, summary };
}

export async function generateCampaignContentExecutionPlan(campaignId: string, contentId: string): Promise<CampaignContentExecutionPlanResult> {
  const { campaignManager } = await buildRuntime();
  return campaignManager.generateExecutionPlanForContent(campaignId, contentId);
}

export async function markCampaignContentStatus(campaignId: string, contentId: string, status: CampaignContentStatus, reason?: string) {
  const { campaignManager } = await buildRuntime();
  return campaignManager.updateContentStatus(campaignId, contentId, status, reason);
}
