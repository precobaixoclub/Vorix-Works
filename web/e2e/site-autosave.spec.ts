import {test,expect,type Page} from "@playwright/test";
import {mkdir} from "node:fs/promises";

test("publicação anterior restaura as condições antigas com a revisão comercial atual",async({page,request},info)=>{
 const current=(await(await request.get(endpoint(),{headers})).json()).data;
 const baseline=(await(await request.get(`${api}/v1/sites/${scope.siteId}/commerce-draft?workspaceId=${scope.workspaceId}`,{headers})).json()).data;
 expect(baseline.rules.length).toBeGreaterThan(0);
 const firstDraft={...current.draft,content:{...current.draft.content,name:"Primeira publicação"},commerceConfig:{...baseline,settings:{...baseline.settings,mode:"SHOWCASE"},rules:baseline.rules.map((rule:any)=>({...rule,definition:{...rule.definition,name:"Condição anterior"}}))}};
 const firstSaved=(await(await request.put(endpoint(),{headers,data:{revision:current.revision,draft:firstDraft}})).json()).data;
 const firstResponse=await request.post(`${api}/v1/sites/${scope.siteId}/publish?workspaceId=${scope.workspaceId}`,{headers,data:{revision:firstSaved.revision}});expect(firstResponse.ok()).toBe(true);const first=(await firstResponse.json()).data;
 const secondDraft={...first.draft,content:{...first.draft.content,name:"Segunda publicação"},commerceConfig:{...first.draft.commerceConfig,settings:{...first.draft.commerceConfig.settings,mode:"WHATSAPP_CART"},rules:first.draft.commerceConfig.rules.map((rule:any)=>({...rule,definition:{...rule.definition,name:"Condição atual"}}))}};
 const secondSaved=(await(await request.put(endpoint(),{headers,data:{revision:first.revision,draft:secondDraft}})).json()).data;
 const secondResponse=await request.post(`${api}/v1/sites/${scope.siteId}/publish?workspaceId=${scope.workspaceId}`,{headers,data:{revision:secondSaved.revision}});expect(secondResponse.ok()).toBe(true);const second=(await secondResponse.json()).data;
 expect(second.published.commerceConfig.baseVersion).not.toBe(first.published.commerceConfig.baseVersion);
 await login(page);await section(page,"Endereço e domínio");await page.getByText("Opções avançadas de publicação",{exact:true}).click();await page.getByRole("button",{name:"Voltar à publicação anterior",exact:true}).click();await page.getByRole("alertdialog").getByRole("button",{name:"Carregar no rascunho",exact:true}).click();await expect(page.getByRole("alertdialog")).toHaveCount(0);await saved(page);
 const staged=(await(await request.get(endpoint(),{headers})).json()).data;
 expect(staged.draft.content.name).toBe("Primeira publicação");expect(staged.draft.commerceConfig.settings.mode).toBe("SHOWCASE");expect(staged.draft.commerceConfig.rules[0].definition.name).toBe("Condição anterior");expect(staged.draft.commerceConfig.baseVersion).toBe(second.published.commerceConfig.baseVersion);
 expect((await(await request.get(commerce(),{headers})).json()).data.settings.mode).toBe("WHATSAPP_CART");
 await publish(page);expect((await(await request.get(commerce(),{headers})).json()).data.settings.mode).toBe("SHOWCASE");expect((await(await request.get(rules(),{headers})).json()).data[0].name).toBe("Condição anterior");expect((await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data.content.name).toBe("Primeira publicação");
 await page.screenshot({path:`../tmp/site-autosave/${info.project.name}-previous-publication.png`});
});
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
 const draft={...structuredClone(scope.initialSiteSnapshot),siteSlug:scope.slug,commerceConfig:{...originalCommerce,baseVersion:live.baseVersion}};
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
 await page.getByRole("button",{name:"Adicionar rede social",exact:true}).click();await page.getByRole("button",{name:"Adicionar rede social",exact:true}).click();const selects=page.getByRole("combobox",{name:/Rede social/});await selects.last().selectOption("tiktok");const index=await selects.count();await page.getByLabel(`Link do perfil ${index}`,{exact:true}).fill("https://www.tiktok.com/@loja.fixture");await saved(page);
 const icon=frame(page).locator("footer").getByRole("link",{name:"TikTok",exact:true});await expect(icon).toHaveAttribute("href","https://www.tiktok.com/@loja.fixture");await expect(icon.locator("svg")).toHaveCount(1);await expect(icon).toHaveAttribute("rel","noopener noreferrer");await icon.click();await expect(page.getByLabel(`Link do perfil ${index}`,{exact:true})).toBeFocused();
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

test("endereço e domínio têm edição automática, instruções e publicação explícita",async({page,request},info)=>{
 await page.route(/\/v1\/sites\?workspaceId=/,async route=>{const response=await route.fetch();const body=await response.json();body.data.customDomainTarget="203.0.113.10";await route.fulfill({response,json:body});});
 await login(page);await section(page,"Endereço e domínio");
 const nextSlug=`loja-${info.project.name}-nova`;await page.getByLabel("Endereço",{exact:true}).fill(nextSlug);await page.getByLabel("Endereço",{exact:true}).press("Tab");await saved(page);
 const staged=(await(await request.get(endpoint(),{headers})).json()).data;expect(staged.slug).toBe(scope.slug);expect(staged.draft.siteSlug).toBe(nextSlug);expect((await request.get(`${api}/v1/public/sites/${nextSlug}`)).status()).toBe(404);
 await page.reload();await expect(page.getByLabel("Endereço",{exact:true})).toHaveValue(nextSlug);await expect(page.getByText(/endereço só muda ao publicar/)).toBeVisible();
 await page.getByLabel("Seu domínio",{exact:true}).fill(`${info.project.name}.loja-fixture-exemplo.com.br`);await page.getByRole("button",{name:"Gerar instruções",exact:true}).click();await expect(page.getByText("203.0.113.10",{exact:true})).toBeVisible();await page.locator("summary").filter({hasText:"Onde criar os registros"}).click();expect(await page.getByRole("link",{name:"Abrir orientação oficial do provedor",exact:true}).count()).toBe(4);
 await publish(page);expect((await(await request.get(endpoint(),{headers})).json()).data.slug).toBe(nextSlug);expect((await request.get(`${api}/v1/public/sites/${nextSlug}`)).ok()).toBe(true);
 if(scope.slug==="bambilu-kids"){const current=(await(await request.get(endpoint(),{headers})).json()).data;expect(current.draft.theme.storefrontVariant).toBe("fashion-kids");await expect(frame(page).locator(".tenant-site-fashion-kids")).toBeVisible();}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`../tmp/site-autosave/${info.project.name}-address.png`});
});

