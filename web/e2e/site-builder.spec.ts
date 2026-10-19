import {test,expect,type Page} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import type {SiteSnapshot} from "../features/sites/types";

const api="http://127.0.0.1:3390";
let scope:{fixtureOnly:boolean;siteBuilderFixture:boolean;initialSiteSnapshot:SiteSnapshot;email:string;password:string;workspaceId:string;siteId:string;slug:string};
let token:string,baseline:SiteSnapshot;
test.beforeAll(async({request})=>{
 scope=await (await request.get(api+"/fixture-only/scope")).json();
 expect(scope.fixtureOnly&&scope.siteBuilderFixture).toBe(true);expect(scope.email).toMatch(/\.invalid$/);
 token=(await (await request.post(api+"/v1/auth/login",{data:{email:scope.email,password:scope.password}})).json()).data.accessToken;
 baseline=scope.initialSiteSnapshot;expect(baseline.content.name).toBe("Empresa de fixture");
 // Compila a rota pública antes de editar: o Fast Refresh do next dev pode
 // recarregar abas já abertas quando uma rota compartilhada é compilada pela primeira vez.
 expect((await request.get(`http://127.0.0.1:3391/s/${scope.slug}`)).ok()).toBe(true);
});
test.beforeEach(async({request})=>{
 const headers={authorization:`Bearer ${token}`},url=`${api}/v1/sites/${scope.siteId}?workspaceId=${scope.workspaceId}`;
 const site=(await (await request.get(`${api}/v1/sites?workspaceId=${scope.workspaceId}`,{headers})).json()).data.sites[0];
 const saved=await request.put(url,{headers,data:{revision:site.revision,draft:baseline}});expect(saved.ok()).toBe(true);
 const revision=(await saved.json()).data.revision;
 expect((await request.post(`${api}/v1/sites/${scope.siteId}/publish?workspaceId=${scope.workspaceId}`,{headers,data:{revision}})).ok()).toBe(true);
});
async function login(page:Page,section="geral"){
 await page.goto("/login");await page.getByLabel("E-mail",{exact:true}).fill(scope.email);await page.getByLabel("Senha",{exact:true}).fill(scope.password);await page.getByRole("button",{name:"Entrar",exact:true}).click();await page.waitForURL(/\/workspaces(?:\/|$)/);
 await page.goto(`/workspaces/${scope.workspaceId}/site?section=${section}`);await expect(page.getByRole("heading",{name:"Meu site",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Pré-visualizar",exact:true})).toBeEnabled();
}
async function section(page:Page,name:string){await page.getByRole("navigation",{name:"Navegação da seção"}).getByRole("button",{name,exact:true}).click();}
async function preview(page:Page){await page.getByRole("button",{name:"Pré-visualizar",exact:true}).click();return page.getByRole("dialog",{name:"Prévia do seu site"}).frameLocator('iframe[title="Prévia do seu site"]');}
async function closePreview(page:Page){await page.keyboard.press("Escape");await expect(page.getByRole("dialog",{name:"Prévia do seu site"})).toHaveCount(0);}
async function save(page:Page){await page.getByRole("button",{name:"Salvar rascunho",exact:true}).click();await expect(page.getByText("Rascunho salvo",{exact:true})).toBeVisible();}
async function publish(page:Page){await page.getByRole("button",{name:"Publicar site",exact:true}).click();await page.getByRole("alertdialog").getByRole("button",{name:"Publicar agora",exact:true}).click();await expect(page.getByRole("alertdialog")).toHaveCount(0);}
async function proof(page:Page,name:string,project:string){const dir=path.resolve("../tmp/site-builder-browser/evidence");await mkdir(dir,{recursive:true});await page.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=innerHeight){window.scrollTo(0,y);await new Promise(ok=>setTimeout(ok,70));}window.scrollTo(0,0);});await page.screenshot({path:path.join(dir,`${project}-${name}.png`),fullPage:true});}

test("prévia interativa usa o rascunho sem mudar o site público",async({page,context},info)=>{
 const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));await login(page);
 const name=`Marca personalizada ${info.project.name}`;await page.getByLabel("Nome do site",{exact:true}).fill(name);
 const frame=await preview(page);await expect(frame.getByRole("link",{name:`${name} — início`,exact:true})).toBeVisible();
 await frame.getByRole("link").filter({has:frame.getByRole("heading",{name:"Camiseta de fixture",exact:true})}).click();await expect(frame.getByRole("heading",{name:"Camiseta de fixture",exact:true})).toBeVisible();await expect(frame.getByRole("button",{name:"Envio desabilitado na prévia",exact:true})).toBeDisabled();
 await closePreview(page);const visitor=await context.newPage();await visitor.goto(`/s/${scope.slug}`);await expect(visitor.getByRole("link",{name:"Empresa de fixture — início",exact:true})).toBeVisible();
 await save(page);await visitor.reload();await expect(visitor.getByRole("link",{name:"Empresa de fixture — início",exact:true})).toBeVisible();await publish(page);await visitor.reload();await expect(visitor.getByRole("link",{name:`${name} — início`,exact:true})).toBeVisible();
 await visitor.close();await proof(page,"editor",info.project.name);expect(errors).toEqual([]);
});

