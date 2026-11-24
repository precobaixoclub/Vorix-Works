const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const input = path.resolve("artifacts/vorix-comercial-local/capturas");
const output = path.resolve("web/public/marketing/comercial");
const desktop = [
  "dashboard", "inbox", "pipeline", "proposal", "ideas", "create", "review", "calendar",
  "site-editor", "storefront", "store-catalog", "recording", "transcript", "meeting-ai", "recording-library", "meeting-actions",
];

async function encode(name, widths, ratio) {
  const source = path.join(input, `${name}.png`);
  const { size } = await fs.stat(source);
  if (size < 15_000) throw new Error(`Capture appears incomplete: ${source}`);
  const image = sharp(source);
  await Promise.all(widths.map(width => image.clone()
    .resize(width, Math.round(width * ratio), { fit: "contain", background: "#141520" })
    .webp({ quality: 81, effort: 5 })
    .toFile(path.join(output, `${name}-${width}.webp`))));
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  for (const name of desktop) await encode(name, [480, 960, 1440], 2 / 3);
  await encode("dashboard-mobile", [390, 780], 844 / 390);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
