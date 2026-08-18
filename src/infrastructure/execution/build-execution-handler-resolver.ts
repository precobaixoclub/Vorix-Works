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
import { EXECUTION_CAPABILITIES } from "../../domain/planning/planning.model.js";
import { HelenaSkillManager, SkillManifestValidator, SkillRegistry } from "../../application/skills/index.js";
import { FileSystemSkillDiscovery } from "../skills/file-system-skill-discovery.js";
import { FileSystemSkillModuleLoader } from "../skills/file-system-skill-module-loader.js";
import { ContentBriefExecutionTaskHandler, QualityGateExecutionTaskHandler, SingleSkillExecutionTaskHandler, VisualPipelineExecutionTaskHandler } from "./real-skill-execution-handlers.js";

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
    registry.register(realSingle("helena-skill-planning-handler", helena, "strategic_planning", "campaign_structure", "marketing_strategy", "structure", ["realExecutionEnabled", "realPlanningEnabled"]));
    registry.register(realSingle("helena-skill-copy-handler", helena, "copywriting", "copy_generation", "copywriting", "copy", ["realExecutionEnabled", "realCopyEnabled"]));
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
      requiredFeatureFlags: ["realExecutionEnabled", "realVisualEnabled"],
    });
    registry.register(realSingle("helena-skill-distribution-handler", helena, "distribution", "publication", "social_publishing", "manifest", ["realExecutionEnabled", "realDistributionEnabled"]));
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
      requiredFeatureFlags: ["realExecutionEnabled", "realVisualEnabled"],
    });

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
    executionTimeoutMs: 30_000,
    requiredFeatureFlags,
  };
}
