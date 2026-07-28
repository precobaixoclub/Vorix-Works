import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HelenaSkillManager } from "../dist/application/skills/helena.manager.js";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { SkillRegistry } from "../dist/application/skills/skill-registry.js";
import { FileSystemSkillDiscovery } from "../dist/infrastructure/skills/file-system-skill-discovery.js";
import { FileSystemSkillModuleLoader } from "../dist/infrastructure/skills/file-system-skill-module-loader.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, "..");
const skillsRoot = join(projectRoot, "dist", "skills");

function createHelena(runtimeDependencies = {}) {
  const registry = new SkillRegistry();
  const helena = new HelenaSkillManager({
    discovery: new FileSystemSkillDiscovery({ rootDirectories: [skillsRoot] }),
    loader: new FileSystemSkillModuleLoader({ runtimeDependencies }),
    validator: new SkillManifestValidator(),
    registry,
  });
  return { helena, registry };
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("npm run build copia skill.manifest.json de Eduardo, Maria, João, Sofia, Bianca, Pedro, Lucas, Ana, Bruno, Vanessa, Diego, Nora e Rafa para dist/skills preservando a estrutura de pastas", async () => {
  assert.equal(await fileExists(join(skillsRoot, "eduardo-editorial-planning", "skill.manifest.json")), true);
  assert.equal(await fileExists(join(skillsRoot, "maria-copywriting", "skill.manifest.json")), true);
  assert.equal(await fileExists(join(skillsRoot, "joao-marketing-strategy", "skill.manifest.json")), true);
  assert.equal(await fileExists(join(skillsRoot, "sofia-art-direction", "skill.manifest.json")), true);
  assert.equal(await fileExists(join(skillsRoot, "bianca-social-media-design", "skill.manifest.json")), true);
  assert.equal(await fileExists(join(skillsRoot, "pedro-image-generation", "skill.manifest.json")), true);
  assert.equal(await fileExists(join(skillsRoot, "lucas-quality-review", "skill.manifest.json")), true);
  assert.equal(await fileExists(join(skillsRoot, "ana-social-publishing", "skill.manifest.json")), true);
  assert.equal(await fileExists(join(skillsRoot, "bruno-video-script", "skill.manifest.json")), true);
  assert.equal(await fileExists(join(skillsRoot, "vanessa-video-direction", "skill.manifest.json")), true);
  assert.equal(await fileExists(join(skillsRoot, "diego-video-editing", "skill.manifest.json")), true);
  assert.equal(await fileExists(join(skillsRoot, "nora-video-narration", "skill.manifest.json")), true);
  assert.equal(await fileExists(join(skillsRoot, "rafa-video-rendering", "skill.manifest.json")), true);
});

test("Helena descobre Eduardo, Maria, João, Sofia, Bianca, Pedro, Lucas, Ana, Bruno, Vanessa, Diego, Nora e Rafa como Skills reais em dist/skills após o build, sem depender de fixtures", async () => {
  const { helena, registry } = createHelena();

  const records = await helena.discoverAndLoadSkills();

  const ids = records.map((record) => record.manifest?.id).sort();
  assert.deepEqual(ids, [
    "ana-social-publishing",
    "bianca-social-media-design",
    "bruno-video-script",
    "diego-video-editing",
    "eduardo-editorial-planning",
    "joao-marketing-strategy",
    "lucas-quality-review",
    "maria-copywriting",
    "motion-design-engine",
    "nora-video-narration",
    "pedro-image-generation",
    "rafa-video-rendering",
    "sofia-art-direction",
    "vanessa-video-direction",
  ]);
  // motion-design-engine é descoberta (catalogada por Helena) mas nasce com `enabled: false` no
  // manifesto — nova capacidade ainda não integrada a nenhum workflow (ver sprint "Motion
  // Design"), então precisa continuar DISABLED e nunca ser contada como Skill pronta para uso.
  assert.equal(registry.getBySkillId("motion-design-engine").state, "DISABLED");
  assert.equal(registry.getBySkillId("eduardo-editorial-planning").state, "READY");
  assert.equal(registry.getBySkillId("maria-copywriting").state, "READY");
  assert.equal(registry.getBySkillId("joao-marketing-strategy").state, "READY");
  assert.equal(registry.getBySkillId("sofia-art-direction").state, "READY");
  assert.equal(registry.getBySkillId("bianca-social-media-design").state, "READY");
  assert.equal(registry.getBySkillId("pedro-image-generation").state, "READY");
  assert.equal(registry.getBySkillId("lucas-quality-review").state, "READY");
  assert.equal(registry.getBySkillId("ana-social-publishing").state, "READY");
  assert.equal(registry.getBySkillId("bruno-video-script").state, "READY");
  assert.equal(registry.getBySkillId("vanessa-video-direction").state, "READY");
  assert.equal(registry.getBySkillId("diego-video-editing").state, "READY");
  assert.equal(registry.getBySkillId("nora-video-narration").state, "READY");
  assert.equal(registry.getBySkillId("rafa-video-rendering").state, "READY");
});

test("Helena encontra Nora pela capability video_narration após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("video_narration");

  assert.equal(record.manifest.id, "nora-video-narration");
});

