#!/usr/bin/env node
import {
  continueZunoExecution,
  createCampaign,
  generateCampaignContentExecutionPlan,
  getVisualAssetsReport,
  getCampaign,
  getQualityFeedbackReport,
  listVisualAssets,
  listCampaigns,
  listPendingExecutions,
  markCampaignContentStatus,
  recordQualityFeedback,
  resumeZunoExecution,
  runZunoCommand,
  scanVisualAssets,
  scanMediaCatalog,
  listMediaAssets,
  showMediaAsset,
  getMediaHealthReport,
  tagMediaAsset,
  approveMediaAsset,
  rejectMediaAsset,
  removeMediaAsset,
  mediaGapAnalysisForExecution,
  createMediaCollection,
  showMediaCollectionStats,
  searchMedia,
  searchMediaVideo,
  acquireMediaResult,
  acquireMediaForExecution,
  mediaAcquisitionReport,
  mediaReviewPending,
  footageReviewList,
  footageReviewShow,
  footageReviewApprove,
  footageReviewReject,
  productCompositingCapabilities,
  productScreenScan,
  listProductScreens,
  showProductScreen,
  approveProductScreen,
  rejectProductScreen,
  productScreenReport,
  buildCompositingAssistedPackage,
  compositeProductScreenForAsset,
  productCoverageReport,
  runAutonomousExecution,
  simulateAutonomousExecution,
  buildCoverageMatrixForExecution,
  composeSceneForShot,
  composeScenesForExecution,
  companyDiscover,
  companyKnowledgeBase,
  listCompanyKnowledgeBases,
  companySearch,
  companyPublish,
  campaignIngest,
  campaignWorkspace,
  listCampaignWorkspaces,
  campaignFrameSearch,
  campaignReuseCheck,
  campaignIntelligencePublish,
  validateLocalAssetCommand,
  validateLocalAssetsBatchCommand,
  rerunAssetResolution,
  rebalanceTimeline,
} from "./run-command.js";
import type { WorkflowExecutionReport } from "../../application/workflows/caio.types.js";
import type { AutonomousEngineOutcome } from "../../application/orchestration/autonomous/autonomous-types.js";
import { QUALITY_FEEDBACK_CATEGORIES, type QualityFeedbackCategory, type QualityFeedbackReport } from "../../application/quality-feedback/index.js";
import { CAMPAIGN_CONTENT_STATUSES, type CampaignContentStatus, type CampaignPlan, type CampaignStatusSummary } from "../../application/campaign/index.js";
import { DEFAULT_ZUNO_RUNTIME_MODE, parseZunoRuntimeMode } from "../../application/runtime/zuno-runtime-mode.js";
import { validateLocalMusicPath } from "../../shared/utils/local-music-asset.js";
import { ASSET_QUALITY_PROFILES, isAssetQualityProfile } from "../../application/ports/asset-quality-profile.js";

function printUsage(): void {
  console.log([
    "Uso:",
    "  npm run zuno -- --mode local-production \"crie um post\"  Executa em LOCAL_PRODUCTION (padrão atual).",
    "  npm run zuno -- \"crie um post para o Rumo ao Altar\"     Executa um comando completo (Arthur -> Caio -> Helena -> Skills).",
    "  npm run zuno -- \"...\" --client-id <id>                  Usa um cliente já cadastrado em vez do cliente de demonstração.",
    "  npm run zuno -- --music \"assets/audio/music/x.mp3\" \"...\"  Informa uma música local para Rafa inserir no vídeo final (mp3/wav/m4a/aac).",
    "  npm run zuno -- --asset-quality premium \"...\"          Perfil de diversidade de assets visuais (draft|standard|premium). Padrão: premium em LOCAL_PRODUCTION, draft em teste/demonstração.",
    "  npm run zuno -- --assets-scan                         Escaneia a biblioteca visual local e provedores por manifesto.",
    "  npm run zuno -- --assets-list                         Lista assets visuais disponíveis com origem/licença.",
    "  npm run zuno -- --assets-report                       Mostra resumo por provider, origem e licença.",
    "  npm run zuno -- --media-scan                          Media Intelligence Engine: varre assets/ (hash, dedup, metadados, classificação de filmagem).",
    "  npm run zuno -- --media-list [--type video]            Lista assets do catálogo (filtro opcional por tipo).",
    "  npm run zuno -- --media-show <assetId>                 Mostra o registro completo de um asset do catálogo.",
    "  npm run zuno -- --media-report                        Relatório de saúde da biblioteca (cobertura, lacunas, duplicatas, recomendações).",
    "  npm run zuno -- --media-tag <arquivo-ou-id> --tags \"casal,celular,felicidade\"  Adiciona tags a um asset.",
    "  npm run zuno -- --media-approve <assetId>              Aprova um asset (só approved conta integralmente no Production Readiness premium).",
    "  npm run zuno -- --media-reject <assetId> [--reason \"...\"]  Rejeita um asset.",
    "  npm run zuno -- --media-remove <assetId>               Remove um asset do catálogo (nunca apaga o arquivo físico).",
    "  npm run zuno -- --media-gap <executionId>              Media Gap Analysis do Shot Plan já resolvido de uma execução.",
    "  npm run zuno -- --media-collection-create \"<nome>\" --assets id1,id2  Cria uma coleção oficial a partir de assetIds.",
    "  npm run zuno -- --media-search \"casal usando celular\"  Busca fotos/vídeos no provider externo configurado (MEDIA_PROVIDER/MEDIA_PROVIDER_API_KEY).",
    "  npm run zuno -- --media-search-video \"casamento cerimônia\"  Busca só vídeos no provider externo.",
    "  npm run zuno -- --media-acquire <resultadoId>          Baixa, valida e cataloga um resultado específico (ex.: pexels:1448735).",
    "  npm run zuno -- --media-acquire-for-execution <executionId>  Aquisição automática para os gaps obrigatórios do Media Gap Analysis da execução.",
    "  npm run zuno -- --media-acquisition-report            Relatório completo de aquisição (buscas, downloads, aprovações, rejeições).",
    "  npm run zuno -- --footage-search-report <executionId>  Intent-Based Footage Acquisition: consultas geradas por Shot Intent, descartadas, candidatos, ranking, motivo de escolha/rejeição.",
    "  npm run zuno -- --media-review-pending                Lista assets externos aguardando aprovação humana (needs_review).",
    "  npm run zuno -- --footage-review-list                  FOOTAGE VISUAL VALIDATION 2.0: lista candidatos que passaram pelo Visual Candidate Validator ainda aguardando revisão humana.",
    "  npm run zuno -- --footage-review-show <candidateId>    Mostra Shot, intenção, consulta, frames analisados, região candidata, scores, motivos e pré-composição de um candidato.",
    "  npm run zuno -- --footage-review-approve <candidateId> [--reason \"...\"]  Aprova um candidato (nunca automático — decisão humana explícita).",
    "  npm run zuno -- --footage-review-reject <candidateId> --reason \"...\"    Rejeita um candidato com motivo.",
    "  npm run zuno -- --product-screen-scan                 Product Compositing Engine: cataloga as telas reais do produto (mockups aprovados).",
    "  npm run zuno -- --product-screen-list                 Lista telas de produto no catálogo.",
    "  npm run zuno -- --product-screen-show <screenId>       Mostra o registro completo de uma tela de produto.",
    "  npm run zuno -- --product-screen-approve <screenId>    Aprova uma tela de produto para uso em composições.",
    "  npm run zuno -- --product-screen-reject <screenId> [--reason \"...\"]  Rejeita uma tela de produto.",
    "  npm run zuno -- --product-screen-report                Relatório do catálogo de telas de produto.",
    "  npm run zuno -- --product-compositing-capabilities     Mostra as capacidades reais (auditadas) do Product Compositing Engine.",
    "  npm run zuno -- --product-compositing-assisted-package <assetId> --screen-type phone --timestamps 1.0,2.5  Gera frames de referência para marcação manual dos 4 cantos.",
    "  npm run zuno -- --product-compositing-compose <assetId> --screen-id <id> --functionality rsvp --start 0.5 --end 2.2 --placement-mode STATIC_SCREEN --keyframes '[...]'  Compõe a tela no vídeo e registra o asset derivado.",
    "  npm run zuno -- --product-coverage-report <executionId>  Product Mention/Visual/Interaction/Legibility Coverage de uma execução.",
    "  npm run zuno -- --coverage-matrix <executionId>         Unified Coverage Model: Shot | Requirement | Status | Evidence | Source, mais Coverage por Cena/Categoria/Geral.",
    "  npm run zuno -- --compose-scene <executionId> [shotId]  Cinematic Scene Composition Engine: decompõe em microplanos, busca vários candidatos reais, monta a sequência e calcula Scene Score (nunca baixa/altera nada — só planeja).",
    "  npm run zuno -- --continue <id> --music \"assets/audio/music/x.mp3\"  Informa a música ao retomar, antes da etapa de renderização de vídeo.",
    "  npm run zuno -- --mode local-production --approve <id>  Aprova a etapa humana pendente e retoma o workflow.",
    "  npm run zuno -- --mode local-production --reject <id>   Reprova a etapa humana pendente e encerra o workflow.",
    "  npm run zuno -- --mode local-production --continue <id> Retoma um workflow aguardando geração assistida de imagem (Pedro), narração (Nora), vídeo (Rafa) ou resposta da IA desenvolvedora.",
    "  npm run zuno -- --list                                  Lista execuções aguardando aprovação humana, geração assistida ou IA desenvolvedora.",
    "  npm run zuno -- --rate <id> --stars 5                   Avalia uma execução COMPLETED com 1 a 5 estrelas.",
    "  npm run zuno -- --rate <id> --score 8                   Avalia uma execução COMPLETED com nota de 1 a 10.",
    "                     [--needs-improvement cta,hashtags]   Marca aspectos que precisam melhorar (ver categorias no relatório).",
    "                     [--comment \"texto livre\"]             Comentário livre sobre a execução.",
    "  npm run zuno -- --quality-report [--client-id <id>]     Mostra o relatório local de qualidade (Quality Feedback).",
    "  npm run zuno -- --campaign \"...\" [--client-id <id>]      Cria uma campanha (Campaign Manager) a partir de um objetivo em texto.",
    "                     [--duration-days 30] [--channels instagram,facebook]",
    "  npm run zuno -- --campaign-list [--client-id <id>]      Lista o histórico de campanhas.",
    "  npm run zuno -- --campaign-show <campaignId>            Mostra o Campaign Plan e o resumo de status.",
    "  npm run zuno -- --campaign-generate-plan <id> <contentId>  Gera, via Arthur, o ExecutionPlan de um conteúdo da campanha.",
    "  npm run zuno -- --campaign-mark <id> <contentId> <status> [--reason \"...\"]  Atualiza o status de um conteúdo.",
    "  npm run zuno -- --autonomous \"...\" [--autonomous-dry-run]  Autonomous Execution Engine: inicia uma execução e tenta resolver bloqueios sozinho antes de pedir ajuda humana.",
    "  npm run zuno -- --autonomous-continue <id> [--autonomous-dry-run]  Retoma uma execução pausada sob o Autonomous Execution Engine.",
    "  npm run zuno -- --simulate-autonomous <id>              Simulação (seção 11): mostra o bloqueio e as ações candidatas sem executar nada de verdade.",
    "  npm run zuno -- --company-discover <domínio> [--company-scope \"/,/precos\"] [--company-max-pages 12]  Company Intelligence Engine: descobre, coleta e analisa um site real (respeita robots.txt; com --company-scope, visita só os paths informados).",
    "  npm run zuno -- --company-report <domínio>              Mostra a base de conhecimento já coletada (Company Profile, Feature Library, Media Library, Telas, Brand Language, relatório de qualidade).",
    "  npm run zuno -- --company-list                          Lista todos os domínios com base de conhecimento coletada.",
    "  npm run zuno -- --company-search <domínio> \"<pergunta>\"  Consulta a base de conhecimento (ex.: \"Qual o CTA oficial?\").",
    "  npm run zuno -- --company-publish <domínio> [--client-id <id>]  Publica a base coletada na Clara (Creative Context) e no Product Screen Catalog (Product Authenticity).",
    "  npm run zuno -- --campaign-ingest <campaignId> <arquivo1> [arquivo2 ...]  Campaign Intelligence Engine: ingere fotos/vídeos/PDF/PPT/DOCX/XLSX/SVG/áudio/ZIP no Workspace da campanha (incremental por hash).",
    "  npm run zuno -- --campaign-workspace <campaignId>       Mostra o Workspace já ingerido (arquivos, telas, funcionalidades, Media Library, grafo, relatório de qualidade).",
    "  npm run zuno -- --campaign-workspace-list               Lista todas as campanhas com Workspace coletado.",
    "  npm run zuno -- --campaign-frame-search <campaignId> \"<consulta>\"  Frame Search: \"Mostrar trecho onde aparece RSVP\", \"Mostrar tela de Check-in\" etc.",
    "  npm run zuno -- --campaign-reuse-check <campaignId> \"<consulta>\"  Reuse Engine: verifica se já existe material oficial antes de gerar algo novo.",
    "  npm run zuno -- --campaign-intelligence-publish <campaignId> [--client-id <id>]  Publica o Workspace na Clara e no Product Screen Catalog.",
    "  npm run zuno -- --validate-local-asset --asset-id <id> [--file-path <path>] [--campaign-id <id>] [--client-id <id>] [--device phone|tablet|notebook|desktop|none] [--force]  Local Official Asset Qualification: valida um asset local oficial com o mesmo Visual Candidate Validator do Footage Acquisition.",
    "  npm run zuno -- --validate-local-assets --campaign-id <id> [--client-id <id>] [--force]  Valida em lote os assets locais oficiais de uma campanha (pula os já validados sem mudança de hash).",
    "  npm run zuno -- --rerun-asset-resolution <executionId>  Official Asset Priority & Authenticity Policy: invalida só a resolução de assets (nunca a execução inteira) e reexecuta Rafa.resolve() — só funciona com a execução pausada em Renderização de vídeo.",
    "  npm run zuno -- --rebalance-timeline <executionId>  Narrative Timing Rebalancing: reexecuta a resolução (mesmo mecanismo de --rerun-asset-resolution) e mostra o plano de realocação de duração aplicado, se algum déficit temporal foi encontrado e coberto por Shot(s) doador(es) válido(s).",
  ].join("\n"));
}

/**
 * Formato mínimo esperado dentro de `response.output` de uma etapa cujo status é
 * `needs_assisted_generation` (ver `PedroAssistedGenerationOutput` e `RafaAssistedGenerationOutput`).
 * A CLI não importa o tipo da Skill diretamente — apenas lê os campos genéricos por nome, do
 * mesmo jeito que Caio já faz.
 */
