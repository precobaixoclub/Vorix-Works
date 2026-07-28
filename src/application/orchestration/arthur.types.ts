import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { WorkflowIntent } from "../../domain/workflows/workflow.contract.js";
import type { ExecutionPlan } from "./execution-plan.contract.js";

export type ArthurSupportedChannel =
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

export type ArthurTextCommandInput = {
  command: string;
  locale?: string;
  clientId?: string;
  tenantId?: string;
  dryRun?: boolean;
  constraints?: string[];
  availableSkillIds?: string[];
  availableCapabilities?: SkillCapability[];
  /** Caminho absoluto de uma música local já validada (ex.: pela CLI via `--music`), a ser entregue a Rafa como `localAssets.musicTrackPath` na etapa de renderização de vídeo, quando o plano tiver uma. */
  musicFilePath?: string;
};

export type ArthurInterpretedIntent = {
  intent: WorkflowIntent;
  detectedChannels: ArthurSupportedChannel[];
  detectedAudience?: string;
  requiredCapabilities: SkillCapability[];
  notes: string[];
};

export type ArthurPlanningOutput = {
  interpretedIntent: ArthurInterpretedIntent;
  executionPlan: ExecutionPlan;
};

export type ArthurIdGenerator = {
  create(prefix: string): string;
};
