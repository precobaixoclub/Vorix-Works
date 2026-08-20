import { join } from "node:path";
import { DeterministicExecutionTaskHandler } from "../../application/execution/deterministic-handlers.js";
import { ExecutionHandlerRegistry } from "../../application/execution/handler-registry.js";
import { ExecutionHandlerResolver } from "../../application/execution/handler-resolver.js";
import type { ExecutionFeatureFlags } from "../../application/execution/feature-flags.js";
import type { PreparedCommandRepositoryPort } from "../../application/ports/prepared-command-repository.port.js";
import type { RuntimeRepositoryPort } from "../../application/ports/runtime-repository.port.js";
import type { ContentGenerationHistoryPort } from "../../application/ports/content-generation-history.port.js";
import type { QualityFeedbackPort } from "../../application/quality-feedback/quality-feedback.port.js";
import type { ObjectStoragePort } from "../../application/ports/object-storage.port.js";
import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { BrandVisualProfile } from "../../shared/utils/brand-visual-profile.types.js";
import type { OpenAiSemanticOcclusionChecker } from "../ai-providers/openai-semantic-occlusion-checker.js";
import { EXECUTION_CAPABILITIES } from "../../domain/planning/planning.model.js";
import { HelenaSkillManager, SkillManifestValidator, SkillRegistry } from "../../application/skills/index.js";
import { FileSystemSkillDiscovery } from "../skills/file-system-skill-discovery.js";
import { FileSystemSkillModuleLoader } from "../skills/file-system-skill-module-loader.js";
import { ContentBriefExecutionTaskHandler, QualityGateExecutionTaskHandler, SingleSkillExecutionTaskHandler, VisualPipelineExecutionTaskHandler } from "./real-skill-execution-handlers.js";
import { GptCreativeEngineQualityTaskHandler, GptCreativeEngineVisualTaskHandler, type GptCreativeEngineVisualTaskHandlerDeps } from "./gpt-creative-engine-execution-handlers.js";

