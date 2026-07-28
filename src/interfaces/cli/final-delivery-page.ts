import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkflowArtifactSummary, WorkflowExecutionReport } from "../../application/workflows/caio.types.js";
import type { SkillArtifact } from "../../domain/skills/skill.contract.js";

export type WorkflowDeliveryPageResult = {
  htmlPath: string;
  captionPath?: string;
  publicationPath?: string;
  hashtagsPath?: string;
  metadataPath: string;
  executionReportPath: string;
  warnings: string[];
};

export type WorkflowDeliveryPageOptions = {
  artifactsDir: string;
};

type DeliveryMedia = {
  kind: "image" | "video";
  title: string;
  href: string;
  downloadName: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  aspectRatio?: string;
  durationSeconds?: number;
  altText?: string;
  sourceStep?: string;
};

type CopyPack = {
  title: string;
  caption: string;
  hashtags: string[];
  cta: string;
  publication: string;
  summary: string;
};

export async function createWorkflowDeliveryPage(
  report: WorkflowExecutionReport,
  options: WorkflowDeliveryPageOptions,
): Promise<WorkflowDeliveryPageResult> {
  const executionRoot = path.join(options.artifactsDir, sanitizePathSegment(report.executionId));
  await mkdir(executionRoot, { recursive: true });

  const copy = extractCopyPack(report);
  const images = collectMedia(report, executionRoot, "image");
  const videos = collectMedia(report, executionRoot, "video");
  const zipHref = report.artifactSummary.zipPaths[0] ? toHref(report.artifactSummary.zipPaths[0], executionRoot) : undefined;
  const warnings = collectWarnings(report);
  const validations = collectValidations(report);
  const nextSteps = collectNextSteps(report);
  const pipeline = describePipeline(report);
  const mode = report.mode ?? "LOCAL_PRODUCTION";

  let captionPath: string | undefined;
  if (copy.caption) {
    captionPath = path.join(executionRoot, "caption.txt");
    await writeFile(captionPath, `${copy.caption.trim()}\n`, "utf8");
  }

  let publicationPath: string | undefined;
  if (copy.publication) {
    publicationPath = path.join(executionRoot, "publication.txt");
    await writeFile(publicationPath, `${copy.publication.trim()}\n`, "utf8");
  }

  let hashtagsPath: string | undefined;
  if (copy.hashtags.length > 0) {
    hashtagsPath = path.join(executionRoot, "hashtags.txt");
    await writeFile(hashtagsPath, `${copy.hashtags.join(" ")}\n`, "utf8");
  }

  const metadataPath = path.join(executionRoot, "metadata.json");
  const executionReportPath = path.join(executionRoot, "execution-report.json");
  const htmlPath = path.join(executionRoot, "index.html");
  const audio = extractAudioSummary(report);
  const metadata = {
    executionId: report.executionId,
    planId: report.planId,
    mode,
    state: report.state,
    statusFinal: report.state,
    localProduction: mode === "LOCAL_PRODUCTION",
    publication: {
      published: false,
      reason: mode === "LOCAL_PRODUCTION"
        ? "LOCAL_PRODUCTION não publica em redes sociais, não cria URL pública e não faz upload para CDN."
        : "Workflow executado em dry_run.",
    },
    identifiedIntent: report.planSnapshot.intent.objective,
    selectedPipeline: pipeline,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    durationMs: calculateDurationMs(report),
    skillsExecuted: report.steps
      .filter((step) => step.skillId)
      .map((step) => ({
        name: step.name,
        skillId: step.skillId,
        capability: step.skillCapability,
        state: step.state,
      })),
    files: {
      html: htmlPath,
      images: images.map((media) => media.href),
      videos: videos.map((media) => media.href),
      zip: zipHref,
      caption: captionPath ? path.basename(captionPath) : undefined,
      publication: publicationPath ? path.basename(publicationPath) : undefined,
      hashtags: hashtagsPath ? path.basename(hashtagsPath) : undefined,
      metadata: path.basename(metadataPath),
      executionReport: path.basename(executionReportPath),
    },
    validations,
    warnings,
    nextSteps,
    ...(audio ? { audio } : {}),
  };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
  const executionReport = {
    ...report,
    artifactSummary: addWorkflowDeliveryToSummary(report.artifactSummary, {
      htmlPath,
      captionPath,
      publicationPath,
      hashtagsPath,
      metadataPath,
      executionReportPath,
      warnings,
    }),
    ...(audio ? { audio } : {}),
  };
  await writeFile(executionReportPath, JSON.stringify(executionReport, null, 2), "utf8");

  const html = buildWorkflowDeliveryHtml({
    report,
    copy,
    images,
    videos,
    zipHref,
    captionHref: captionPath ? path.basename(captionPath) : undefined,
    publicationHref: publicationPath ? path.basename(publicationPath) : undefined,
    hashtagsHref: hashtagsPath ? path.basename(hashtagsPath) : undefined,
    metadataHref: path.basename(metadataPath),
    executionReportHref: path.basename(executionReportPath),
    warnings,
    validations,
    nextSteps,
    pipeline,
    audio,
  });
  await writeFile(htmlPath, html, "utf8");

  return {
    htmlPath,
    captionPath,
    publicationPath,
    hashtagsPath,
    metadataPath,
    executionReportPath,
    warnings,
  };
}

