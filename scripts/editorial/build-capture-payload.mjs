// Monta o pacote de cadastro das capturas reais (consumido por upload-software-captures.mjs). Só lê arquivos
// locais e grava o pacote; não fala com o servidor. O cadastro em produção exige autorização.
//
// Uso: node scripts/editorial/build-capture-payload.mjs <workspaceId> <saída.json> [pasta]
//   Vorix Works = workspace-mscc9pi2-jkvwbo
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [workspaceId, output, dir = "scripts/editorial/library/vorix-works"] = process.argv.slice(2);
if (!workspaceId || !output) throw new Error("Uso: node scripts/editorial/build-capture-payload.mjs <workspaceId> <saída.json> [pasta]");
const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
const captures = [];
for (const capture of manifest.captures) captures.push({ ...capture, data: (await readFile(join(dir, capture.file))).toString("base64") });
await writeFile(output, JSON.stringify({ workspaceId, source: manifest.source, captures }));
console.log(JSON.stringify({ workspaceId, captures: captures.map((capture) => `${capture.file} (${capture.feature}, ${capture.form})`) }));