export async function buildExecutionHandlerResolver(input: {
  featureFlags: ExecutionFeatureFlags;
  skillsRoot?: string;
  runtimeDependencies?: Record<string, unknown>;
  runtimeRepository?: RuntimeRepositoryPort;
  preparedCommandRepository?: PreparedCommandRepositoryPort;
  contentGenerationHistory?: ContentGenerationHistoryPort;
  qualityFeedback?: QualityFeedbackPort;
  clara?: ClaraKnowledgePort;
  objectStorage?: ObjectStoragePort;
  ensureBrandVisualProfile?: (workspaceId: string) => Promise<BrandVisualProfile>;
  semanticOcclusionChecker?: OpenAiSemanticOcclusionChecker;
  /** Migração "GPT como motor criativo único" (PR 6/9) — deps exclusivas do motor GPT (segunda
   * instância do Ícaro, compositores com geometria do plano, renderer de zonas de texto,
   * persistência de `creative_engine_runs`). Só é lido quando `creativeEngineGptEnabled` está
   * ligado; ausente com a flag ligada é um erro de wiring (fail-closed), nunca um fallback
   * silencioso para o motor legado. */
  gptCreativeEngine?: Omit<GptCreativeEngineVisualTaskHandlerDeps, "runtimeRepository" | "preparedCommandRepository">;
}): Promise<ExecutionHandlerResolver> {
  const registry = new ExecutionHandlerRegistry();
  registry.register({
    id: "deterministic-execution-handler",
    provider: "deterministic",
    version: "1",
    priority: 0,
    handler: new DeterministicExecutionTaskHandler(),
    executionModes: ["dry_run"],
    enabled: true,
      supportedCapabilities: EXECUTION_CAPABILITIES,
      fallbackPolicy: "deterministic_fallback",
      sideEffectPolicy: "none",
      retryPolicy: { supportsRetry: true, maxAttempts: 2, backoffStrategy: "fixed" },
      executionTimeoutMs: 5_000,
    });

  if (input.featureFlags.realExecutionEnabled) {
    const helena = new HelenaSkillManager({
      discovery: new FileSystemSkillDiscovery({ rootDirectories: [input.skillsRoot ?? join(process.cwd(), "dist", "skills")] }),
      loader: new FileSystemSkillModuleLoader({ runtimeDependencies: input.runtimeDependencies }),
      validator: new SkillManifestValidator(),
      registry: new SkillRegistry(),
    });
    await helena.discoverAndLoadSkills();

    registry.register(realSingle("helena-skill-research-handler", helena, "editorial_research", "research", "editorial_planning", "context", ["realExecutionEnabled", "realExecutionResearchEnabled"]));

    // Migração "GPT como motor criativo único" (PR 6/9) — os 4 registros a seguir (João/Maria/
    // Sofia+Bianca+Pedro/Lucas) só existem quando `legacyCreativeEngineEnabled` está ligado
    // (construção condicional, não só filtro em tempo de resolução — nunca instanciados quando o
    // motor GPT é o ativo). `requiredFeatureFlags` também carrega a flag como segunda trava
    // (defesa em profundidade, ver `scripts/check-legacy-creative-engine-gating.mjs`).
    if (input.featureFlags.legacyCreativeEngineEnabled) {
      registry.register(realSingle("helena-skill-planning-handler", helena, "strategic_planning", "campaign_structure", "marketing_strategy", "structure", ["realExecutionEnabled", "realPlanningEnabled", "legacyCreativeEngineEnabled"]));
      // 30_000 (o padrão de `realSingle`) achado ao vivo como apertado demais pra copy_generation
      // especificamente (Rodada 2, Fatia 3, Caso B de produção): variância real de latência da
      // OpenAI para completions de texto passa de 30s com alguma frequência, mesmo sem estar "fora
      // do ar" — cada estouro derrubava a execução inteira (Bianca/Pedro nem chegavam a rodar).
      // 60s dá margem real sem mudar o comportamento das outras capabilities que usam `realSingle`.
      registry.register(realSingle("helena-skill-copy-handler", helena, "copywriting", "copy_generation", "copywriting", "copy", ["realExecutionEnabled", "realCopyEnabled", "legacyCreativeEngineEnabled"], 60_000));
      registry.register({
        id: "helena-skill-visual-pipeline-handler",
        provider: "helena",
        version: "1",
        priority: 100,
        handler: new VisualPipelineExecutionTaskHandler({
          helena,
          provider: "helena",
          clara: input.clara,
          objectStorage: input.objectStorage,
          runtimeRepository: input.runtimeRepository,
          preparedCommandRepository: input.preparedCommandRepository,
          ensureBrandVisualProfile: input.ensureBrandVisualProfile,
          semanticOcclusionChecker: input.semanticOcclusionChecker,
        }),
        executionModes: ["real"],
        enabled: true,
        supportedCapabilities: ["visual_design"],
        fallbackPolicy: "fail_closed",
        sideEffectPolicy: "external_write",
        retryPolicy: { supportsRetry: true, maxAttempts: 2, backoffStrategy: "fixed" },
        // Sofia + Bianca são rápidas, mas Pedro chama a OpenAI de verdade (geração de imagem
        // rotineiramente passa de 30s) — precisa cobrir a cadeia inteira, não só o texto.
        executionTimeoutMs: 120_000,
        requiredFeatureFlags: ["realExecutionEnabled", "realVisualEnabled", "legacyCreativeEngineEnabled"],
      });
      registry.register({
        id: "helena-skill-quality-gate-handler",
        // "helena" pelo mesmo motivo de todos os outros handlers reais deste arquivo — único provider
        // que sobrevive ao SideEffectGuard em modo real além de "deterministic".
        provider: "helena",
        version: "1",
        priority: 100,
        handler: new QualityGateExecutionTaskHandler({
          helena,
          provider: "helena",
          contentGenerationHistory: input.contentGenerationHistory,
          runtimeRepository: input.runtimeRepository,
          preparedCommandRepository: input.preparedCommandRepository,
        }),
        executionModes: ["real"],
        enabled: true,
        supportedCapabilities: ["human_review"],
        fallbackPolicy: "fail_closed",
        // Reprovação não é "erro transitório" (Lucas com as mesmas entradas reprova de novo) — sem
        // retry automático aqui; a regeneração de verdade acontece uma execução inteira nova, no
        // caller HTTP (`production.route.ts`), não como retry da mesma task.
        sideEffectPolicy: "external_read",
        retryPolicy: { supportsRetry: false, maxAttempts: 1, backoffStrategy: "none" },
        // Lucas é heurístico e rápido no geral, mas quando há Reference Intelligence disponível faz
        // uma chamada real de visão pra checar fidelidade de produto (`checkProductFidelity`) —
        // precisa de mais fôlego que os 30s antigos (puramente heurísticos, sem nenhuma chamada de
        // IA).
        executionTimeoutMs: 60_000,
        requiredFeatureFlags: ["realExecutionEnabled", "realVisualEnabled", "legacyCreativeEngineEnabled"],
      });
    }

    registry.register(realSingle("helena-skill-distribution-handler", helena, "distribution", "publication", "social_publishing", "manifest", ["realExecutionEnabled", "realDistributionEnabled"]));

    // Migração "GPT como motor criativo único" (PR 6/9) — motor GPT, espelhando exatamente as
    // mesmas capabilities (`visual_design`/`human_review`) que os handlers legados acima, nunca
    // registrado ao mesmo tempo que eles (flags mutuamente exclusivas, ver
    // `creative-engine-mode.ts`). `gptCreativeEngine` ausente com a flag ligada é um erro de
    // wiring — falha alto (`GPT_CREATIVE_ENGINE_DEPS_MISSING`), nunca cai silenciosamente pro
    // motor legado.
    if (input.featureFlags.creativeEngineGptEnabled) {
      if (!input.gptCreativeEngine || !input.runtimeRepository || !input.preparedCommandRepository) {
        throw new Error("GPT_CREATIVE_ENGINE_DEPS_MISSING: creativeEngineGptEnabled=true exige gptCreativeEngine + runtimeRepository + preparedCommandRepository configurados.");
      }
      const gptDeps = { ...input.gptCreativeEngine, runtimeRepository: input.runtimeRepository, preparedCommandRepository: input.preparedCommandRepository };
      registry.register({
        id: "gpt-creative-engine-visual-handler",
        provider: "gpt-creative-engine",
        version: "1",
        priority: 100,
        handler: new GptCreativeEngineVisualTaskHandler(gptDeps),
        executionModes: ["real"],
        enabled: true,
        supportedCapabilities: ["visual_design"],
        fallbackPolicy: "fail_closed",
        sideEffectPolicy: "external_write",
        retryPolicy: { supportsRetry: false, maxAttempts: 1, backoffStrategy: "none" },
        // creative_plan + geração de imagem + Repair Loop (até 2 rodadas, cada uma podendo chamar
        // o modelo de imagem de novo) — mesma ordem de grandeza do handler legado equivalente.
        executionTimeoutMs: 180_000,
        requiredFeatureFlags: ["realExecutionEnabled", "realVisualEnabled", "creativeEngineGptEnabled"],
      });
      registry.register({
        id: "gpt-creative-engine-quality-handler",
        provider: "gpt-creative-engine",
        version: "1",
        priority: 100,
        handler: new GptCreativeEngineQualityTaskHandler({ contentGenerationHistory: input.contentGenerationHistory }),
        executionModes: ["real"],
        enabled: true,
        supportedCapabilities: ["human_review"],
        fallbackPolicy: "fail_closed",
        sideEffectPolicy: "external_read",
        retryPolicy: { supportsRetry: false, maxAttempts: 1, backoffStrategy: "none" },
        executionTimeoutMs: 15_000,
        requiredFeatureFlags: ["realExecutionEnabled", "realVisualEnabled", "creativeEngineGptEnabled"],
      });
    }

    if (input.runtimeRepository && input.preparedCommandRepository) {
      registry.register({
        id: "content-brief-deterministic-handler",
        // "helena" é o único nome que sobrevive aos dois filtros pra um handler REAL: precisa estar
        // na allowlist do SideEffectGuard (`execution-operational-policy.ts` — só "deterministic"/
        // "helena" em qualquer ambiente) E não pode ser "deterministic", que o próprio
        // `ExecutionHandlerResolver.resolve()` filtra fora explicitamente em mode="real" (linha
        // reservada pro fallback determinístico de dry_run). Todo outro handler real deste arquivo
        // (SingleSkillExecutionTaskHandler/VisualPipelineExecutionTaskHandler) já usa "helena" pelo
        // mesmo motivo, mesmo quando — como aqui — não chama nenhuma Skill de verdade.
        provider: "helena",
        version: "1",
        priority: 100,
        handler: new ContentBriefExecutionTaskHandler({
          runtimeRepository: input.runtimeRepository,
          preparedCommandRepository: input.preparedCommandRepository,
          contentGenerationHistory: input.contentGenerationHistory,
          qualityFeedback: input.qualityFeedback,
        }),
        executionModes: ["real"],
        enabled: true,
        supportedCapabilities: ["content_brief"],
        fallbackPolicy: "fail_closed",
        sideEffectPolicy: "external_read",
        retryPolicy: { supportsRetry: true, maxAttempts: 2, backoffStrategy: "fixed" },
        executionTimeoutMs: 5_000,
        requiredFeatureFlags: ["realExecutionEnabled"],
      });
    }
  }

  return new ExecutionHandlerResolver(registry);
}

function realSingle(
  id: string,
  helena: HelenaSkillManager,
  capability: (typeof EXECUTION_CAPABILITIES)[number],
  taskType: "research" | "campaign_structure" | "copy_generation" | "publication",
  skillCapability: string,
  outputPort: string,
  requiredFeatureFlags: readonly (keyof ExecutionFeatureFlags)[],
  executionTimeoutMs = 30_000,
) {
  return {
    id,
    provider: "helena",
    version: "1",
    priority: 100,
    handler: new SingleSkillExecutionTaskHandler({ helena, capability, taskType, skillCapability, outputPort, provider: "helena" }),
    executionModes: ["real"] as const,
    enabled: true,
    supportedCapabilities: [capability],
    fallbackPolicy: "fail_closed" as const,
    sideEffectPolicy: capability === "distribution" ? "publication_preview" as const : "external_read" as const,
    retryPolicy: { supportsRetry: true, maxAttempts: 2, backoffStrategy: "fixed" as const },
    executionTimeoutMs,
    requiredFeatureFlags,
  };
}
