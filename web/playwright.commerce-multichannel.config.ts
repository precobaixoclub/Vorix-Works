import {defineConfig} from "@playwright/test";
/** Central de Pedidos multicanal, Marketplaces e "Vendas por canal" com a API mockada (page.route). */
export default defineConfig({
 testDir:"./e2e",testMatch:"commerce-multichannel.spec.ts",fullyParallel:false,workers:1,retries:0,timeout:120000,
 reporter:[["list"]],use:{baseURL:"http://localhost:3265",channel:"chrome",trace:"retain-on-failure",acceptDownloads:true},
 webServer:{command:"node node_modules/next/dist/bin/next dev --webpack -p 3265",url:"http://localhost:3265",reuseExistingServer:false,timeout:180000,env:{PLAYWRIGHT_TEST:"1"}},
 projects:[390,768,1024,1440].map(width=>({name:String(width),use:{viewport:{width,height:1000}}})),
});
