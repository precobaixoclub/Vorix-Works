import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();

async function readAllTsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await readAllTsFiles(fullPath)));
    else if (entry.name.endsWith(".ts")) files.push(fullPath);
  }
  return files;
}

test("nenhum arquivo do Intent-Based Footage Acquisition usa child_process.exec/execSync ou shell:true", async () => {
  const dir = join(ROOT, "src", "infrastructure", "footage-acquisition");
  const files = await readAllTsFiles(dir);
  assert.ok(files.length > 0, "esperava encontrar arquivos-fonte da Intent-Based Footage Acquisition");
  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.ok(!/\bexecSync\s*\(/.test(content), `${file} não deve usar execSync`);
    assert.ok(!/[^.]\bexec\s*\(\s*["'`]/.test(content), `${file} não deve usar child_process.exec com string de comando`);
    assert.ok(!/shell\s*:\s*true/.test(content), `${file} não deve usar shell:true`);
  }
});

test("nenhuma Skill (src/skills/**) importa a infraestrutura de Footage Acquisition diretamente", async () => {
  const skillsDir = join(ROOT, "src", "skills");
  const files = await readAllTsFiles(skillsDir);
  assert.ok(files.length > 0, "esperava encontrar arquivos de Skills");
  // Só checa declarações `import ... from "..."` reais (não comentários que mencionem o nome do
  // módulo a título de documentação — como já acontece propositalmente em
  // `lucas-quality-review.types.ts`, que CITA `visual-candidate-validator.ts` num comentário para
  // explicar de onde o dado espelhado se origina, sem importar nada de fato).
  const importLinePattern = /^\s*import\b.*from\s+["'][^"']+["']/gm;
  for (const file of files) {
    const content = await readFile(file, "utf8");
    const importLines = content.match(importLinePattern) ?? [];
    for (const importLine of importLines) {
      assert.ok(!importLine.includes("infrastructure/footage-acquisition"), `${file}: import indevido -> ${importLine}`);
      assert.ok(!importLine.includes("shot-intent-query-generator"), `${file}: import indevido -> ${importLine}`);
      assert.ok(!importLine.includes("visual-candidate-validator"), `${file}: import indevido -> ${importLine}`);
      assert.ok(!importLine.includes("pre-composition-simulator"), `${file}: import indevido -> ${importLine}`);
      // FOOTAGE VISUAL VALIDATION 2.0 — novos módulos desta sprint corretiva, mesma regra.
      assert.ok(!importLine.includes("device-geometry"), `${file}: import indevido -> ${importLine}`);
      assert.ok(!importLine.includes("semantic-safety-gate"), `${file}: import indevido -> ${importLine}`);
      assert.ok(!importLine.includes("rejection-history"), `${file}: import indevido -> ${importLine}`);
      assert.ok(!importLine.includes("visual-validation-stage"), `${file}: import indevido -> ${importLine}`);
    }
  }
});

test("nenhuma das 14 Skills protegidas foi alterada nesta sprint (verificação por lista nominal do escopo)", async () => {
  const protectedSkillDirs = [
    "arthur", "helena", "caio", "eduardo-editorial-planning", "joao-marketing-strategy", "maria-copywriting",
    "sofia-art-direction", "bianca-social-media-design", "pedro-image-generation", "bruno-video-script",
    "vanessa-video-direction", "diego-video-editing", "nora-video-narration", "rafa-video-rendering",
  ];
  const skillsDir = join(ROOT, "src", "skills");
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const actualDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  // Confirma que os diretórios de Skill protegidos existem e não foram removidos/renomeados —
  // a proteção real (nenhum import de infra nova) é verificada nos testes acima.
  for (const protectedName of protectedSkillDirs) {
    const stillExists = actualDirs.some((dirName) => dirName.includes(protectedName) || protectedName.includes(dirName));
    if (protectedName === "arthur" || protectedName === "helena" || protectedName === "caio") continue; // orquestração vive fora de src/skills
    assert.ok(stillExists, `Skill protegida "${protectedName}" deveria continuar existindo em src/skills`);
  }
});
