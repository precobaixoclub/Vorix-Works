import {defineConfig} from "@playwright/test";
export default defineConfig({
 testDir:"./e2e",testMatch:"marketplace-phase1.spec.ts",fullyParallel:false,workers:1,retries:0,timeout:60000,
 reporter:[["list"]],use:{baseURL:"http://localhost:3264",channel:"chrome",trace:"retain-on-failure"},
 webServer:{command:"node node_modules/next/dist/bin/next start -p 3264",url:"http://localhost:3264",reuseExistingServer:false,timeout:60000},
 projects:[390,768,1024,1440].map(width=>({name:String(width),use:{viewport:{width,height:1000}}})),
});
