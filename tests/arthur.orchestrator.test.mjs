import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ArthurOrchestrator } from "../dist/application/orchestration/arthur.orchestrator.js";
import { InMemoryArthurDecisionLogger } from "../dist/infrastructure/telemetry/in-memory-arthur-decision-logger.js";
import {
  classifyContentObjective,
  classifyRecommendedFormat,
  pipelineForRecommendedFormat,
} from "../dist/shared/utils/content-format-classification.js";
import { normalize } from "../dist/shared/utils/skill-parsing.js";

function createDeterministicIdGenerator() {
  let nextNumber = 1;
  return {
    create(prefix) {
      const id = `${prefix}-${String(nextNumber).padStart(4, "0")}`;
      nextNumber += 1;
      return id;
    },
  };
}

test("Arthur cria plano estruturado para Instagram e Facebook sem executar Skills", async () => {
  const logger = new InMemoryArthurDecisionLogger();
  const arthur = new ArthurOrchestrator({
    logger,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  const result = await arthur.planFromText({
    command: "Quero criar uma publicação para Instagram e Facebook sobre o Rumo ao Altar, explicando que os convidados podem enviar presentes via PIX direto para os noivos.",
    clientId: "client-rumo",
    dryRun: true,
  });

  assert.equal(result.executionPlan.createdBy, "arthur");
  assert.equal(result.executionPlan.tenant.clientId, "client-rumo");
  assert.deepEqual(result.interpretedIntent.detectedChannels, ["instagram", "facebook"]);
  assert.equal(result.interpretedIntent.detectedAudience, "convidados");

  const stepNames = result.executionPlan.steps.map((step) => step.name);
  assert.deepEqual(stepNames, [
    "Planejamento editorial",
    "Estratégia de marketing",
    "Criação da copy",
    "Direção de arte",
    "Design de redes sociais",
    "Geração de imagem",
    "Revisão",
    "Aprovação",
  ]);

  const editorialPlanningStep = result.executionPlan.steps.find((step) => step.name === "Planejamento editorial");
  assert.equal(editorialPlanningStep.order, 1);
  assert.equal(editorialPlanningStep.skillCapability, "editorial_planning");
  assert.deepEqual(editorialPlanningStep.dependsOn, []);

  const strategyStep = result.executionPlan.steps.find((step) => step.name === "Estratégia de marketing");
  assert.deepEqual(strategyStep.dependsOn, [editorialPlanningStep.id]);
  assert.ok(strategyStep.inputBindings.some((binding) => binding.targetField === "editorialBrief" && binding.fromStepId === editorialPlanningStep.id));
  assert.ok(
    strategyStep.inputBindings.some(
      (binding) => binding.targetField === "desiredFormat" && binding.fromStepId === editorialPlanningStep.id && binding.sourcePath === "recommendedFormatLabel",
    ),
  );

  assert.equal(result.executionPlan.steps.find((step) => step.name === "Aprovação").type, "human_gate");
  assert.equal(result.executionPlan.steps.find((step) => step.name === "Design de redes sociais").skillCapability, "social_media_design");
  assert.deepEqual(
    result.executionPlan.steps.find((step) => step.name === "Design de redes sociais").dependsOn,
    [result.executionPlan.steps.find((step) => step.name === "Direção de arte").id],
  );
  assert.deepEqual(
    result.executionPlan.steps.find((step) => step.name === "Geração de imagem").dependsOn,
    [result.executionPlan.steps.find((step) => step.name === "Design de redes sociais").id],
  );
  assert.equal(result.executionPlan.steps.some((step) => step.skillCapability === "social_publishing"), false);

  const logs = logger.list();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].planId, result.executionPlan.id);
  assert.deepEqual(logs[0].detectedChannels, ["instagram", "facebook"]);
  assert.equal(logs[0].stepCount, 8);
});

