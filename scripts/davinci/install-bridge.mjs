#!/usr/bin/env node
// Instala a ponte Vorix no DaVinci Resolve desta máquina (ambiente de desenvolvimento/worker).
// - Grava a raiz de trabalho da ponte DENTRO do script Lua (constante; nunca vem de pedido).
// - Copia para a pasta de scripts do usuário: aparece em Workspace > Scripts > VorixBridge.
// Uso: node scripts/davinci/install-bridge.mjs [--print-root]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "src", "infrastructure", "davinci-resolve", "lua", "VorixBridge.lua");

export function defaultBridgeRoot() {
  if (platform() === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Vorix", "davinci-bridge");
  return join(homedir(), ".vorix", "davinci-bridge");
}

export function resolveScriptsDir() {
  if (platform() === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Blackmagic Design", "DaVinci Resolve", "Support", "Fusion", "Scripts", "Utility");
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "Blackmagic Design", "DaVinci Resolve", "Fusion", "Scripts", "Utility");
  return join(homedir(), ".local", "share", "DaVinciResolve", "Fusion", "Scripts", "Utility");
}

async function main() {
  const root = defaultBridgeRoot();
  if (process.argv.includes("--print-root")) {
    console.log(root);
    return;
  }
  // A raiz vira literal Lua: só caracteres de caminho comuns.
  if (!/^[A-Za-z0-9 _.:\\/()-]+$/.test(root)) throw new Error(`Caminho da ponte com caracteres não suportados: ${root}`);
  const sep = platform() === "win32" ? "\\" : "/";
  const luaLiteral = (value) => value.replace(/\\/g, "\\\\");
  const template = await readFile(source, "utf8");
  if (!template.includes("__VORIX_BRIDGE_ROOT__") || !template.includes("__VORIX_PATH_SEP__")) throw new Error("Modelo da ponte sem marcadores — arquivo alterado?");
  const script = template.replace("__VORIX_BRIDGE_ROOT__", luaLiteral(root)).replace("__VORIX_PATH_SEP__", luaLiteral(sep));
  for (const dir of ["inbox", "outbox", "jobs"]) await mkdir(join(root, dir), { recursive: true });
  const scriptsDir = resolveScriptsDir();
  await mkdir(scriptsDir, { recursive: true });
  const target = join(scriptsDir, "VorixBridge.lua");
  await writeFile(target, script, "utf8");
  console.log(`Ponte instalada em: ${target}`);
  console.log(`Raiz de trabalho:   ${root}`);
  console.log("Próximo passo: abra o DaVinci Resolve e rode Workspace > Scripts > VorixBridge.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