export function addWorkflowDeliveryToSummary(
  summary: WorkflowArtifactSummary,
  delivery: WorkflowDeliveryPageResult,
): WorkflowArtifactSummary {
  return {
    htmlPaths: unique([delivery.htmlPath, ...summary.htmlPaths]),
    imagePaths: unique(summary.imagePaths),
    videoPaths: unique(summary.videoPaths ?? []),
    captionPaths: unique([...(delivery.captionPath ? [delivery.captionPath] : []), ...(summary.captionPaths ?? [])]),
    publicationPaths: unique([...(delivery.publicationPath ? [delivery.publicationPath] : []), ...(summary.publicationPaths ?? [])]),
    hashtagsPaths: unique([...(delivery.hashtagsPath ? [delivery.hashtagsPath] : []), ...(summary.hashtagsPaths ?? [])]),
    metadataPaths: unique([delivery.metadataPath, ...(summary.metadataPaths ?? [])]),
    reportPaths: unique([delivery.executionReportPath, ...(summary.reportPaths ?? [])]),
    zipPaths: unique(summary.zipPaths ?? []),
  };
}

function buildWorkflowDeliveryHtml(input: {
  report: WorkflowExecutionReport;
  copy: CopyPack;
  images: DeliveryMedia[];
  videos: DeliveryMedia[];
  zipHref?: string;
  captionHref?: string;
  publicationHref?: string;
  hashtagsHref?: string;
  metadataHref: string;
  executionReportHref: string;
  warnings: string[];
  validations: string[];
  nextSteps: string[];
  pipeline: string;
  audio?: ReturnType<typeof extractAudioSummary>;
}): string {
  const mediaBlocks = [
    input.images.length > 0 ? buildImageSection(input.images, input.zipHref) : "",
    input.videos.length > 0 ? buildVideoSection(input.videos) : "",
  ].filter(Boolean).join("\n");
  const copyBlocks = buildCopySections(input.copy);
  const fileLinks = [
    input.captionHref ? `<a class="button" href="${escapeAttribute(input.captionHref)}" download="caption.txt">Baixar legenda</a>` : "",
    input.publicationHref ? `<a class="button primary" href="${escapeAttribute(input.publicationHref)}" download="publication.txt">Baixar publicação completa</a>` : "",
    input.hashtagsHref ? `<a class="button" href="${escapeAttribute(input.hashtagsHref)}" download="hashtags.txt">Baixar hashtags</a>` : "",
    `<a class="button" href="${escapeAttribute(input.metadataHref)}" download="metadata.json">Baixar metadata</a>`,
    `<a class="button" href="${escapeAttribute(input.executionReportHref)}" download="execution-report.json">Baixar relatório JSON</a>`,
  ].filter(Boolean).join("");

  return [
    "<!doctype html>",
    "<html lang=\"pt-BR\">",
    "<head>",
    "  <meta charset=\"utf-8\">",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `  <title>Entrega Zuno — ${escapeHtml(input.report.executionId)}</title>`,
    "  <style>",
    "    :root { --bg:#fff8fa; --card:#ffffff; --ink:#181116; --muted:#75646d; --brand:#c77f91; --brand-dark:#32111a; --line:#eadde2; --soft:#f8edf1; --ok:#07895c; --warn:#a96700; }",
    "    * { box-sizing:border-box; }",
    "    body { margin:0; font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:var(--bg); color:var(--ink); }",
    "    main { width:min(1180px, calc(100% - 28px)); margin:0 auto; padding:34px 0 56px; }",
    "    header { display:grid; gap:22px; grid-template-columns:minmax(0,1.4fr) minmax(280px,.6fr); align-items:end; padding:34px; border-radius:30px; color:#fff; background:radial-gradient(circle at top right, rgba(255,205,217,.45), transparent 34%), linear-gradient(135deg, #241017, #9d5264 62%, #d99aaa); box-shadow:0 22px 60px rgba(50,17,26,.18); }",
    "    h1 { margin:0; font-family:Georgia, 'Times New Roman', serif; font-size:clamp(2.1rem,5vw,4.6rem); line-height:.95; letter-spacing:-.04em; }",
    "    h2 { margin:0 0 12px; font-size:clamp(1.35rem,2.4vw,2rem); }",
    "    h3 { margin:0 0 8px; font-size:1.05rem; }",
    "    p { line-height:1.62; }",
    "    code, pre { font-family:'SFMono-Regular', Consolas, monospace; }",
    "    pre { white-space:pre-wrap; margin:0; line-height:1.55; }",
    "    .eyebrow { display:inline-flex; align-items:center; gap:8px; text-transform:uppercase; letter-spacing:.16em; font-size:.72rem; font-weight:850; color:var(--brand); }",
    "    header .eyebrow { color:#ffdbe4; }",
    "    .hero-card { padding:20px; border:1px solid rgba(255,255,255,.24); border-radius:22px; background:rgba(255,255,255,.12); backdrop-filter:blur(10px); }",
    "    .hero-card strong { display:block; font-size:1.15rem; margin-bottom:6px; }",
    "    .section { margin-top:24px; padding:24px; border:1px solid var(--line); border-radius:24px; background:var(--card); box-shadow:0 12px 32px rgba(50,17,26,.06); }",
    "    .media-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:18px; }",
    "    .media-card { overflow:hidden; border:1px solid var(--line); border-radius:22px; background:#fff; }",
    "    .media-preview { display:block; width:100%; max-height:720px; object-fit:contain; background:#211b1f; }",
    "    video.media-preview { aspect-ratio:9/16; }",
    "    .media-body { padding:18px; }",
    "    .actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; }",
    "    .button, button { appearance:none; border:1px solid var(--line); border-radius:12px; background:#fff; color:var(--ink); padding:11px 14px; font-weight:800; text-decoration:none; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px; }",
    "    .button.primary, button.primary { background:var(--brand); border-color:var(--brand); color:#fff; }",
    "    .copy-box { display:grid; grid-template-columns:1fr auto; gap:16px; align-items:center; padding:18px; border:1px solid var(--line); border-radius:18px; background:var(--soft); margin-top:14px; }",
    "    .copy-box.primary-copy { border-color:rgba(199,127,145,.42); background:linear-gradient(135deg, #fff, #f8edf1); box-shadow:0 14px 34px rgba(50,17,26,.08); }",
    "    .copy-box.primary-copy button { min-width:240px; font-size:1rem; }",
    "    .stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px; margin-top:16px; }",
    "    .stat { padding:16px; border-radius:18px; background:var(--soft); }",
    "    .stat span { display:block; color:var(--muted); font-size:.8rem; margin-bottom:6px; }",
    "    .stat strong { font-size:1.05rem; }",
    "    .list { display:grid; gap:10px; padding:0; list-style:none; margin:14px 0 0; }",
    "    .list li { padding:12px 14px; border-radius:14px; background:var(--soft); }",
    "    .skills { display:grid; gap:10px; padding:0; list-style:none; margin:14px 0 0; }",
    "    .skills li { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; padding:12px 14px; border-radius:14px; background:var(--soft); }",
    "    .pill { display:inline-flex; align-items:center; border-radius:999px; padding:4px 9px; font-size:.72rem; font-weight:850; text-transform:uppercase; background:#e8fff5; color:var(--ok); }",
    "    .pill.warn { background:#fff3dc; color:var(--warn); }",
    "    .file-meta { display:grid; gap:7px; margin-top:12px; color:var(--muted); font-size:.9rem; }",
    "    .file-meta div { display:flex; justify-content:space-between; gap:14px; border-bottom:1px dashed var(--line); padding-bottom:7px; }",
    "    footer { margin-top:24px; color:var(--muted); text-align:center; }",
    "    @media (max-width: 760px) { header { grid-template-columns:1fr; padding:24px; } .copy-box { grid-template-columns:1fr; } main { width:min(100% - 18px, 1180px); } .section { padding:18px; } }",
    "  </style>",
    "</head>",
    "<body>",
    "<main>",
    "  <header>",
    "    <div>",
    "      <span class=\"eyebrow\">Entrega final do Zuno</span>",
    `      <h1>${escapeHtml(input.copy.title || "Material pronto")}</h1>`,
    `      <p>${escapeHtml(input.copy.summary || input.report.planSnapshot.intent.objective)}</p>`,
    "    </div>",
    "    <div class=\"hero-card\">",
    "      <strong>Como salvar</strong>",
    `      <p>${escapeHtml((input.report.mode ?? "LOCAL_PRODUCTION") === "LOCAL_PRODUCTION" ? "Modo LOCAL_PRODUCTION: tudo foi preparado localmente para publicação manual. Nada foi enviado para Meta, CDN ou provider externo." : "Use os botões de download para baixar os arquivos reais. Se o navegador bloquear downloads em arquivo local, clique em abrir e use “Salvar como”.")}</p>`,
    "    </div>",
    "  </header>",
    buildStats(input.report, input.pipeline, input.images.length, input.videos.length),
    mediaBlocks || buildEmptyMediaNotice(),
    copyBlocks,
    input.audio ? buildAudioSection(input.audio) : "",
    `<section class="section"><h2>Arquivos organizados</h2><div class="actions">${fileLinks}</div></section>`,
    buildSkillsReport(input.report),
    buildListSection("Validações realizadas", input.validations, "Tudo que o Lucas e o workflow checaram antes da entrega."),
    buildListSection("Warnings", input.warnings.length > 0 ? input.warnings : ["Nenhum warning registrado."], "Atenções técnicas ou de qualidade encontradas durante a execução."),
    buildListSection("Próximos passos", input.nextSteps.length > 0 ? input.nextSteps : ["Abrir os arquivos, revisar visualmente e aprovar o uso."], "O que fazer agora com o material pronto."),
    "  <footer>Gerado localmente pelo Zuno. Nenhum arquivo desta página depende de canvas, base64, file:// tratado como URL pública ou links quebrados.</footer>",
    "</main>",
    "<script>",
    "  async function copyTextFromElement(id, button) {",
    "    const element = document.getElementById(id);",
    "    const text = element ? element.innerText.trim() : '';",
    "    if (!text) return;",
    "    const original = button.innerText;",
    "    try {",
    "      if (navigator.clipboard && navigator.clipboard.writeText) {",
    "        await navigator.clipboard.writeText(text);",
    "      } else {",
    "        throw new Error('clipboard indisponível');",
    "      }",
    "      button.innerText = 'Copiado!';",
    "    } catch (_error) {",
    "      const area = document.createElement('textarea');",
    "      area.value = text;",
    "      area.setAttribute('readonly', '');",
    "      area.style.position = 'fixed';",
    "      area.style.left = '-9999px';",
    "      document.body.appendChild(area);",
    "      area.select();",
    "      try { document.execCommand('copy'); button.innerText = 'Copiado!'; }",
    "      catch (_fallbackError) { button.innerText = 'Selecione e copie'; }",
    "      document.body.removeChild(area);",
    "    }",
    "    setTimeout(function () { button.innerText = original; }, 1600);",
    "  }",
    "</script>",
    "</body>",
    "</html>",
  ].join("\n");
}

