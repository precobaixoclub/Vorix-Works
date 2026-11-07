import {test,expect,type Page} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {selectSiteTemplate} from "../features/sites/template-state";
const api="http://127.0.0.1:3390",evidence=path.resolve("../tmp/site-editor-interactions");
let scope:any,headers:Record<string,string>;
test.beforeAll(async({request})=>{scope=await(await request.get(api+"/fixture-only/scope")).json();expect(scope.fixtureOnly&&scope.siteBuilderFixture).toBe(true);expect(scope.email).toMatch(/\.invalid$/);const token=(await(await request.post(api+"/v1/auth/login",{data:{email:scope.email,password:scope.password}})).json()).data.accessToken;headers={authorization:`Bearer ${token}`};await mkdir(evidence,{recursive:true});});
const endpoint=()=>`${api}/v1/sites/${scope.siteId}?workspaceId=${scope.workspaceId}`;
async function login(page:Page,section="geral"){await page.goto("/login");await page.getByLabel("E-mail",{exact:true}).fill(scope.email);await page.getByLabel("Senha",{exact:true}).fill(scope.password);await page.getByRole("button",{name:"Entrar",exact:true}).click();await page.waitForURL(/\/workspaces(?:\/|$)/);await page.goto(`/workspaces/${scope.workspaceId}/site?section=${section}`);await expect(page.getByRole("heading",{name:"Meu site",exact:true})).toBeVisible();}
const preview=(page:Page)=>page.getByRole("region",{name:"Prévia ao vivo",exact:true});
const frame=(page:Page)=>preview(page).frameLocator("iframe");
async function section(page:Page,name:string){await page.getByRole("navigation",{name:"Navegação da seção"}).getByRole("button",{name,exact:true}).click();}
async function noOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}

