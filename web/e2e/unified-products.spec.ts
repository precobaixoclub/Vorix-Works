import {test,expect,type Page} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import path from "node:path";
const api="http://127.0.0.1:3390";
let scope:{fixtureOnly:boolean;tenantId:string;workspaceId:string;email:string;password:string};
test.beforeAll(async({request})=>{scope=await(await request.get(api+"/fixture-only/scope")).json();expect(scope.fixtureOnly).toBe(true);expect(scope.email).toMatch(/\.invalid$/);});
async function login(page:Page){await page.goto("/login");await page.getByLabel("E-mail",{exact:true}).fill(scope.email);await page.getByLabel("Senha",{exact:true}).fill(scope.password);const response=page.waitForResponse(r=>r.url().includes("/v1/auth/login")&&r.request().method()==="POST");await page.getByRole("button",{name:"Entrar",exact:true}).click();const token=(await(await response).json()).data.accessToken;await page.waitForURL(/\/workspaces(?:\/|$)/);await expect(page.getByRole("link",{name:/Empresa de fixture/}).first()).toBeVisible();return {authorization:`Bearer ${token}`};}
async function proof(page:Page,name:string,project:string){const dir=path.resolve("../tmp/unified-products-browser/evidence");await mkdir(dir,{recursive:true});await page.screenshot({path:path.join(dir,`${project}-${name}.png`),fullPage:true});}

test("oferta pública contém três produtos e apresenta Site sem um Commerce separado",async({page},info)=>{
 const response=await page.request.get(api+"/v1/platform/plans");expect(response.status()).toBe(200);expect((await response.json()).data.solutions.map((product:{key:string;contractable:boolean})=>[product.key,product.contractable])).toEqual([["conversations",true],["meetings",true],["site",true]]);
 await page.goto("/produtos/site");await expect(page.getByRole("heading",{name:"O site da sua empresa, conectado à sua operação."})).toBeVisible();await expect(page.getByText("Vorix Commerce",{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await proof(page,"public-site",info.project.name);
 await page.goto("/produtos/meetings");await expect(page.getByText("Recursos apresentados como visão do produto em homologação.",{exact:false})).toHaveCount(0);await expect(page.getByRole("link",{name:/Contratar Meetings/}).first()).toBeVisible();
});

test("admin classifica somente Marketing como interno e libera Meetings por concessão normal",async({page},info)=>{
 const headers=await login(page);const grant=await page.request.put(`${api}/v1/admin/tenants/${scope.tenantId}/solutions/meetings`,{headers,data:{enabled:true,source:"manual",limits:{maxConcurrentRecordings:1},reason:"Fixture — decisão de produto"}});expect(grant.status()).toBe(200);
 const state=(await(await page.request.get(`${api}/v1/admin/tenants/${scope.tenantId}/solutions`,{headers})).json()).data.solutions;expect(state.filter((product:{internal:boolean})=>product.internal).map((product:{key:string})=>product.key)).toEqual([]);expect(state.some((product:{key:string})=>product.key==="commerce")).toBe(false);
 await page.goto(`/admin/tenants/${scope.tenantId}`);await expect(page.getByText("acesso interno",{exact:true})).toHaveCount(1);await expect(page.getByRole("switch",{name:"Desligar Vorix Site",exact:true})).toBeVisible();await expect(page.getByText("Vorix Commerce",{exact:true})).toHaveCount(0);await proof(page,"admin-products",info.project.name);
});

test("endereço antigo e loja online usam o único produto Site",async({page},info)=>{
 await login(page);await page.goto(`/workspaces/${scope.workspaceId}/commerce`);await expect(page).toHaveURL(new RegExp(`/workspaces/${scope.workspaceId}/site$`));await page.goto(`/workspaces/${scope.workspaceId}/site?section=loja`);await expect(page.getByRole("heading",{name:"Loja online",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Ativar compra online"})).toBeDisabled();await expect(page.getByText("Vorix Commerce",{exact:true})).toHaveCount(0);await proof(page,"unified-shop",info.project.name);
});
