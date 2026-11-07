import {test,expect,type Page} from "@playwright/test";
import {mkdir} from "node:fs/promises";
const api="http://127.0.0.1:3390";
let scope:any,headers:Record<string,string>,originalCommerce:any;
const endpoint=()=>`${api}/v1/sites/${scope.siteId}?workspaceId=${scope.workspaceId}`;
const commerce=()=>`${api}/v1/sites/${scope.siteId}/commerce?workspaceId=${scope.workspaceId}`;
const rules=()=>`${api}/v1/sites/${scope.siteId}/commercial-rules?workspaceId=${scope.workspaceId}`;
const region=(page:Page)=>page.getByRole("region",{name:"Prévia ao vivo",exact:true});
const frame=(page:Page)=>region(page).frameLocator("iframe");
const saved=(page:Page)=>expect(page.getByText("Rascunho salvo automaticamente",{exact:true})).toBeVisible();
async function section(page:Page,name:string){await page.getByRole("navigation",{name:"Navegação da seção"}).getByRole("button",{name,exact:true}).click();}
async function login(page:Page){await page.goto("/login",{waitUntil:"networkidle"});await page.getByLabel("E-mail",{exact:true}).fill(scope.email);await page.getByLabel("Senha",{exact:true}).fill(scope.password);await page.getByRole("button",{name:"Entrar",exact:true}).click();await page.waitForURL(/\/workspaces(?:\/|$)/);await page.goto(`/workspaces/${scope.workspaceId}/site?section=geral`);await expect(page.getByLabel("Nome do site",{exact:true})).toBeVisible();}
async function publish(page:Page){await page.getByRole("button",{name:"Publicar site",exact:true}).click();await page.getByRole("alertdialog").getByRole("button",{name:/^Publicar (agora|este modelo)$/}).click();await expect(page.getByRole("alertdialog")).toHaveCount(0);}
test.beforeAll(async({request})=>{scope=await(await request.get(api+"/fixture-only/scope")).json();expect(scope.fixtureOnly&&scope.siteBuilderFixture).toBe(true);expect(scope.email).toMatch(/\.invalid$/);const token=(await(await request.post(api+"/v1/auth/login",{data:{email:scope.email,password:scope.password}})).json()).data.accessToken;headers={authorization:`Bearer ${token}`};originalCommerce=(await(await request.get(`${api}/v1/sites/${scope.siteId}/commerce-draft?workspaceId=${scope.workspaceId}`,{headers})).json()).data;await mkdir("../tmp/site-autosave",{recursive:true});});
test.beforeEach(async({request})=>{const site=(await(await request.get(endpoint(),{headers})).json()).data;const snapshot=structuredClone(scope.initialSiteSnapshot);if(site.published?.commerceConfig)snapshot.commerceConfig=site.published.commerceConfig;const saved=(await(await request.put(endpoint(),{headers,data:{revision:site.revision,draft:snapshot}})).json()).data;expect((await request.post(`${api}/v1/sites/${scope.siteId}/publish?workspaceId=${scope.workspaceId}`,{headers,data:{revision:saved.revision}})).ok()).toBe(true);});
// These are disposable, fictional stores. Restore their commercial baseline so
// publishing a discount here does not change the prices assumed by other specs.
test.afterEach(async({request})=>{
 const site=(await(await request.get(endpoint(),{headers})).json()).data;
 const live=(await(await request.get(`${api}/v1/sites/${scope.siteId}/commerce-draft?workspaceId=${scope.workspaceId}`,{headers})).json()).data;
 const draft={...structuredClone(scope.initialSiteSnapshot),commerceConfig:{...originalCommerce,baseVersion:live.baseVersion}};
 const response=await request.put(endpoint(),{headers,data:{revision:site.revision,draft}});expect(response.ok()).toBe(true);
 const saved=(await response.json()).data;expect((await request.post(`${api}/v1/sites/${scope.siteId}/publish?workspaceId=${scope.workspaceId}`,{headers,data:{revision:saved.revision}})).ok()).toBe(true);
});

