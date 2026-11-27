#!/usr/bin/env node
// Uso (no deploy): node make-video-isolated-backend.mjs <backend em produção> <backend do repositório> <saída>
// Aplica SÓ o ramo de vídeo sobre o backend que está em produção, sem as mudanças de outras frentes.
// Variante ISOLADA do backend do piloto: a versão que está no servidor + somente o ramo de vídeo
// (bloco autocontido, despacho video_* e os dados do vídeo na refação). Nada das outras frentes.
import { readFileSync, writeFileSync } from "node:fs";
const [serverFile, repoFile, out] = process.argv.slice(2);
let server = readFileSync(serverFile, "utf8").replace(/\r/g, "");
const repo = readFileSync(repoFile, "utf8").replace(/\r/g, "");
const block = repo.slice(repo.indexOf("// >>> RAMO DE VÍDEO"), repo.indexOf("// <<< RAMO DE VÍDEO"));
const end = repo.slice(repo.indexOf("// <<< RAMO DE VÍDEO")).split("\n")[0];
const put = (anchor, text, after = false) => { const i = server.indexOf(anchor); if (i < 0) throw new Error(`âncora: ${anchor}`); server = after ? server.slice(0, i + anchor.length) + text + server.slice(i + anchor.length) : server.slice(0, i) + text + server.slice(i); };
put("async function run() {", `${block}${end}\n\n`);
put(`  if (mode === "claim_redo") return claimRedo();`, `\n  // Vídeo (Reels) a partir de pauta "video" do Bolsão: ramo próprio, sem tocar no fluxo de imagem/carrossel.\n  if (typeof mode === "string" && mode.startsWith("video_")) return videoAction(workspace, brandConfig);`, true);
const claim = server.indexOf("async function claimRedo() {");
const ret = server.indexOf("  return { job: {", claim);
server = server.slice(0, ret) + `  // Vídeo reprovado: a refação parte da versão exata que foi ao WhatsApp (o orquestrador de vídeo refaz).\n  const video = typeof plan?.payload?.videoVersionId === "string" ? { versionId: plan.payload.videoVersionId, projectId: plan.payload.videoProjectId, sha256: plan.payload.videoSha256 } : undefined;\n  return { job: {\n    ...(video ? { video, brand: (await c.workspaceRepository.getById(workspaceId))?.name } : {}),` + server.slice(ret + "  return { job: {".length);
writeFileSync(out, server);
console.log("ok", server.length);
