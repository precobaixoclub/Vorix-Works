// PROVA DE RENDER dos componentes conceituais (clock, counter, versus, mask_reveal) com o MESMO renderizador do
// worker (`motion-graphics/render.mjs`): um clipe por componente + prancha de quadros (início, virada, fim).
// Local, sem rede, sem publicar. Uso: node scripts/video/concept-templates-proof.mjs [pasta-saída]
import { copyFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const out = resolve(process.argv[2] ?? "artifacts/diretor-criativo/componentes");
await mkdir(out, { recursive: true });
await copyFile("artifacts/reformulacao/cmkv/job/000037-preto.jpg", join(out, "foto.jpg"));
const { renderScene } = await import(pathToFileURL(resolve("motion-graphics/render.mjs")).href);
const brand = { name: "Vorix", primary: "#1B1035", accent: "#B990FC", light: "#F5F5F4", dark: "#0E0A1A", display: "Barlow Condensed" };
const base = { width: 1080, height: 1920, fps: 30, durationInFrames: 120, brand };
const scenes = {
  clock: { template: "clock", lines: ["Seu dia acabou", "e a lista não"], label: "Parou." },
  counter: { template: "counter", value: "3", lines: ["filtros que decidem", "a compra certa"] },
  versus: { template: "versus", left: "Planilha e retrabalho", right: "Tudo num lugar só", kicker: "Antes e depois" },
  mask_reveal: { template: "mask_reveal", photo: "foto.jpg", photoAspect: 0.75, headline: "O detalhe que muda tudo", kicker: "Estampa Fé" },
};
const files = [];
for (const [name, props] of Object.entries(scenes)) {
  const outputPath = join(out, `${name}.mp4`);
  const started = Date.now();
  await renderScene({ jobDir: out, outputPath, props: { ...base, ...props }, quality: "preview", cacheDir: join(out, ".cache") });
  console.log(`[render] ${name}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  files.push(outputPath);
}
// Prancha: 3 quadros por componente (10%, 55%, 90% da duração) lado a lado, um componente por linha.
const rows = [];
for (const file of files) {
  const row = file.replace(/\.mp4$/, "-linha.jpg");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-vf", "select='eq(n\\,12)+eq(n\\,66)+eq(n\\,108)',scale=270:-1,tile=3x1", "-frames:v", "1", "-fps_mode", "passthrough", row]);
  rows.push(row);
}
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...rows.flatMap((row) => ["-i", row]), "-filter_complex", `vstack=inputs=${rows.length}`, join(out, "prancha-componentes.jpg")]);
console.log(`[prancha] ${join(out, "prancha-componentes.jpg")}`);
