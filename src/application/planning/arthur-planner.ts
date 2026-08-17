import type { PreparedCommand } from "../../domain/briefing/briefing.model.js";
import type { ExecutionTask, PlanningArtifact, PlanningArtifactType, PlanningDecision, TaskInputContract, TaskOutputContract, TaskType } from "../../domain/planning/planning.model.js";
import { getPlanningTemplateId } from "./templates.js";

/** Versão dos contratos de porta emitidos por este Arthur Planner (Sprint 10) — muda só se a
 * FORMA de alguma porta mudar, independente de `PLANNER_VERSION` (que versiona a decomposição em
 * tarefas, não a forma das portas de cada tarefa). */
export const TASK_CONTRACT_VERSION = 1;

/**
 * Arthur Planner — Sprint 09 (Fase 4). Um TERCEIRO componente "Arthur", na mesma linhagem de
 * "Arthur Conversation Decision" (Sprint 06): nome/persona compartilhados, código totalmente
 * independente do `ArthurOrchestrator` legado (`src/application/orchestration/*`) — nunca o
 * importa, nunca é importado por ele.
 *
 * 100% determinístico nesta sprint (decisão obrigatória) — nunca chama o AI Gateway.
 * `campaign_creation` e `content_request` têm template (`templates.ts`); quem chama já garantiu
 * isso via `ValidationReport` antes de chegar aqui. Nunca cita um especialista (Maria/Sofia/
 * Pedro/...) — só `ExecutionCapability`, o vocabulário próprio deste domínio.
 */

export const PLANNER_VERSION = 1;
export const PLANNER_STRATEGY = "deterministic-campaign-creation-v1";
export const GRAPH_VERSION = 1;

export type ArthurPlannerDeps = {
  idGenerator: () => string;
  now?: () => Date;
};

export type PlannedEdge = { fromTaskId: string; toTaskId: string };

export type ArthurPlanningResult = {
  planningTemplate: string;
  tasks: ExecutionTask[];
  edges: readonly PlannedEdge[];
  artifacts: PlanningArtifact[];
  decisions: PlanningDecision[];
};

function visualArtifactTypeFor(contentFormat: string | undefined): "image" | "video" | "carousel" {
  if (contentFormat === "video" || contentFormat === "reel") return "video";
  if (contentFormat === "carousel") return "carousel";
  return "image";
}

/**
 * Decompõe um `PreparedCommand.type === "campaign_creation"` num pipeline fixo de 6 tarefas —
 * mesma estrutura para todo Planning desta sprint (sem variação condicional por canal/formato
 * além do tipo do artefato visual). `research → campaign_structure → {copy_generation,
 * visual_generation} (paralelas) → approval → publication` — demonstra dependência simples,
 * execução paralela genuína (as duas do meio não dependem uma da outra) e um ponto de bloqueio
 * (aprovação), exatamente o pedido da Fase 6.
 */
export function planFromPreparedCommand(preparedCommand: PreparedCommand, planningId: string, deps: ArthurPlannerDeps): ArthurPlanningResult {
  const templateId = getPlanningTemplateId(preparedCommand.type);
  if (!templateId) {
    throw new Error(`PLANNING_TEMPLATE_NOT_FOUND: nenhum template para "${preparedCommand.type}" — o chamador deveria ter checado o ValidationReport antes.`);
  }
  if (preparedCommand.type === "content_request") {
    return planContentRequestVisualOnly(preparedCommand, planningId, templateId, deps);
  }
  return planCampaignCreationPipeline(preparedCommand, planningId, templateId, deps);
}

/**
 * Decompõe um `PreparedCommand.type === "campaign_creation"` num pipeline fixo de 6 tarefas —
 * mesma estrutura para todo Planning desta sprint (sem variação condicional por canal/formato
 * além do tipo do artefato visual). `research → campaign_structure → {copy_generation,
 * visual_generation} (paralelas) → approval → publication` — demonstra dependência simples,
 * execução paralela genuína (as duas do meio não dependem uma da outra) e um ponto de bloqueio
 * (aprovação), exatamente o pedido da Fase 6.
 */