test("Arthur inclui Ana somente quando o comando pede publicação explicitamente", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Crie um post para Instagram e Facebook sobre taxa zero e publique depois da aprovação.",
    clientId: "client-rumo",
  });

  const publishingStep = result.executionPlan.steps.find((step) => step.skillCapability === "social_publishing");
  assert.ok(publishingStep);
  assert.equal(publishingStep.name, "Publicação Meta");
  assert.match(publishingStep.instructions, /Arthur não publica/);
});

test("Arthur respeita negação explícita e não inclui Ana quando o comando diz para não publicar", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Crie um Reels premium para Instagram sobre o Rumo ao Altar. Não publique.",
    clientId: "client-rumo",
  });

  const capabilities = result.executionPlan.steps
    .map((step) => step.skillCapability)
    .filter(Boolean);

  assert.equal(capabilities.includes("video_narration"), true);
  assert.equal(capabilities.includes("video_rendering"), true);
  assert.equal(capabilities.includes("social_publishing"), false);
});

test("Arthur adiciona campanha e métricas quando a intenção pede essas capacidades, e NÃO cria uma capability separada para carrossel", async () => {
  const logger = new InMemoryArthurDecisionLogger();
  const arthur = new ArthurOrchestrator({
    logger,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  const result = await arthur.planFromText({
    command: "Criar carrossel para LinkedIn, campanha Meta Ads e depois analisar métricas para sugerir melhorias.",
    clientId: "client-rumo",
  });

  const capabilities = result.executionPlan.steps
    .map((step) => step.skillCapability)
    .filter(Boolean);

  // Carrossel não é uma capability separada: só existe uma etapa de image_generation, cujo
  // imageCount final é decidido pelo Eduardo (Editorial Brief) e resolvido em runtime por
  // inputBinding — Arthur só planeja um valor neutro de fallback (1).
  assert.equal(capabilities.includes("carousel_creation"), false);
  assert.equal(capabilities.filter((capability) => capability === "image_generation").length, 1);
  const imageStep = result.executionPlan.steps.find((step) => step.skillCapability === "image_generation");
  assert.equal(imageStep.input.imageCount, 1);
  const editorialPlanningStepId = result.executionPlan.steps.find((step) => step.skillCapability === "editorial_planning").id;
  assert.ok(
    imageStep.inputBindings.some(
      (binding) => binding.targetField === "imageCount" && binding.fromStepId === editorialPlanningStepId && binding.sourcePath === "recommendedSlideCount",
    ),
  );

  // Regressão do BUG-06: proporção/resolução não são mais um valor estático de Arthur — a etapa
  // de Geração de imagem precisa receber `desiredAspectRatio` da mesma etapa de Design de redes
  // sociais (Bianca) de onde já vêm `biancaDesign`/`biancaPedroBriefing`, e Bianca só repassa o
  // valor decidido por Sofia (`recommendedAspectRatio`), a autoridade única do workflow.
  const socialMediaDesignStepId = result.executionPlan.steps.find((step) => step.skillCapability === "social_media_design").id;
  assert.ok(
    imageStep.inputBindings.some(
      (binding) => binding.targetField === "desiredAspectRatio" && binding.fromStepId === socialMediaDesignStepId && binding.sourcePath === "recommendedAspectRatio",
    ),
  );

  assert.ok(capabilities.includes("social_media_design"));
  assert.ok(capabilities.includes("campaign_management"));
  assert.ok(capabilities.includes("metrics_analysis"));
  assert.ok(capabilities.includes("optimization"));
  assert.equal(logger.list().length, 1);
});

test("Arthur não decide mais formato/imageCount a partir do texto: a etapa de Planejamento editorial (Eduardo) é sempre a primeira e alimenta Estratégia e Geração de imagem por inputBinding", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Crie 3 imagens para o Instagram do Rumo ao Altar sobre taxa zero na lista de presentes.",
    clientId: "client-rumo",
  });

  const steps = result.executionPlan.steps;
  assert.equal(steps[0].name, "Planejamento editorial");
  assert.equal(steps[0].skillCapability, "editorial_planning");

  const imageStep = steps.find((step) => step.skillCapability === "image_generation");
  // Valor neutro de fallback: a quantidade real só existe depois que o Eduardo executa.
  assert.equal(imageStep.input.imageCount, 1);
  assert.equal(
    result.executionPlan.steps.some((step) => step.skillCapability === "carousel_creation"),
    false,
  );
});