type AssistedGenerationOutputShape = {
  mode?: unknown;
  instruction?: unknown;
  resumeCommand?: unknown;
  pendingImages?: Array<{
    expectedRelativePath?: unknown;
    prompt?: unknown;
    width?: unknown;
    height?: unknown;
  }>;
  pendingVideos?: Array<{
    expectedRelativePath?: unknown;
    prompt?: unknown;
    specs?: {
      resolution?: unknown;
      durationSeconds?: unknown;
      fps?: unknown;
    };
  }>;
  pendingVisualAssets?: Array<{
    expectedRelativePath?: unknown;
    prompt?: unknown;
    width?: unknown;
    height?: unknown;
    aspectRatio?: unknown;
    sceneName?: unknown;
    shotId?: unknown;
    requiredKind?: unknown;
    requiredSubject?: unknown;
    rejectionReason?: unknown;
  }>;
  /** ASSET DIVERSITY GATE — ver `RafaAssistedGenerationOutput.diversitySummary`. */
  diversitySummary?: {
    qualityProfile?: unknown;
    failures?: unknown;
    totalShots?: unknown;
    distinctPhysicalFiles?: unknown;
    minDistinctPhysicalFiles?: unknown;
    videoRatio?: unknown;
    minVideoRatio?: unknown;
  };
  /** PRODUCTION READINESS — ver `RafaAssistedGenerationOutput.productionPlan`/`productionReadinessScore`. */
  productionPlan?: {
    scenesCount?: unknown;
    shotsCount?: unknown;
    assetsNeeded?: unknown;
    assetsFound?: unknown;
    assetsMissing?: unknown;
    videoCount?: unknown;
    photoCount?: unknown;
    mockupCount?: unknown;
    productScreenCount?: unknown;
    humanAssetCount?: unknown;
    repeatedAssetCount?: unknown;
  };
  productionReadinessScore?: {
    overall?: unknown;
    minimumAcceptable?: unknown;
    visualCoverage?: unknown;
    humanCoverage?: unknown;
    productCoverage?: unknown;
    emotionalCoverage?: unknown;
    videoCoverage?: unknown;
    sceneDiversity?: unknown;
    assetVariety?: unknown;
  };
  pendingNarrations?: Array<{
    expectedRelativePath?: unknown;
    prompt?: unknown;
    durationSeconds?: unknown;
    voiceProfile?: {
      language?: unknown;
      genderPreference?: unknown;
      tone?: unknown;
      pace?: unknown;
    };
  }>;
  narrationScript?: unknown;
};

function printAssistedGenerationInstructions(report: WorkflowExecutionReport): void {
  const waitingStep = report.steps.find((step) => step.stepId === report.waitingForStepId);
  const output = waitingStep?.response?.output as AssistedGenerationOutputShape | undefined;
  const pendingImages = Array.isArray(output?.pendingImages) ? output.pendingImages : [];
  const pendingVideos = Array.isArray(output?.pendingVideos) ? output.pendingVideos : [];
  const pendingVisualAssets = Array.isArray(output?.pendingVisualAssets) ? output.pendingVisualAssets : [];
  const pendingNarrations = Array.isArray(output?.pendingNarrations) ? output.pendingNarrations : [];

  console.log(`\nAguardando geração assistida na etapa "${waitingStep?.name ?? report.waitingForStepId}".`);
  console.log(typeof output?.instruction === "string" ? output.instruction : "Crie o arquivo usando o prompt abaixo e salve exatamente no caminho indicado.");

  // ASSET DIVERSITY GATE — diversidade atual vs. requisito mínimo, mostrado ANTES do prompt de
  // cada Shot bloqueado, para que fique claro que a pausa é sobre a composição do vídeo inteiro,
  // não sobre um Shot isolado sem candidato algum.
  const diversitySummary = output?.diversitySummary;
  if (diversitySummary) {
    console.log(`\n  Asset Diversity Gate (perfil "${String(diversitySummary.qualityProfile ?? "?")}"):`);
    console.log(`    Diversidade atual: ${String(diversitySummary.distinctPhysicalFiles ?? "?")} arquivo(s) físico(s) distinto(s) para ${String(diversitySummary.totalShots ?? "?")} Shot(s); ${Math.round(Number(diversitySummary.videoRatio ?? 0) * 100)}% vídeo/b-roll real.`);
    console.log(`    Requisito mínimo: ${String(diversitySummary.minDistinctPhysicalFiles ?? "?")} arquivo(s) físico(s) distinto(s); ${Math.round(Number(diversitySummary.minVideoRatio ?? 0) * 100)}% vídeo/b-roll real.`);
    if (Array.isArray(diversitySummary.failures)) {
      for (const failure of diversitySummary.failures) console.log(`    - ${String(failure)}`);
    }
  }

  // PRODUCTION READINESS — o Production Plan (inventário real vs. exigido) e a nota composta,
  // mostrados como um produtor executivo leria: "esta campanha tem material para virar um
  // comercial?", nunca "falta um arquivo aqui".
  const productionPlan = output?.productionPlan;
  const productionScore = output?.productionReadinessScore;
  if (productionPlan && productionScore) {
    const percent = (value: unknown) => `${Math.round(Number(value ?? 0) * 100)}%`;
    console.log(`\n  Production Plan:`);
    console.log(`    Cenas: ${String(productionPlan.scenesCount ?? "?")} · Shots: ${String(productionPlan.shotsCount ?? "?")} · Assets necessários: ${String(productionPlan.assetsNeeded ?? "?")}`);
    console.log(`    Assets encontrados: ${String(productionPlan.assetsFound ?? "?")} · Faltando: ${String(productionPlan.assetsMissing ?? "?")} · Repetidos: ${String(productionPlan.repeatedAssetCount ?? "?")}`);
    console.log(`    Vídeos: ${String(productionPlan.videoCount ?? "?")} · Fotografias: ${String(productionPlan.photoCount ?? "?")} · Mockups: ${String(productionPlan.mockupCount ?? "?")} · Telas de produto: ${String(productionPlan.productScreenCount ?? "?")} · Assets humanos: ${String(productionPlan.humanAssetCount ?? "?")}`);
    console.log(`\n  Production Readiness Score:`);
    console.log(`    Visual Coverage: ${percent(productionScore.visualCoverage)}    Human Coverage: ${percent(productionScore.humanCoverage)}    Product Coverage: ${percent(productionScore.productCoverage)}`);
    console.log(`    Emotional Coverage: ${percent(productionScore.emotionalCoverage)}    Video Coverage: ${percent(productionScore.videoCoverage)}`);
    console.log(`    Scene Diversity: ${percent(productionScore.sceneDiversity)}    Asset Variety: ${percent(productionScore.assetVariety)}`);
    console.log(`    Production Readiness: ${percent(productionScore.overall)} (mínimo aceitável: ${percent(productionScore.minimumAcceptable)})`);
  }

  pendingImages.forEach((image, index) => {
    console.log(`\n  Imagem ${index + 1}:`);
    console.log(`    Caminho: ${String(image.expectedRelativePath ?? "?")}`);
    if (typeof image.width === "number" && typeof image.height === "number") {
      console.log(`    Resolução: ${image.width}x${image.height}`);
    }
    console.log(`    Prompt:\n${String(image.prompt ?? "").split("\n").map((line) => `      ${line}`).join("\n")}`);
  });

  pendingVideos.forEach((video, index) => {
    console.log(`\n  Vídeo ${index + 1}:`);
    console.log(`    Caminho: ${String(video.expectedRelativePath ?? "?")}`);
    if (typeof video.specs?.resolution === "string") {
      console.log(`    Resolução: ${video.specs.resolution}`);
    }
    if (typeof video.specs?.durationSeconds === "number") {
      console.log(`    Duração: ${video.specs.durationSeconds}s`);
    }
    if (typeof video.specs?.fps === "number") {
      console.log(`    FPS: ${video.specs.fps}`);
    }
    console.log(`    Prompt:\n${String(video.prompt ?? "").split("\n").map((line) => `      ${line}`).join("\n")}`);
  });

  pendingVisualAssets.forEach((asset, index) => {
    console.log(`\n  Asset visual ${index + 1}:`);
    console.log(`    Cena: ${String(asset.sceneName ?? "?")}${asset.shotId ? ` · Shot: ${String(asset.shotId)}` : ""}`);
    console.log(`    Caminho: ${String(asset.expectedRelativePath ?? "?")}`);
    if (typeof asset.width === "number" && typeof asset.height === "number") {
      console.log(`    Resolução: ${asset.width}x${asset.height}${typeof asset.aspectRatio === "string" ? ` (${asset.aspectRatio})` : ""}`);
    }
    if (asset.requiredKind) console.log(`    Tipo necessário: ${String(asset.requiredKind)}`);
    if (asset.requiredSubject) console.log(`    Sujeito esperado: ${String(asset.requiredSubject)}`);
    if (asset.rejectionReason) console.log(`    Motivo: ${String(asset.rejectionReason)}`);
    console.log(`    Prompt:\n${String(asset.prompt ?? "").split("\n").map((line) => `      ${line}`).join("\n")}`);
  });

  pendingNarrations.forEach((narration, index) => {
    console.log(`\n  Narração ${index + 1}:`);
    console.log(`    Caminho: ${String(narration.expectedRelativePath ?? "?")}`);
    if (typeof narration.durationSeconds === "number") console.log(`    Duração alvo: ${narration.durationSeconds}s`);
    const voiceProfile = narration.voiceProfile;
    if (voiceProfile && typeof voiceProfile === "object") {
      console.log(`    Voz: ${String(voiceProfile.language ?? "?")} · ${String(voiceProfile.genderPreference ?? "?")} · ${String(voiceProfile.tone ?? "?")}`);
    }
    if (typeof output?.narrationScript === "string") {
      console.log(`    Roteiro:\n${output.narrationScript.split("\n").map((line) => `      ${line}`).join("\n")}`);
    }
    console.log(`    Prompt:\n${String(narration.prompt ?? "").split("\n").map((line) => `      ${line}`).join("\n")}`);
  });

  console.log(`\nDepois de salvar o(s) arquivo(s), retome com:`);
  console.log(`  ${typeof output?.resumeCommand === "string" ? output.resumeCommand : `npm run zuno -- --continue ${report.executionId}`}`);
}

/**
 * Formato mínimo esperado dentro de `response.output` de uma etapa cujo status é
 * `needs_developer_ai` (ver `DeveloperAssistancePendingOutput`). Assim como
 * `AssistedGenerationOutputShape`, a CLI só lê campos genéricos por nome, sem importar nenhum tipo
 * de Skill nem do `DeveloperAssistedIcaroProvider` (ADR 0002 — Caio/CLI nunca conhecem Skills).
 */
type DeveloperAiOutputShape = {
  mode?: unknown;
  instruction?: unknown;
  specialistId?: unknown;
  taskType?: unknown;
  workPackagePath?: unknown;
  expectedResponsePath?: unknown;
  resumeCommand?: unknown;
  validationErrors?: unknown;
};

function printDeveloperAiInstructions(report: WorkflowExecutionReport): void {
  const waitingStep = report.steps.find((step) => step.stepId === report.waitingForStepId);
  const output = waitingStep?.response?.output as DeveloperAiOutputShape | undefined;

  console.log(`\nAguardando IA desenvolvedora na etapa "${waitingStep?.name ?? report.waitingForStepId}"${waitingStep?.skillId ? ` (${waitingStep.skillId})` : ""}.`);
  console.log(typeof output?.instruction === "string" ? output.instruction : "Produza a resposta real desta tarefa e salve-a no caminho indicado no pacote de trabalho.");

  if (Array.isArray(output?.validationErrors) && output.validationErrors.length > 0) {
    console.log("\n  A resposta anterior foi rejeitada:");
    for (const error of output.validationErrors) console.log(`    - ${String(error)}`);
  }

  console.log(`\n  Pacote de trabalho (prompt completo, contexto e schema esperado): ${String(output?.workPackagePath ?? "?")}`);
  console.log(`  Salvar a resposta em: ${String(output?.expectedResponsePath ?? "?")}`);

  console.log(`\nDepois de salvar a resposta, retome com:`);
  console.log(`  ${typeof output?.resumeCommand === "string" ? output.resumeCommand : `npm run zuno -- --continue ${report.executionId}`}`);
}

function printReport(report: WorkflowExecutionReport): void {
  console.log(`\nExecução ${report.executionId} — estado: ${report.state}`);
  console.log(report.message);
  console.log(`Modo usado: ${report.mode ?? DEFAULT_ZUNO_RUNTIME_MODE}`);
  console.log(`Intenção identificada: ${report.planSnapshot.intent.objective}`);
  console.log(`Pipeline escolhida: ${describePipeline(report)}`);
  console.log(`Tempo de execução: ${formatDuration(calculateDurationMs(report))}`);
  console.log("");
  for (const step of report.steps) {
    console.log(`  [${step.state.padEnd(9)}] ${step.name}${step.skillId ? ` (${step.skillId})` : ""}`);
  }

  if (report.state === "WAITING_HUMAN_APPROVAL") {
    console.log(`\nAguardando aprovação humana. Para continuar:`);
    console.log(`  npm run zuno -- --approve ${report.executionId}`);
    console.log(`  npm run zuno -- --reject ${report.executionId}`);
  }

  if (report.state === "WAITING_ASSISTED_GENERATION") {
    printAssistedGenerationInstructions(report);
  }

  if (report.state === "WAITING_DEVELOPER_AI") {
    printDeveloperAiInstructions(report);
  }

  if (report.artifactSummary.htmlPaths.length > 0) {
    console.log("\nPágina(s) de entrega gerada(s):");
    for (const path of report.artifactSummary.htmlPaths) console.log(`  ${path}`);
  }

  const videoPaths = report.artifactSummary.videoPaths ?? [];
  if (report.artifactSummary.imagePaths.length > 0 || videoPaths.length > 0 || report.artifactSummary.zipPaths.length > 0) {
    console.log("\nArquivos gerados:");
    for (const path of report.artifactSummary.imagePaths) console.log(`  imagem: ${path}`);
    for (const path of videoPaths) console.log(`  vídeo: ${path}`);
    for (const path of report.artifactSummary.zipPaths) console.log(`  zip: ${path}`);
  }

  const hashtagsPaths = report.artifactSummary.hashtagsPaths ?? [];
  const publicationPaths = report.artifactSummary.publicationPaths ?? [];
  const reportPaths = report.artifactSummary.reportPaths ?? [];
  if (report.artifactSummary.captionPaths.length > 0 || publicationPaths.length > 0 || hashtagsPaths.length > 0 || report.artifactSummary.metadataPaths.length > 0 || reportPaths.length > 0) {
    console.log("\nArquivos de texto e relatório:");
    for (const path of report.artifactSummary.captionPaths) console.log(`  legenda: ${path}`);
    for (const path of publicationPaths) console.log(`  publicação completa: ${path}`);
    for (const path of hashtagsPaths) console.log(`  hashtags: ${path}`);
    for (const path of report.artifactSummary.metadataPaths) console.log(`  metadata: ${path}`);
    for (const path of reportPaths) console.log(`  relatório: ${path}`);
  }

  if ((report.mode ?? DEFAULT_ZUNO_RUNTIME_MODE) === "LOCAL_PRODUCTION" && report.state === "COMPLETED") {
    console.log("\nLOCAL_PRODUCTION: nada foi publicado. Revise os arquivos locais e publique manualmente quando quiser.");
  }
}