test("três modelos, cores e fontes mudam o resultado mantendo conteúdo",async({page,context},info)=>{
 await login(page,"aparencia");
 for(const [label,template] of [["Catálogo","catalog"],["Institucional","studio"],["Vitrine","showcase"]]){
  await page.getByRole("button",{name:new RegExp(`^${label}`)}).and(page.locator("[aria-pressed]")).click();await save(page);await publish(page);
  const visitor=await context.newPage();await visitor.goto(`/s/${scope.slug}`);await expect(visitor.locator(`.tenant-site-${template}`)).toBeVisible();await expect(visitor.getByRole("heading",{name:"Nosso catálogo",exact:true})).toBeVisible();await expect(visitor.locator(".ts-hero img")).toBeVisible();
  expect(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await proof(visitor,`public-${template}`,info.project.name);await visitor.close();
 }
 await page.getByLabel("Cor principal",{exact:true}).fill("#8B3159");await page.getByLabel("Fonte dos títulos",{exact:true}).selectOption("classic");
 const frame=await preview(page);await expect(frame.getByTestId("tenant-site")).toHaveCSS("--site-primary","#8B3159");await expect(frame.locator("h1")).toHaveCSS("font-family",/Georgia/);await closePreview(page);await save(page);await page.reload();await expect(page.getByLabel("Cor principal",{exact:true})).toHaveValue("#8B3159");
});

test("menu, aviso e rodapé são editáveis e persistem",async({page},info)=>{
 await login(page,"menu");await page.getByLabel("Texto da faixa de aviso",{exact:true}).fill("Atendimento personalizado, do seu jeito");await page.getByLabel("Nome do link 1",{exact:true}).fill("Página inicial");
 await section(page,"Rodapé");await page.getByLabel("Aviso final do rodapé",{exact:true}).fill("Todos os detalhes são da nossa marca");await page.getByRole("button",{name:"Adicionar coluna ao rodapé",exact:true}).click();await page.getByLabel("Título da coluna 1",{exact:true}).fill("Institucional");await page.getByRole("button",{name:"Adicionar link",exact:true}).click();await page.getByLabel("Nome do link 1",{exact:true}).fill("Conheça a empresa");await page.getByLabel("Destino do link 1",{exact:true}).fill("/sobre");
 const frame=await preview(page);await expect(frame.getByText("Atendimento personalizado, do seu jeito",{exact:true})).toBeVisible();await expect(frame.locator("footer").getByRole("heading",{name:"Institucional",exact:true})).toBeVisible();await frame.getByRole("link",{name:"Conheça a empresa",exact:true}).click();await expect(frame.getByRole("heading",{name:"Nossa história",exact:true})).toBeVisible();await proof(page,"preview-navigation",info.project.name);await closePreview(page);await save(page);await page.reload();await expect(page.getByLabel("Aviso final do rodapé",{exact:true})).toHaveValue("Todos os detalhes são da nossa marca");
});

test("seções permitem duplicar, mover, ocultar, desfazer e formatar texto",async({page},info)=>{
 await login(page,"secoes");const rows=page.getByTestId("site-section-row"),count=await rows.count();
 await page.getByRole("button",{name:"Duplicar seção Nosso catálogo",exact:true}).click();await expect(rows).toHaveCount(count+1);await page.getByLabel("Título da seção",{exact:true}).fill("Seleção personalizada");await page.getByRole("button",{name:"Mover seção para cima",exact:true}).click();await expect(rows.nth(2)).toContainText("Seleção personalizada");
 if(info.project.name==="desktop"){
  const handle=page.getByRole("button",{name:"Arrastar seção Seleção personalizada",exact:true});await handle.scrollIntoViewIfNeeded();const start=await handle.boundingBox(),target=await rows.last().boundingBox();expect(start&&target).toBeTruthy();
  await page.mouse.move(start!.x+start!.width/2,start!.y+start!.height/2);await page.mouse.down();await page.mouse.move(target!.x+target!.width/2,target!.y+target!.height/2,{steps:18});await page.mouse.up();await expect(rows.last()).toContainText("Seleção personalizada");
 }
 await page.getByRole("button",{name:"Ocultar seção Seleção personalizada",exact:true}).click();let frame=await preview(page);await expect(frame.getByRole("heading",{name:"Seleção personalizada",exact:true})).toHaveCount(0);await closePreview(page);await page.getByRole("button",{name:"Desfazer alteração",exact:true}).click();frame=await preview(page);await expect(frame.getByRole("heading",{name:"Seleção personalizada",exact:true})).toBeVisible();await closePreview(page);await page.getByRole("button",{name:"Refazer alteração",exact:true}).click();await page.getByRole("button",{name:"Mostrar seção Seleção personalizada",exact:true}).click();
 await page.getByRole("button",{name:"Adicionar seção",exact:true}).click();await page.getByLabel("Título da seção",{exact:true}).fill("Nosso cuidado com você");const text=page.getByRole("textbox",{name:"Texto da seção",exact:true});await text.fill("Conteúdo criado pela própria empresa");await text.press("ControlOrMeta+A");await page.getByRole("button",{name:"Negrito",exact:true}).click();
 frame=await preview(page);await expect(frame.locator("strong").filter({hasText:"Conteúdo criado pela própria empresa"})).toBeVisible();await closePreview(page);await proof(page,"section-editor",info.project.name);await save(page);await page.reload();await expect(page.getByTestId("site-section-row").filter({hasText:"Nosso cuidado com você"})).toBeVisible();
});

test("páginas de rascunho têm prévia e ficam fora da publicação",async({page,context,request},info)=>{
 await login(page,"paginas");await page.getByRole("button",{name:"Adicionar página",exact:true}).click();await page.getByLabel("Título da página",{exact:true}).fill("Cuidados especiais");await page.getByLabel("Endereço da página",{exact:true}).fill("cuidados-especiais");await page.getByLabel("Título da seção",{exact:true}).fill("Um conteúdo só nosso");
 await page.getByRole("button",{name:"Mostrar esta página na prévia",exact:true}).click();const frame=await preview(page);await expect(frame.getByRole("heading",{name:"Cuidados especiais",exact:true})).toBeVisible();await expect(frame.getByRole("heading",{name:"Um conteúdo só nosso",exact:true})).toBeVisible();await closePreview(page);await save(page);await publish(page);
 const visitor=await context.newPage();await visitor.goto(`/s/${scope.slug}/cuidados-especiais`);await expect(visitor.getByRole("heading",{name:"Cuidados especiais",exact:true})).toHaveCount(0);await visitor.close();
 const visibility=page.getByRole("switch",{name:"Incluir esta página na próxima publicação",exact:true});await visibility.click();await expect(visibility).toBeChecked();await save(page);await expect(visibility).toBeChecked();await publish(page);
 const published=(await (await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data;expect(published.content.pages.some((item:{slug:string})=>item.slug==="cuidados-especiais")).toBe(true);
 const publicPage=await context.newPage();await publicPage.goto(`/s/${scope.slug}/cuidados-especiais`);await expect(publicPage.getByRole("heading",{name:"Cuidados especiais",exact:true})).toBeVisible();await proof(publicPage,"custom-page",info.project.name);await publicPage.close();
});

test("banners têm imagens diferentes para celular, carrossel e agendamento",async({page},info)=>{
 await login(page,"banners");const first=page.locator("details").filter({has:page.locator("summary").filter({hasText:/^Banner 1:/})}).last();if(await first.getAttribute("open")===null)await first.locator("summary").first().click();
 const image=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=","base64");await page.getByLabel("Enviar banner 1 para celular",{exact:true}).setInputFiles({name:"mobile-fixture.png",mimeType:"image/png",buffer:image});await expect(page.getByRole("img",{name:"Banner 1 para celular",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Adicionar banner",exact:true}).click();await page.locator("summary").filter({hasText:/^Banner 2:/}).click();await page.getByLabel("Título do banner 2",{exact:true}).fill("Próxima coleção");await page.getByLabel("Mostrar a partir de (opcional)").last().fill("2099-01-01T09:00");await page.getByLabel("Ocultar depois de (opcional)").last().fill("2099-02-01T09:00");
 const frame=await preview(page);await frame.getByRole("button",{name:"Mostrar banner 2",exact:true}).click();await expect(frame.getByRole("heading",{name:"Próxima coleção",exact:true})).toBeVisible();await page.getByRole("dialog").getByRole("button",{name:"Prévia em celular",exact:true}).click();await expect(page.getByRole("dialog").locator("iframe")).toHaveCSS("width","390px");await proof(page,"mobile-preview",info.project.name);await closePreview(page);await save(page);
});
