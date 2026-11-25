// Compatibilidade entre os scripts do piloto e o dist/ da API: cada nome importado de "./dist/..." (import
// estático) ou via `dist("...")` (import dinâmico do renderizador) precisa existir no módulo compilado.
// Serve para o deploy (scripts novos × API nova) e para o rollback (scripts do commit anterior × API nova).
//
// Uso (na raiz, depois de `npm run build`): node scripts/editorial/check-pilot-compat.mjs <arquivo|git:<rev>:<caminho>>...
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const targets = process.argv.slice(2);
if (!targets.length) throw new Error("Uso: node scripts/editorial/check-pilot-compat.mjs <arquivo|git:<rev>:<caminho>>...");
let failures = 0;
for (const target of targets) {
  const source = target.startsWith("git:")
    ? execFileSync("git", ["show", target.slice(4)], { encoding: "utf8" })
    : await readFile(target, "utf8");
  const imports = [];
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.\/dist\/([^"]+)"/g)) imports.push({ names: match[1], path: match[2] });
  for (const match of source.matchAll(/const\s*\{([^}]+)\}\s*=\s*await\s+dist\("([^"]+)"\)/g)) imports.push({ names: match[1], path: match[2] });
  const missing = [];
  for (const { names, path } of imports) {
    let module;
    try { module = await import(pathToFileURL(join(process.cwd(), "dist", path)).href); } catch (error) { missing.push(`${path} (módulo ausente: ${error.message.split("\n")[0]})`); continue; }
    for (const raw of names.split(",")) {
      const name = raw.trim().split(/\s+as\s+|\s*:\s*/)[0].trim();
      if (name && !(name in module)) missing.push(`${path} → ${name}`);
    }
  }
  failures += missing.length;
  console.log(`${missing.length ? "✗" : "✓"} ${target}: ${imports.length} importação(ões) do dist${missing.length ? ` — faltando: ${missing.join("; ")}` : ""}`);
}
process.exitCode = failures ? 1 : 0;