/** Relatório do Autonomous Execution Engine (seção 6/16) — histórico completo, bloqueios encontrados e como cada um terminou. */
function printAutonomousOutcome(outcome: AutonomousEngineOutcome): void {
  console.log(`\nAutonomous Execution Engine — encerrado: ${outcome.stoppedReason}`);
  console.log(`  Bloqueios resolvidos automaticamente: ${outcome.resolvedBlockers}`);
  console.log(`  Ações executadas: ${outcome.totalActionsExecuted}`);
  console.log(`  Recálculos (retomadas do workflow): ${outcome.totalRecalculations}`);

  if (outcome.history.length > 0) {
    console.log("\nHistórico de execução:");
    for (const entry of outcome.history) {
      const acao = entry.acao ?? "(nenhuma ação candidata)";
      console.log(`  [${entry.resultado.padEnd(10)}] bloqueio=${entry.bloqueio} ação=${acao} tentativa=${entry.tentativa} (${entry.tempoMs}ms) — ${entry.motivo}${entry.erro ? ` [erro: ${entry.erro}]` : ""}`);
    }
  }

  if (outcome.escalations.length > 0) {
    console.log("\nEscalonamentos para intervenção humana:");
    for (const escalation of outcome.escalations) {
      console.log(`  - [${escalation.reason}] ${escalation.blocker.kind} (etapa "${escalation.blocker.stepName}"): ${escalation.message}`);
    }
  }

  if (outcome.finalReport) {
    console.log("\nRelatório final do workflow:");
    printReport(outcome.finalReport);
  }
}

function printAutonomousSimulation(preview: Awaited<ReturnType<typeof simulateAutonomousExecution>>): void {
  console.log(`\nSimulação (nenhuma ação real executada) — execução ${preview.executionId}, estado: ${preview.state}`);
  if (!preview.blocker) {
    console.log("  Nenhum bloqueio classificável neste estado (fora do escopo do Engine: aprovação humana, IA desenvolvedora, ou execução já concluída).");
    return;
  }
  console.log(`  Bloqueio: ${preview.blocker.kind} — ${preview.blocker.message}`);
  if (preview.candidateActions.length === 0) {
    console.log("  Nenhuma ação registrada resolve este bloqueio — o Engine escalonaria direto para intervenção humana.");
    return;
  }
  console.log("  Ações candidatas, na ordem em que seriam tentadas:");
  preview.candidateActions.forEach((action, index) => {
    const alt = index === 0 ? "(ação principal)" : "(ação alternativa)";
    console.log(`    ${index + 1}. ${action.name} [${action.id}] ${alt} — até ${action.maxAttempts} tentativa(s).`);
    if (action.limitations.length > 0) console.log(`       limitações: ${action.limitations.join(" | ")}`);
  });
}

/** UNIFIED COVERAGE MODEL (seção 13) — Shot | Requirement | Status | Evidence | Source, mais Coverage por Cena/Categoria/Geral. */
function printCoverageMatrix(report: Awaited<ReturnType<typeof buildCoverageMatrixForExecution>>): void {
  console.log(`\nCoverage Matrix — execução ${report.executionId}`);
  console.log(`  Coverage geral: ${report.overall.resolved}/${report.overall.total} (${Math.round(report.overall.ratio * 100)}%)`);

  console.log("\nCoverage por cena:");
  for (const scene of report.byScene) {
    console.log(`  Cena ${scene.sceneOrder}: ${scene.resolved}/${scene.total} (${Math.round(scene.ratio * 100)}%)`);
  }

  console.log("\nCoverage por categoria:");
  for (const category of report.byCategory) {
    console.log(`  ${category.label}: ${category.resolved}/${category.total} (${Math.round(category.ratio * 100)}%)`);
  }

  console.log("\nShot | Requirement | Status | Evidence | Source");
  for (const row of report.matrix) {
    console.log(`  ${row.shotId} | ${row.category} | ${row.status} | ${row.evidence} | ${row.source}`);
  }
}

/** CINEMATIC SCENE COMPOSITION ENGINE (seção 16) — relatório consolidado: Shots, microplanos, assets utilizados, cobertura por composição, variedade de câmera/movimento, quantidade de planos, tempo médio por plano, número de transições, Scene Score. */
function printSceneCompositionReport(reports: Awaited<ReturnType<typeof composeScenesForExecution>>): void {
  console.log(`\nCinematic Scene Composition Engine — ${reports.length} Shot(s) analisado(s)`);

  for (const report of reports) {
    const sequence = report.composed.sequence;
    const totalDuration = sequence.reduce((sum, microShot) => sum + microShot.duration, 0);
    const avgDuration = sequence.length > 0 ? totalDuration / sequence.length : 0;
    const distinctFramings = new Set(sequence.map((microShot) => microShot.preferredCamera)).size;
    const distinctMovements = new Set(sequence.map((microShot) => microShot.preferredMovement)).size;
    const transitions = Math.max(0, sequence.length - 1);
    const assetsUsed = new Set(report.coverage.microShotFulfillments.filter((f) => f.fulfilled).map((f) => f.microShotId)).size;
    const totalCandidates = report.candidatesByMicroShot.reduce((sum, entry) => sum + entry.candidates.length, 0);

    console.log(`\n  Shot ${report.shotId} (${report.shotPurpose})`);
    console.log(`    Microplanos: ${sequence.length} · Candidatos avaliados: ${totalCandidates} · Microplanos cumpridos: ${assetsUsed}/${sequence.length}`);
    console.log(`    Cobertura por composição: ${Math.round(report.coverage.coverage * 100)}%`);
    console.log(`    Variedade de câmera: ${distinctFramings} enquadramento(s) distinto(s) · Variedade de movimento: ${distinctMovements} movimento(s) distinto(s)`);
    console.log(`    Tempo médio por plano: ${avgDuration.toFixed(1)}s · Transições: ${transitions}`);
    console.log(`    Scene Score: overall=${Math.round(report.score.overall * 100)}% (narrativa=${Math.round(report.score.narrativa * 100)}%, variedade=${Math.round(report.score.variedade * 100)}%, cobertura=${Math.round(report.score.cobertura * 100)}%, ritmo=${Math.round(report.score.ritmo * 100)}%, produto=${Math.round(report.score.produto * 100)}%, emoção=${Math.round(report.score.emocao * 100)}%, diversidade=${Math.round(report.score.diversidade * 100)}%, transições=${Math.round(report.score.transicoes * 100)}%)`);
    if (report.qualityIssues.length > 0) {
      console.log("    Gate de qualidade de cena:");
      for (const qualityIssue of report.qualityIssues) console.log(`      [${qualityIssue.severity}] ${qualityIssue.code}: ${qualityIssue.message}`);
    }
    for (const microShot of sequence) {
      const candidateEntry = report.candidatesByMicroShot.find((entry) => entry.microShotId === microShot.id);
      console.log(`      ${microShot.purpose.padEnd(20)} câmera=${microShot.preferredCamera.padEnd(14)} mov=${microShot.preferredMovement.padEnd(12)} dur=${microShot.duration.toFixed(1)}s candidatos=${candidateEntry?.candidates.length ?? 0}`);
    }
  }
}

function describePipeline(report: WorkflowExecutionReport): string {
  const capabilities = report.planSnapshot.steps.map((step) => step.skillCapability).filter(Boolean);
  const hasVideo = capabilities.includes("video_rendering");
  const hasImage = capabilities.includes("image_generation");
  const hasPublishing = capabilities.includes("social_publishing");
  if (hasVideo) return hasPublishing ? "Vídeo + revisão + publicação" : "Vídeo + revisão";
  if (hasImage) return hasPublishing ? "Imagem/carrossel + revisão + publicação" : "Imagem/carrossel + revisão";
  return hasPublishing ? "Texto + publicação" : "Texto + revisão";
}

function calculateDurationMs(report: WorkflowExecutionReport): number {
  const end = report.finishedAt ? Date.parse(report.finishedAt) : Date.now();
  return Math.max(0, end - Date.parse(report.startedAt));
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}

function printQualityFeedbackReport(report: QualityFeedbackReport): void {
  console.log(`\nRelatório de qualidade (Quality Feedback) — gerado em ${report.generatedAt}`);
  console.log(`Total de avaliações: ${report.totalFeedbackCount}`);
  console.log(`Média geral: ${report.overallAverageScore ?? "sem dados"}`);

  console.log("\nMédia por formato:");
  if (report.averageByFormat.length === 0) console.log("  Sem dados.");
  for (const bucket of report.averageByFormat) console.log(`  ${bucket.key}: ${bucket.averageScore} (${bucket.count} avaliação(ões))`);

  console.log("\nMédia por Skill:");
  if (report.averageBySkill.length === 0) console.log("  Sem dados.");
  for (const bucket of report.averageBySkill) console.log(`  ${bucket.key}: ${bucket.averageScore} (${bucket.count} avaliação(ões))`);

  console.log("\nMédia por campanha:");
  if (report.averageByCampaign.length === 0) console.log("  Sem dados (nenhuma avaliação informou campaignId).");
  for (const bucket of report.averageByCampaign) console.log(`  ${bucket.key}: ${bucket.averageScore} (${bucket.count} avaliação(ões))`);

  console.log("\nEvolução da qualidade ao longo do tempo:");
  if (report.qualityOverTime.length === 0) console.log("  Sem dados.");
  for (const point of report.qualityOverTime) console.log(`  ${point.period}: ${point.averageScore} (${point.count} avaliação(ões))`);

  console.log("\nConteúdos mais bem avaliados:");
  if (report.bestRatedContent.length === 0) console.log("  Sem dados.");
  for (const content of report.bestRatedContent) console.log(`  ${content.executionId} (${content.format}): ${content.overallScore}`);

  console.log("\nConteúdos menos bem avaliados:");
  if (report.worstRatedContent.length === 0) console.log("  Sem dados.");
  for (const content of report.worstRatedContent) console.log(`  ${content.executionId} (${content.format}): ${content.overallScore}`);

  console.log("\nPrincipais reclamações recorrentes:");
  if (report.topRecurringComplaints.length === 0) console.log("  Sem dados.");
  for (const complaint of report.topRecurringComplaints) {
    console.log(`  ${complaint.category}: ${complaint.count} ocorrência(s) (${Math.round(complaint.ratio * 100)}% das avaliações)`);
  }
}

function parseCategoriesList(raw: string, flag: string): QualityFeedbackCategory[] {
  const allowed = new Set<string>(QUALITY_FEEDBACK_CATEGORIES);
  const categories = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const invalid = categories.filter((category) => !allowed.has(category));
  if (invalid.length > 0) {
    throw new Error(`${flag} possui categoria(s) inválida(s): ${invalid.join(", ")}. Categorias válidas: ${QUALITY_FEEDBACK_CATEGORIES.join(", ")}.`);
  }
  return categories as QualityFeedbackCategory[];
}

function printCampaignPlan(plan: CampaignPlan): void {
  console.log(`\nCampanha ${plan.id} — ${plan.objective}`);
  console.log(`Tipo: ${plan.objectiveType} | Duração: ${plan.durationDays} dias | Persona: ${plan.persona}`);
  console.log(`Canais: ${plan.channels.join(", ")} | Frequência: ${plan.frequency.label}`);
  console.log(`Período: ${plan.startDate} até ${plan.endDate}`);
  console.log(`\nConteúdos (${plan.contents.length}):`);
  for (const content of plan.contents) {
    console.log(`  [${String(content.order).padStart(2, "0")}] ${content.id} — ${content.role} — ${content.recommendedFormat} — prioridade ${content.priority}`);
    console.log(`       Tópico: ${content.topic}`);
    console.log(`       Canal: ${content.channel} | CTA: ${content.cta} | Data: ${content.scheduledDate}`);
    console.log(`       Status: ${content.status}${content.relatedContentIds.length > 0 ? ` | Relacionado a: ${content.relatedContentIds.join(", ")}` : ""}`);
  }
}

function printCampaignStatusSummary(summary: CampaignStatusSummary): void {
  console.log(`\nResumo de status da campanha ${summary.campaignId}:`);
  console.log(`  Total: ${summary.totalContents} | Concluído: ${summary.percentComplete}%`);
  console.log(`  Pendentes: ${summary.pendingCount} | Plano gerado: ${summary.executionPlannedCount} | Em revisão: ${summary.inReviewCount}`);
  console.log(`  Aprovados: ${summary.approvedCount} | Publicados: ${summary.publishedCount} | Rejeitados: ${summary.rejectedCount} | Falhos: ${summary.failedCount}`);
}

type VisualAssetsPrintableReport = Awaited<ReturnType<typeof scanVisualAssets>>;

function printVisualAssetsReport(report: VisualAssetsPrintableReport, detail: "scan" | "list" | "report"): void {
  console.log(`\nAssets visuais — ${report.summary.total} encontrado(s).`);
  if (report.warnings.length > 0) {
    console.log("\nAvisos:");
    for (const warning of report.warnings) console.log(`  - ${warning}`);
  }
  if (detail === "report") {
    console.log("\nPor provider:");
    for (const [provider, count] of Object.entries(report.summary.byProvider)) console.log(`  ${provider}: ${count}`);
    console.log("\nPor origem:");
    for (const [origin, count] of Object.entries(report.summary.byOrigin)) console.log(`  ${origin}: ${count}`);
    console.log("\nPor licença:");
    for (const [license, count] of Object.entries(report.summary.byLicense)) console.log(`  ${license}: ${count}`);
    return;
  }
  if (report.assets.length === 0) {
    console.log("\nNenhum asset encontrado. Adicione imagens em assets/visual/library ou configure assets/visual/free/manifest.json.");
    return;
  }
  console.log("");
  for (const asset of report.assets) {
    console.log(`  ${asset.id}`);
    console.log(`    provider/origem: ${asset.provider} / ${asset.origin}`);
    console.log(`    arquivo: ${asset.absolutePath}`);
    console.log(`    resolução: ${asset.width}x${asset.height} (${asset.aspectRatio})`);
    console.log(`    licença: ${asset.license.name}${asset.license.requiresAttribution ? " (atribuição obrigatória)" : ""}`);
    if (asset.author) console.log(`    autor: ${asset.author}`);
    if (asset.sourceUrl) console.log(`    origem: ${asset.sourceUrl}`);
    console.log(`    tags: ${asset.tags.join(", ") || "sem tags"}`);
  }
}

