import type { PreparedCommand } from "../../domain/briefing/briefing.model.js";
import type { ExecutionTask, PlanningArtifact, PlanningArtifactType, PlanningDecision, TaskInputContract, TaskOutputContract, TaskType } from "../../domain/planning/planning.model.js";
import { getPlanningTemplateId } from "./templates.js";
import type { CreativeEngineMode } from "../creative-engine/creative-engine-mode.js";

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
  /** Migração "GPT como motor criativo único" (PR 6/9) — decide qual grafo `content_request`
   * recebe (`content_request-gpt-creative-v3` vs. `-visual-only-v2`, ver `templates.ts`). Default
   * `"legacy"` preserva o comportamento anterior a esta migração para qualquer chamador que ainda
   * não foi atualizado. */
  creativeEngine?: CreativeEngineMode;
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
  const creativeEngine = deps.creativeEngine ?? "legacy";
  const templateId = getPlanningTemplateId(preparedCommand.type, creativeEngine);
  if (!templateId) {
    throw new Error(`PLANNING_TEMPLATE_NOT_FOUND: nenhum template para "${preparedCommand.type}" — o chamador deveria ter checado o ValidationReport antes.`);
  }
  if (preparedCommand.type === "content_request" && creativeEngine === "gpt") {
    return planContentRequestGptCreative(preparedCommand, planningId, templateId, deps);
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
 * Decompõe um `PreparedCommand.type === "content_request"` num pipeline reduzido de 6 tarefas —
 * `content_brief → campaign_structure(João) → copy_generation(Maria) → visual_generation(Sofia+
 * Bianca+Pedro) → quality_review(Lucas) → approval`, sem `research`/`publication`. Antes (v1) só
 * tinha 3 tasks (`content_brief → visual_generation → approval`) e não passava por João/Maria/
 * Lucas de verdade — a raiz do problema de conteúdo genérico/repetitivo diagnosticada na auditoria
 * desta rodada. `visual_generation` depende de `copy_generation` ter terminado (sequencial, não
 * paralelo como em `campaign_creation`) porque Pedro usa `copy.imageHeadline` como texto
 * autorizado da imagem. Sem `distribution` neste grafo — nenhum risco de publicação acidental.
 * `campaign_structure`/`copy_generation` reaproveitam os MESMOS handlers reais já registrados para
 * `campaign_creation` (`build-execution-handler-resolver.ts`) — nenhum handler novo para eles.
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
    "Empacotar objetivo, oferta/assunto, público-alvo e canal informados diretamente pelo usuário — sem pesquisa adicional.",
    "content_brief",
    "document",
    1,
    inputContract([]),
    outputContract([outputPort("structure", "document", "Briefing mínimo (objetivo, oferta/assunto, público-alvo, canal, formato) para orientar a estratégia.")]),
  );

  const campaignStructure = task(
    "campaign_structure",
    "Estratégia de marketing",
    "Classificar o objetivo de marketing e definir ângulo, CTA e creative brief a partir do briefing do usuário (João).",
    "strategic_planning",
    "document",
    2,
    inputContract([inputPort("context", ["document"], true, "Briefing da peça já definido.")]),
    outputContract([outputPort("structure", "document", "Estratégia estruturada (ângulo, CTA, creative brief, briefing para Maria/Sofia).")]),
  );

  const copyGeneration = task(
    "copy_generation",
    "Copy real",
    "Escrever título, headline da imagem, legenda e CTA prontos para postar, alinhados à estratégia (Maria).",
    "copywriting",
    "text",
    3,
    inputContract([inputPort("structure", ["document"], true, "Estratégia já definida.")]),
    outputContract([outputPort("copy", "text", "Título, headline da imagem, legenda e CTA prontos para postar.")]),
  );

  const visualArtifactType = visualArtifactTypeFor(preparedCommand.validatedInputs.contentFormat);
  const visualGeneration = task(
    "visual_generation",
    "Geração visual",
    "Produzir a peça visual a partir da estratégia e da copy real (Sofia → Bianca → Pedro).",
    "visual_design",
    visualArtifactType,
    4,
    inputContract([
      inputPort("structure", ["document"], true, "Estratégia já definida."),
      inputPort("copy", ["text"], true, "Copy real já escrita — fonte do texto autorizado na imagem."),
    ]),
    outputContract([outputPort("visual", visualArtifactType, "Peça visual produzida para o canal informado.")]),
  );

  const qualityReview = task(
    "quality_review",
    "Quality gate",
    "Avaliar a peça (genericidade, repetição, CTA, coerência de marca) antes de apresentar ao usuário (Lucas).",
    "human_review",
    "document",
    5,
    inputContract([
      inputPort("structure", ["document"], true, "Estratégia já definida."),
      inputPort("copy", ["text"], true, "Copy real já escrita."),
      inputPort("visual", ["image", "video", "carousel"], true, "Peça visual produzida."),
    ]),
    outputContract([outputPort("review", "document", "Avaliação de qualidade estruturada (score, status, issues).")]),
  );

  const approval = task(
    "approval",
    "Aprovação",
    "Revisão humana da peça visual gerada — nenhuma publicação acontece neste pipeline.",
    "human_review",
    "document",
    6,
    inputContract([
      inputPort("visual", ["image", "video", "carousel"], true, "Peça visual produzida."),
      inputPort("review", ["document"], true, "Avaliação de qualidade que aprovou a peça."),
    ]),
    outputContract([outputPort("decision", "document", "Registro da decisão de aprovação humana.")]),
  );

  const tasks = [contentBrief, campaignStructure, copyGeneration, visualGeneration, qualityReview, approval];

  const edges: PlannedEdge[] = [
    { fromTaskId: contentBrief.id, toTaskId: campaignStructure.id },
    { fromTaskId: campaignStructure.id, toTaskId: copyGeneration.id },
    { fromTaskId: campaignStructure.id, toTaskId: visualGeneration.id },
    { fromTaskId: copyGeneration.id, toTaskId: visualGeneration.id },
    { fromTaskId: campaignStructure.id, toTaskId: qualityReview.id },
    { fromTaskId: copyGeneration.id, toTaskId: qualityReview.id },
    { fromTaskId: visualGeneration.id, toTaskId: qualityReview.id },
    { fromTaskId: visualGeneration.id, toTaskId: approval.id },
    { fromTaskId: qualityReview.id, toTaskId: approval.id },
  ];

  function artifact(executionTaskId: string, expectedType: PlanningArtifact["contract"]["expectedType"], description: string, expectedFields: readonly string[]): PlanningArtifact {
    return { id: nextId(), planningId, executionTaskId, contract: { expectedType, description, expectedFields }, status: "expected", createdAt };
  }

  const artifacts = [
    artifact(contentBrief.id, "document", "Briefing mínimo (objetivo, oferta/assunto, público-alvo, canal, formato).", ["objective", "channel", "format"]),
    artifact(campaignStructure.id, "document", "Estratégia estruturada (ângulo, CTA, creative brief).", ["angle", "recommendedCta", "creativeBrief"]),
    artifact(copyGeneration.id, "text", "Copy real pronta para postar.", ["title", "imageHeadline", "caption", "cta"]),
    artifact(visualGeneration.id, visualArtifactType, "Peça visual produzida para o canal informado.", ["assetUri", "format", "dimensions"]),
    artifact(qualityReview.id, "document", "Avaliação de qualidade estruturada.", ["reviewStatus", "overallScore"]),
    artifact(approval.id, "document", "Registro da decisão de aprovação humana sobre a peça gerada.", ["decision", "reviewer", "notes"]),
  ];

  function decision(decisionCode: string, reason: string, relatedTaskIds: readonly string[]): PlanningDecision {
    return { id: nextId(), planningId, decisionCode, reason, relatedTaskIds, createdAt };
  }

  const decisions = [
    decision("template_selected", `PreparedCommand.type="${preparedCommand.type}" mapeado para o template "${templateId}" (com estratégia/copy/quality gate reais, sem publicação).`, []),
    decision(
      "visual_artifact_type_selected",
      `Tipo de artefato visual definido como "${visualArtifactType}" a partir de contentFormat="${preparedCommand.validatedInputs.contentFormat ?? "não informado"}".`,
      [visualGeneration.id],
    ),
  ];

  return { planningTemplate: templateId, tasks, edges, artifacts, decisions };
}