function buildAudioSection(audio: NonNullable<ReturnType<typeof extractAudioSummary>>): string {
  const rows = [
    ["Áudio no MP4", audio.audioApplied ? "sim" : "não"],
    ["Narração", audio.narrationApplied ? audio.narrationFilename ?? "aplicada" : "não aplicada"],
    ["Música", audio.musicFilename ?? "não informada"],
    ["Ducking da música", audio.musicDuckingApplied ? "sim, durante a fala" : "não aplicável"],
    ["Codec final", audio.audioCodec ?? "—"],
    ["Duração", audio.audioDuration ? `${audio.audioDuration}s` : "—"],
  ];
  return [
    "<section class=\"section\">",
    "  <span class=\"eyebrow\">Mixagem de áudio</span>",
    "  <h2>Narração, música e efeitos</h2>",
    "  <div class=\"stats\">",
    rows.map(([label, value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("\n"),
    "  </div>",
    "</section>",
  ].join("\n");
}

function buildImageSection(images: DeliveryMedia[], zipHref?: string): string {
  const cards = images.map((image, index) => [
    "<article class=\"media-card\">",
    `  <img class=\"media-preview\" src="${escapeAttribute(image.href)}" alt="${escapeAttribute(image.altText ?? image.title)}">`,
    "  <div class=\"media-body\">",
    `    <h3>${escapeHtml(image.title || `Imagem ${index + 1}`)}</h3>`,
    buildFileMeta(image),
    "    <div class=\"actions\">",
    `      <a class=\"button primary\" href="${escapeAttribute(image.href)}" download="${escapeAttribute(image.downloadName)}">Baixar Imagem</a>`,
    `      <a class=\"button\" href="${escapeAttribute(image.href)}" target="_blank" rel="noopener">Abrir Imagem</a>`,
    "    </div>",
    "  </div>",
    "</article>",
  ].join("\n")).join("\n");

  return [
    "<section class=\"section\">",
    "  <span class=\"eyebrow\">Imagens finais</span>",
    "  <h2>Preview grande</h2>",
    `  <div class=\"media-grid\">${cards}</div>`,
    zipHref ? `  <div class=\"actions\"><a class=\"button primary\" href="${escapeAttribute(zipHref)}" download="carousel.zip">Baixar ZIP</a></div>` : "",
    "</section>",
  ].filter(Boolean).join("\n");
}

function buildVideoSection(videos: DeliveryMedia[]): string {
  const cards = videos.map((video, index) => [
    "<article class=\"media-card\">",
    `  <video class=\"media-preview\" controls preload=\"metadata\" src="${escapeAttribute(video.href)}"></video>`,
    "  <div class=\"media-body\">",
    `    <h3>${escapeHtml(video.title || `Vídeo ${index + 1}`)}</h3>`,
    buildFileMeta(video),
    "    <div class=\"actions\">",
    `      <a class=\"button\" href="${escapeAttribute(video.href)}" target="_blank" rel="noopener">Assistir</a>`,
    `      <a class=\"button primary\" href="${escapeAttribute(video.href)}" download="${escapeAttribute(video.downloadName)}">Baixar Vídeo</a>`,
    "    </div>",
    "  </div>",
    "</article>",
  ].join("\n")).join("\n");

  return [
    "<section class=\"section\">",
    "  <span class=\"eyebrow\">Vídeos finais</span>",
    "  <h2>Player HTML5</h2>",
    `  <div class=\"media-grid\">${cards}</div>`,
    "</section>",
  ].join("\n");
}

function buildCopySections(copy: CopyPack): string {
  const sections = [
    copy.publication ? buildCopyBox("Publicação completa", "publication-text", copy.publication, "Copiar publicação completa", true) : "",
    copy.caption ? buildCopyBox("Legenda", "caption-text", copy.caption, "Copiar Legenda") : "",
    copy.hashtags.length > 0 ? buildCopyBox("Hashtags", "hashtags-text", copy.hashtags.join(" "), "Copiar Hashtags") : "",
    copy.cta ? buildCopyBox("CTA", "cta-text", copy.cta, "Copiar CTA") : "",
  ].filter(Boolean).join("\n");

  if (!sections) return "";
  return `<section class="section"><span class="eyebrow">Texto final</span><h2>Publicação pronta para colar</h2><p>Use a ação principal para copiar legenda, CTA e hashtags em um único bloco.</p>${sections}</section>`;
}

function buildCopyBox(label: string, id: string, text: string, buttonLabel: string, primary = false): string {
  return [
    `<div class="copy-box${primary ? " primary-copy" : ""}">`,
    "  <div>",
    `    <span class=\"eyebrow\">${escapeHtml(label)}</span>`,
    `    <pre id=\"${escapeAttribute(id)}\">${escapeHtml(text)}</pre>`,
    "  </div>",
    `  <button type=\"button\" class=\"${primary ? "primary" : ""}\" onclick=\"copyTextFromElement('${escapeAttribute(id)}', this)\">${escapeHtml(buttonLabel)}</button>`,
    "</div>",
  ].join("\n");
}

function buildSkillsReport(report: WorkflowExecutionReport): string {
  const items = report.steps.map((step) => {
    const duration = step.startedAt && step.finishedAt ? formatDuration(Date.parse(step.finishedAt) - Date.parse(step.startedAt)) : "—";
    const statusClass = step.state === "COMPLETED" ? "pill" : "pill warn";
    return [
      "<li>",
      "  <div>",
      `    <strong>${escapeHtml(step.name)}</strong>`,
      `    <p>${escapeHtml([step.skillId, step.skillCapability].filter(Boolean).join(" · ") || step.type)}</p>`,
      "  </div>",
      `  <span class="${statusClass}">${escapeHtml(step.state)} · ${escapeHtml(duration)}</span>`,
      "</li>",
    ].join("\n");
  }).join("\n");

  return [
    "<section class=\"section\">",
    "  <span class=\"eyebrow\">Relatório das Skills utilizadas e executadas</span>",
    "  <h2>Relatório das Skills executadas</h2>",
    `  <ul class=\"skills\">${items}</ul>`,
    "</section>",
  ].join("\n");
}

function buildStats(report: WorkflowExecutionReport, pipeline: string, imageCount: number, videoCount: number): string {
  const stats = [
    ["Intenção identificada", report.planSnapshot.intent.objective],
    ["Modo usado", report.mode ?? "LOCAL_PRODUCTION"],
    ["Pipeline escolhida", pipeline],
    ["Tempo de execução", formatDuration(calculateDurationMs(report))],
    ["Arquivos gerados", `${imageCount} imagem(ns), ${videoCount} vídeo(s), ${report.artifactSummary.zipPaths.length} ZIP(s)`],
    ["Origem dos artefatos", collectGenerationSources(report).join(", ") || "—"],
    ["Estado final", report.state],
    ["Publicação", (report.mode ?? "LOCAL_PRODUCTION") === "LOCAL_PRODUCTION" ? "não publicada · pronta para publicação manual" : report.dryRun ? "dry_run" : "produção"],
  ];

  return [
    "<section class=\"section\">",
    "  <span class=\"eyebrow\">Resumo técnico da execução</span>",
    "  <h2>O que o Zuno entendeu e entregou</h2>",
    "  <div class=\"stats\">",
    stats.map(([label, value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("\n"),
    "  </div>",
    "</section>",
  ].join("\n");
}

function buildListSection(title: string, items: string[], description: string): string {
  return [
    "<section class=\"section\">",
    `  <span class=\"eyebrow\">${escapeHtml(title)}</span>`,
    `  <h2>${escapeHtml(title)}</h2>`,
    `  <p>${escapeHtml(description)}</p>`,
    "  <ul class=\"list\">",
    items.map((item) => `    <li>${escapeHtml(item)}</li>`).join("\n"),
    "  </ul>",
    "</section>",
  ].join("\n");
}

function buildFileMeta(media: DeliveryMedia): string {
  const rows = [
    ["Arquivo", media.downloadName],
    ["Formato", media.mimeType ?? "—"],
    ["Tamanho", formatBytes(media.sizeBytes)],
    ["Dimensões", formatDimensions(media)],
    media.durationSeconds ? ["Duração", `${media.durationSeconds}s`] : undefined,
    media.sourceStep ? ["Origem", media.sourceStep] : undefined,
  ].filter((row): row is [string, string] => Boolean(row));

  return `<div class="file-meta">${rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>`;
}

function buildEmptyMediaNotice(): string {
  return [
    "<section class=\"section\">",
    "  <span class=\"eyebrow\">Sem mídia final</span>",
    "  <h2>Nenhuma imagem ou vídeo foi encontrado no relatório.</h2>",
    "  <p>O workflow pode ter produzido apenas texto, ou pode ter sido encerrado antes da geração de artefatos visuais.</p>",
    "</section>",
  ].join("\n");
}

function collectMedia(report: WorkflowExecutionReport, executionRoot: string, kind: "image" | "video"): DeliveryMedia[] {
  const media: DeliveryMedia[] = [];
  const add = (candidate: Partial<DeliveryMedia> & { localPath?: string; relativePath?: string; uri?: string }, sourceStep?: string) => {
    const href = candidate.relativePath
      ?? candidate.uri
      ?? (candidate.localPath ? toHref(candidate.localPath, executionRoot) : undefined);
    if (!href) return;
    const title = candidate.title ?? candidate.downloadName ?? path.basename(href);
    const downloadName = candidate.downloadName ?? path.basename(href);
    media.push({
      kind,
      title,
      href: normalizeHref(href),
      downloadName,
      mimeType: candidate.mimeType,
      sizeBytes: candidate.sizeBytes,
      width: candidate.width,
      height: candidate.height,
      aspectRatio: candidate.aspectRatio,
      durationSeconds: candidate.durationSeconds,
      altText: candidate.altText,
      sourceStep,
    });
  };

  for (const step of report.steps) {
    const output = valueAsRecord(step.response?.output);
    if (kind === "image") {
      const images = Array.isArray(output?.images) ? output.images : [];
      for (const image of images) {
        const record = valueAsRecord(image);
        if (!record) continue;
        add({
          title: valueAsString(record.fileName) ?? valueAsString(record.id) ?? "Imagem",
          downloadName: valueAsString(record.fileName),
          mimeType: valueAsString(record.mimeType),
          sizeBytes: valueAsNumber(record.sizeBytes),
          width: valueAsNumber(record.width),
          height: valueAsNumber(record.height),
          aspectRatio: valueAsString(record.aspectRatio),
          altText: valueAsString(record.altText),
          localPath: valueAsString(record.localPath),
          relativePath: valueAsString(record.relativePath) ?? valueAsString(record.downloadHref),
          uri: valueAsString(record.uri),
        }, step.name);
      }
    } else {
      const video = valueAsRecord(output?.video);
      const specs = valueAsRecord(video?.specs);
      if (video) {
        add({
          title: valueAsString(video.fileName) ?? "Vídeo final",
          downloadName: valueAsString(video.fileName),
          mimeType: valueAsString(video.mimeType),
          sizeBytes: valueAsNumber(video.sizeBytes),
          width: valueAsNumber(specs?.width),
          height: valueAsNumber(specs?.height),
          aspectRatio: valueAsString(specs?.aspectRatio),
          durationSeconds: valueAsNumber(specs?.durationSeconds),
          localPath: valueAsString(video.localPath),
          relativePath: valueAsString(video.relativePath) ?? valueAsString(video.downloadHref),
          uri: valueAsString(video.uri),
        }, step.name);
      }
    }

    for (const artifact of step.response?.artifacts ?? []) {
      collectArtifactMedia(artifact, kind, (candidate) => add(candidate, step.name));
    }
  }

  const summaryPaths = kind === "image" ? report.artifactSummary.imagePaths : report.artifactSummary.videoPaths ?? [];
  for (const localPath of summaryPaths) {
    add({
      title: path.basename(localPath),
      downloadName: path.basename(localPath),
      localPath,
    });
  }

  return uniqueMedia(media);
}

function collectArtifactMedia(
  artifact: SkillArtifact,
  kind: "image" | "video",
  add: (candidate: Partial<DeliveryMedia> & { localPath?: string; relativePath?: string; uri?: string }) => void,
): void {
  const mimeType = artifact.file?.mimeType;
  const matchesKind = kind === "video"
    ? artifact.type === "video" || mimeType?.startsWith("video/")
    : artifact.type === "image" || mimeType?.startsWith("image/");

  if (matchesKind) {
    add({
      title: artifact.name,
      downloadName: artifact.file?.localPath ? path.basename(artifact.file.localPath) : artifact.uri ? path.basename(artifact.uri) : artifact.name,
      mimeType: artifact.file?.mimeType,
      sizeBytes: artifact.file?.sizeBytes,
      width: artifact.dimensions?.width,
      height: artifact.dimensions?.height,
      aspectRatio: artifact.dimensions?.aspectRatio,
      localPath: artifact.file?.localPath,
      uri: artifact.uri,
      durationSeconds: typeof artifact.metadata?.durationSeconds === "number" ? artifact.metadata.durationSeconds : undefined,
    });
  }

  for (const item of artifact.items ?? []) {
    collectArtifactMedia(item, kind, add);
  }
}

function extractCopyPack(report: WorkflowExecutionReport): CopyPack {
  const copyStep = report.steps.find((step) => step.skillCapability === "copywriting");
  const output = valueAsRecord(copyStep?.response?.output);
  const strategyStep = report.steps.find((step) => step.skillCapability === "strategy");
  const strategy = valueAsRecord(strategyStep?.response?.output);
  const caption = valueAsString(output?.caption) ?? "";
  const hashtags = valueAsStringArray(output?.hashtags);
  const cta = valueAsString(output?.cta) ?? valueAsString(strategy?.recommendedCta) ?? "";
  return {
    title: valueAsString(output?.title) ?? valueAsString(strategy?.title) ?? "Entrega Zuno",
    caption,
    hashtags,
    cta,
    publication: valueAsString(output?.publication) ?? buildPublicationText({ caption, cta, hashtags }),
    summary: valueAsString(output?.summary) ?? valueAsString(strategy?.overallStrategy) ?? "",
  };
}

function collectWarnings(report: WorkflowExecutionReport): string[] {
  const warnings: string[] = [];
  for (const step of report.steps) {
    for (const warning of step.response?.warnings ?? []) warnings.push(`${step.name}: ${warning}`);
    if (step.error) warnings.push(`${step.name}: ${step.error.message}`);
    const output = valueAsRecord(step.response?.output);
    for (const warning of valueAsStringArray(output?.warnings)) warnings.push(`${step.name}: ${warning}`);
    const issues = Array.isArray(output?.issues) ? output.issues : [];
    for (const issue of issues) {
      const record = valueAsRecord(issue);
      const message = valueAsString(record?.message);
      if (message) warnings.push(`${step.name}: ${message}`);
    }
  }
  return unique(warnings);
}

function collectValidations(report: WorkflowExecutionReport): string[] {
  const lucas = report.steps.find((step) => step.skillCapability === "quality_review");
  const output = valueAsRecord(lucas?.response?.output);
  const checklist = Array.isArray(output?.checklist) ? output.checklist : [];
  const items = checklist
    .map((item) => valueAsRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => `${valueAsString(item.item) ?? "Validação"}: ${item.passed === true ? "ok" : "atenção"}`);

  if (items.length > 0) return items;
  return report.steps.filter((step) => step.state === "COMPLETED").map((step) => `${step.name}: concluída`);
}

function collectNextSteps(report: WorkflowExecutionReport): string[] {
  const steps: string[] = [];
  if ((report.mode ?? "LOCAL_PRODUCTION") === "LOCAL_PRODUCTION") {
    steps.push("Revisar o HTML final localmente antes de publicar manualmente.");
    steps.push("Baixar imagens, vídeos, legenda, hashtags, metadata e relatório JSON.");
    steps.push("Publicar manualmente nas redes sociais desejadas; o Zuno não publicou nada neste modo.");
  }
  for (const step of report.steps) {
    const output = valueAsRecord(step.response?.output);
    for (const nextStep of valueAsStringArray(output?.nextSteps)) steps.push(`${step.name}: ${nextStep}`);
  }
  return unique(steps).slice(0, 12);
}

function collectGenerationSources(report: WorkflowExecutionReport): string[] {
  const sources: string[] = [];
  for (const step of report.steps) {
    const output = valueAsRecord(step.response?.output);
    const providerUsed = valueAsString(output?.providerUsed);
    const generationMode = valueAsString(output?.generationMode);
    if (providerUsed) sources.push(providerUsed);
    if (generationMode) sources.push(generationMode);
    for (const artifact of step.response?.artifacts ?? []) {
      collectArtifactGenerationSources(artifact, sources);
    }
  }
  return unique(sources);
}

function collectArtifactGenerationSources(artifact: SkillArtifact, sources: string[]): void {
  if (artifact.generation?.provider) sources.push(artifact.generation.provider);
  if (artifact.generation?.model) sources.push(artifact.generation.model);
  for (const item of artifact.items ?? []) {
    collectArtifactGenerationSources(item, sources);
  }
}

function describePipeline(report: WorkflowExecutionReport): string {
  const capabilities = report.planSnapshot.steps.map((step) => step.skillCapability).filter(Boolean);
  const hasVideo = capabilities.includes("video_rendering");
  const hasImage = capabilities.includes("image_generation");
  const hasPublishing = capabilities.includes("social_publishing");
  if (hasVideo) return hasPublishing ? "Vídeo + revisão + publicação" : "Vídeo + revisão";
  if (hasImage) {
    const imageStep = report.planSnapshot.steps.find((step) => step.skillCapability === "image_generation");
    const imageCount = valueAsNumber(imageStep?.input.imageCount) ?? 1;
    const base = imageCount > 1 ? `Carrossel (${imageCount} imagens) + revisão` : "Imagem/post + revisão";
    return hasPublishing ? `${base} + publicação` : base;
  }
  return hasPublishing ? "Texto + publicação" : "Texto + revisão";
}

function buildPublicationText(copy: Pick<CopyPack, "caption" | "cta" | "hashtags">): string {
  return [copy.caption, copy.cta, copy.hashtags.join(" ")].filter((item) => item.trim()).join("\n\n");
}

function calculateDurationMs(report: WorkflowExecutionReport): number {
  const end = report.finishedAt ? Date.parse(report.finishedAt) : Date.now();
  return Math.max(0, end - Date.parse(report.startedAt));
}

function toHref(localPath: string, executionRoot: string): string {
  if (!path.isAbsolute(localPath)) return normalizeHref(localPath);
  const relative = path.relative(executionRoot, localPath);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return normalizeHref(relative);
  return normalizeHref(localPath);
}

function normalizeHref(value: string): string {
  return value.replace(/\\/g, "/");
}

function uniqueMedia(media: DeliveryMedia[]): DeliveryMedia[] {
  const seen = new Set<string>();
  const result: DeliveryMedia[] = [];
  for (const item of media) {
    const key = `${item.kind}:${item.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function valueAsRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function valueAsNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Espelha, só por nome de campo (sem importar nenhum tipo de Skill, ADR 0002), o resumo de áudio
 * que Rafa devolve em `RafaVideoRenderingOutput` (`audioApplied`/`musicSource`/`musicFilename`/
 * `audioCodec`/`audioDuration`) — ver `src/skills/rafa-video-rendering/rafa-video-rendering.types.ts`.
 * Devolve `undefined` quando a execução não tem etapa de renderização de vídeo (nada a mostrar).
 */
function extractAudioSummary(report: WorkflowExecutionReport): {
  audioApplied: boolean;
  musicSource?: string;
  musicFilename?: string;
  narrationApplied?: boolean;
  narrationSource?: string;
  narrationFilename?: string;
  narrationDuration?: number;
  musicDuckingApplied?: boolean;
  audioCodec?: string;
  audioDuration?: number;
} | undefined {
  const step = report.steps.find((candidate) => candidate.skillCapability === "video_rendering");
  const output = valueAsRecord(step?.response?.output);
  if (!output) return undefined;

  return {
    audioApplied: output.audioApplied === true,
    musicSource: valueAsString(output.musicSource),
    musicFilename: valueAsString(output.musicFilename),
    narrationApplied: output.narrationApplied === true,
    narrationSource: valueAsString(output.narrationSource),
    narrationFilename: valueAsString(output.narrationFilename),
    narrationDuration: valueAsNumber(output.narrationDuration),
    musicDuckingApplied: output.musicDuckingApplied === true,
    audioCodec: valueAsString(output.audioCodec),
    audioDuration: valueAsNumber(output.audioDuration),
  };
}

function valueAsStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function formatBytes(value?: number): string {
  if (!value || value <= 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDimensions(media: DeliveryMedia): string {
  if (media.width && media.height) return `${media.width}x${media.height}${media.aspectRatio ? ` (${media.aspectRatio})` : ""}`;
  return media.aspectRatio ?? "—";
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}min ${seconds % 60}s`;
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!sanitized) throw new Error("executionId inválido para gerar entrega do workflow.");
  return sanitized;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}