function printMediaAssetRecord(asset: Awaited<ReturnType<typeof showMediaAsset>>): void {
  if (!asset) { console.log("Asset não encontrado no catálogo."); return; }
  console.log(`\n${asset.assetId}`);
  console.log(`  arquivo: ${asset.absolutePath}`);
  console.log(`  tipo: ${asset.type}${asset.subtype ? ` / ${asset.subtype}` : ""} · formato: ${asset.format}`);
  if (asset.width && asset.height) console.log(`  resolução: ${asset.width}x${asset.height} (${asset.aspectRatio ?? "?"})`);
  if (asset.durationSeconds) console.log(`  duração: ${asset.durationSeconds.toFixed(2)}s`);
  console.log(`  tamanho: ${asset.sizeBytes} bytes · hash: ${asset.hash.slice(0, 12)}...`);
  console.log(`  origem: ${asset.origin} · autor: ${asset.author ?? "desconhecido"} · status de licença: ${asset.licenseStatus}`);
  if (asset.license) console.log(`  licença: ${asset.license.name}${asset.license.allowsCommercialUse ? "" : " (uso comercial NÃO permitido)"}`);
  console.log(`  classificação de filmagem: ${asset.footageClassification ?? "não classificada"}`);
  console.log(`  status de aprovação: ${asset.approvalStatus} · disponível: ${asset.available ? "sim" : "não"}`);
  console.log(`  tags: ${asset.tags.join(", ") || "sem tags"}`);
  if (asset.duplicate.duplicateOf) console.log(`  duplicateOf: ${asset.duplicate.duplicateOf}`);
  if (asset.duplicate.visualNearDuplicateOf?.length) console.log(`  visualNearDuplicateOf: ${asset.duplicate.visualNearDuplicateOf.join(", ")}`);
  console.log(`  usado em ${asset.usageHistory.length} execução(ões)`);
}