function planCampaignCreationPipeline(preparedCommand: PreparedCommand, planningId: string, templateId: string, deps: ArthurPlannerDeps): ArthurPlanningResult {
  const now = deps.now ?? (() => new Date());
  const createdAt = now().toISOString();
  const nextId = deps.idGenerator;

  function outputContract(ports: TaskOutputContract["ports"]): TaskOutputContract {
    return { version: TASK_CONTRACT_VERSION, ports };
  }
  function inputContract(ports: TaskInputContract["ports"]): TaskInputContract {
    return { version: TASK_CONTRACT_VERSION, ports };
  }
  function outputPort(portKey: string, artifactType: PlanningArtifactType, description: string) {
    return { portKey, artifactType, description };
  }
  function inputPort(portKey: string, acceptedArtifactTypes: readonly PlanningArtifactType[], required: boolean, description: string) {
    return { portKey, acceptedArtifactTypes, required, description };
  }

  function task(
    type: TaskType,
    name: string,
    description: string,
    capability: ExecutionTask["capability"],
    expectedArtifactType: ExecutionTask["expectedArtifactType"],
    sequenceHint: number,
    input: TaskInputContract,
    output: TaskOutputContract,
  ): ExecutionTask {
    return { id: nextId(), planningId, type, name, description, capability, expectedArtifactType, status: "planned", sequenceHint, inputContract: input, outputContract: output, createdAt };
  }

  const research = task(
    "research",
    "Pesquisa de contexto",
    "Reunir e sintetizar o contexto necessário (objetivo, público-alvo, tom, conhecimento já disponível) antes de estruturar a campanha.",
    "editorial_research",
    "document",
    1,
    inputContract([]),
    outputContract([outputPort("context", "document", "Síntese de contexto (objetivo, público, tom) usada para orientar as demais etapas.")]),
  );

  const campaignStructure = task(
    "campaign_structure",
    "Estrutura da campanha",
    "Definir a estrutura da campanha (calendário, cadência, canais) a partir do contexto reunido na pesquisa.",
    "strategic_planning",
    "document",
    2,
    inputContract([inputPort("context", ["document"], true, "Contexto reunido na pesquisa.")]),
    outputContract([outputPort("structure", "document", "Estrutura da campanha (calendário, cadência, formatos por canal).")]),
  );

  const copyGeneration = task(
    "copy_generation",
    "Geração de texto",
    "Produzir o texto principal da campanha (título, corpo, chamada para ação) alinhado à estrutura definida.",
    "copywriting",
    "text",
    3,
    inputContract([inputPort("structure", ["document"], true, "Estrutura da campanha já definida.")]),
    outputContract([outputPort("copy", "text", "Texto principal da campanha.")]),
  );

  const visualArtifactType = visualArtifactTypeFor(preparedCommand.validatedInputs.contentFormat);
  const visualGeneration = task(
    "visual_generation",
    "Geração visual",
    "Produzir a peça visual principal da campanha para o canal informado.",
    "visual_design",
    visualArtifactType,
    3,
    inputContract([inputPort("structure", ["document"], true, "Estrutura da campanha já definida.")]),
    outputContract([outputPort("visual", visualArtifactType, "Peça visual principal para o canal informado.")]),
  );

  const approval = task(
    "approval",
    "Aprovação",
    "Revisão humana dos artefatos de texto e visual antes de qualquer publicação.",
    "human_review",
    "document",
    4,
    inputContract([
      inputPort("copy", ["text"], true, "Texto principal produzido para a campanha."),
      inputPort("visual", ["image", "video", "carousel"], true, "Peça visual produzida para a campanha."),
    ]),
    outputContract([outputPort("decision", "document", "Registro da decisão de aprovação humana.")]),
  );

  const publication = task(
    "publication",
    "Publicação",
    "Preparar o manifesto de publicação (quando e onde os artefatos aprovados seriam publicados).",
    "distribution",
    "document",
    5,
    inputContract([inputPort("decision", ["document"], true, "Registro da decisão de aprovação.")]),
    outputContract([outputPort("manifest", "document", "Manifesto de publicação (quando/onde os artefatos aprovados seriam publicados).")]),
  );

  const tasks = [research, campaignStructure, copyGeneration, visualGeneration, approval, publication];

  const edges: PlannedEdge[] = [
    { fromTaskId: research.id, toTaskId: campaignStructure.id },
    { fromTaskId: campaignStructure.id, toTaskId: copyGeneration.id },
    { fromTaskId: campaignStructure.id, toTaskId: visualGeneration.id },
    { fromTaskId: copyGeneration.id, toTaskId: approval.id },
    { fromTaskId: visualGeneration.id, toTaskId: approval.id },
    { fromTaskId: approval.id, toTaskId: publication.id },
  ];

  function artifact(executionTaskId: string, expectedType: PlanningArtifact["contract"]["expectedType"], description: string, expectedFields: readonly string[]): PlanningArtifact {
    return { id: nextId(), planningId, executionTaskId, contract: { expectedType, description, expectedFields }, status: "expected", createdAt };
  }

  const artifacts = [
    artifact(research.id, "document", "Síntese de contexto (objetivo, público, tom) usada para orientar as demais etapas.", ["summary", "keyInsights"]),
    artifact(campaignStructure.id, "document", "Estrutura da campanha (calendário, cadência, formatos por canal).", ["calendar", "channels"]),
    artifact(copyGeneration.id, "text", "Texto principal da campanha.", ["headline", "body", "callToAction"]),
    artifact(visualGeneration.id, visualArtifactType, "Peça visual principal para o canal informado.", ["assetUri", "format", "dimensions"]),
    artifact(approval.id, "document", "Registro da decisão de aprovação humana sobre os artefatos gerados.", ["decision", "reviewer", "notes"]),
    artifact(publication.id, "document", "Manifesto de publicação (quando/onde os artefatos aprovados seriam publicados).", ["schedule", "destinations"]),
  ];

  function decision(decisionCode: string, reason: string, relatedTaskIds: readonly string[]): PlanningDecision {
    return { id: nextId(), planningId, decisionCode, reason, relatedTaskIds, createdAt };
  }

  const decisions = [
    decision("template_selected", `PreparedCommand.type="${preparedCommand.type}" mapeado para o template "${templateId}".`, []),
    decision(
      "visual_artifact_type_selected",
      `Tipo de artefato visual definido como "${visualArtifactType}" a partir de contentFormat="${preparedCommand.validatedInputs.contentFormat ?? "não informado"}".`,
      [visualGeneration.id],
    ),
    decision(
      "parallel_tracks_identified",
      "copy_generation e visual_generation não dependem uma da outra — podem ser tratadas em paralelo quando execução real existir (nenhuma execução acontece nesta sprint).",
      [copyGeneration.id, visualGeneration.id],
    ),
  ];

  return { planningTemplate: templateId, tasks, edges, artifacts, decisions };
}

