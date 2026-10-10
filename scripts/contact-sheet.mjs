// Prancha lado a lado para revisão visual. Uso: node scripts/contact-sheet.mjs out.jpg height img1 img2 ...
import sharp from "sharp";
const [out, heightArg, ...files] = process.argv.slice(2);
const height = Number(heightArg);
const tiles = await Promise.all(files.map(async (file) => {
  const buffer = await sharp(file).resize({ height }).toBuffer();
  return { buffer, width: (await sharp(buffer).metadata()).width };
}));
const gap = 16;
const width = tiles.reduce((sum, tile) => sum + tile.width, 0) + gap * (tiles.length + 1);
let x = gap;
const composite = tiles.map((tile) => { const item = { input: tile.buffer, left: x, top: gap }; x += tile.width + gap; return item; });
await sharp({ create: { width, height: height + 2 * gap, channels: 3, background: "#777777" } }).composite(composite).jpeg({ quality: 85 }).toFile(out);
console.log(out, width);
