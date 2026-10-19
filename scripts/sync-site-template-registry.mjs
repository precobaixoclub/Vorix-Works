import {readFileSync,writeFileSync} from "node:fs";
const source=new URL("../src/domain/sites/template-registry.json",import.meta.url);
const target=new URL("../web/features/sites/template-registry.generated.json",import.meta.url);
const expected=readFileSync(source,"utf8");
if(process.argv.includes("--check")){
 if(readFileSync(target,"utf8")!==expected)throw Error("Registro de modelos divergente. Execute node scripts/sync-site-template-registry.mjs.");
 console.log("SITE_TEMPLATE_REGISTRY_SYNCED");
}else writeFileSync(target,expected);