test("Arthur inclui o Planejamento editorial (Eduardo) como primeira etapa mesmo na pipeline de vídeo, antes do Roteiro de vídeo", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Crie um roteiro de vídeo curto sobre taxa zero na lista de presentes.",
    clientId: "client-rumo",
  });

  const steps = result.executionPlan.steps;
  assert.equal(steps[0].name, "Planejamento editorial");
  assert.equal(steps[0].skillCapability, "editorial_planning");
  assert.deepEqual(steps[0].dependsOn, []);

  const scriptStep = steps.find((step) => step.skillCapability === "video_script");
  assert.ok(scriptStep.inputBindings.some((binding) => binding.targetField === "workflowContext.editorialBrief" && binding.fromStepId === steps[0].id));
});

test("Arthur mantém imageCount=1 para um post único, sem menção a carrossel/slides", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Crie um post para o Instagram do Rumo ao Altar sobre taxa zero na lista de presentes.",
    clientId: "client-rumo",
  });

  const imageStep = result.executionPlan.steps.find((step) => step.skillCapability === "image_generation");
  assert.equal(imageStep.input.imageCount, 1);
  assert.equal(imageStep.input.format, "post único");
});

test("Arthur reconhece a capability video_script e adiciona a etapa 'Roteiro de vídeo' quando o comando pede um roteiro, sem acionar a pipeline de imagens", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Crie um roteiro de vídeo curto sobre taxa zero na lista de presentes.",
    clientId: "client-rumo",
  });

  const capabilities = result.executionPlan.steps.map((step) => step.skillCapability).filter(Boolean);
  assert.ok(capabilities.includes("video_script"));
  assert.equal(capabilities.includes("art_direction"), false);
  assert.equal(capabilities.includes("social_media_design"), false);
  assert.equal(capabilities.includes("image_generation"), false);

  const scriptStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_script");
  assert.equal(scriptStep.name, "Roteiro de vídeo");
  assert.equal(scriptStep.type, "skill");
  const strategyStepId = result.executionPlan.steps.find((step) => step.skillCapability === "strategy").id;
  assert.deepEqual(scriptStep.dependsOn, [strategyStepId]);
  assert.ok(scriptStep.inputBindings.some((binding) => binding.targetField === "joaoStrategy" && binding.fromStepId === strategyStepId));
  assert.equal(scriptStep.input.videoObjective, result.interpretedIntent.intent.objective);
});

test("Arthur entende pedido natural de vídeo para Reels sem acionar a pipeline de imagens nem Ana", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Crie um vídeo para Reels de 30 segundos sobre RSVP do Rumo ao Altar.",
    clientId: "client-rumo",
  });

  const capabilities = result.executionPlan.steps.map((step) => step.skillCapability).filter(Boolean);
  assert.ok(capabilities.includes("video_script"));
  assert.ok(capabilities.includes("video_direction"));
  assert.ok(capabilities.includes("video_editing"));
  assert.ok(capabilities.includes("video_narration"));
  assert.ok(capabilities.includes("video_rendering"));
  assert.equal(capabilities.includes("art_direction"), false);
  assert.equal(capabilities.includes("social_media_design"), false);
  assert.equal(capabilities.includes("image_generation"), false);
  assert.equal(capabilities.includes("social_publishing"), false);

  const renderingStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_rendering");
  assert.equal(renderingStep.input.format, "reels");
});

