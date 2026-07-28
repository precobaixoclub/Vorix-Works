import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkflowDeliveryPage } from "../dist/interfaces/cli/final-delivery-page.js";

async function withArtifacts(run) {
  const root = await mkdtemp(join(tmpdir(), "zuno-final-delivery-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function createReport(overrides = {}) {
  const executionId = overrides.executionId ?? "workflow-final-test";
  const planSteps = overrides.planSteps ?? [
    createPlanStep("step-strategy", 1, "Estratégia de marketing", "strategy"),
    createPlanStep("step-copy", 2, "Criação da copy", "copywriting"),
    createPlanStep("step-image", 3, "Geração de imagem", "image_generation", { imageCount: 1 }),
    createPlanStep("step-review", 4, "Revisão", "quality_review"),
  ];

  return {
    executionId,
    planId: "plan-final-test",
    clientId: "client-rumo",
    state: "COMPLETED",
    startedAt: "2026-07-09T10:00:00.000Z",
    finishedAt: "2026-07-09T10:00:03.000Z",
    message: "Workflow concluído com sucesso.",
    steps: overrides.steps ?? [],
    artifactSummary: {
      htmlPaths: [],
      imagePaths: [],
      videoPaths: [],
      captionPaths: [],
      publicationPaths: [],
      metadataPaths: [],
      zipPaths: [],
      hashtagsPaths: [],
      reportPaths: [],
      ...(overrides.artifactSummary ?? {}),
    },
    planSnapshot: {
      id: "plan-final-test",
      intent: {
        id: "intent-final-test",
        objective: overrides.objective ?? "Crie um post para Instagram sobre taxa zero.",
        channels: ["instagram"],
        successCriteria: [],
      },
      createdBy: "arthur",
      tenant: { clientId: "client-rumo", source: "input" },
      steps: planSteps,
      acceptanceCriteria: [],
    },
    locale: "pt-BR",
    dryRun: true,
    mode: "LOCAL_PRODUCTION",
    correlationId: executionId,
  };
}

function createPlanStep(id, order, name, skillCapability, input = {}) {
  return {
    id,
    order,
    type: "skill",
    name,
    skillCapability,
    instructions: `${name} instructions`,
    input,
    expectedOutput: `${name} output`,
    dependsOn: [],
  };
}

function createStepReport(stepId, order, name, skillCapability, output, artifacts = []) {
  return {
    stepId,
    order,
    name,
    type: "skill",
    skillCapability,
    state: "COMPLETED",
    startedAt: "2026-07-09T10:00:00.000Z",
    finishedAt: "2026-07-09T10:00:01.000Z",
    skillId: `${skillCapability}-skill`,
    response: {
      skillId: `${skillCapability}-skill`,
      taskId: stepId,
      status: "completed",
      output,
      artifacts,
      warnings: [],
    },
  };
}

test("página final do workflow renderiza imagens com download real, ZIP e botões de copiar", async () => {
  await withArtifacts(async (artifactsDir) => {
    const executionId = "workflow-image";
    const executionRoot = join(artifactsDir, executionId);
    const imagePath = join(executionRoot, "images", "slide-01.png");
    const zipPath = join(executionRoot, "carousel.zip");
    await mkdir(join(executionRoot, "images"), { recursive: true });
    await writeFile(imagePath, Buffer.from("fake-image"));
    await writeFile(zipPath, Buffer.from("fake-zip"));

    const report = createReport({
      executionId,
      artifactSummary: {
        imagePaths: [imagePath],
        zipPaths: [zipPath],
      },
      steps: [
        createStepReport("step-copy", 2, "Criação da copy", "copywriting", {
          title: "Taxa zero no altar",
          caption: "Receba presentes via Pix com leveza.",
          hashtags: ["#RumoAoAltar", "#TaxaZero"],
          cta: "Criar minha lista",
          publication: "Receba presentes via Pix com leveza.\n\nCriar minha lista\n\n#RumoAoAltar #TaxaZero",
          summary: "Peça final para divulgar taxa zero.",
        }),
        createStepReport("step-image", 3, "Geração de imagem", "image_generation", {
          images: [
            {
              id: "image-1",
              fileName: "slide-01.png",
              mimeType: "image/png",
              width: 1080,
              height: 1350,
              aspectRatio: "4:5",
              sizeBytes: 10,
              relativePath: "images/slide-01.png",
              localPath: imagePath,
            },
          ],
        }),
        createStepReport("step-review", 4, "Revisão", "quality_review", {
          checklist: [{ item: "Copy aprovada", passed: true }],
          nextSteps: ["Enviar para aprovação final."],
        }),
      ],
    });

    const result = await createWorkflowDeliveryPage(report, { artifactsDir });
    const html = await readFile(result.htmlPath, "utf8");
    const caption = await readFile(result.captionPath, "utf8");
    const publication = await readFile(result.publicationPath, "utf8");
    const hashtags = await readFile(result.hashtagsPath, "utf8");
    const metadata = JSON.parse(await readFile(result.metadataPath, "utf8"));
    const executionReport = JSON.parse(await readFile(result.executionReportPath, "utf8"));

    assert.ok(html.includes("Preview grande"));
    assert.ok(html.includes("href=\"images/slide-01.png\" download=\"slide-01.png\""));
    assert.ok(html.includes("Abrir Imagem"));
    assert.ok(html.includes("Copiar Legenda"));
    assert.ok(html.includes("Copiar publicação completa"));
    assert.ok(html.indexOf("Copiar publicação completa") < html.indexOf("Copiar Legenda"));
    assert.ok(html.includes("Copiar Hashtags"));
    assert.ok(html.includes("Copiar CTA"));
    assert.ok(html.includes("navigator.clipboard.writeText"));
    assert.ok(html.includes("document.execCommand('copy')"));
    assert.ok(html.includes("Baixar ZIP"));
    assert.ok(html.includes("Baixar publicação completa"));
    assert.ok(html.includes("Baixar hashtags"));
    assert.ok(html.includes("Baixar relatório JSON"));
    assert.ok(html.includes("Relatório das Skills executadas"));
    assert.ok(html.includes("Resumo técnico da execução"));
    assert.ok(html.includes("Modo LOCAL_PRODUCTION"));
    assert.ok(caption.includes("Receba presentes via Pix"));
    assert.equal(publication.trim(), "Receba presentes via Pix com leveza.\n\nCriar minha lista\n\n#RumoAoAltar #TaxaZero");
    assert.ok(hashtags.includes("#RumoAoAltar"));
    assert.equal(metadata.mode, "LOCAL_PRODUCTION");
    assert.equal(metadata.selectedPipeline, "Imagem/post + revisão");
    assert.equal(metadata.files.metadata, "metadata.json");
    assert.equal(metadata.files.publication, "publication.txt");
    assert.equal(metadata.files.executionReport, "execution-report.json");
    assert.equal(executionReport.executionId, executionId);
    assert.ok(executionReport.artifactSummary.publicationPaths.includes(result.publicationPath));
  });
});

test("página final do workflow renderiza vídeo com player HTML5 e download real", async () => {
  await withArtifacts(async (artifactsDir) => {
    const executionId = "workflow-video";
    const executionRoot = join(artifactsDir, executionId);
    const videoPath = join(executionRoot, "videos", "final-video.mp4");
    await mkdir(join(executionRoot, "videos"), { recursive: true });
    await writeFile(videoPath, Buffer.from("fake-video"));

    const report = createReport({
      executionId,
      objective: "Crie um vídeo para Reels de 30 segundos.",
      planSteps: [
        createPlanStep("step-strategy", 1, "Estratégia de marketing", "strategy"),
        createPlanStep("step-copy", 2, "Criação da copy", "copywriting"),
        createPlanStep("step-video", 3, "Renderização de vídeo", "video_rendering"),
        createPlanStep("step-review", 4, "Revisão", "quality_review"),
      ],
      artifactSummary: {
        videoPaths: [videoPath],
      },
      steps: [
        createStepReport("step-copy", 2, "Criação da copy", "copywriting", {
          title: "Reels taxa zero",
          caption: "Um vídeo curto para explicar taxa zero.",
          hashtags: ["#Reels", "#Casamento"],
          cta: "Teste agora",
          publication: "Um vídeo curto para explicar taxa zero.\n\nTeste agora\n\n#Reels #Casamento",
          summary: "Vídeo vertical para Reels.",
        }),
        createStepReport("step-video", 3, "Renderização de vídeo", "video_rendering", {
          video: {
            fileName: "final-video.mp4",
            mimeType: "video/mp4",
            sizeBytes: 10,
            relativePath: "videos/final-video.mp4",
            localPath: videoPath,
            specs: {
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              durationSeconds: 30,
            },
          },
        }),
        createStepReport("step-review", 4, "Revisão", "quality_review", {
          checklist: [{ item: "Vídeo vertical validado", passed: true }],
        }),
      ],
    });

    const result = await createWorkflowDeliveryPage(report, { artifactsDir });
    const html = await readFile(result.htmlPath, "utf8");
    const metadata = JSON.parse(await readFile(result.metadataPath, "utf8"));

    assert.ok(html.includes("<video class=\"media-preview\" controls"));
    assert.ok(html.includes("href=\"videos/final-video.mp4\" download=\"final-video.mp4\""));
    assert.ok(html.includes("Assistir"));
    assert.ok(html.includes("Baixar Vídeo"));
    assert.ok(html.includes("Copiar Legenda"));
    assert.ok(html.includes("Copiar publicação completa"));
    assert.ok(html.includes("Copiar Hashtags"));
    assert.ok(html.includes("Copiar CTA"));
    assert.equal(metadata.mode, "LOCAL_PRODUCTION");
    assert.equal(metadata.selectedPipeline, "Vídeo + revisão");
  });
});