test("configurações mantêm somente o produto ativo, inclusive após recarregar",async({page},info)=>{
 await page.route("**/v1/solutions",route=>route.fulfill({json:{ok:true,data:{solutions:["site","conversations","meetings","marketing"].map(key=>({key,name:`Vorix ${key}`,internal:false}))}}}));
 await login(page);
 for(const solution of ["site","conversations","meetings","marketing"]){
  await page.evaluate(value=>sessionStorage.setItem("vorix:active-solution",value),solution);await page.goto(`/workspaces/${scope.workspaceId}/settings`);const nav=page.getByRole("navigation",{name:"Navegação da seção",exact:true});
  await expect(nav.getByRole("button",{name:"Geral",exact:true})).toBeVisible();await expect(nav.getByRole("button",{name:solution==="site"?"Endereço e domínio":solution==="conversations"?"Atendimento":solution==="meetings"?"Contas de gravação":"Marca",exact:true})).toHaveCount(1);
  await expect(nav.getByRole("button",{name:solution==="site"?"Atendimento":"Endereço e domínio",exact:true})).toHaveCount(0);await expect(page.getByText("Contato automático (CRM)",{exact:true})).toHaveCount(solution==="conversations"?1:0);
 }
 await page.evaluate(()=>sessionStorage.setItem("vorix:active-solution","site"));await page.goto(`/workspaces/${scope.workspaceId}/settings/attendance`);await page.waitForURL(new RegExp(`/workspaces/${scope.workspaceId}/settings$`));await expect(page.getByRole("navigation",{name:"Navegação da seção"}).getByRole("button",{name:"Atendimento",exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`../tmp/site-autosave/${info.project.name}-settings.png`});
});

test("textos do modelo e do formulário abrem pelo clique e aparecem na prévia",async({page,request},info)=>{
 await login(page);await region(page).getByRole("button",{name:"Prévia em computador",exact:true}).click();await frame(page).locator('[data-site-text="fk.headerNote"]').click();await expect(page.getByLabel("Frase do cabeçalho",{exact:true})).toBeFocused();await page.getByLabel("Frase do cabeçalho",{exact:true}).fill("Peças feitas para você");await expect(frame(page).getByText("Peças feitas para você",{exact:true})).toBeVisible();
 if(info.project.name==="mobile")await region(page).getByRole("button",{name:"Prévia em celular",exact:true}).click();await frame(page).locator('[data-site-text="form.name"]').first().click();await expect(page.getByLabel("Formulário: campo nome",{exact:true})).toBeFocused();await page.getByLabel("Formulário: campo nome",{exact:true}).fill("Sua identificação");await expect(frame(page).getByRole("textbox",{name:"Sua identificação",exact:true})).toBeVisible();
 await page.getByLabel("Formulário: botão enviar",{exact:true}).fill("Quero conversar");await expect(frame(page).getByRole("button",{name:"Quero conversar",exact:true})).toBeDisabled();await saved(page);
 const current=(await(await request.get(endpoint(),{headers})).json()).data;expect(current.draft.content.texts["form.submit"]).toBe("Quero conversar");expect((await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data.content.texts?.["form.submit"]).not.toBe("Quero conversar");
 await page.screenshot({path:`../tmp/site-autosave/${info.project.name}-editable-texts.png`});
});
