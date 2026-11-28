// PROVA CRIATIVA REAL do Diretor Criativo Autônomo (cenários A–E da evolução do Creative Engine).
// Pautas de TESTE (fixtures, nenhuma ideia do Bolsão é consumida), briefs montados pelo módulo real (dist) e
// prompts do diretor real; o Codex do piloto responde no servidor (scripts/video/codex-director-proof.mjs).
// Só a etapa de concepção/plano: nada é renderizado, enviado ou publicado.
//
//   node scripts/video/creative-director-proof.mjs --emit        → artifacts/diretor-criativo/{img,vid}
//   (servidor) node codex-director-proof.mjs <pasta> <casos>     → <caso>-codex.json
//   node scripts/video/creative-director-proof.mjs --evaluate    → avaliacao.json + resumo no console
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { briefFromIdea, materialInventory, selectCreativeDirection, directionRecord } from "../../dist/application/creative-engine/creative-director.js";
import { directorPrompt, directorSchemaWith, dropInventedFigures, toDraft } from "../editorial/video-director.mjs";

const OUT = "artifacts/diretor-criativo";
const PHOTOS = ["artifacts/reformulacao/cmkv/job/000037-preto.jpg", "artifacts/reformulacao/cmkv/job/000037-branco.jpg"];

const CASES = {
  "A-imagem-economia": { medium: "image", brand: { name: "Preço Baixo Club", positioning: "clube que ajuda a comparar preços antes de comprar", tone: "direto, próximo e esperto" },
    idea: { title: "Comprar sem comparar pode custar caro", keyMessage: "Antes de comprar, compare", cta: "Compare antes de comprar" }, instructions: [], inv: { logo: true } },
  "B-video-produtividade": { medium: "video", brand: { name: "Vorix Works", positioning: "plataforma que organiza marketing, conversas e reuniões num lugar só", tone: "confiante e claro" },
    idea: { title: "Nosso sistema economiza tempo", keyMessage: "Menos tempo em tarefa repetida, mais tempo para o que importa", cta: "Conheça a Vorix" }, instructions: [], inv: { logo: true } },
  "C-video-camisetas": { medium: "video", brand: { name: "CMKV Wears", positioning: "streetwear premium com estampas próprias", tone: "premium e direto" },
    idea: { title: "A qualidade das nossas camisetas", keyMessage: "Estampa própria com acabamento que dura", cta: "Conheça a estampa Fé" }, instructions: [], inv: { productPhotos: 2, logo: true }, photos: true },
  "D-video-comparacao": { medium: "video", brand: { name: "Preço Baixo Club", positioning: "clube que ajuda a comparar preços antes de comprar", tone: "direto, próximo e esperto" },
    idea: { title: "Divulgar a plataforma de comparação de preços", keyMessage: "O mesmo produto pode ter preços bem diferentes", cta: "Compare no Preço Baixo Club" }, instructions: [], inv: { logo: true } },
  "E-video-briefing": { medium: "video", brand: { name: "CMKV Wears", positioning: "streetwear premium com estampas próprias", tone: "premium e direto" },
    idea: { title: "Camisetas com estampa própria", keyMessage: "A estampa é o detalhe que diferencia", cta: "Conheça a estampa Fé" },
    instructions: ["Quero destacar as estampas, usar suspense e fazer uma revelação impactante. Nunca mostrar preço."], inv: { productPhotos: 2, logo: true }, photos: true },
};

function brief(c) {
  return briefFromIdea({ medium: c.medium, brand: c.brand, idea: c.idea, instructions: c.instructions, inventory: materialInventory({ medium: c.medium, ...c.inv }) });
}