test("Arthur encadeia video_direction em cascata sempre que video_script é necessária, com a etapa 'Direção de vídeo' dependendo do Roteiro de vídeo", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Crie um roteiro de vídeo curto sobre taxa zero na lista de presentes.",
    clientId: "client-rumo",
  });

  const capabilities = result.executionPlan.steps.map((step) => step.skillCapability).filter(Boolean);
  assert.ok(capabilities.includes("video_direction"));

  const scriptStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_script");
  const directionStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_direction");
  assert.equal(directionStep.name, "Direção de vídeo");
  assert.equal(directionStep.type, "skill");
  assert.deepEqual(directionStep.dependsOn, [scriptStep.id]);
  assert.ok(directionStep.inputBindings.some((binding) => binding.targetField === "joaoStrategy"));
  assert.ok(
    directionStep.inputBindings.some(
      (binding) => binding.targetField === "brunoScript" && binding.fromStepId === scriptStep.id && binding.sourcePath === "vanessaBriefing",
    ),
  );

  // A etapa de direção de vídeo não deve alimentar Revisão nem Aprovação: Lucas ainda não sabe
  // revisar direção audiovisual, e a pipeline de vídeo para em Vanessa nesta fase.
  const reviewStep = result.executionPlan.steps.find((step) => step.skillCapability === "quality_review");
  assert.equal(reviewStep.dependsOn.includes(directionStep.id), false);
});

test("Arthur encadeia video_editing em cascata sempre que video_direction é necessária, com a etapa 'Edição de vídeo' dependendo da Direção de vídeo", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Crie um roteiro de vídeo curto sobre taxa zero na lista de presentes.",
    clientId: "client-rumo",
  });

  const capabilities = result.executionPlan.steps.map((step) => step.skillCapability).filter(Boolean);
  assert.ok(capabilities.includes("video_editing"));

  const scriptStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_script");
  const directionStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_direction");
  const editingStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_editing");
  assert.equal(editingStep.name, "Edição de vídeo");
  assert.equal(editingStep.type, "skill");
  assert.deepEqual(editingStep.dependsOn, [directionStep.id]);
  assert.ok(editingStep.inputBindings.some((binding) => binding.targetField === "joaoStrategy"));
  assert.ok(
    editingStep.inputBindings.some(
      (binding) => binding.targetField === "brunoScript" && binding.fromStepId === scriptStep.id && binding.sourcePath === "vanessaBriefing",
    ),
  );
  assert.ok(
    editingStep.inputBindings.some(
      (binding) => binding.targetField === "vanessaDirection" && binding.fromStepId === directionStep.id && binding.sourcePath === "diegoBriefing",
    ),
  );

  // A etapa de edição de vídeo não deve alimentar Revisão nem Aprovação: Lucas ainda não sabe
  // revisar plano de edição, e a pipeline de vídeo para em Diego nesta fase.
  const reviewStep = result.executionPlan.steps.find((step) => step.skillCapability === "quality_review");
  assert.equal(reviewStep.dependsOn.includes(editingStep.id), false);
});

