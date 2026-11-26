#!/usr/bin/env node
// Lê o resultado da VorixProbe pelos dois canais: arquivo na raiz da ponte e Fusion.prefs.
// Uso: node scripts/davinci/read-probe.mjs
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { defaultBridgeRoot } from "./install-bridge.mjs";

function prefsCandidates() {
  if (platform() === "win32") {
    const appdata = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return [join(appdata, "Blackmagic Design", "DaVinci Resolve", "Support", "Fusion", "Profiles", "Default", "Fusion.prefs")];
  }
  if (platform() === "darwin") return [join(homedir(), "Library", "Application Support", "Blackmagic Design", "DaVinci Resolve", "Fusion", "Profiles", "Default", "Fusion.prefs")];
  return [join(homedir(), ".local", "share", "DaVinciResolve", "Fusion", "Profiles", "Default", "Fusion.prefs")];
}

const root = defaultBridgeRoot();
let found = 0;
if (existsSync(root)) {
  for (const name of (await readdir(root)).filter((n) => /^probe-.*\.json$/.test(n))) {
    found += 1;
    console.log(`\n== arquivo ${name} ==`);
    console.log(await readFile(join(root, name), "utf8"));
  }
}
for (const prefs of prefsCandidates()) {
  if (!existsSync(prefs)) {
    console.log(`\n(Fusion.prefs não encontrado em ${prefs})`);
    continue;
  }
  const text = await readFile(prefs, "utf8");
  const hits = text.split(/\r?\n/).filter((line) => line.includes("VorixProbe"));
  console.log(`\n== Fusion.prefs (${hits.length} linha(s) VorixProbe) ==`);
  for (const line of hits) console.log(line.trim().slice(0, 4000));
  found += hits.length;
}
if (found === 0) {
  console.log("\nNenhum resultado da sonda. Ela foi executada? (Workspace > Scripts > VorixProbe, depois de reiniciar o DaVinci)");
  process.exitCode = 2;
}