async function emit() {
  for (const kind of ["img", "vid"]) await mkdir(join(OUT, kind), { recursive: true });
  for (const [name, c] of Object.entries(CASES)) {
    const b = brief(c);
    if (c.medium === "image") {
      await writeFile(join(OUT, "img", `${name}-prompt.txt`), `${b.prompt}\nResponda só o JSON do schema.`);
      await writeFile(join(OUT, "img", `${name}-imagens.json`), "[]");
      await writeFile(join(OUT, "img", "schema.json"), JSON.stringify(b.schema));
      continue;
    }
    const materials = c.photos ? PHOTOS.map((file, i) => ({ id: `M${i + 1}`, kind: "image", role: "product_photo", label: `camiseta ${i ? "branca" : "preta"} — estampa Fé`, width: 1440, height: 1920, thumb: "x" })) : [];
    const selection = { brand: c.brand.name, idea: c.idea, brandStyle: { name: c.brand.name, tone: c.brand.tone }, creativeBrief: { prompt: b.prompt, schema: b.schema } };
    await writeFile(join(OUT, "vid", `${name}-prompt.txt`), directorPrompt({ selection, materials, targetSeconds: 20 }));
    const images = [];
    for (const [i, file] of (c.photos ? PHOTOS : []).entries()) { const target = `${name}-m${i + 1}.jpg`; await copyFile(file, join(OUT, "vid", target)); images.push(target); }
    await writeFile(join(OUT, "vid", `${name}-imagens.json`), JSON.stringify(images));
    await writeFile(join(OUT, "vid", "schema.json"), JSON.stringify(directorSchemaWith(b.schema)));
  }
  console.log(`[emit] ${Object.keys(CASES).length} casos em ${OUT}`);
}

async function evaluate() {
  const report = {};
  for (const [name, c] of Object.entries(CASES)) {
    const file = join(OUT, c.medium === "image" ? "img" : "vid", `${name}-codex.json`);
    if (!existsSync(file)) { report[name] = { error: "sem resposta do Codex" }; continue; }
    const output = JSON.parse(await readFile(file, "utf8"));
    const b = brief(c);
    const direction = selectCreativeDirection(c.medium === "image" ? output : output.direction, { inventory: { footage: false }, requestedLanguages: b.briefing.requestedLanguages });
    const entry = { briefing: { required: b.briefing.required, preferences: b.briefing.preferences, requestedLanguages: b.briefing.requestedLanguages, free: b.briefing.free },
      concepts: (c.medium === "image" ? output : output.direction).concepts.map((k) => ({ id: k.id, name: k.name, language: k.language, visualDevice: k.visualDevice, notes: `${k.impact}/${k.originality}/${k.feasibility}/${k.brandFit}` })),
      chosen: direction ? directionRecord(direction) : null, decision: direction?.decision, warnings: direction?.warnings, rationale: direction?.rationale };
    if (c.medium === "video") {
      const draft = toDraft(output);
      const guarded = dropInventedFigures(draft, [c.idea.title, c.idea.keyMessage, c.idea.cta].join(" "));
      entry.plan = { story: output.story, strategy: output.strategy, scenes: draft.scenes.map((s) => `${s.purpose}:${s.design?.template ?? "ffmpeg"}${s.emotion ? `/${s.emotion}` : ""}`), factWarnings: guarded.warnings };
    }
    report[name] = entry;
    console.log(`\n[${name}] escolhido: ${entry.chosen?.name ?? "—"} (${entry.chosen?.language ?? ""}) · ${entry.decision ?? ""}`);
    for (const k of entry.concepts) console.log(`   ${k.id} ${k.name} · ${k.language} · ${k.visualDevice} · notas ${k.notes}`);
    if (entry.plan) console.log(`   plano: ${entry.plan.scenes.join(" → ")}${entry.plan.factWarnings.length ? ` · ${entry.plan.factWarnings.join("; ")}` : ""}`);
  }
  await writeFile(join(OUT, "avaliacao.json"), JSON.stringify(report, null, 2));
}

const flag = process.argv[2];
if (flag === "--emit") await emit();
else if (flag === "--evaluate") await evaluate();
else throw new Error("Uso: --emit | --evaluate");