function printCompanyKnowledgeBase(base: NonNullable<Awaited<ReturnType<typeof companyKnowledgeBase>>>): void {
  const { profile, qualityReport, features, screens, mediaLibrary, brandLanguage, graph, pages } = base;
  console.log(`\nCompany Intelligence — ${profile.companyName} (${profile.domain})`);
  console.log(`  Segmento: ${profile.segment}${profile.subsegment ? ` / ${profile.subsegment}` : ""} · Idioma: ${profile.language} · Mercado: ${profile.market}`);
  if (profile.slogan) console.log(`  Slogan: "${profile.slogan}"`);
  if (profile.officialCta) console.log(`  CTA oficial: "${profile.officialCta}"`);
  if (profile.valueProposition) console.log(`  Proposta de valor: ${profile.valueProposition}`);
  console.log(`  Tom de voz: ${brandLanguage.tone} · Estilo: ${brandLanguage.style}`);
  if (profile.keyDifferentiators.length > 0) console.log(`  Diferenciais: ${profile.keyDifferentiators.join(" | ")}`);
  if (profile.keyBenefits.length > 0) console.log(`  Benefícios: ${profile.keyBenefits.slice(0, 6).join(" | ")}`);
  console.log(`  Cores: ${profile.visualIdentity.primaryColors.join(", ") || "nenhuma identificada"}`);
  console.log(`  Logos encontrados: ${profile.visualIdentity.logoUrls.length}`);

  console.log(`\n  Páginas descobertas (${pages.length}):`);
  for (const page of pages) console.log(`    [${page.category}] ${page.path}${page.title ? ` — ${page.title}` : ""} (HTTP ${page.httpStatus ?? "?"})`);

  console.log(`\n  Funcionalidades identificadas (${features.length}):`);
  for (const feature of features) {
    console.log(`    - ${feature.name}${feature.relatedScreenIds.length > 0 ? ` [tela real: ${feature.relatedScreenIds.join(", ")}]` : " [sem tela real]"}`);
  }

  console.log(`\n  Telas capturadas (${screens.length}):`);
  for (const screen of screens) console.log(`    [${screen.category}] ${screen.sourceUrl} -> ${screen.absolutePath} (${screen.width}x${screen.height})`);

  console.log(`\n  Media Library (${mediaLibrary.length} item(ns)): ${Object.entries(countBy(mediaLibrary.map((item) => item.category))).map(([category, count]) => `${category}=${count}`).join(", ")}`);

  console.log(`\n  Knowledge Graph: ${graph.nodes.length} nó(s), ${graph.edges.length} relação(ões).`);

  console.log(`\n  Relatório de qualidade:`);
  console.log(`    Páginas: ${qualityReport.pagesFound} · Funcionalidades: ${qualityReport.featuresIdentified} · CTAs: ${qualityReport.ctasFound} · Assets: ${qualityReport.assetsCollected} · Telas: ${qualityReport.screensCaptured}`);
  console.log(`    Benefícios: ${qualityReport.benefitsFound} · Dores resolvidas: ${qualityReport.painPointsSolved}`);
  console.log(`    Brand Score: ${qualityReport.brandScore}/100 · Coverage Score: ${qualityReport.coverageScore}/100`);
  if (qualityReport.pendingItems.length > 0) {
    console.log("    Itens pendentes:");
    for (const item of qualityReport.pendingItems) console.log(`      - ${item}`);
  }
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function printCampaignWorkspace(workspace: NonNullable<Awaited<ReturnType<typeof campaignWorkspace>>>): void {
  const { campaignId, files, screens, features, mediaLibrary, videoAnalyses, documentAnalyses, graph, qualityReport } = workspace;
  console.log(`\nCampaign Intelligence — Workspace da campanha ${campaignId}`);

  console.log(`\n  Arquivos ingeridos (${files.length}): ${Object.entries(countBy(files.map((file) => file.kind))).map(([kind, count]) => `${kind}=${count}`).join(", ")}`);
  for (const file of files) {
    console.log(`    [${file.kind}/${file.status}] ${file.originalFileName} (${(file.sizeBytes / 1024).toFixed(0)}KB)${file.processingNotes.length > 0 ? ` — ${file.processingNotes.join(" ")}` : ""}`);
  }

  console.log(`\n  Vídeos processados (${videoAnalyses.length}):`);
  for (const video of videoAnalyses) {
    console.log(`    ${video.fileId}: ${video.durationSeconds.toFixed(1)}s, ${video.scenes.length} cena(s), ${video.frames.length} frame(s) extraído(s)`);
    for (const entry of video.timeline) console.log(`      ${formatSeconds(entry.timestampSeconds)}  ${entry.label}  (confiança ${(entry.confidence * 100).toFixed(0)}%)`);
  }

  console.log(`\n  Documentos processados (${documentAnalyses.length}):`);
  for (const doc of documentAnalyses) {
    console.log(`    ${doc.fileId}: ${doc.headlines.length} título(s), ${doc.paragraphs.length} parágrafo(s), ${doc.tables.length} tabela(s)${doc.pageCount ? `, ${doc.pageCount} página(s)` : ""}${doc.slideCount ? `, ${doc.slideCount} slide(s)` : ""}`);
  }

  console.log(`\n  Telas detectadas (${screens.length}):`);
  for (const screen of screens) {
    const origin = screen.sourceType === "video_frame" && screen.sourceTimestampSeconds !== undefined ? `${screen.sourceFileId} @ ${formatSeconds(screen.sourceTimestampSeconds)}` : screen.sourceFileId;
    console.log(`    [${screen.category}] origem: ${origin} (${screen.sourceType})`);
  }

  console.log(`\n  Funcionalidades identificadas (${features.length}):`);
  for (const feature of features) console.log(`    - ${feature.name}${feature.relatedScreenIds.length > 0 ? ` [tela: ${feature.relatedScreenIds.join(", ")}]` : " [sem tela]"}`);

  console.log(`\n  Campaign Media Library (${mediaLibrary.length} item(ns)): ${Object.entries(countBy(mediaLibrary.map((item) => item.category))).map(([category, count]) => `${category}=${count}`).join(", ")}`);

  console.log(`\n  Media Knowledge Graph: ${graph.nodes.length} nó(s), ${graph.edges.length} relação(ões).`);

  console.log(`\n  Relatório de qualidade:`);
  console.log(`    Arquivos: ${qualityReport.filesIngested} (${qualityReport.processedFiles} processados) · Funcionalidades: ${qualityReport.featuresFound} · Telas: ${qualityReport.screensFound}`);
  console.log(`    Vídeos: ${qualityReport.videosProcessed} · Frames: ${qualityReport.framesExtracted} · Documentos: ${qualityReport.documentsProcessed} · Caracteres OCR: ${qualityReport.ocrCharactersExtracted}`);
  console.log(`    Assets: ${qualityReport.assetsCollected} · Cobertura: ${qualityReport.coverageScore}/100 · Confiança média: ${(qualityReport.averageConfidence * 100).toFixed(0)}%`);
  console.log(`    Duplicados: ${qualityReport.duplicateFiles} · Reutilizáveis: ${qualityReport.reusableAssets}`);
  if (qualityReport.pendingItems.length > 0) {
    console.log("    Itens pendentes:");
    for (const item of qualityReport.pendingItems) console.log(`      - ${item}`);
  }
}

function printLocalAssetValidationOutcome(outcome: Awaited<ReturnType<typeof validateLocalAssetCommand>>): void {
  if (outcome.skipped) {
    console.log(`\nAsset ${outcome.assetId}: pulado — ${outcome.skipReason}`);
    return;
  }
  if (outcome.error) {
    console.log(`\nAsset ${outcome.assetId}: falha — ${outcome.error}`);
    return;
  }
  console.log(`\nAsset ${outcome.assetId} validado (Local Official Asset Qualification):`);
  console.log(`  Estágio: ${outcome.stage} · screenVisible: ${outcome.screenVisible} · compositingReady: ${outcome.compositingReady}`);
  console.log(`  approvalStatus: ${outcome.approvalStatus} (revisão humana continua obrigatória — use --footage-review-approve/--media-approve)`);
  console.log(`  Capacidades: ${(outcome.capabilities ?? []).join(", ") || "nenhuma"}`);
}

function printBatchLocalAssetValidationResult(result: Awaited<ReturnType<typeof validateLocalAssetsBatchCommand>>): void {
  console.log(`\nLocal Official Asset Qualification — lote concluído.`);
  console.log(`  Candidatos: ${result.totalCandidates} · Validados: ${result.validated} · Pulados (sem mudança): ${result.skipped} · Falhas: ${result.failed}`);
  for (const outcome of result.outcomes) {
    if (outcome.skipped) console.log(`  ${outcome.assetId}: pulado — ${outcome.skipReason}`);
    else if (outcome.error) console.log(`  ${outcome.assetId}: falha — ${outcome.error}`);
    else console.log(`  ${outcome.assetId}: ${outcome.stage} (screenVisible=${outcome.screenVisible}, compositingReady=${outcome.compositingReady}, approvalStatus=${outcome.approvalStatus})`);
  }
}

function formatSeconds(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function printMediaHealthReport(report: Awaited<ReturnType<typeof getMediaHealthReport>>): void {
  console.log(`\nSaúde da biblioteca de mídia — ${report.totalAssets} asset(s) catalogado(s) em ${report.generatedAt}`);
  console.log("\nPor tipo:");
  for (const [type, count] of Object.entries(report.byType)) console.log(`  ${type}: ${count}`);
  console.log("\nPor status de aprovação:");
  for (const [status, count] of Object.entries(report.byApprovalStatus)) console.log(`  ${status}: ${count}`);
  console.log(`\nLicença: ${report.licenseUnknown} desconhecida(s), ${report.licenseBlocked} bloqueada(s) para publicação.`);
  console.log(`Duplicatas registradas: ${report.duplicates}`);
  console.log(`Vídeos reais: ${report.realVideos} · Fotos: ${report.photos} · Mockups: ${report.mockups} · Músicas: ${report.music} · SFX: ${report.sfx}`);
  if (report.criticalGaps.length > 0) {
    console.log("\nLacunas críticas:");
    for (const gap of report.criticalGaps) console.log(`  - ${gap}`);
  }
  if (report.acquisitionRecommendations.length > 0) {
    console.log("\nRecomendações de aquisição:");
    for (const recommendation of report.acquisitionRecommendations) console.log(`  - ${recommendation}`);
  }
  if (report.mostUsedAssets.length > 0) {
    console.log("\nMais usados:");
    for (const entry of report.mostUsedAssets) console.log(`  ${entry.assetId}: ${entry.usageCount}x`);
  }
  console.log(`\nNunca usados: ${report.neverUsedAssets.length} asset(s).`);
}

function printMediaGapAnalysis(input: Awaited<ReturnType<typeof mediaGapAnalysisForExecution>>): void {
  const { gap } = input;
  console.log(`\nMedia Gap Analysis — ${gap.totalShots} Shot(s) no plano.`);
  console.log(`  Encontrados: ${gap.itemsFound.length} · Substitutos: ${gap.itemsSubstitute.length} · Faltando: ${gap.itemsMissing.length}`);
  console.log(`  Licença desconhecida: ${gap.itemsLicenseUnknown.length} · Risco de duplicata: ${gap.itemsDuplicateRisk.length}`);
  console.log(`  Shots sem filmagem real: ${gap.shotsWithoutRealFootage.length}${gap.shotsWithoutRealFootage.length > 0 ? ` (${gap.shotsWithoutRealFootage.join(", ")})` : ""}`);
  if (gap.sameCoupleShots.length > 0) {
    console.log("\n  Shots que dependem do mesmo casal:");
    for (const group of gap.sameCoupleShots) console.log(`    - ${group.join(", ")}`);
  }
  if (gap.sameEnvironmentShots.length > 0) {
    console.log("\n  Shots que dependem do mesmo ambiente:");
    for (const group of gap.sameEnvironmentShots) console.log(`    - ${group.join(", ")}`);
  }
  if (gap.prioritizedList.length > 0) {
    console.log("\n  Lista priorizada de produção:");
    for (const item of gap.prioritizedList) {
      console.log(`    [${item.priority}] ${item.shotId ?? `cena ${item.sceneOrder}`} — ${item.status} — ${item.description}`);
      console.log(`       motivo: ${item.reason}`);
    }
  }
}

function printMediaSearchResult(result: Awaited<ReturnType<typeof searchMedia>>): void {
  if (!result.providerConfigured) {
    console.log(`\nProvider "${result.providerId}" não configurado.`);
    console.log("  Defina as variáveis de ambiente:");
    console.log("    MEDIA_PROVIDER=pexels");
    console.log("    MEDIA_PROVIDER_API_KEY=<sua chave gratuita, obtida em https://www.pexels.com/api/>");
    console.log("  Sem essas variáveis, nenhuma busca/download externo é executado — a biblioteca local continua funcionando normalmente.");
    return;
  }
  console.log(`\n${result.hits.length} resultado(s) via ${result.providerId}.`);
  for (const hit of result.hits) {
    console.log(`\n  ${result.providerId}:${hit.externalId}`);
    console.log(`    autor: ${hit.author ?? "desconhecido"} · origem: ${hit.originPageUrl}`);
    console.log(`    resolução: ${hit.width ?? "?"}x${hit.height ?? "?"}${hit.durationSeconds ? ` · duração: ${hit.durationSeconds.toFixed(1)}s` : ""}`);
    console.log(`    licença: ${hit.license.name}${hit.license.requiresAttribution ? " (atribuição obrigatória)" : ""}`);
  }
  if (result.hits.length > 0) console.log(`\nPara baixar: npm run zuno -- --media-acquire ${result.providerId}:${result.hits[0].externalId}`);
}

function printAcquisitionRunReport(report: Awaited<ReturnType<typeof acquireMediaForExecution>>): void {
  console.log(`\nAquisição automática — execução ${report.executionId ?? "?"}.`);
  console.log(`  Buscas: ${report.searched} · Baixados: ${report.downloaded} · Adquiridos (needs_review): ${report.acquired} · Rejeitados: ${report.rejected}`);
  if (Object.keys(report.rejectionsByReason).length > 0) {
    console.log("\n  Rejeições por motivo:");
    for (const [reason, count] of Object.entries(report.rejectionsByReason)) console.log(`    ${reason}: ${count}`);
  }
  if (report.shotAssignments.length > 0) {
    console.log("\n  Shot -> asset adquirido:");
    for (const assignment of report.shotAssignments) console.log(`    ${assignment.shotId ?? `cena ${assignment.sceneOrder}`}: ${assignment.assetId} (autor: ${assignment.author ?? "desconhecido"})`);
  }
  if (report.fallbackNeeded.length > 0) {
    console.log("\n  Shots que continuam pendentes (fallback assistido necessário, nenhum gradiente/procedural usado):");
    for (const item of report.fallbackNeeded) console.log(`    ${item.shotId ?? `cena ${item.sceneOrder}`} — ${item.description}`);
  }
  console.log(`\nTodo asset adquirido entrou como "needs_review" — use --media-review-pending e --media-approve/--media-reject antes de contar para uma produção premium.`);
}

/** INTENT-BASED FOOTAGE ACQUISITION — `--footage-search-report`: mostra a mudança de filosofia (tema -> Shot Intent) com transparência total: toda consulta gerada, toda consulta descartada e por quê, quantos candidatos cada consulta trouxe, e o motivo exato de cada escolha/rejeição. */
function printFootageSearchReport(report: Awaited<ReturnType<typeof acquireMediaForExecution>>): void {
  console.log(`\nIntent-Based Footage Acquisition — execução ${report.executionId ?? "?"}.`);
  console.log(`  Shots processados: ${report.queryReports.length} · Buscas executadas: ${report.searched} · Baixados: ${report.downloaded} · Adquiridos: ${report.acquired} · Rejeitados: ${report.rejected}`);

  for (const shotReport of report.queryReports) {
    console.log(`\n  === Shot ${shotReport.shotId ?? `cena ${shotReport.sceneOrder}`} ===`);
    console.log(`    Intent: objetivo="${shotReport.intent.narrativeGoal}" · ação="${shotReport.intent.mainAction}" · dispositivo=${shotReport.intent.device} · telaVisível=${shotReport.intent.screenVisibleRequired} · compositingNecessario=${shotReport.intent.compositingRequired}`);
    console.log(`    Consultas geradas (${shotReport.positiveQueries.length}):`);
    for (const query of shotReport.positiveQueries) {
      const count = shotReport.resultsPerQuery[query] ?? 0;
      console.log(`      - "${query}" -> ${count} resultado(s)`);
    }
    if (shotReport.negativePatterns.length > 0) {
      console.log(`    Padrões negativos (usados só na validação visual pós-download, nunca enviados ao provider): ${shotReport.negativePatterns.join(", ")}`);
    }
    if (shotReport.discardedQueries.length > 0) {
      console.log("    Consultas descartadas:");
      for (const discarded of shotReport.discardedQueries) console.log(`      - "${discarded.query}" — ${discarded.reason}`);
    }
    console.log(`    Candidatos únicos considerados: ${shotReport.candidatesConsidered}`);
    if (shotReport.chosenAssetId) {
      console.log(`    Escolhido: ${shotReport.chosenAssetId} — ${shotReport.chosenReason}`);
    } else {
      console.log("    Nenhum candidato aprovado para este Shot (ver rejeições no relatório de aquisição).");
    }
  }

  if (Object.keys(report.rejectionsByReason).length > 0) {
    console.log("\n  Rejeições por motivo (todos os Shots):");
    for (const [reason, count] of Object.entries(report.rejectionsByReason)) console.log(`    ${reason}: ${count}`);
  }
}

/** FOOTAGE VISUAL VALIDATION 2.0 (seção 8) — fila de revisão em lote: só candidatos que passaram pelo Visual Candidate Validator desta sprint (nunca a fila genérica `--media-review-pending`, que mistura qualquer coisa `needs_review`). */
function printFootageReviewList(assets: Awaited<ReturnType<typeof footageReviewList>>): void {
  console.log(`\nFOOTAGE VISUAL VALIDATION 2.0 — ${assets.length} candidato(s) aguardando revisão humana.`);
  console.log("Nenhum candidato é aprovado automaticamente — use --footage-review-show <id> e depois --footage-review-approve/--footage-review-reject.\n");
  for (const asset of assets) {
    console.log(`  ${asset.assetId}  estágio=${asset.visualValidationStage ?? "?"}  screenVisible=${asset.screenVisible ?? "n/d"}  compositingReady=${asset.compositingReady ?? "n/d"}  autor=${asset.author ?? "desconhecido"}`);
  }
}

/** Seção 7/8 — a tela de revisão deve exibir: Shot; intenção; consulta; vídeo; frames analisados; região candidata; scores; motivos; pré-composição. Aqui não há mais o Shot Plan em memória (o candidato já foi indexado), então mostra tudo que o PRÓPRIO asset carrega (consulta/motivos ficam em `notes`, escritos no momento da aquisição). */
function printFootageReviewShow(asset: NonNullable<Awaited<ReturnType<typeof footageReviewShow>>>): void {
  console.log(`\n${asset.assetId} — ${asset.relativePath}`);
  console.log(`  autor: ${asset.author ?? "desconhecido"} · licença: ${asset.license?.name ?? "desconhecida"} · fonte: ${asset.sourceUrl ?? "desconhecida"}`);
  console.log(`  resolução: ${asset.width ?? "?"}x${asset.height ?? "?"} · duração: ${asset.durationSeconds?.toFixed(2) ?? "?"}s`);
  console.log(`  estágio de validação visual: ${asset.visualValidationStage ?? "não avaliado por esta sprint"}`);
  console.log(`  screenVisible=${asset.screenVisible ?? "n/d"} · compositingReady=${asset.compositingReady ?? "n/d"} · deviceType=${asset.deviceType ?? "n/d"} · deviceOrientation=${asset.deviceOrientation ?? "n/d"}`);
  console.log(`  deviceConfidence=${asset.deviceConfidence ?? "n/d"} · screenConfidence=${asset.screenConfidence ?? "n/d"}`);
  console.log(`  humanPresenceScore=${asset.humanPresenceScore ?? "n/d"} · humanInteractionScore=${asset.humanInteractionScore ?? "n/d"}`);
  console.log(`  persistenceRatio=${asset.persistenceRatio ?? "n/d"} · occlusionRisk=${asset.occlusionRisk ?? "n/d"}`);
  if (asset.reviewArtifacts?.annotatedFramePath) console.log(`  frame anotado (região detectada): ${asset.reviewArtifacts.annotatedFramePath}`);
  if (asset.reviewArtifacts?.zoomFramePath) console.log(`  zoom da região candidata: ${asset.reviewArtifacts.zoomFramePath}`);
  console.log("\n  Checklist para a revisão humana responder (seção 7):");
  console.log("    [ ] dispositivo correto?      [ ] tela correta?           [ ] perspectiva aceitável?");
  console.log("    [ ] interação coerente?       [ ] oclusão aceitável?      [ ] legibilidade suficiente?");
  console.log("\n  Notas/motivos registrados no momento da aquisição:");
  for (const note of asset.notes ?? []) console.log(`    - ${note}`);
  console.log(`\n  status atual: ${asset.approvalStatus}`);
}

function printAcquisitionLog(entries: Awaited<ReturnType<typeof mediaAcquisitionReport>>): void {
  const acquired = entries.filter((entry) => entry.outcome === "acquired");
  const rejected = entries.filter((entry) => entry.outcome === "rejected");
  console.log(`\nRelatório de aquisição — ${entries.length} tentativa(s) registrada(s) no total.`);
  console.log(`  Adquiridos: ${acquired.length} · Rejeitados: ${rejected.length}`);
  const byReason = new Map<string, number>();
  for (const entry of rejected) byReason.set(entry.rejectionReason ?? "desconhecido", (byReason.get(entry.rejectionReason ?? "desconhecido") ?? 0) + 1);
  if (byReason.size > 0) {
    console.log("\n  Rejeições por motivo:");
    for (const [reason, count] of byReason) console.log(`    ${reason}: ${count}`);
  }
  const authors = new Set(acquired.map((entry) => entry.author).filter(Boolean));
  console.log(`\n  Autores distintos adquiridos: ${authors.size > 0 ? [...authors].join(", ") : "nenhum"}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  let mode = DEFAULT_ZUNO_RUNTIME_MODE;
  let musicFilePath: string | undefined;
  let assetQualityProfile: string | undefined;
  try {
    const parsedMode = extractOption(args, "--mode");
    mode = parseZunoRuntimeMode(parsedMode.value);
    args.splice(0, args.length, ...parsedMode.remaining);

    const parsedMusic = extractOption(args, "--music");
    args.splice(0, args.length, ...parsedMusic.remaining);
    if (parsedMusic.value) {
      const validated = validateLocalMusicPath(parsedMusic.value, process.cwd());
      if (!validated.ok) throw new Error(validated.error);
      musicFilePath = validated.absolutePath;
    }

    const parsedAssetQuality = extractOption(args, "--asset-quality");
    args.splice(0, args.length, ...parsedAssetQuality.remaining);
    if (parsedAssetQuality.value) {
      if (!isAssetQualityProfile(parsedAssetQuality.value)) {
        throw new Error(`--asset-quality inválido: "${parsedAssetQuality.value}". Use um de: ${ASSET_QUALITY_PROFILES.join(", ")}.`);
      }
      assetQualityProfile = parsedAssetQuality.value;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  if (args.includes("--assets-scan") || args.includes("--assets-list") || args.includes("--assets-report")) {
    try {
      if (args.includes("--assets-report")) {
        printVisualAssetsReport(await getVisualAssetsReport(), "report");
      } else if (args.includes("--assets-list")) {
        printVisualAssetsReport(await listVisualAssets(), "list");
      } else {
        printVisualAssetsReport(await scanVisualAssets(), "scan");
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  // MEDIA INTELLIGENCE ENGINE — comandos standalone `--media-*`, mesmo padrão dos `--assets-*`
  // acima: nunca passam por ArthurOrchestrator/CaioWorkflowExecutor, operam diretamente sobre o
  // catálogo. Precisa vir ANTES do fallback de texto livre (senão os flags seriam engolidos no
  // comando de workflow) e depois do bloco `--assets-*` (evita colisão de prefixo).
  if (
    args.includes("--media-scan") || args.includes("--media-list") || args.includes("--media-show")
    || args.includes("--media-report") || args.includes("--media-tag") || args.includes("--media-approve")
    || args.includes("--media-reject") || args.includes("--media-remove") || args.includes("--media-gap")
    || args.includes("--media-collection-create") || args.includes("--media-search") || args.includes("--media-search-video")
    || args.includes("--media-acquire") || args.includes("--media-acquire-for-execution")
    || args.includes("--media-acquisition-report") || args.includes("--media-review-pending")
    || args.includes("--footage-search-report") || args.includes("--footage-review-list")
    || args.includes("--footage-review-show") || args.includes("--footage-review-approve")
    || args.includes("--footage-review-reject")
  ) {
    try {
      const parsedType = extractOption(args, "--type");
      args.splice(0, args.length, ...parsedType.remaining);
      const parsedTags = extractOption(args, "--tags");
      args.splice(0, args.length, ...parsedTags.remaining);
      const parsedReason = extractOption(args, "--reason");
      args.splice(0, args.length, ...parsedReason.remaining);
      const parsedAssets = extractOption(args, "--assets");
      args.splice(0, args.length, ...parsedAssets.remaining);

      if (args.includes("--media-scan")) {
        const result = await scanMediaCatalog();
        console.log(`\nMedia Intelligence Engine — varredura concluída.`);
        console.log(`  Escaneados: ${result.scanned} · Adicionados: ${result.added} · Atualizados: ${result.updated} · Indisponíveis: ${result.unavailable} · Duplicatas encontradas: ${result.duplicatesFound}`);
        if (result.warnings.length > 0) {
          console.log("\n  Avisos:");
          for (const warning of result.warnings) console.log(`    - ${warning}`);
        }
      } else if (args.includes("--media-list")) {
        const assets = await listMediaAssets(parsedType.value ? { type: parsedType.value as never } : undefined);
        console.log(`\n${assets.length} asset(s) no catálogo.`);
        for (const asset of assets) console.log(`  ${asset.assetId}  [${asset.type}/${asset.approvalStatus}]  ${asset.relativePath}`);
      } else if (args.includes("--media-show")) {
        const assetId = args.find((arg) => !arg.startsWith("--") && arg !== "--media-show");
        if (!assetId) throw new Error("Informe o assetId. Exemplo: --media-show <assetId>.");
        printMediaAssetRecord(await showMediaAsset(assetId));
      } else if (args.includes("--media-report")) {
        printMediaHealthReport(await getMediaHealthReport());
      } else if (args.includes("--media-tag")) {
        const assetIdOrPath = args.find((arg) => !arg.startsWith("--") && arg !== "--media-tag");
        if (!assetIdOrPath) throw new Error("Informe o asset ou caminho. Exemplo: --media-tag <arquivo-ou-id> --tags \"casal,celular\".");
        if (!parsedTags.value) throw new Error("Informe --tags \"tag1,tag2\".");
        const tags = parsedTags.value.split(",").map((tag) => tag.trim()).filter(Boolean);
        const updated = await tagMediaAsset(assetIdOrPath, tags);
        console.log(`Asset ${updated.assetId} agora com tags: ${updated.tags.join(", ")}`);
      } else if (args.includes("--media-approve")) {
        const assetId = args.find((arg) => !arg.startsWith("--") && arg !== "--media-approve");
        if (!assetId) throw new Error("Informe o assetId. Exemplo: --media-approve <assetId>.");
        const updated = await approveMediaAsset(assetId);
        console.log(`Asset ${updated.assetId} aprovado.`);
      } else if (args.includes("--media-reject")) {
        const assetId = args.find((arg) => !arg.startsWith("--") && arg !== "--media-reject");
        if (!assetId) throw new Error("Informe o assetId. Exemplo: --media-reject <assetId> [--reason \"...\"].");
        const updated = await rejectMediaAsset(assetId, parsedReason.value);
        console.log(`Asset ${updated.assetId} rejeitado.`);
      } else if (args.includes("--media-remove")) {
        const assetId = args.find((arg) => !arg.startsWith("--") && arg !== "--media-remove");
        if (!assetId) throw new Error("Informe o assetId. Exemplo: --media-remove <assetId>.");
        await removeMediaAsset(assetId);
        console.log(`Asset ${assetId} removido do catálogo (arquivo físico preservado).`);
      } else if (args.includes("--media-gap")) {
        const executionId = args.find((arg) => !arg.startsWith("--") && arg !== "--media-gap");
        if (!executionId) throw new Error("Informe o executionId. Exemplo: --media-gap <executionId>.");
        printMediaGapAnalysis(await mediaGapAnalysisForExecution(executionId));
      } else if (args.includes("--media-collection-create")) {
        const name = args.find((arg) => !arg.startsWith("--") && arg !== "--media-collection-create");
        if (!name) throw new Error("Informe o nome da coleção. Exemplo: --media-collection-create \"Nome\" --assets id1,id2.");
        if (!parsedAssets.value) throw new Error("Informe --assets id1,id2,....");
        const assetIds = parsedAssets.value.split(",").map((id) => id.trim()).filter(Boolean);
        const collection = await createMediaCollection({ name, assetIds });
        const stats = await showMediaCollectionStats(collection.collectionId);
        console.log(`\nColeção "${collection.name}" criada (${collection.collectionId}) com ${collection.assetIds.length} asset(s).`);
        if (stats) {
          console.log(`  Vídeos reais: ${stats.realVideoCount} · Fotos: ${stats.photoCount} · Variedade humana: ${stats.humanVariety} · Variedade de ambiente: ${stats.environmentVariety} · Qualidade média: ${stats.averageQuality}`);
          if (stats.gaps.length > 0) { console.log("  Lacunas:"); for (const gap of stats.gaps) console.log(`    - ${gap}`); }
        }
      } else if (args.includes("--media-search") || args.includes("--media-search-video")) {
        const flag = args.includes("--media-search-video") ? "--media-search-video" : "--media-search";
        const text = args.find((arg) => !arg.startsWith("--") && arg !== flag);
        if (!text) throw new Error(`Informe o texto da busca. Exemplo: ${flag} "casal usando celular".`);
        const result = flag === "--media-search-video" ? await searchMediaVideo(text) : await searchMedia(text);
        printMediaSearchResult(result);
      } else if (args.includes("--media-acquire-for-execution")) {
        const executionId = args.find((arg) => !arg.startsWith("--") && arg !== "--media-acquire-for-execution");
        if (!executionId) throw new Error("Informe o executionId. Exemplo: --media-acquire-for-execution <executionId>.");
        printAcquisitionRunReport(await acquireMediaForExecution(executionId));
      } else if (args.includes("--footage-search-report")) {
        const executionId = args.find((arg) => !arg.startsWith("--") && arg !== "--footage-search-report");
        if (!executionId) throw new Error("Informe o executionId. Exemplo: --footage-search-report <executionId>.");
        printFootageSearchReport(await acquireMediaForExecution(executionId));
      } else if (args.includes("--media-acquire")) {
        const resultId = args.find((arg) => !arg.startsWith("--") && arg !== "--media-acquire");
        if (!resultId) throw new Error("Informe o resultadoId. Exemplo: --media-acquire pexels:1448735.");
        const outcome = await acquireMediaResult(resultId);
        if (outcome.status === "acquired") {
          console.log(`\nAsset adquirido: ${outcome.record.assetId} (${outcome.record.relativePath}).`);
          console.log(`  Autor: ${outcome.record.author ?? "desconhecido"} · Licença: ${outcome.record.license?.name ?? "desconhecida"} · Status: ${outcome.record.approvalStatus} (requer revisão humana).`);
        } else {
          console.log(`\nCandidato rejeitado automaticamente: ${outcome.reason}`);
          console.log(`  ${outcome.detail}`);
        }
      } else if (args.includes("--media-acquisition-report")) {
        printAcquisitionLog(await mediaAcquisitionReport());
      } else if (args.includes("--media-review-pending")) {
        const pending = await mediaReviewPending();
        console.log(`\n${pending.length} asset(s) aguardando revisão humana (needs_review).`);
        for (const asset of pending) console.log(`  ${asset.assetId}  [${asset.type}]  autor: ${asset.author ?? "desconhecido"}  ${asset.relativePath}`);
      } else if (args.includes("--footage-review-list")) {
        printFootageReviewList(await footageReviewList());
      } else if (args.includes("--footage-review-show")) {
        const assetId = args.find((arg) => !arg.startsWith("--") && arg !== "--footage-review-show");
        if (!assetId) throw new Error("Informe o assetId. Exemplo: --footage-review-show <candidateId>.");
        const asset = await footageReviewShow(assetId);
        if (!asset) throw new Error(`Candidato "${assetId}" não encontrado no catálogo.`);
        printFootageReviewShow(asset);
      } else if (args.includes("--footage-review-approve")) {
        const assetId = args.find((arg) => !arg.startsWith("--") && arg !== "--footage-review-approve");
        if (!assetId) throw new Error("Informe o assetId. Exemplo: --footage-review-approve <candidateId> [--reason \"...\"].");
        const updated = await footageReviewApprove(assetId, parsedReason.value);
        console.log(`Candidato ${updated.assetId} aprovado (approvalStatus=${updated.approvalStatus}).`);
      } else if (args.includes("--footage-review-reject")) {
        const assetId = args.find((arg) => !arg.startsWith("--") && arg !== "--footage-review-reject");
        if (!assetId) throw new Error("Informe o assetId. Exemplo: --footage-review-reject <candidateId> --reason \"...\".");
        const updated = await footageReviewReject(assetId, parsedReason.value);
        console.log(`Candidato ${updated.assetId} rejeitado (approvalStatus=${updated.approvalStatus}).`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  // COMPANY INTELLIGENCE ENGINE — comandos standalone `--company-*`, mesmo padrão dos `--media-*`
  // acima: nunca passam pelo orquestrador, operam direto sobre a base de conhecimento de empresa.
  if (
    args.includes("--company-discover") || args.includes("--company-report")
    || args.includes("--company-list") || args.includes("--company-search")
    || args.includes("--company-publish")
  ) {
    try {
      const parsedScope = extractOption(args, "--company-scope");
      args.splice(0, args.length, ...parsedScope.remaining);
      const parsedMaxPages = extractOption(args, "--company-max-pages");
      args.splice(0, args.length, ...parsedMaxPages.remaining);
      const parsedDelay = extractOption(args, "--company-delay-ms");
      args.splice(0, args.length, ...parsedDelay.remaining);
      const parsedClientId = extractOption(args, "--client-id");
      args.splice(0, args.length, ...parsedClientId.remaining);

      if (args.includes("--company-discover")) {
        const domain = args.find((arg) => !arg.startsWith("--") && arg !== "--company-discover");
        if (!domain) throw new Error("Informe o domínio. Exemplo: --company-discover exemplo.com.br [--company-scope \"/,/precos\"] [--company-max-pages 12].");
        const allowedPaths = parsedScope.value ? parsedScope.value.split(",").map((path) => path.trim()).filter(Boolean) : undefined;
        const maxPages = parsedMaxPages.value ? Number.parseInt(parsedMaxPages.value, 10) : undefined;
        const requestDelayMs = parsedDelay.value ? Number.parseInt(parsedDelay.value, 10) : undefined;
        const base = await companyDiscover(domain, { allowedPaths, seedPaths: allowedPaths, maxPages, requestDelayMs });
        printCompanyKnowledgeBase(base);
      } else if (args.includes("--company-report")) {
        const domain = args.find((arg) => !arg.startsWith("--") && arg !== "--company-report");
        if (!domain) throw new Error("Informe o domínio. Exemplo: --company-report exemplo.com.br.");
        const base = await companyKnowledgeBase(domain);
        if (!base) throw new Error(`Nenhuma base de conhecimento coletada ainda para ${domain}. Rode --company-discover primeiro.`);
        printCompanyKnowledgeBase(base);
      } else if (args.includes("--company-list")) {
        const bases = await listCompanyKnowledgeBases();
        console.log(`\n${bases.length} empresa(s) com base de conhecimento coletada.`);
        for (const base of bases) console.log(`  ${base.profile.domain}  [${base.profile.companyName}]  Brand Score: ${base.qualityReport.brandScore}  Coverage Score: ${base.qualityReport.coverageScore}`);
      } else if (args.includes("--company-search")) {
        const companySearchIndex = args.indexOf("--company-search");
        const domain = args[companySearchIndex + 1];
        const question = args[companySearchIndex + 2];
        if (!domain || !question) throw new Error("Informe domínio e pergunta: --company-search <domínio> \"<pergunta>\".");
        const result = await companySearch(domain, question);
        console.log(`\n${result.answer}`);
        console.log(`  Confiança: ${(result.confidence * 100).toFixed(0)}%`);
      } else if (args.includes("--company-publish")) {
        const domain = args.find((arg) => !arg.startsWith("--") && arg !== "--company-publish");
        if (!domain) throw new Error("Informe o domínio. Exemplo: --company-publish exemplo.com.br [--client-id <id>].");
        const result = parsedClientId.value ? await companyPublish(domain, parsedClientId.value) : await companyPublish(domain);
        console.log(`\nBase de conhecimento de ${result.domain} publicada para o cliente ${result.clientId}.`);
        console.log(`  Registros na Clara: ${result.claraRecords.map((entry) => entry.module).join(", ")}`);
        console.log(`  Telas publicadas no Product Screen Catalog: ${result.productScreens.length}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  // CAMPAIGN INTELLIGENCE ENGINE — comandos standalone `--campaign-ingest`/`--campaign-*`, mesmo
  // padrão dos `--company-*` acima: nunca passam pelo orquestrador, operam direto sobre o
  // Workspace da campanha.
  if (
    args.includes("--campaign-ingest") || args.includes("--campaign-workspace")
    || args.includes("--campaign-workspace-list") || args.includes("--campaign-frame-search")
    || args.includes("--campaign-reuse-check") || args.includes("--campaign-intelligence-publish")
  ) {
    try {
      const parsedClientId = extractOption(args, "--client-id");
      args.splice(0, args.length, ...parsedClientId.remaining);

      if (args.includes("--campaign-ingest")) {
        const ingestIndex = args.indexOf("--campaign-ingest");
        const positionalArgs = args.slice(ingestIndex + 1).filter((arg) => !arg.startsWith("--"));
        const [campaignId, ...filePaths] = positionalArgs;
        if (!campaignId || filePaths.length === 0) throw new Error("Informe campaignId e ao menos um arquivo: --campaign-ingest <campaignId> <arquivo1> [arquivo2 ...].");
        const result = await campaignIngest(campaignId, filePaths);
        console.log(`\nIngestão concluída para a campanha ${campaignId}: ${result.newFilesProcessed} arquivo(s) novo(s) processado(s), ${result.duplicatesSkipped} duplicata(s) ignorada(s).`);
        printCampaignWorkspace(result.workspace);
      } else if (args.includes("--campaign-workspace")) {
        const campaignId = args.find((arg) => !arg.startsWith("--") && arg !== "--campaign-workspace");
        if (!campaignId) throw new Error("Informe o campaignId. Exemplo: --campaign-workspace <campaignId>.");
        const workspace = await campaignWorkspace(campaignId);
        if (!workspace) throw new Error(`Nenhum Workspace coletado ainda para a campanha ${campaignId}. Rode --campaign-ingest primeiro.`);
        printCampaignWorkspace(workspace);
      } else if (args.includes("--campaign-workspace-list")) {
        const workspaces = await listCampaignWorkspaces();
        console.log(`\n${workspaces.length} campanha(s) com Workspace coletado.`);
        for (const workspace of workspaces) console.log(`  ${workspace.campaignId}  arquivos=${workspace.files.length}  funcionalidades=${workspace.features.length}  telas=${workspace.screens.length}  cobertura=${workspace.qualityReport.coverageScore}/100`);
      } else if (args.includes("--campaign-frame-search")) {
        const searchIndex = args.indexOf("--campaign-frame-search");
        const campaignId = args[searchIndex + 1];
        const query = args[searchIndex + 2];
        if (!campaignId || !query) throw new Error("Informe campanha e consulta: --campaign-frame-search <campaignId> \"<consulta>\".");
        const results = await campaignFrameSearch(campaignId, query);
        console.log(`\n${results.length} resultado(s) para "${query}":`);
        for (const result of results) console.log(`  [${result.kind}] ${result.description}${result.path ? ` -> ${result.path}` : ""}`);
      } else if (args.includes("--campaign-reuse-check")) {
        const reuseIndex = args.indexOf("--campaign-reuse-check");
        const campaignId = args[reuseIndex + 1];
        const query = args[reuseIndex + 2];
        if (!campaignId || !query) throw new Error("Informe campanha e consulta: --campaign-reuse-check <campaignId> \"<consulta>\".");
        const result = await campaignReuseCheck(campaignId, query);
        console.log(`\n${result.found ? "MATERIAL OFICIAL ENCONTRADO" : "NADA ENCONTRADO"}: ${result.reason}`);
      } else if (args.includes("--campaign-intelligence-publish")) {
        const campaignId = args.find((arg) => !arg.startsWith("--") && arg !== "--campaign-intelligence-publish");
        if (!campaignId) throw new Error("Informe o campaignId. Exemplo: --campaign-intelligence-publish <campaignId> [--client-id <id>].");
        const result = parsedClientId.value ? await campaignIntelligencePublish(campaignId, parsedClientId.value) : await campaignIntelligencePublish(campaignId);
        console.log(`\nWorkspace da campanha ${result.campaignId} publicado para o cliente ${result.clientId}.`);
        console.log(`  Registros na Clara: ${result.claraRecords.map((entry) => entry.module).join(", ") || "nenhum (sem funcionalidades/identidade suficientes)"}`);
        console.log(`  Telas publicadas no Product Screen Catalog: ${result.productScreens.length}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  // LOCAL OFFICIAL ASSET QUALIFICATION — comandos standalone `--validate-local-asset*`, mesmo
  // padrão dos blocos acima: opera direto sobre o catálogo de mídia.
  if (args.includes("--validate-local-asset") || args.includes("--validate-local-assets")) {
    try {
      const parsedAssetId = extractOption(args, "--asset-id");
      args.splice(0, args.length, ...parsedAssetId.remaining);
      const parsedFilePath = extractOption(args, "--file-path");
      args.splice(0, args.length, ...parsedFilePath.remaining);
      const parsedCampaignId = extractOption(args, "--campaign-id");
      args.splice(0, args.length, ...parsedCampaignId.remaining);
      const parsedClientId = extractOption(args, "--client-id");
      args.splice(0, args.length, ...parsedClientId.remaining);
      const parsedDevice = extractOption(args, "--device");
      args.splice(0, args.length, ...parsedDevice.remaining);
      const forceFlag = args.includes("--force");
      args.splice(0, args.length, ...args.filter((arg) => arg !== "--force"));

      if (args.includes("--validate-local-asset")) {
        if (!parsedAssetId.value && !parsedFilePath.value) throw new Error("Informe --asset-id ou --file-path. Exemplo: --validate-local-asset --asset-id <id> --campaign-id <id>.");
        const outcome = await validateLocalAssetCommand({
          assetId: parsedAssetId.value,
          filePath: parsedFilePath.value,
          campaignId: parsedCampaignId.value,
          clientId: parsedClientId.value,
          device: parsedDevice.value as never,
          force: forceFlag,
        });
        printLocalAssetValidationOutcome(outcome);
      } else if (args.includes("--validate-local-assets")) {
        if (!parsedCampaignId.value) throw new Error("Informe --campaign-id. Exemplo: --validate-local-assets --campaign-id <id>.");
        const result = await validateLocalAssetsBatchCommand({ campaignId: parsedCampaignId.value, clientId: parsedClientId.value, force: forceFlag });
        printBatchLocalAssetValidationResult(result);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  // OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY — `--rerun-asset-resolution`, mesmo padrão dos
  // blocos acima: nunca um alias de `--continue` (comportamento normal preservado), só uma
  // operação explícita e escopada.
  if (args.includes("--rerun-asset-resolution")) {
    try {
      const executionId = args.find((arg) => !arg.startsWith("--") && arg !== "--rerun-asset-resolution");
      if (!executionId) throw new Error("Informe o executionId. Exemplo: --rerun-asset-resolution <executionId>.");
      const result = await rerunAssetResolution(executionId);
      console.log(`\nNova resolução de assets executada para ${executionId}.`);
      if (result.staleness.stale) {
        console.log(`  ASSET_RESOLUTION_STALE (esperado — por isso a re-resolução foi pedida):`);
        for (const reason of result.staleness.reasons) console.log(`    - ${reason}`);
      } else {
        console.log(`  A resolução anterior não estava marcada como obsoleta (sem asset-report.json anterior, ou nada mudou no catálogo/política/validador).`);
      }
      const previousSet = new Set(result.previousResolvedAssetIds);
      const newSet = new Set(result.newResolvedAssetIds);
      const added = result.newResolvedAssetIds.filter((id) => !previousSet.has(id));
      const removed = result.previousResolvedAssetIds.filter((id) => !newSet.has(id));
      console.log(`  Shots resolvidos antes: ${result.previousResolvedAssetIds.length} · agora: ${result.newResolvedAssetIds.length}`);
      if (added.length > 0) console.log(`  Novos assets selecionados: ${added.join(", ")}`);
      if (removed.length > 0) console.log(`  Assets que deixaram de ser selecionados: ${removed.join(", ")}`);
      console.log(`\nEstado da execução: ${result.report.state}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  // NARRATIVE TIMING REBALANCING — `--rebalance-timeline`, mesmo padrão de `--rerun-asset-resolution`
  // (reaproveita a MESMA função por baixo, nunca um caminho de código paralelo): a realocação em
  // si já roda automaticamente dentro de Rafa sempre que há déficit; este comando só nomeia a
  // operação explicitamente e mostra o plano aplicado (se algum foi).
  if (args.includes("--rebalance-timeline")) {
    try {
      const executionId = args.find((arg) => !arg.startsWith("--") && arg !== "--rebalance-timeline");
      if (!executionId) throw new Error("Informe o executionId. Exemplo: --rebalance-timeline <executionId>.");
      const result = await rebalanceTimeline(executionId);
      console.log(`\nNarrative Timing Rebalancing executado para ${executionId}.`);
      if (result.rebalanceRecords.length > 0) {
        console.log(`  ${result.rebalanceRecords.length} plano(s) de realocação aplicado(s):`);
        for (const record of result.rebalanceRecords as Array<{ receiverShotId: string; donorShotIds: string[]; reason: string; durationDelta: Record<string, number> }>) {
          console.log(`    - receptor=${record.receiverShotId} doador(es)=${record.donorShotIds.join(", ")} · ${record.reason}`);
          console.log(`      deltas: ${JSON.stringify(record.durationDelta)}`);
        }
      } else if (result.unresolvedShotIds.length > 0) {
        console.log(`  TIMING_REBALANCE_NOT_POSSIBLE para: ${result.unresolvedShotIds.join(", ")} — nenhum Shot doador válido encontrado.`);
      } else {
        console.log(`  Nenhum déficit temporal detectado nesta resolução — nada para realocar.`);
      }
      console.log(`\nEstado da execução: ${result.report.state}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  // PRODUCT COMPOSITING ENGINE — comandos standalone `--product-screen-*`/`--product-compositing-*`,
  // mesmo padrão dos `--media-*` acima: nunca passam pelo orquestrador, operam direto sobre o
  // catálogo de telas de produto e o motor de composição.
  if (
    args.includes("--product-screen-scan") || args.includes("--product-screen-list") || args.includes("--product-screen-show")
    || args.includes("--product-screen-approve") || args.includes("--product-screen-reject") || args.includes("--product-screen-report")
    || args.includes("--product-compositing-capabilities") || args.includes("--product-compositing-assisted-package")
    || args.includes("--product-compositing-compose") || args.includes("--product-coverage-report")
    || args.includes("--coverage-matrix") || args.includes("--compose-scene")
  ) {
    try {
      const parsedReason = extractOption(args, "--reason");
      args.splice(0, args.length, ...parsedReason.remaining);
      const parsedScreenType = extractOption(args, "--screen-type");
      args.splice(0, args.length, ...parsedScreenType.remaining);
      const parsedTimestamps = extractOption(args, "--timestamps");
      args.splice(0, args.length, ...parsedTimestamps.remaining);
      const parsedScreenId = extractOption(args, "--screen-id");
      args.splice(0, args.length, ...parsedScreenId.remaining);
      const parsedFunctionality = extractOption(args, "--functionality");
      args.splice(0, args.length, ...parsedFunctionality.remaining);
      const parsedStart = extractOption(args, "--start");
      args.splice(0, args.length, ...parsedStart.remaining);
      const parsedEnd = extractOption(args, "--end");
      args.splice(0, args.length, ...parsedEnd.remaining);
      const parsedMode = extractOption(args, "--placement-mode");
      args.splice(0, args.length, ...parsedMode.remaining);
      const parsedKeyframes = extractOption(args, "--keyframes");
      args.splice(0, args.length, ...parsedKeyframes.remaining);

      if (args.includes("--product-screen-scan")) {
        const result = await productScreenScan();
        console.log(`\nCatálogo de telas de produto — varredura concluída.`);
        console.log(`  Escaneados: ${result.scanned} · Adicionados: ${result.added} · Atualizados: ${result.updated}`);
        if (result.warnings.length > 0) { console.log("\n  Avisos:"); for (const warning of result.warnings) console.log(`    - ${warning}`); }
      } else if (args.includes("--product-screen-list")) {
        const screens = await listProductScreens();
        console.log(`\n${screens.length} tela(s) de produto no catálogo.`);
        for (const screen of screens) console.log(`  ${screen.screenId}  [${screen.functionality}/${screen.deviceTarget}/${screen.approvalStatus}]  ${screen.sourcePath}`);
      } else if (args.includes("--product-screen-show")) {
        const screenId = args.find((arg) => !arg.startsWith("--") && arg !== "--product-screen-show");
        if (!screenId) throw new Error("Informe o screenId. Exemplo: --product-screen-show <screenId>.");
        const screen = await showProductScreen(screenId);
        if (!screen) console.log(`Tela "${screenId}" não encontrada.`);
        else console.log(JSON.stringify(screen, null, 2));
      } else if (args.includes("--product-screen-approve")) {
        const screenId = args.find((arg) => !arg.startsWith("--") && arg !== "--product-screen-approve");
        if (!screenId) throw new Error("Informe o screenId. Exemplo: --product-screen-approve <screenId>.");
        const updated = await approveProductScreen(screenId);
        console.log(`Tela ${updated.screenId} aprovada.`);
      } else if (args.includes("--product-screen-reject")) {
        const screenId = args.find((arg) => !arg.startsWith("--") && arg !== "--product-screen-reject");
        if (!screenId) throw new Error("Informe o screenId. Exemplo: --product-screen-reject <screenId> [--reason \"...\"].");
        const updated = await rejectProductScreen(screenId, parsedReason.value);
        console.log(`Tela ${updated.screenId} rejeitada.`);
      } else if (args.includes("--product-screen-report")) {
        const report = await productScreenReport();
        console.log(`\nCatálogo de telas de produto — ${report.total} tela(s).`);
        console.log(`  Aprovadas: ${report.approved} · Aguardando revisão: ${report.needsReview} · Rejeitadas: ${report.rejected}`);
        console.log(`  Por funcionalidade: ${JSON.stringify(report.byFunctionality)}`);
        console.log(`  Por dispositivo: ${JSON.stringify(report.byDeviceTarget)}`);
      } else if (args.includes("--product-compositing-capabilities")) {
        const capabilities = await productCompositingCapabilities();
        console.log("\nProduct Compositing Engine — capacidades reais (auditadas, nunca simuladas):");
        for (const capability of capabilities) {
          console.log(`  [${capability.status}] ${capability.capability}`);
          console.log(`    ${capability.explanation}`);
        }
      } else if (args.includes("--product-compositing-assisted-package")) {
        const assetId = args.find((arg) => !arg.startsWith("--") && arg !== "--product-compositing-assisted-package");
        if (!assetId) throw new Error("Informe o assetId. Exemplo: --product-compositing-assisted-package <assetId> --screen-type phone --timestamps 1.0,2.5.");
        if (!parsedScreenType.value) throw new Error("Informe --screen-type phone|tablet|notebook|desktop.");
        if (!parsedTimestamps.value) throw new Error("Informe --timestamps 1.0,2.5,...");
        const referenceTimestamps = parsedTimestamps.value.split(",").map((value) => Number(value.trim()));
        const pkg = await buildCompositingAssistedPackage({ assetId, screenType: parsedScreenType.value as never, referenceTimestamps });
        console.log(`\nPacote assistido criado: ${pkg.packageId}`);
        for (const frame of pkg.referenceFrames) console.log(`  t=${frame.time}s -> ${frame.frameImagePath}`);
        console.log(`\n${pkg.instructions}`);
      } else if (args.includes("--product-compositing-compose")) {
        const sourceAssetId = args.find((arg) => !arg.startsWith("--") && arg !== "--product-compositing-compose");
        if (!sourceAssetId) throw new Error("Informe o assetId de origem. Exemplo: --product-compositing-compose <assetId> --screen-id <screenId> --functionality rsvp --start 0.5 --end 2.2 --placement-mode STATIC_SCREEN --keyframes '[...]'.");
        if (!parsedScreenId.value) throw new Error("Informe --screen-id <screenId>.");
        if (!parsedFunctionality.value) throw new Error("Informe --functionality <nome>.");
        if (!parsedStart.value || !parsedEnd.value) throw new Error("Informe --start <segundos> --end <segundos>.");
        if (!parsedMode.value) throw new Error("Informe --placement-mode STATIC_SCREEN|SIMPLE_KEYFRAME_TRACKING|MANUAL_ASSISTED.");
        if (!parsedKeyframes.value) throw new Error("Informe --keyframes '[{\"time\":1.0,\"corners\":{...}}]' (JSON).");
        const keyframes = JSON.parse(parsedKeyframes.value);
        const outcome = await compositeProductScreenForAsset({
          sourceAssetId, productScreenId: parsedScreenId.value, functionality: parsedFunctionality.value,
          startTime: Number(parsedStart.value), endTime: Number(parsedEnd.value),
          mode: parsedMode.value as never, keyframes,
        });
        if (outcome.status === "composited") {
          console.log(`\nComposição concluída: ${outcome.asset.assetId} (${outcome.asset.relativePath}).`);
          console.log(`  Status: ${outcome.asset.approvalStatus} (requer revisão humana antes de contar integralmente no Product Coverage).`);
        } else {
          console.log(`\nComposição bloqueada: ${outcome.reason}`);
          if (outcome.needsManualOcclusion) console.log("  Este Shot precisa de máscara de oclusão manual (--occlusion-keyframes) ou de outro footage.");
        }
      } else if (args.includes("--product-coverage-report")) {
        const executionId = args.find((arg) => !arg.startsWith("--") && arg !== "--product-coverage-report");
        if (!executionId) throw new Error("Informe o executionId. Exemplo: --product-coverage-report <executionId>.");
        const report = await productCoverageReport(executionId);
        console.log(`\nProduct Coverage — execução ${executionId} (${report.productShotsCount} Shot(s) que exigem produto).`);
        console.log(`  Product Mention Coverage: ${Math.round(report.productMentionCoverage * 100)}%`);
        console.log(`  Product Visual Coverage: ${Math.round(report.productVisualCoverage * 100)}%`);
        console.log(`  Product Interaction Coverage: ${Math.round(report.productInteractionCoverage * 100)}%`);
        console.log(`  Product Legibility Coverage: ${Math.round(report.productLegibilityCoverage * 100)}%`);
      } else if (args.includes("--coverage-matrix")) {
        const executionId = args.find((arg) => !arg.startsWith("--") && arg !== "--coverage-matrix");
        if (!executionId) throw new Error("Informe o executionId. Exemplo: --coverage-matrix <executionId>.");
        printCoverageMatrix(await buildCoverageMatrixForExecution(executionId));
      } else if (args.includes("--compose-scene")) {
        const composeIndex = args.indexOf("--compose-scene");
        const executionId = args[composeIndex + 1];
        const shotId = args[composeIndex + 2] && !args[composeIndex + 2].startsWith("--") ? args[composeIndex + 2] : undefined;
        if (!executionId) throw new Error('Informe o executionId. Exemplo: --compose-scene <executionId> [shotId].');
        const reports = shotId ? [await composeSceneForShot(executionId, shotId)] : await composeScenesForExecution(executionId);
        printSceneCompositionReport(reports);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  // AUTONOMOUS EXECUTION ENGINE — `--autonomous-dry-run` é um modificador (nunca usado sozinho),
  // por isso é lido e removido de `args` ANTES de checar `--autonomous`/`--autonomous-continue`.
  const autonomousDryRun = args.includes("--autonomous-dry-run");
  if (autonomousDryRun) args.splice(args.indexOf("--autonomous-dry-run"), 1);

  const simulateAutonomousIndex = args.indexOf("--simulate-autonomous");
  if (simulateAutonomousIndex !== -1) {
    const executionId = args[simulateAutonomousIndex + 1];
    if (!executionId) {
      console.error("Informe o executionId: --simulate-autonomous <executionId>.");
      process.exitCode = 1;
      return;
    }
    try {
      printAutonomousSimulation(await simulateAutonomousExecution(executionId));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  const autonomousIndex = args.indexOf("--autonomous");
  const autonomousContinueIndex = args.indexOf("--autonomous-continue");
  if (autonomousIndex !== -1 || autonomousContinueIndex !== -1) {
    try {
      if (autonomousIndex !== -1) {
        const command = args[autonomousIndex + 1];
        if (!command) throw new Error('Informe o comando: --autonomous "<comando>".');
        const outcome = await runAutonomousExecution({ command, mode, musicFilePath, assetQualityProfile, dryRun: autonomousDryRun });
        printAutonomousOutcome(outcome);
      } else {
        const executionId = args[autonomousContinueIndex + 1];
        if (!executionId) throw new Error("Informe o executionId: --autonomous-continue <executionId>.");
        const outcome = await runAutonomousExecution({ executionId, mode, musicFilePath, assetQualityProfile, dryRun: autonomousDryRun });
        printAutonomousOutcome(outcome);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  const campaignShowIndex = args.indexOf("--campaign-show");
  if (campaignShowIndex !== -1) {
    const campaignId = args[campaignShowIndex + 1];
    if (!campaignId) {
      console.error("Informe o campaignId: --campaign-show <campaignId>.");
      process.exitCode = 1;
      return;
    }
    try {
      const result = await getCampaign(campaignId);
      if (!result) {
        console.error(`Campanha ${campaignId} não encontrada.`);
        process.exitCode = 1;
        return;
      }
      printCampaignPlan(result.plan);
      printCampaignStatusSummary(result.summary);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (args.includes("--campaign-list")) {
    try {
      const clientIdIndex = args.indexOf("--client-id");
      const clientId = clientIdIndex !== -1 ? args[clientIdIndex + 1] : undefined;
      const plans = await listCampaigns(clientId ? { clientId } : {});
      if (plans.length === 0) {
        console.log("Nenhuma campanha cadastrada.");
        return;
      }
      console.log("Histórico de campanhas:");
      for (const plan of plans) {
        console.log(`  ${plan.id} — ${plan.objective} (${plan.objectiveType}, ${plan.contents.length} conteúdo(s), criada em ${plan.createdAt})`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  const campaignGenerateIndex = args.indexOf("--campaign-generate-plan");
  if (campaignGenerateIndex !== -1) {
    const campaignId = args[campaignGenerateIndex + 1];
    const contentId = args[campaignGenerateIndex + 2];
    if (!campaignId || !contentId) {
      console.error("Informe campaignId e contentId: --campaign-generate-plan <campaignId> <contentId>.");
      process.exitCode = 1;
      return;
    }
    try {
      const { executionPlan } = await generateCampaignContentExecutionPlan(campaignId, contentId);
      console.log(`\nExecutionPlan ${executionPlan.id} gerado para o conteúdo ${contentId} da campanha ${campaignId}.`);
      console.log(`Etapas: ${executionPlan.steps.map((step) => step.name).join(" -> ")}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  const campaignMarkIndex = args.indexOf("--campaign-mark");
  if (campaignMarkIndex !== -1) {
    const campaignId = args[campaignMarkIndex + 1];
    const contentId = args[campaignMarkIndex + 2];
    const status = args[campaignMarkIndex + 3];
    if (!campaignId || !contentId || !status) {
      console.error(`Informe campaignId, contentId e status: --campaign-mark <campaignId> <contentId> <status>. Status válidos: ${CAMPAIGN_CONTENT_STATUSES.join(", ")}.`);
      process.exitCode = 1;
      return;
    }
    try {
      const reasonOption = extractOption(args, "--reason");
      const content = await markCampaignContentStatus(campaignId, contentId, status as CampaignContentStatus, reasonOption.value);
      console.log(`\nConteúdo ${content.id} atualizado para status "${content.status}".`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  const campaignIndex = args.indexOf("--campaign");
  if (campaignIndex !== -1) {
    const objective = args[campaignIndex + 1];
    if (!objective) {
      console.error("Informe o objetivo da campanha: --campaign \"<objetivo>\".");
      process.exitCode = 1;
      return;
    }
    try {
      const clientIdIndex = args.indexOf("--client-id");
      const clientId = clientIdIndex !== -1 ? args[clientIdIndex + 1] : undefined;
      const durationOption = extractOption(args, "--duration-days");
      const channelsOption = extractOption(args, "--channels");

      const plan = await createCampaign({
        objective,
        clientId,
        durationDays: durationOption.value ? Number(durationOption.value) : undefined,
        channels: channelsOption.value ? channelsOption.value.split(",").map((value) => value.trim()).filter(Boolean) : undefined,
      });
      printCampaignPlan(plan);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (args.includes("--quality-report")) {
    try {
      const clientIdIndex = args.indexOf("--client-id");
      const clientId = clientIdIndex !== -1 ? args[clientIdIndex + 1] : undefined;
      const report = await getQualityFeedbackReport(clientId ? { clientId } : {});
      printQualityFeedbackReport(report);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  const rateIndex = args.indexOf("--rate");
  if (rateIndex !== -1) {
    const executionId = args[rateIndex + 1];
    if (!executionId) {
      console.error("Informe o executionId: --rate <executionId> --stars <1-5> ou --score <1-10>.");
      process.exitCode = 1;
      return;
    }

    try {
      const starsOption = extractOption(args, "--stars");
      const scoreOption = extractOption(args, "--score");
      if (!starsOption.value && !scoreOption.value) {
        throw new Error("Informe --stars <1-5> ou --score <1-10> para avaliar a execução.");
      }
      if (starsOption.value && scoreOption.value) {
        throw new Error("Informe apenas um de --stars ou --score, não os dois.");
      }
      const rating = starsOption.value
        ? { kind: "stars" as const, value: Number(starsOption.value) }
        : { kind: "score" as const, value: Number(scoreOption.value) };

      const needsImprovementOption = extractOption(args, "--needs-improvement");
      const categoriesNeedingImprovement = needsImprovementOption.value
        ? parseCategoriesList(needsImprovementOption.value, "--needs-improvement")
        : undefined;

      const commentOption = extractOption(args, "--comment");
      const campaignIdOption = extractOption(args, "--campaign-id");

      const record = await recordQualityFeedback({
        executionId,
        rating,
        categoriesNeedingImprovement,
        comment: commentOption.value,
        campaignId: campaignIdOption.value,
      });

      console.log(`\nAvaliação registrada para a execução ${record.executionId}.`);
      console.log(`Nota geral (1-10): ${record.overallScore}`);
      if (record.categoriesNeedingImprovement.length > 0) {
        console.log(`Aspectos marcados para melhorar: ${record.categoriesNeedingImprovement.join(", ")}`);
      }
      if (record.comment) console.log(`Comentário: ${record.comment}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (args.includes("--list")) {
    const pending = await listPendingExecutions();
    if (pending.length === 0) {
      console.log("Nenhuma execução aguardando aprovação humana ou geração assistida.");
      return;
    }
    console.log("Execuções aguardando aprovação humana ou geração assistida:");
    for (const executionId of pending) console.log(`  ${executionId}`);
    return;
  }

  const approveIndex = args.indexOf("--approve");
  const rejectIndex = args.indexOf("--reject");
  if (approveIndex !== -1 || rejectIndex !== -1) {
    const flagIndex = approveIndex !== -1 ? approveIndex : rejectIndex;
    const executionId = args[flagIndex + 1];
    if (!executionId) {
      console.error("Informe o executionId: --approve <executionId> ou --reject <executionId>.");
      process.exitCode = 1;
      return;
    }

    const report = await resumeZunoExecution({
      executionId,
      mode,
      assetQualityProfile,
      approval: {
        confirmed: approveIndex !== -1,
        approvedBy: "cli",
        approvedAt: new Date().toISOString(),
      },
    });
    printReport(report);
    return;
  }

  const continueIndex = args.indexOf("--continue");
  if (continueIndex !== -1) {
    const executionId = args[continueIndex + 1];
    if (!executionId) {
      console.error("Informe o executionId: --continue <executionId>.");
      process.exitCode = 1;
      return;
    }

    const report = await continueZunoExecution({ executionId, mode, musicFilePath, assetQualityProfile });
    printReport(report);
    return;
  }

  const clientIdIndex = args.indexOf("--client-id");
  const clientId = clientIdIndex !== -1 ? args[clientIdIndex + 1] : undefined;
  const commandParts = args.filter((value, index) => {
    if (value === "--client-id") return false;
    if (clientIdIndex !== -1 && index === clientIdIndex + 1) return false;
    return true;
  });
  const command = commandParts.join(" ").trim();

  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const report = await runZunoCommand({ command, clientId, mode, musicFilePath, assetQualityProfile });
  printReport(report);
}

/**
 * Todas as flags reconhecidas pela CLI. Usado por `extractOption` para diferenciar "o token
 * seguinte é de fato outra flag" (usuário esqueceu de informar o valor) de "o valor legítimo do
 * usuário apenas começa com --" (ex.: um comentário como "--ótimo trabalho"). Antes, qualquer
 * valor começando com "--" era rejeitado, mesmo sendo um texto válido do usuário.
 */
const KNOWN_CLI_FLAGS = new Set([
  "--approve", "--asset-quality", "--assets-list", "--assets-report", "--assets-scan", "--campaign", "--campaign-generate-plan", "--campaign-id", "--campaign-list",
  "--campaign-mark", "--campaign-show", "--channels", "--client-id", "--comment", "--continue",
  "--duration-days", "--help", "--list", "--mode", "--music", "--needs-improvement", "--quality-report",
  "--rate", "--reason", "--reject", "--score", "--stars",
  "--media-scan", "--media-list", "--media-show", "--media-report", "--media-tag", "--media-approve",
  "--media-reject", "--media-remove", "--media-gap", "--media-collection-create", "--type", "--tags", "--assets",
  "--media-search", "--media-search-video", "--media-acquire", "--media-acquire-for-execution",
  "--media-acquisition-report", "--media-review-pending", "--footage-search-report",
  "--footage-review-list", "--footage-review-show", "--footage-review-approve", "--footage-review-reject",
  "--product-screen-scan", "--product-screen-list", "--product-screen-show", "--product-screen-approve",
  "--product-screen-reject", "--product-screen-report", "--product-compositing-capabilities",
  "--product-compositing-assisted-package", "--product-compositing-compose", "--product-coverage-report",
  "--screen-type", "--timestamps", "--screen-id", "--functionality", "--start", "--end",
  "--placement-mode", "--keyframes",
  "--autonomous", "--autonomous-continue", "--autonomous-dry-run", "--simulate-autonomous", "--coverage-matrix", "--compose-scene",
  "--company-discover", "--company-report", "--company-list", "--company-search", "--company-publish",
  "--company-scope", "--company-max-pages", "--company-delay-ms",
  "--campaign-ingest", "--campaign-workspace", "--campaign-workspace-list", "--campaign-frame-search",
  "--campaign-reuse-check", "--campaign-intelligence-publish",
  "--validate-local-asset", "--validate-local-assets", "--asset-id", "--file-path", "--campaign-id", "--force", "--device",
  "--rerun-asset-resolution",
  "--rebalance-timeline",
]);

function exampleValueFor(flag: string): string {
  switch (flag) {
    case "--mode": return "--mode local-production";
    case "--asset-quality": return `--asset-quality premium (opções: ${ASSET_QUALITY_PROFILES.join(", ")})`;
    case "--music": return "--music \"assets/audio/music/minha-musica.mp3\"";
    case "--reason": return "--reason \"cliente pediu ajuste de tom\"";
    case "--duration-days": return "--duration-days 30";
    case "--channels": return "--channels instagram,facebook";
    case "--stars": return "--stars 5";
    case "--score": return "--score 8";
    case "--needs-improvement": return "--needs-improvement cta,hashtags";
    case "--comment": return "--comment \"legenda podia ser mais direta\"";
    case "--campaign-id": return "--campaign-id campaign-...";
    case "--type": return "--type video";
    case "--tags": return "--tags \"casal,celular,felicidade\"";
    case "--assets": return "--assets id1,id2,id3";
    default: return `${flag} <valor>`;
  }
}

function extractOption(args: string[], flag: string): { value?: string; remaining: string[] } {
  const index = args.indexOf(flag);
  if (index === -1) return { remaining: [...args] };
  const value = args[index + 1];
  if (!value || KNOWN_CLI_FLAGS.has(value)) {
    throw new Error(`Informe o valor de ${flag}. Exemplo: ${exampleValueFor(flag)}.`);
  }
  return {
    value,
    remaining: args.filter((_, currentIndex) => currentIndex !== index && currentIndex !== index + 1),
  };
}

main().catch((error) => {
  console.error("[zuno] Erro inesperado:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