test("edição ao vivo acompanha os campos nos seis modelos sem salvar nem publicar",async({page,request},info)=>{
 test.setTimeout(180000);const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 for(const id of ["nexus","aura","pulse","catalog","showcase","studio"]){
  const site=(await(await request.get(endpoint(),{headers})).json()).data;expect((await request.put(endpoint(),{headers,data:{revision:site.revision,draft:selectSiteTemplate(scope.initialSiteSnapshot,id)}})).ok()).toBe(true);
  const before=(await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data;
  if(id==="nexus")await login(page);else await page.goto(`/workspaces/${scope.workspaceId}/site?section=geral`);
  const name=`Marca ${id} ao vivo`;await page.getByLabel("Nome do site",{exact:true}).fill(name);await expect(preview(page)).toBeVisible();await expect(frame(page).getByRole("link",{name:`${name} — início`,exact:true})).toBeVisible();await expect(preview(page)).toContainText("Alterações não salvas");
  await section(page,"Rodapé");const footer=page.getByLabel("Texto do rodapé",{exact:true});await footer.fill(`Mensagem em tempo real ${id}`);await expect(frame(page).locator("[data-site-preview-active]")).toContainText(`Mensagem em tempo real ${id}`);await expect.poll(()=>frame(page).locator("body").evaluate(element=>element.ownerDocument.defaultView!.scrollY)).toBeGreaterThan(100);await expect(footer).toBeFocused();await noOverflow(page);
  await preview(page).getByRole("button",{name:"Acompanhar edição",exact:true}).click();await section(page,"Sua marca");await page.getByLabel("Nome do site",{exact:true}).fill(name+" livre");await expect(frame(page).locator("[data-site-preview-active]")).toHaveCount(0);await preview(page).getByRole("button",{name:"Acompanhar edição",exact:true}).click();await expect.poll(()=>frame(page).locator("body").evaluate(element=>element.ownerDocument.defaultView!.scrollY)).toBe(0);
  expect((await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data.content).toEqual(before.content);expect((await(await request.get(endpoint(),{headers})).json()).data.draft.content.name).toBe(scope.initialSiteSnapshot.content.name);
 }
 await page.screenshot({path:path.join(evidence,`${info.project.name}-live.png`),fullPage:true});expect(errors).toEqual([]);
});

test("links oferecem destinos guiados e completam o endereço do outro site",async({page,request},info)=>{
 const site=(await(await request.get(endpoint(),{headers})).json()).data;await request.put(endpoint(),{headers,data:{revision:site.revision,draft:selectSiteTemplate(scope.initialSiteSnapshot,"nexus")}});await login(page,"menu");
 const kind=page.getByLabel("Tipo de destino — Destino do link 1",{exact:true}),destination=()=>page.getByLabel("Destino do link 1",{exact:true});
 await kind.selectOption("page");await destination().selectOption("/sobre");await expect(frame(page).locator('header a[href$="/sobre"]').first()).toHaveAttribute("href",`/s/${scope.slug}/sobre`);
 await kind.selectOption("section");await destination().selectOption("#catalogo");await expect(frame(page).locator('header a[href$="#catalogo"]').first()).toBeAttached();
 await kind.selectOption("external");await destination().fill("www.example.com/colecao");await page.getByLabel("Nome do link 1",{exact:true}).click();await expect(destination()).toHaveValue("https://www.example.com/colecao");
 await kind.selectOption("whatsapp");await destination().fill("55 (11) 99999-9999");await expect(destination()).toHaveValue("5511999999999");await expect(frame(page).locator('header a[href="https://wa.me/5511999999999"]').first()).toBeAttached();
 await kind.selectOption("email");await destination().fill("contato@example.com");await expect(frame(page).locator('header a[href="mailto:contato@example.com"]').first()).toBeAttached();
 await noOverflow(page);await page.screenshot({path:path.join(evidence,`${info.project.name}-links.png`),fullPage:true});
});

test("botão azul de imagem abre o seletor, troca e remove com prévia imediata",async({page,request},info)=>{
 const site=(await(await request.get(endpoint(),{headers})).json()).data;await request.put(endpoint(),{headers,data:{revision:site.revision,draft:selectSiteTemplate(scope.initialSiteSnapshot,"nexus")}});await login(page);
 const add=page.getByRole("button",{name:"Adicionar imagem — Logo",exact:true});await expect(add).toBeVisible();await expect(add).toHaveClass(/bg-blue-600/);
 const chooser=page.waitForEvent("filechooser");await add.click();await(await chooser).setFiles({name:"logo.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWNYtfvMf2TMQLoAAL4eMwFtMcU2AAAAAElFTkSuQmCC","base64")});await expect(page.getByRole("button",{name:"Trocar imagem — Logo",exact:true})).toBeVisible();await expect(frame(page).locator("header img").first()).toBeVisible();
 const logo=page.getByRole("img",{name:"Logo",exact:true});await expect(logo).toBeVisible();await logo.locator("..").getByRole("button",{name:"Remover imagem",exact:true}).click();await expect(add).toBeVisible();await expect(frame(page).locator("header img")).toHaveCount(0);await noOverflow(page);await page.screenshot({path:path.join(evidence,`${info.project.name}-images.png`),fullPage:true});
});

test("prévia segue banner específico e os blocos de páginas internas",async({page,request},info)=>{
 const draft=selectSiteTemplate(structuredClone(scope.initialSiteSnapshot),"nexus"),hero=draft.content.blocks.find(block=>block.type==="hero")!;hero.slides=[{id:"a",enabled:true,title:"Primeiro banner",text:"Primeiro",imageAlt:""},{id:"b",enabled:true,title:"Segundo banner",text:"Segundo",imageAlt:""}];
 const site=(await(await request.get(endpoint(),{headers})).json()).data;await request.put(endpoint(),{headers,data:{revision:site.revision,draft}});await login(page,"banners");const summary=page.locator("summary").filter({hasText:/^Banner 2:/});await summary.click();await page.getByLabel("Título do banner 2",{exact:true}).fill("Editando a segunda campanha");await expect(frame(page).getByRole("heading",{name:"Editando a segunda campanha",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Adicionar imagem — Banner 2 para celular",exact:true}).focus();await expect(preview(page).locator("iframe")).toHaveCSS("width","390px");
 await section(page,"Páginas");await expect(frame(page).getByRole("heading",{name:"Nossa história",exact:true})).toBeVisible();await page.getByLabel("Título da seção",{exact:true}).fill("Conteúdo interno em tempo real");await expect(frame(page).locator("[data-site-preview-active]")).toContainText("Conteúdo interno em tempo real");await expect(preview(page)).toBeInViewport({ratio:0.8});await expect(frame(page).locator("[data-site-preview-active]")).toBeInViewport();await noOverflow(page);await page.screenshot({path:path.join(evidence,`${info.project.name}-page.png`),fullPage:true});
});

test("prévia ocupa a área disponível e permite ampliar sem alterar o rascunho",async({page,request},info)=>{
 test.setTimeout(60000);
 const site=(await(await request.get(endpoint(),{headers})).json()).data;
 await request.put(endpoint(),{headers,data:{revision:site.revision,draft:selectSiteTemplate(scope.initialSiteSnapshot,"nexus")}});
 await login(page,"banners");
 const panel=preview(page),canvas=panel.getByTestId("site-preview-canvas"),zoom=panel.getByLabel("Zoom da prévia",{exact:true}),iframe=panel.locator("iframe");
 await expect(iframe).toHaveAttribute("sandbox","allow-same-origin");
 if(info.project.name==="desktop"){
  const area=await panel.boundingBox(),visible=await canvas.boundingBox();expect(area!.width).toBeGreaterThan(700);expect(visible!.height).toBeGreaterThan(550);
 }
 await section(page,"Sua marca");await page.getByLabel("Nome do site",{exact:true}).focus();await expect(panel).toBeInViewport({ratio:0.98});await section(page,"Banners e destaques");
 const initial=(await(await request.get(endpoint(),{headers})).json()).data;
 await panel.getByRole("button",{name:"Prévia em computador",exact:true}).click();await zoom.selectOption("100");await expect(iframe).toHaveCSS("width","1440px");await expect(iframe).toHaveCSS("transform","matrix(1, 0, 0, 1, 0, 0)");
 expect(await canvas.evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);
 await canvas.evaluate(element=>{element.scrollLeft=200;});expect(await canvas.evaluate(element=>element.scrollLeft)).toBeGreaterThan(0);
 await noOverflow(page);
 await zoom.selectOption("fit");await expect.poll(()=>canvas.evaluate(element=>element.scrollLeft)).toBe(0);
 await expect.poll(()=>canvas.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
 const current=(await(await request.get(endpoint(),{headers})).json()).data;expect(current.revision).toBe(initial.revision);expect(current.draft).toEqual(initial.draft);
 await page.getByLabel("Título do banner 1",{exact:true}).fill("Detalhes visíveis em uma prévia maior");await expect(frame(page).getByRole("heading",{name:"Detalhes visíveis em uma prévia maior",exact:true})).toBeVisible();await expect(panel).toContainText("Alterações não salvas");
 await expect.poll(()=>frame(page).locator("[data-site-preview-active]").evaluate(element=>element.getBoundingClientRect().top-Math.max(0,element.ownerDocument.querySelector("header")?.getBoundingClientRect().bottom??0))).toBeGreaterThanOrEqual(16);
 await noOverflow(page);await page.screenshot({path:path.join(evidence,`${info.project.name}-large-preview.png`)});
});