test("salva durante a digitação, mantém produção, recupera após falha e restaura",async({page,request},info)=>{
 await login(page);expect(await page.getByRole("button",{name:/Salvar rascunho|Salvar como vender/}).count()).toBe(0);
 const original=(await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data.content.name;
 let intercepted=false,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route("**/v1/sites/*?workspaceId=*",async route=>{if(route.request().method()==="PUT"&&!intercepted){intercepted=true;await gate;}await route.continue();});
 await page.getByLabel("Nome do site",{exact:true}).fill("Primeira digitação");await expect.poll(()=>intercepted).toBe(true);await page.getByLabel("Nome do site",{exact:true}).fill("Digitação enquanto salva");release();await saved(page);
 await expect.poll(async()=>(await(await request.get(endpoint(),{headers})).json()).data.draft.content.name).toBe("Digitação enquanto salva");expect((await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data.content.name).toBe(original);
 await page.reload();await expect(page.getByLabel("Nome do site",{exact:true})).toHaveValue("Digitação enquanto salva");
 let fail=true;await page.route("**/v1/sites/*?workspaceId=*",async route=>{if(route.request().method()==="PUT"&&fail)await route.abort("failed");else await route.fallback();});
 await page.getByLabel("Nome do site",{exact:true}).fill("Mantido após falha");await expect(page.getByRole("alert").filter({hasText:"Suas alterações continuam"})).toBeVisible();await expect(page.getByLabel("Nome do site",{exact:true})).toHaveValue("Mantido após falha");fail=false;await page.getByRole("button",{name:"Tentar novamente",exact:true}).first().click();await saved(page);
 await page.getByRole("button",{name:"Restaurar versão em produção",exact:true}).click();await page.getByRole("alertdialog").getByRole("button",{name:"Restaurar rascunho",exact:true}).click();await expect(page.getByLabel("Nome do site",{exact:true})).toHaveValue(original);await saved(page);await page.reload();await expect(page.getByLabel("Nome do site",{exact:true})).toHaveValue(original);
 await page.getByLabel("Nome do site",{exact:true}).fill("Publicação sem salvar manualmente");await publish(page);expect((await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data.content.name).toBe("Publicação sem salvar manualmente");await page.screenshot({path:`../tmp/site-autosave/${info.project.name}-autosave.png`});
});

test("título de contato e ícones sociais são editáveis e publicáveis",async({page,request},info)=>{
 await login(page);const initial=(await(await request.get(endpoint(),{headers})).json()).data.draft.content.blocks.find((block:any)=>block.type==="contact");
 await frame(page).locator("#contato h2").click();await expect(page.getByLabel("Título da seção",{exact:true})).toBeFocused();await page.getByLabel("Título da seção",{exact:true}).fill("Fale com a nossa equipe");await expect(frame(page).getByRole("heading",{name:"Fale com a nossa equipe",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Adicionar rede social",exact:true}).click();const selects=page.getByRole("combobox",{name:/Rede social/});await selects.last().selectOption("tiktok");const index=await selects.count();await page.getByLabel(`Link do perfil ${index}`,{exact:true}).fill("https://www.tiktok.com/@loja.fixture");await saved(page);
 const icon=frame(page).locator("footer").getByRole("link",{name:"TikTok",exact:true});await expect(icon).toHaveAttribute("href","https://www.tiktok.com/@loja.fixture");await expect(icon.locator("svg")).toHaveCount(1);await expect(icon).toHaveAttribute("rel","noopener noreferrer");
 expect((await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data.content.blocks.find((block:any)=>block.id===initial.id).title).toBe(initial.title);
 await publish(page);const published=(await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data;expect(published.content.blocks.find((block:any)=>block.id===initial.id).title).toBe("Fale com a nossa equipe");expect(published.content.socials.some((link:any)=>link.label==="TikTok")).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`../tmp/site-autosave/${info.project.name}-contact-socials.png`});
});

test("regras e modo de venda compartilham o editor e aguardam publicação",async({page,request},info)=>{
 const ruleName=`Regra em rascunho ${info.project.name}`;await login(page);const production=(await(await request.get(commerce(),{headers})).json()).data.settings,existing=(await(await request.get(rules(),{headers})).json()).data;
 await section(page,"Como vender pelo site");const mode=production.mode==="SHOWCASE"?"WHATSAPP_CART":"SHOWCASE";await page.getByRole("radio",{name:mode==="SHOWCASE"?/Apenas mostrar meus produtos/:/Montar um carrinho/}).check();await saved(page);expect((await(await request.get(commerce(),{headers})).json()).data.settings.mode).toBe(production.mode);
 await section(page,"Regras Comerciais");await expect(region(page)).toBeVisible();await page.getByRole("button",{name:"Criar regra",exact:true}).click();const dialog=page.getByRole("dialog");await dialog.getByLabel("Nome da regra",{exact:true}).fill(ruleName);await dialog.getByLabel("Regra ativa",{exact:true}).check();await dialog.getByRole("button",{name:"Concluir edição",exact:true}).click();await saved(page);expect((await(await request.get(rules(),{headers})).json()).data).toEqual(existing);
 await page.reload();await expect(page.getByTestId("commercial-rule-row").filter({hasText:ruleName})).toBeVisible();await expect(region(page)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`../tmp/site-autosave/${info.project.name}-rules.png`});
 await publish(page);expect((await(await request.get(commerce(),{headers})).json()).data.settings.mode).toBe(mode);expect((await(await request.get(rules(),{headers})).json()).data.some((rule:any)=>rule.name===ruleName)).toBe(true);
});