test("Arthur encadeia video_narration entre Diego e Rafa sempre que video_editing é necessária", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Crie um roteiro de vídeo curto sobre taxa zero na lista de presentes.",
    clientId: "client-rumo",
  });

  const capabilities = result.executionPlan.steps.map((step) => step.skillCapability).filter(Boolean);
  assert.ok(capabilities.includes("video_narration"));
  assert.ok(capabilities.includes("video_rendering"));

  const scriptStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_script");
  const directionStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_direction");
  const editingStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_editing");
  const narrationStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_narration");
  const renderingStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_rendering");
  assert.equal(narrationStep.name, "Narração de vídeo");
  assert.equal(narrationStep.type, "skill");
  assert.deepEqual(narrationStep.dependsOn, [editingStep.id]);
  assert.ok(narrationStep.inputBindings.some((binding) => binding.targetField === "joaoStrategy"));
  assert.ok(
    narrationStep.inputBindings.some(
      (binding) => binding.targetField === "brunoScript" && binding.fromStepId === scriptStep.id && binding.sourcePath === "vanessaBriefing",
    ),
  );
  assert.ok(
    narrationStep.inputBindings.some(
      (binding) => binding.targetField === "vanessaDirection" && binding.fromStepId === directionStep.id && binding.sourcePath === "diegoBriefing",
    ),
  );
  assert.ok(
    narrationStep.inputBindings.some(
      (binding) => binding.targetField === "diegoEditingPlan" && binding.fromStepId === editingStep.id && binding.sourcePath === "rafaBriefing",
    ),
  );

  assert.equal(renderingStep.name, "Renderização de vídeo");
  assert.equal(renderingStep.type, "skill");
  assert.deepEqual(renderingStep.dependsOn, [narrationStep.id]);
  assert.ok(renderingStep.inputBindings.some((binding) => binding.targetField === "joaoStrategy"));
  assert.ok(
    renderingStep.inputBindings.some(
      (binding) => binding.targetField === "brunoScript" && binding.fromStepId === scriptStep.id && binding.sourcePath === "vanessaBriefing",
    ),
  );
  assert.ok(
    renderingStep.inputBindings.some(
      (binding) => binding.targetField === "vanessaDirection" && binding.fromStepId === directionStep.id && binding.sourcePath === "diegoBriefing",
    ),
  );
  assert.ok(
    renderingStep.inputBindings.some(
      (binding) => binding.targetField === "diegoEditingPlan" && binding.fromStepId === editingStep.id && binding.sourcePath === "rafaBriefing",
    ),
  );
  assert.ok(
    renderingStep.inputBindings.some(
      (binding) => binding.targetField === "noraNarration" && binding.fromStepId === narrationStep.id && binding.sourcePath === "rafaBriefing",
    ),
  );

  // A etapa de renderização de vídeo alimenta a Revisão; Nora entra antes do Rafa e também envia
  // o plano/arquivo de voz para Lucas validar sincronização e mixagem.
  const reviewStep = result.executionPlan.steps.find((step) => step.skillCapability === "quality_review");
  assert.ok(reviewStep.dependsOn.includes(renderingStep.id));
});

test("Arthur conecta a pipeline de vídeo à etapa de Revisão: Revisão depende da Renderização de vídeo e recebe roteiro/direção/edição/vídeo por inputBinding", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Crie um roteiro de vídeo curto sobre taxa zero na lista de presentes.",
    clientId: "client-rumo",
  });

  const scriptStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_script");
  const directionStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_direction");
  const editingStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_editing");
  const narrationStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_narration");
  const renderingStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_rendering");
  const reviewStep = result.executionPlan.steps.find((step) => step.skillCapability === "quality_review");

  assert.ok(reviewStep.dependsOn.includes(renderingStep.id));
  assert.ok(reviewStep.inputBindings.some((binding) => binding.targetField === "brunoScript" && binding.fromStepId === scriptStep.id && binding.sourcePath === "vanessaBriefing"));
  assert.ok(reviewStep.inputBindings.some((binding) => binding.targetField === "vanessaDirection" && binding.fromStepId === directionStep.id && binding.sourcePath === "diegoBriefing"));
  assert.ok(reviewStep.inputBindings.some((binding) => binding.targetField === "diegoEditingPlan" && binding.fromStepId === editingStep.id && binding.sourcePath === "rafaBriefing"));
  assert.ok(reviewStep.inputBindings.some((binding) => binding.targetField === "noraNarration" && binding.fromStepId === narrationStep.id && binding.sourcePath === "rafaBriefing"));
  assert.ok(reviewStep.inputBindings.some((binding) => binding.targetField === "rafaVideo" && binding.fromStepId === renderingStep.id && binding.sourcePath === "video"));
});

test("Arthur não adiciona bindings de vídeo à Revisão quando o comando não menciona roteiro (sem regressão na pipeline de imagens)", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Quero criar uma publicação para Instagram e Facebook sobre o Rumo ao Altar.",
    clientId: "client-rumo",
  });

  const reviewStep = result.executionPlan.steps.find((step) => step.skillCapability === "quality_review");
  assert.equal(reviewStep.inputBindings.some((binding) => binding.targetField === "brunoScript"), false);
  assert.equal(reviewStep.inputBindings.some((binding) => binding.targetField === "vanessaDirection"), false);
  assert.equal(reviewStep.inputBindings.some((binding) => binding.targetField === "diegoEditingPlan"), false);
  assert.equal(reviewStep.inputBindings.some((binding) => binding.targetField === "rafaVideo"), false);
});

