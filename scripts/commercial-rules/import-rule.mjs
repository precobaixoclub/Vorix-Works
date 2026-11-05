// Import a reviewed configuration through the normal authenticated API. No SQL or catalog edits.
import {readFile} from "node:fs/promises";
import {commercialRuleSchema} from "../../dist/domain/commerce/commercial-rules.js";
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const file=option("--file"),workspaceId=option("--workspace-id"),api=option("--api"),token=process.env.VORIX_RULE_IMPORT_TOKEN;
if(!file||!workspaceId||!api)throw Error("Use --file <config.json> --workspace-id <id> --api <url>. Sem --apply, apenas apresenta a configuração.");
const url=new URL(api);if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw Error("API inválida.");
const input=JSON.parse(await readFile(file,"utf8")),definition=commercialRuleSchema.parse(input.definition);
if(!args.includes("--apply")){console.log(JSON.stringify({api:url.origin,workspaceId,siteSlug:input.siteSlug,definition,applied:false},null,2));process.exit(0);}
if(!token)throw Error("Informe um token de sessão do lojista em VORIX_RULE_IMPORT_TOKEN.");
async function call(path,method="GET",body){const response=await fetch(api.replace(/\/$/,"")+path,{method,headers:{authorization:`Bearer ${token}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw Error(result.error?.message??`HTTP ${response.status}`);return result.data;}
const query=`workspaceId=${encodeURIComponent(workspaceId)}`,sites=await call(`/v1/sites?${query}`),site=sites.sites.find(site=>site.slug===input.siteSlug);
if(!site)throw Error("Loja não encontrada neste workspace. Nenhuma alteração foi feita.");
const endpoint=`/v1/sites/${encodeURIComponent(site.id)}/commercial-rules`,rules=await call(`${endpoint}?${query}`),existing=rules.find(rule=>rule.name===definition.name);
const saved=existing?await call(`${endpoint}/${encodeURIComponent(existing.id)}?${query}`,"PUT",{definition,revision:existing.revision}):await call(`${endpoint}?${query}`,"POST",{definition});
console.log(JSON.stringify({siteSlug:site.slug,ruleId:saved.id,revision:saved.revision,active:saved.active,applied:true},null,2));