/**
 * Decompõe um `PreparedCommand.type === "content_request"` num pipeline reduzido de 3 tarefas —
 * `content_brief → visual_generation → approval`, sem `research`/`campaign_structure`/
 * `copy_generation`/`publication`. Existe para gerar uma peça visual real a partir de uma ideia do
 * tanque de Produção sem nenhum risco de publicação acidental (nenhuma tarefa `distribution` neste
 * grafo) e sem depender de flags reais além de `REAL_EXECUTION_ENABLED`/`REAL_VISUAL_ENABLED` (já
 * ligadas em produção) — `content_brief` nunca chama IA nem exige flag própria, só empacota
 * `PreparedCommand.validatedInputs` (ver `ContentBriefExecutionTaskHandler`,
 * `real-skill-execution-handlers.ts`) na mesma forma de "structure" que `campaign_structure`
 * produz, para que `VisualPipelineExecutionTaskHandler` funcione idêntico nos dois pipelines.
 */
function planContentRequestVisualOnly(preparedCommand: PreparedCommand, planningId: string, templateId: string, deps: ArthurPlannerDeps): ArthurPlanningResult {
  const now = deps.now ?? (() => new Date());
  const createdAt = now().toISOString();
  const nextId = deps.idGenerator;

  function outputContract(ports: TaskOutputContract["ports"]): TaskOutputContract {
    return { version: TASK_CONTRACT_VERSION, ports };
  }
  function inputContract(ports: TaskInputContract["ports"]): TaskInputContract {
    return { version: TASK_CONTRACT_VERSION, ports };
  }
  function outputPort(portKey: string, artifactType: PlanningArtifactType, description: string) {
    return { portKey, artifactType, description };
  }
  function inputPort(portKey: string, acceptedArtifactTypes: readonly PlanningArtifactType[], required: boolean, description: string) {
    return { portKey, acceptedArtifactTypes, required, description };
  }

  function task(
    type: TaskType,
    name: string,
    description: string,
    capability: ExecutionTask["capability"],
    expectedArtifactType: ExecutionTask["expectedArtifactType"],
    sequenceHint: number,
    input: TaskInputContract,
    output: TaskOutputContract,
  ): ExecutionTask {
    return { id: nextId(), planningId, type, name, description, capability, expectedArtifactType, status: "planned", sequenceHint, inputContract: input, outputContract: output, createdAt };
  }

  const contentBrief = task(
    "content_brief",
    "Briefing da peça",
    "Empacotar objetivo, oferta/assunto, público-alvo e canal informados diretamente pelo usuário — sem pesquisa nem estratégia adicional.",
    "content_brief",
    "document",
    1,
    inputContract([]),
    outputContract([outputPort("structure", "document", "Briefing mínimo (objetivo, oferta/assunto, público-alvo, canal, formato) para orientar a geração visual.")]),
  );

  const visualArtifactType = visualArtifactTypeFor(preparedCommand.validatedInputs.contentFormat);
  const visualGeneration = task(
    "visual_generation",
    "Geração visual",
    "Produzir a peça visual a partir do briefing informado pelo usuário.",
    "visual_design",
    visualArtifactType,
    2,
    inputContract([inputPort("structure", ["document"], true, "Briefing da peça já definido.")]),
    outputContract([outputPort("visual", visualArtifactType, "Peça visual produzida para o canal informado.")]),
  );

  const approval = task(
    "approval",
    "Aprovação",
    "Revisão humana da peça visual gerada — nenhuma publicação acontece neste pipeline.",
    "human_review",
    "document",
    3,
    inputContract([inputPort("visual", ["image", "video", "carousel"], true, "Peça visual produzida.")]),
    outputContract([outputPort("decision", "document", "Registro da decisão de aprovação humana.")]),
  );

  const tasks = [contentBrief, visualGeneration, approval];

  const edges: PlannedEdge[] = [
    { fromTaskId: contentBrief.id, toTaskId: visualGeneration.id },
    { fromTaskId: visualGeneration.id, toTaskId: approval.id },
  ];

  function artifact(executionTaskId: string, expectedType: PlanningArtifact["contract"]["expectedType"], description: string, expectedFields: readonly string[]): PlanningArtifact {
    return { id: nextId(), planningId, executionTaskId, contract: { expectedType, description, expectedFields }, status: "expected", createdAt };
  }

  const artifacts = [
    artifact(contentBrief.id, "document", "Briefing mínimo (objetivo, oferta/assunto, público-alvo, canal, formato).", ["objective", "channel", "format"]),
    artifact(visualGeneration.id, visualArtifactType, "Peça visual produzida para o canal informado.", ["assetUri", "format", "dimensions"]),
    artifact(approval.id, "document", "Registro da decisão de aprovação humana sobre a peça gerada.", ["decision", "reviewer", "notes"]),
  ];

  function decision(decisionCode: string, reason: string, relatedTaskIds: readonly string[]): PlanningDecision {
    return { id: nextId(), planningId, decisionCode, reason, relatedTaskIds, createdAt };
  }

  const decisions = [
    decision("template_selected", `PreparedCommand.type="${preparedCommand.type}" mapeado para o template reduzido "${templateId}" (sem publicação).`, []),
    decision(
      "visual_artifact_type_selected",
      `Tipo de artefato visual definido como "${visualArtifactType}" a partir de contentFormat="${preparedCommand.validatedInputs.contentFormat ?? "não informado"}".`,
      [visualGeneration.id],
    ),
  ];

  return { planningTemplate: templateId, tasks, edges, artifacts, decisions };
}