test("Arthur não adiciona as etapas de vídeo quando o comando não menciona roteiro", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Quero criar uma publicação para Instagram e Facebook sobre o Rumo ao Altar.",
    clientId: "client-rumo",
  });

  const capabilities = result.executionPlan.steps.map((step) => step.skillCapability).filter(Boolean);
  assert.equal(capabilities.includes("video_script"), false);
  assert.equal(capabilities.includes("video_direction"), false);
  assert.equal(capabilities.includes("video_editing"), false);
  assert.equal(capabilities.includes("video_rendering"), false);
  assert.equal(result.executionPlan.steps.some((step) => step.name === "Roteiro de vídeo"), false);
  assert.equal(result.executionPlan.steps.some((step) => step.name === "Direção de vídeo"), false);
  assert.equal(result.executionPlan.steps.some((step) => step.name === "Edição de vídeo"), false);
  assert.equal(result.executionPlan.steps.some((step) => step.name === "Renderização de vídeo"), false);
});

test("Arthur rejeita comando vazio", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  await assert.rejects(
    () => arthur.planFromText({ command: "   ", clientId: "client-rumo" }),
    /comando em texto/,
  );
});

test("Arthur rejeita workflow sem cliente", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  await assert.rejects(
    () => arthur.planFromText({ command: "Criar publicação para Instagram." }),
    /clientId ou tenantId/,
  );
});

// ---------------------------------------------------------------------------------------------
// Correção de divergência Eduardo/Arthur: Eduardo passa a ser a única autoridade sobre o formato
// da peça — o ExecutionPlan é montado a partir da mesma classificação que o Eduardo usa
// (`src/shared/utils/content-format-classification.ts`), nunca mais de uma lista de palavras
// própria de Arthur. Os dois cenários abaixo são os achados reais da validação de criatividade
// (docs de sessão anterior) que expuseram a divergência.
// ---------------------------------------------------------------------------------------------

test("Regressão (achado 'Site'): Eduardo recomenda reels para demonstração de funcionalidade sem a palavra 'vídeo' — Arthur agora constrói a pipeline de vídeo, não a de imagem", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });
  const command = "crie um post mostrando como funciona o site de casamento do Rumo ao Altar";

  const result = await arthur.planFromText({ command, clientId: "client-rumo" });
  const capabilities = result.executionPlan.steps.map((step) => step.skillCapability).filter(Boolean);

  // A mesma classificação que o Eduardo usaria, calculada aqui só para a asserção — não é uma
  // segunda implementação: é a prova de que Arthur chamou exatamente esta função.
  const normalizedText = normalize(command);
  const objective = classifyContentObjective(normalizedText);
  const expectedFormat = classifyRecommendedFormat(normalizedText, objective);
  assert.equal(expectedFormat, "reels");
  assert.equal(pipelineForRecommendedFormat(expectedFormat), "video");

  assert.ok(capabilities.includes("video_script"), "pipeline de vídeo deveria estar presente");
  assert.ok(capabilities.includes("video_direction"));
  assert.ok(capabilities.includes("video_editing"));
  assert.ok(capabilities.includes("video_rendering"));
  assert.equal(capabilities.includes("art_direction"), false, "pipeline de imagem NÃO deveria estar presente");
  assert.equal(capabilities.includes("social_media_design"), false);
  assert.equal(capabilities.includes("image_generation"), false);
});

