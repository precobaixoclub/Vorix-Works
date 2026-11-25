// Cadastra as capturas reais da Vorix (scripts/editorial/library/vorix-works) na Biblioteca da marca, como
// "Captura do aplicativo", com as etiquetas que o motor criativo lê: feature:, form:, dpr:, focus:x,y,w,h e as
// palavras-chave da funcionalidade. Idempotente pelo nome do arquivo (não duplica).
//
// SÓ RODA COM AUTORIZAÇÃO (é escrita em produção). No servidor, dentro do container da API:
//   docker exec -i -e CAPTURES_JSON="$(base64 -w0 capturas.json)" zuno-zuno-api-1 node --input-type=module < upload-software-captures.mjs
// onde capturas.json = { workspaceId, captures: [{ file, data(base64), ...manifesto }] } (montado por quem roda).
import { buildApiContainer } from "./dist/interfaces/api/di/container.js";
import { loadApiConfig } from "./dist/interfaces/api/config/api-config.js";

const payload = JSON.parse(Buffer.from(process.env.CAPTURES_JSON ?? "", "base64").toString("utf8"));
if (!payload.workspaceId || !Array.isArray(payload.captures)) throw new Error("CAPTURES_JSON inválido");
const c = buildApiContainer(loadApiConfig());
try {
  const workspace = await c.workspaceRepository.getById(payload.workspaceId);
  if (!workspace) throw new Error("Workspace não encontrado");
  const library = (await c.assetLibraryRepository.getLibraryByWorkspace(workspace.id)) ?? await c.assetLibraryRepository.createLibrary({ workspaceId: workspace.id });
  const existing = await c.assetLibraryRepository.listAssets(library.id);
  const results = [];
  for (const capture of payload.captures) {
    const name = `Captura real — ${capture.label}`;
    if (existing.some((asset) => asset.name === name && asset.status === "active")) { results.push({ file: capture.file, skipped: "já cadastrada" }); continue; }
    const body = Buffer.from(capture.data, "base64");
    const key = `assets/${workspace.tenantId}/${workspace.id}/library/captura-${capture.file}`;
    await c.objectStorage.put({ key, body, contentType: "image/png" });
    const tags = [`feature:${capture.feature}`, `form:${capture.form}`, `dpr:${capture.devicePixelRatio}`,
      ...(capture.focus ? [`focus:${capture.focus.x},${capture.focus.y},${capture.focus.w},${capture.focus.h}`] : []), ...capture.keywords];
    const asset = await c.assetLibraryRepository.registerAsset({
      libraryId: library.id, kind: "reference", name, tags, materialType: "screenshot_app", usagePriority: "automatic",
      aiInstructions: `${capture.label}. Tela real do produto (ambiente de demonstração, sem dados de cliente). Usar só por composição — nunca redesenhar.`,
      storageRef: { provider: "s3", objectKey: key, metadata: { contentType: "image/png", width: String(capture.width), height: String(capture.height) } },
    });
    results.push({ file: capture.file, assetId: asset.id });
  }
  console.log(JSON.stringify({ workspaceId: workspace.id, results }));
} finally {
  await c.pool?.end?.().catch(() => undefined);
  await c.identity?.pool?.end().catch(() => undefined);
}