test("Helena encontra Bruno pela capability video_script após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("video_script");

  assert.equal(record.manifest.id, "bruno-video-script");
});

test("Helena encontra Vanessa pela capability video_direction após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("video_direction");

  assert.equal(record.manifest.id, "vanessa-video-direction");
});

test("Helena encontra Rafa pela capability video_rendering após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("video_rendering");

  assert.equal(record.manifest.id, "rafa-video-rendering");
});

test("Helena encontra Diego pela capability video_editing após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("video_editing");

  assert.equal(record.manifest.id, "diego-video-editing");
});

test("Helena encontra Bianca pela capability social_media_design após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("social_media_design");

  assert.equal(record.manifest.id, "bianca-social-media-design");
});

test("Helena encontra Maria pela capability copywriting após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("copywriting");

  assert.equal(record.manifest.id, "maria-copywriting");
});

test("Helena encontra Eduardo pela capability editorial_planning após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("editorial_planning");

  assert.equal(record.manifest.id, "eduardo-editorial-planning");
});

test("Helena encontra João pela capability strategy após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("strategy");

  assert.equal(record.manifest.id, "joao-marketing-strategy");
});

test("Helena encontra João pela capability marketing_strategy após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("marketing_strategy");

  assert.equal(record.manifest.id, "joao-marketing-strategy");
});

test("Helena encontra Sofia pela capability art_direction após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("art_direction");

  assert.equal(record.manifest.id, "sofia-art-direction");
});

test("Helena encontra Pedro pela capability image_generation após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("image_generation");

  assert.equal(record.manifest.id, "pedro-image-generation");
});

test("Helena encontra Lucas pela capability quality_review após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("quality_review");

  assert.equal(record.manifest.id, "lucas-quality-review");
});

test("Helena encontra Ana pela capability social_publishing após o build real", async () => {
  const { helena } = createHelena();
  await helena.discoverAndLoadSkills();

  const record = await helena.findSkillByCapability("social_publishing");

  assert.equal(record.manifest.id, "ana-social-publishing");
});

test("Nenhuma Skill de template (_template) é descoberta ou carregada em dist/skills", async () => {
  const { helena } = createHelena();

  const records = await helena.discoverAndLoadSkills();

  assert.ok(records.every((record) => record.manifest?.id !== "future-skill-id"));
  assert.ok(records.every((record) => !record.source.sourceId.startsWith("_")));
  assert.equal(await fileExists(join(skillsRoot, "_template")), false);
});

test("O loader repassa o mesmo pacote de dependências injetáveis para qualquer Skill carregada, de forma genérica", async () => {
  const icaro = { async request() { throw new Error("não deveria ser chamado neste teste"); } };
  const valentina = { async getClientContext() { throw new Error("não deveria ser chamado neste teste"); } };
  const clara = { async requestContext() { throw new Error("não deveria ser chamado neste teste"); } };
  const { helena } = createHelena({ icaro, valentina, clara });

  const records = await helena.discoverAndLoadSkills();

  // motion-design-engine nasce DISABLED de propósito (nova capacidade ainda não integrada a
  // nenhum workflow — ver sprint "Motion Design"); excluída aqui porque este teste valida o
  // mecanismo de carregamento/injeção de dependências, não o estado de habilitação por Skill.
  assert.ok(records.filter((record) => record.state !== "DISABLED").every((record) => record.state === "READY"));
});

test("Uma Skill carrega mesmo com um pacote de dependências vazio; ela só falha ao executar sem o que precisa", async () => {
  const { helena } = createHelena({});

  const records = await helena.discoverAndLoadSkills();

  assert.ok(records.filter((record) => record.state !== "DISABLED").every((record) => record.state === "READY"));
});