test("Regressão (achado 'Story sobre vídeo de casamento'): Eduardo prioriza Story mesmo com a palavra 'vídeo' no texto — Arthur agora constrói a pipeline de imagem, não a de vídeo", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });
  const command = "crie um Story sobre vídeo de casamento para o Rumo ao Altar";

  const result = await arthur.planFromText({ command, clientId: "client-rumo" });
  const capabilities = result.executionPlan.steps.map((step) => step.skillCapability).filter(Boolean);

  const normalizedText = normalize(command);
  const objective = classifyContentObjective(normalizedText);
  const expectedFormat = classifyRecommendedFormat(normalizedText, objective);
  assert.equal(expectedFormat, "story");
  assert.equal(pipelineForRecommendedFormat(expectedFormat), "image");

  assert.ok(capabilities.includes("art_direction"), "pipeline de imagem deveria estar presente");
  assert.ok(capabilities.includes("social_media_design"));
  assert.ok(capabilities.includes("image_generation"));
  assert.equal(capabilities.includes("video_script"), false, "pipeline de vídeo NÃO deveria estar presente");
  assert.equal(capabilities.includes("video_direction"), false);
  assert.equal(capabilities.includes("video_editing"), false);
  assert.equal(capabilities.includes("video_rendering"), false);
});

test("Reels explícito: pipeline de vídeo construída, coerente com o formato reels do Eduardo", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });
  const command = "crie um vídeo para Reels de 20 segundos sobre lua de mel para o Rumo ao Altar";

  const result = await arthur.planFromText({ command, clientId: "client-rumo" });
  const capabilities = result.executionPlan.steps.map((step) => step.skillCapability).filter(Boolean);

  const normalizedText = normalize(command);
  const objective = classifyContentObjective(normalizedText);
  const expectedFormat = classifyRecommendedFormat(normalizedText, objective);
  assert.equal(expectedFormat, "reels");

  assert.ok(capabilities.includes("video_script"));
  assert.ok(capabilities.includes("video_rendering"));
  assert.equal(capabilities.includes("image_generation"), false);
});

test("Para um lote de comandos variados, a pipeline que Arthur constrói bate exatamente com a pipeline que a classificação do Eduardo recomendaria (nenhuma segunda fonte de verdade)", async () => {
  const commands = [
    "crie um post lembrando os convidados de confirmar presença (RSVP) no Rumo ao Altar",
    "crie um post sobre a lista de presentes com taxa zero do Rumo ao Altar",
    "crie um carrossel sobre fornecedores de casamento no Rumo ao Altar",
    "crie um Story sobre o cronograma do casamento no Rumo ao Altar",
    "crie um vídeo para TikTok sobre o álbum colaborativo no Rumo ao Altar",
    "crie um post sobre padrinhos e madrinhas no Rumo ao Altar",
  ];

  for (const command of commands) {
    const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });
    const result = await arthur.planFromText({ command, clientId: "client-rumo" });
    const capabilities = result.executionPlan.steps.map((step) => step.skillCapability).filter(Boolean);

    const normalizedText = normalize(command);
    const objective = classifyContentObjective(normalizedText);
    const expectedFormat = classifyRecommendedFormat(normalizedText, objective);
    const expectedPipeline = pipelineForRecommendedFormat(expectedFormat);

    const hasVideoPipeline = capabilities.includes("video_script");
    const hasImagePipeline = capabilities.includes("image_generation");

    assert.equal(
      hasVideoPipeline,
      expectedPipeline === "video",
      `comando "${command}": esperava pipeline de vídeo=${expectedPipeline === "video"}, mas video_script presente=${hasVideoPipeline}`,
    );
    assert.equal(
      hasImagePipeline,
      expectedPipeline === "image",
      `comando "${command}": esperava pipeline de imagem=${expectedPipeline === "image"}, mas image_generation presente=${hasImagePipeline}`,
    );
    // Nunca as duas pipelines ao mesmo tempo.
    assert.equal(hasVideoPipeline && hasImagePipeline, false);
  }
});

test("Arthur não tem mais nenhuma lista de palavras própria para decidir vídeo-vs-imagem: o código-fonte só chama a classificação compartilhada", async () => {
  const source = await readFile("src/application/orchestration/arthur.orchestrator.ts", "utf8");
  assert.ok(
    source.includes('from "../../shared/utils/content-format-classification.js"'),
    "Arthur deveria importar a classificação compartilhada",
  );
  assert.ok(source.includes("classifyRecommendedFormat("), "Arthur deveria chamar classifyRecommendedFormat");
  assert.ok(source.includes("pipelineForRecommendedFormat("), "Arthur deveria chamar pipelineForRecommendedFormat");
});
