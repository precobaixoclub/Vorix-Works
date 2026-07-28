import type { SkillManifest } from "./skill-manifest.contract.js";

export type SkillExecutionContext = {
  executionId: string;
  taskId: string;
  correlationId: string;
  locale: string;
  clientId?: string;
  tenantId?: string;
  dryRun: boolean;
  requestedBy: "helena";
  orchestratedBy: "arthur";
  metadata?: Record<string, unknown>;
};

export const SKILL_ARTIFACT_TYPES = ["text", "image", "video", "carousel", "metric", "plan", "file", "unknown"] as const;

export type SkillArtifactType = (typeof SKILL_ARTIFACT_TYPES)[number];

export const SKILL_ARTIFACT_STATUSES = ["ready", "pending", "failed"] as const;

export type SkillArtifactStatus = (typeof SKILL_ARTIFACT_STATUSES)[number];

export type SkillArtifactDimensions = {
  width?: number;
  height?: number;
  aspectRatio?: string;
};

export type SkillArtifactFileInfo = {
  mimeType?: string;
  extension?: string;
  sizeBytes?: number;
  localPath?: string;
};

export type SkillArtifactGenerationInfo = {
  prompt?: string;
  provider?: string;
  model?: string;
  cost?: {
    estimated?: number;
    actual?: number;
    currency?: string;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    units?: number;
  };
  durationMs?: number;
};

/**
 * Campos além de id/type/name/uri/metadata são genéricos e opcionais, reutilizáveis por
 * qualquer Skill que produza arquivos, imagens ou artefatos compostos (ex.: carrossel via
 * `items`) — nenhum campo aqui deve ser exclusivo de uma Skill específica.
 */
export type SkillArtifact = {
  id: string;
  type: SkillArtifactType;
  name: string;
  status?: SkillArtifactStatus;
  uri?: string;
  file?: SkillArtifactFileInfo;
  dimensions?: SkillArtifactDimensions;
  generation?: SkillArtifactGenerationInfo;
  items?: SkillArtifact[];
  metadata?: Record<string, unknown>;
};

export type SkillRequest<TInput = unknown> = {
  skillId: string;
  input: TInput;
  context: SkillExecutionContext;
};

export type SkillResponse<TOutput = unknown> = {
  skillId: string;
  taskId: string;
  /**
   * `needs_assisted_generation`: a Skill não pode completar sozinha porque depende de um
   * artefato que precisa ser produzido por intervenção externa assistida (ex.: Pedro aguardando
   * uma imagem real, ou Rafa aguardando um vídeo real, serem salvos em disco pela IA
   * desenvolvedora — "Developer Assisted Mode"). Não é uma falha: o orquestrador (Caio) deve
   * pausar o workflow e permitir retomada depois que o artefato existir, do mesmo jeito que já
   * faz para `human_gate`.
   *
   * `needs_developer_ai`: variante do mesmo mecanismo para tarefas de texto, estratégia, análise
   * e direção criativa — a Skill depende de `IcaroBrainPort` e, em LOCAL_PRODUCTION, o provider
   * configurado é o `DeveloperAssistedIcaroProvider` (não o `DeterministicFakeIcaroProvider`), que
   * gera um pacote de trabalho estruturado e aguarda a IA desenvolvedora do VS Code salvar a
   * resposta real em disco. Caio pausa em `WAITING_DEVELOPER_AI` em vez de
   * `WAITING_ASSISTED_GENERATION` porque não há nenhum artefato binário envolvido.
   */
  status: "completed" | "failed" | "needs_more_context" | "needs_assisted_generation" | "needs_developer_ai";
  output?: TOutput;
  artifacts: SkillArtifact[];
  warnings: string[];
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
};

export type Skill<TInput = unknown, TOutput = unknown> = {
  manifest: SkillManifest;
  execute(request: SkillRequest<TInput>): Promise<SkillResponse<TOutput>>;
};
