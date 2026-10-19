// QA local com banco e imagens fictícios. Não conecta provedores ou bancos de clientes.
import {spawn,spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {createServer} from "node:net";
import {mkdirSync,openSync,closeSync,readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

const root=fileURLToPath(new URL("../../",import.meta.url));
process.chdir(root);
if(process.env.NODE_ENV==="production")throw Error("FIXTURE_ONLY: execute em ambiente local.");
const name=`vorix-site-builder-fixture-${randomUUID()}`,label="site-builder-browser";
const windows=process.platform==="win32";
const docker=args=>{
 const command=windows?"wsl.exe":"docker",input=windows?["-u","root","--","docker",...args]:args;
 const result=spawnSync(command,input,{encoding:"utf8"});
 if(result.status!==0)throw Error(result.stderr||result.error?.message||"Docker indisponível.");
 return result.stdout.trim();
};
async function availablePort(port=0){const server=createServer();await new Promise((ok,fail)=>{server.once("error",fail);server.listen(port,"127.0.0.1",ok);});const value=server.address().port;await new Promise(ok=>server.close(ok));return value;}
await availablePort(3390);await availablePort(3391);const pgPort=await availablePort();
mkdirSync("tmp/site-builder-browser/evidence",{recursive:true});
const serverLog=openSync("tmp/site-builder-browser/server.log","w"),testLog=openSync("tmp/site-builder-browser/tests.log","w");
let fixture,tests,created=false;
const pause=()=>new Promise(ok=>setTimeout(ok,1000));
try{
 docker(["run","--rm","-d","--name",name,"--label",`vorix.fixture=${label}`,"-e","POSTGRES_PASSWORD=fixture-only","-e","POSTGRES_USER=fixture","-e","POSTGRES_DB=vorix_capacity_fixture_site_builder","-p",`127.0.0.1:${pgPort}:5432`,"postgres:16-alpine"]);created=true;
 let ready=false;
 for(let attempt=0;attempt<30;attempt++){const command=windows?"wsl.exe":"docker",args=["exec",name,"pg_isready","-U","fixture"];const check=spawnSync(command,windows?["-u","root","--","docker",...args]:args,{encoding:"utf8"});if(check.status===0){ready=true;break;}await pause();}
 if(!ready)throw Error("PostgreSQL de fixture não iniciou.");
 fixture=spawn(process.execPath,["tests/fixtures/product-site-browser-server.mjs","--capacity","--site-builder",...(process.env.PRODUCT_VERTICALS_QA?["--product-verticals"]:[])],{stdio:["ignore",serverLog,serverLog],env:{...process.env,VORIX_CAPACITY_FIXTURE_PG_URL:`postgres://fixture:fixture-only@127.0.0.1:${pgPort}/vorix_capacity_fixture_site_builder`}});
 ready=false;
 for(let attempt=0;attempt<90;attempt++){
  if(fixture.exitCode!==null)throw Error("Fixture interrompida. Consulte tmp/site-builder-browser/server.log.");
  try{const response=await fetch("http://127.0.0.1:3390/fixture-only/scope");if(response.ok){const scope=await response.json();if(scope.fixtureOnly&&scope.siteBuilderFixture&&scope.capacityFixture&&scope.billingProvider==="sandbox"){ready=true;break;}}}catch{}
  await pause();
 }
 if(!ready)throw Error("API de fixture não iniciou.");
 const qaDir=`.next-site-qa-${randomUUID()}`;
 writeFileSync("web/.tsconfig-site-qa.json",JSON.stringify(JSON.parse(readFileSync("web/tsconfig.json","utf8")),null,2));
 tests=spawn(process.execPath,[resolve("web/node_modules/@playwright/test/cli.js"),"test","--config","playwright.product-site.config.ts",...process.argv.slice(2)],{cwd:resolve("web"),env:{...process.env,SITE_BUILDER_QA:"1",SITE_BUILDER_QA_DIST_DIR:qaDir},stdio:["ignore",testLog,testLog]});
 const code=await new Promise(ok=>tests.once("exit",ok));process.exitCode=code??1;
 console.log(`SITE_BUILDER_BROWSER exit=${process.exitCode}; evidências em tmp/site-builder-browser/`);
}finally{
 if(tests?.exitCode===null)tests.kill();
 if(fixture?.exitCode===null){fixture.kill();await Promise.race([new Promise(ok=>fixture.once("exit",ok)),new Promise(ok=>setTimeout(ok,5000))]);}
 closeSync(serverLog);closeSync(testLog);
 if(created){if(docker(["inspect","--format",'{{index .Config.Labels "vorix.fixture"}}',name])!==label)throw Error("Identidade da fixture divergente; limpeza recusada.");docker(["stop",name]);console.log("PostgreSQL descartável encerrado e removido.");}
}