/**
 * Decompõe um `PreparedCommand.type === "content_request"` num pipeline de 4 tarefas EXCLUSIVO do
 * motor GPT (migração "GPT como motor criativo único", PR 6/9) — `content_brief →
 * visual_generation → quality_review → approval`. DELIBERADAMENTE sem `strategic_planning`
 * (João) nem `copywriting` (Maria): o motor GPT assume integralmente estratégia, headline, CTA e
 * direção de arte dentro do próprio `creative_plan` (ver `run-gpt-creative-engine.ts`) — não há
 * nó nesta árvore para essas capabilities, prova estrutural (não apenas ausência de chamada) de
 * que João/Maria nunca são agendados quando `creativeEngine === "gpt"`.
 *
 * `visual_generation` e `quality_review` resolvem para os handlers registrados só sob
 * `creativeEngineGptEnabled` (ver `gpt-creative-engine-execution-handlers.ts`/
 * `build-execution-handler-resolver.ts`) — nunca os handlers do motor legado, mesmas capabilities
 * (`visual_design`/`human_review`) reaproveitadas para não exigir migração dos CHECK constraints
 * de `execution_tasks`/`runtime_tasks`/etc.
 */
function planContentRequestGptCreative(preparedCommand: PreparedCommand, planningId: string, templateId: string, deps: ArthurPlannerDeps): ArthurPlanningResult {
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
    "Empacotar objetivo, oferta/assunto, público-alvo, canal e assets reais informados diretamente pelo usuário — sem pesquisa adicional.",
    "content_brief",
    "document",
    1,
    inputContract([]),
    outputContract([outputPort("structure", "document", "Briefing mínimo (objetivo, oferta/assunto, público-alvo, canal, formato, assets) para montar o creative_context.")]),
  );

  const visualArtifactType = visualArtifactTypeFor(preparedCommand.validatedInputs.contentFormat);
  const visualGeneration = task(
    "visual_generation",
    "Motor criativo GPT",
    "GPT assume integralmente estratégia, conceito, headline, CTA e direção de arte a partir do creative_context — produz o creative_plan e a peça final.",
    "visual_design",
    visualArtifactType,
    2,
    inputContract([inputPort("structure", ["document"], true, "Briefing da peça já definido.")]),
    outputContract([outputPort("visual", visualArtifactType, "Peça visual produzida pelo motor GPT para o canal informado.")]),
  );

  const qualityReview = task(
    "quality_review",
    "Quality gate do motor GPT",
    "Avaliar a peça (produto/logo/screenshot corretos, fatos comerciais fiéis, texto legível, composição íntegra) antes de apresentar ao usuário — sem score, só pass/fail.",
    "human_review",
    "document",
    3,
    inputContract([inputPort("visual", ["image", "video", "carousel"], true, "Peça visual produzida pelo motor GPT.")]),
    outputContract([outputPort("review", "document", "Avaliação de qualidade estruturada (verdict, issues).")]),
  );

  const approval = task(
    "approval",
    "Aprovação",
    "Revisão humana da peça visual gerada — nenhuma publicação acontece neste pipeline.",
    "human_review",
    "document",
    4,
    inputContract([
      inputPort("visual", ["image", "video", "carousel"], true, "Peça visual produzida."),
      inputPort("review", ["document"], true, "Avaliação de qualidade que aprovou a peça."),
    ]),
    outputContract([outputPort("decision", "document", "Registro da decisão de aprovação humana.")]),
  );

  const tasks = [contentBrief, visualGeneration, qualityReview, approval];

  const edges: PlannedEdge[] = [
    { fromTaskId: contentBrief.id, toTaskId: visualGeneration.id },
    { fromTaskId: visualGeneration.id, toTaskId: qualityReview.id },
    { fromTaskId: visualGeneration.id, toTaskId: approval.id },
    { fromTaskId: qualityReview.id, toTaskId: approval.id },
  ];

  function artifact(executionTaskId: string, expectedType: PlanningArtifact["contract"]["expectedType"], description: string, expectedFields: readonly string[]): PlanningArtifact {
    return { id: nextId(), planningId, executionTaskId, contract: { expectedType, description, expectedFields }, status: "expected", createdAt };
  }

  const artifacts = [
    artifact(contentBrief.id, "document", "Briefing mínimo (objetivo, oferta/assunto, público-alvo, canal, formato, assets).", ["objective", "channel", "format"]),
    artifact(visualGeneration.id, visualArtifactType, "Peça visual produzida pelo motor GPT.", ["assetUri", "format", "dimensions"]),
    artifact(qualityReview.id, "document", "Avaliação de qualidade estruturada.", ["verdict", "issues"]),
    artifact(approval.id, "document", "Registro da decisão de aprovação humana sobre a peça gerada.", ["decision", "reviewer", "notes"]),
  ];

  function decision(decisionCode: string, reason: string, relatedTaskIds: readonly string[]): PlanningDecision {
    return { id: nextId(), planningId, decisionCode, reason, relatedTaskIds, createdAt };
  }

  const decisions = [
    decision(
      "template_selected",
      `PreparedCommand.type="${preparedCommand.type}" mapeado para o template "${templateId}" (motor GPT — sem nós de strategic_planning/copywriting).`,
      [],
    ),
    decision(
      "creative_engine_selected",
      "engineMode=gpt — GPT assume integralmente estratégia/headline/CTA/direção de arte; motor legado (João/Maria/Bianca/Pedro/Lucas) não participa desta execução.",
      [visualGeneration.id, qualityReview.id],
    ),
    decision(
      "visual_artifact_type_selected",
      `Tipo de artefato visual definido como "${visualArtifactType}" a partir de contentFormat="${preparedCommand.validatedInputs.contentFormat ?? "não informado"}".`,
      [visualGeneration.id],
    ),
  ];

  return { planningTemplate: templateId, tasks, edges, artifacts, decisions };
}
