// Gera o pacote de exemplo do importador de modelos (docs/site-template-package/example →
// web/public/site-assets/vorix-modelo-exemplo.zip). As imagens de exemplo são desenhadas aqui
// (sem fotos de terceiros) e só são criadas quando ainda não existem.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import sharp from "sharp";

const root = join(process.cwd(), "docs/site-template-package/example");
const output = join(process.cwd(), "web/public/site-assets/vorix-modelo-exemplo.zip");

const art = (width, height, [from, to], shape) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${shape}</svg>`);
const images = {
  "assets/hero.jpg": art(1200, 1500, ["#e9d6c2", "#b9825a"], `<ellipse cx="600" cy="980" rx="420" ry="90" fill="#8a4b2a" opacity=".35"/><path d="M380 960 C380 640 820 640 820 960 Z" fill="#fbf7f2"/><rect x="520" y="560" width="160" height="90" rx="20" fill="#fbf7f2"/>`),
  "assets/story.jpg": art(1200, 900, ["#d9a066", "#6b3a22"], `<circle cx="600" cy="450" r="230" fill="#fbf7f2" opacity=".85"/><circle cx="600" cy="450" r="120" fill="#b9825a"/>`),
  "assets/icon-hand.jpg": art(240, 240, ["#f3ebe1", "#d9a066"], `<circle cx="120" cy="120" r="60" fill="#8a4b2a"/>`),
  "assets/icon-box.jpg": art(240, 240, ["#f3ebe1", "#b9825a"], `<rect x="60" y="70" width="120" height="100" rx="8" fill="#8a4b2a"/>`),
  "assets/icon-leaf.jpg": art(240, 240, ["#eef2e6", "#8fa36b"], `<path d="M60 170 C60 80 150 50 190 50 C190 120 150 180 60 170 Z" fill="#4f6b3a"/>`),
  "preview.png": art(1200, 800, ["#fbf7f2", "#e9d6c2"], `<text x="80" y="330" font-family="Georgia, serif" font-size="96" fill="#2b211b">Atelier</text><text x="80" y="420" font-family="Arial" font-size="34" fill="#8a4b2a">Modelo de exemplo Vorix</text><rect x="760" y="140" width="340" height="520" rx="24" fill="#b9825a"/>`),
};

mkdirSync(join(root, "assets"), { recursive: true });
for (const [path, svg] of Object.entries(images)) {
  const target = join(root, path);
  if (existsSync(target)) continue;
  const image = sharp(svg);
  await (path.endsWith(".png") ? image.png() : image.jpeg({ quality: 82 })).toFile(target);
}

const zip = new AdmZip();
for (const file of ["manifest.json", "theme.json", "styles.css", "preview.png"]) zip.addLocalFile(join(root, file));
zip.addLocalFolder(join(root, "sections"), "sections");
zip.addLocalFolder(join(root, "assets"), "assets");
mkdirSync(join(process.cwd(), "web/public/site-assets"), { recursive: true });
zip.writeZip(output);
console.log(`SITE_TEMPLATE_EXAMPLE ${output}`);
