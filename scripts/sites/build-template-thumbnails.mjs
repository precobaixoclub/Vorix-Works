import sharp from "sharp";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../../",import.meta.url));
const source=resolve(root,"tmp/website-builder/evidence"),destination=resolve(root,"web/public/site-assets/templates");
for(const id of["nexus","aura","pulse"]){
 for(const mode of["desktop","mobile"]){await sharp(resolve(source,`${id}-${mode}.png`)).resize({width:mode==="desktop"?720:390,withoutEnlargement:true}).webp({quality:82}).toFile(resolve(destination,`${id}-${mode}.webp`));}
}
console.log("TEMPLATE_THUMBNAILS_FROM_REAL_RENDERERS");
