import {test,expect,type Page} from "@playwright/test";
import {selectSiteTemplate} from "../features/sites/template-state";
const api="http://127.0.0.1:3390";
test.use({actionTimeout:15000});
let scope:any,headers:Record<string,string>;
test.beforeAll(async({request})=>{scope=await(await request.get(api+"/fixture-only/scope")).json();expect(scope.fixtureOnly&&scope.siteBuilderFixture).toBe(true);expect(scope.email).toMatch(/\.invalid$/);const login=await(await request.post(api+"/v1/auth/login",{data:{email:scope.email,password:scope.password}})).json();headers={authorization:`Bearer ${login.data.accessToken}`};});
const endpoint=()=>`${api}/v1/sites/${scope.siteId}?workspaceId=${scope.workspaceId}`;
async function login(page:Page,section="geral"){await page.goto("/login",{waitUntil:"networkidle"});await page.getByLabel("E-mail",{exact:true}).fill(scope.email);await page.getByLabel("Senha",{exact:true}).fill(scope.password);await page.getByRole("button",{name:"Entrar",exact:true}).click();await page.waitForURL(/\/workspaces(?:\/|$)/);await page.goto(`/workspaces/${scope.workspaceId}/site?section=${section}`);}
const preview=(page:Page)=>page.getByRole("region",{name:"Prévia ao vivo",exact:true});
const frame=(page:Page)=>preview(page).frameLocator("iframe");
async function section(page:Page,name:string){await page.getByRole("navigation",{name:"Navegação da seção"}).getByRole("button",{name,exact:true}).click();}

test("clique na prévia abre os campos nos seis modelos sem salvar nem publicar",async({page,request},info)=>{
 test.setTimeout(180000);const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 for(const template of ["nexus","aura","pulse","catalog","showcase","studio"]){
  const site=(await(await request.get(endpoint(),{headers})).json()).data;expect((await request.put(endpoint(),{headers,data:{revision:site.revision,draft:selectSiteTemplate(structuredClone(scope.initialSiteSnapshot),template)}})).ok()).toBe(true);
  const saved=(await(await request.get(endpoint(),{headers})).json()).data,before=(await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data;
  if(template==="nexus")await login(page);else await page.goto(`/workspaces/${scope.workspaceId}/site?section=geral`);
  await expect(preview(page).getByRole("button",{name:"Selecionar elementos para editar",exact:true})).toHaveAttribute("aria-pressed","true");await expect(preview(page)).toContainText("Role a prévia e clique em uma área");
  await frame(page).locator(".premium-brand,.ts-brand,.fk-brand").first().click();await expect(page.getByLabel("Nome do site",{exact:true})).toBeFocused();
  await frame(page).locator("[data-site-block=hero] h1").click();await expect(page.getByLabel("Título do banner 1",{exact:true})).toBeFocused();await expect(preview(page)).toContainText("Prévia atualizada");
  await page.getByLabel("Título do banner 1",{exact:true}).fill(`Edição por clique ${template}`);await expect(frame(page).getByRole("heading",{name:`Edição por clique ${template}`,exact:true})).toBeVisible();
  await frame(page).locator(".ts-footer-brand p").click();await expect(page.getByLabel("Texto do rodapé",{exact:true})).toBeFocused();
  const current=(await(await request.get(endpoint(),{headers})).json()).data;expect(current.draft).toEqual(saved.draft);expect(current.revision).toBe(saved.revision);expect((await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data.content).toEqual(before.content);
 }
 expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`../tmp/site-click-editing/${info.project.name}-selection.png`});
});

test("itens, imagens e links abrem sua configuração específica",async({page,request})=>{
 const draft=selectSiteTemplate(structuredClone(scope.initialSiteSnapshot),"nexus"),hero=draft.content.blocks.find(block=>block.type==="hero")!;
 draft.layoutConfig!.heroImageUrl=hero.imageUrl;draft.content.blocks.push({id:"gallery",type:"gallery",title:"Momentos",text:"",enabled:true,imageAlt:"",productIds:[],items:[],images:[{id:"photo-a",url:hero.imageUrl!,alt:"Primeira foto",caption:"Primeira"},{id:"photo-b",url:hero.imageUrl!,alt:"Segunda foto",caption:"Segunda"}]});
 draft.content.footerColumns=[{id:"first-column",title:"Primeira coluna",links:[{id:"first-link",label:"Primeiro destino",url:"/sobre",enabled:true,newTab:false}]},{id:"second-column",title:"Segunda coluna",links:[{id:"second-link",label:"Segundo destino",url:"/sobre",enabled:true,newTab:true}]}];
 const site=(await(await request.get(endpoint(),{headers})).json()).data;await request.put(endpoint(),{headers,data:{revision:site.revision,draft}});await login(page);
 await frame(page).locator("[data-site-block=features] [data-site-item='1'] h3").click();await expect(page.getByLabel("Título do item 2",{exact:true})).toBeFocused();
 await frame(page).locator("[data-site-block=gallery] [data-site-image=photo-b] img").click();await expect(page.getByRole("button",{name:"Trocar imagem — Imagem da galeria 2",exact:true})).toBeFocused();
 await frame(page).locator("[data-site-footer-column=second-column] a").click();await expect(page.getByLabel("Nome do link 1",{exact:true}).last()).toBeFocused();await expect(page.getByLabel("Nome do link 1",{exact:true}).last()).toHaveValue("Segundo destino");expect(page.context().pages()).toHaveLength(1);
 await section(page,"Banners e destaques");
 // The banner uses a background image behind a transparent layout. Click its visible
 // area with coordinates corrected for the iframe scale instead of targeting the covered img.
 const point=await frame(page).locator(".nexus-hero-layout").evaluate(element=>{const doc=element.ownerDocument,view=doc.defaultView!,headerHeight=doc.querySelector("header")!.getBoundingClientRect().height,top=element.getBoundingClientRect().top+view.scrollY;view.scrollTo({top:Math.max(0,top-headerHeight-20),behavior:"instant"});const rect=element.getBoundingClientRect();return {x:rect.right-24,y:rect.top+20,viewport:view.innerWidth};});
 const bounds=(await preview(page).locator("iframe").boundingBox())!,scale=bounds.width/point.viewport;await page.mouse.click(bounds.x+point.x*scale,bounds.y+point.y*scale);
 await expect(page.getByRole("button",{name:"Trocar imagem — Imagem exclusiva deste modelo",exact:true})).toBeFocused();await expect(page.locator('[data-site-editor-selected][data-site-field-label="Imagem exclusiva deste modelo"]')).toBeVisible();
});

test("navegação livre e seleção de conteúdo em outra página",async({page,request})=>{
 const draft=selectSiteTemplate(structuredClone(scope.initialSiteSnapshot),"nexus");draft.content.pages.unshift({slug:"outra",title:"Outra página",seoDescription:"",published:true,blocks:[{...structuredClone(draft.content.pages[0].blocks[0]),id:"other-block",title:"Outro conteúdo"}]});
 const site=(await(await request.get(endpoint(),{headers})).json()).data;await request.put(endpoint(),{headers,data:{revision:site.revision,draft}});await login(page);
 await preview(page).getByRole("button",{name:"Testar navegação da prévia",exact:true}).click();if(await frame(page).getByRole("button",{name:"Abrir menu",exact:true}).isVisible())await frame(page).getByRole("button",{name:"Abrir menu",exact:true}).click();await frame(page).locator('header [data-site-link=about]:visible').click();await expect(frame(page).getByRole("heading",{name:"Nossa história",exact:true})).toBeVisible();
 await preview(page).getByRole("button",{name:"Selecionar elementos para editar",exact:true}).click();await frame(page).locator('[data-site-block=about] p').click();await expect(page.getByRole("textbox",{name:"Texto da seção",exact:true})).toBeFocused();await expect(page.getByRole("button",{name:"Recolher página: Sobre a empresa",exact:true})).toBeVisible();
 await page.getByRole("textbox",{name:"Texto da seção",exact:true}).fill("História escolhida diretamente na prévia");await expect(frame(page).getByText("História escolhida diretamente na prévia",{exact:true})).toBeVisible();
 await page.getByLabel("Endereço da página",{exact:true}).fill("historia-atualizada");await expect(frame(page).getByText("História escolhida diretamente na prévia",{exact:true})).toBeVisible();await expect(preview(page)).toContainText("/historia-atualizada");
});

test("páginas expandem, recolhem e criam pelo botão azul sem perder o conteúdo",async({page,request},info)=>{
 const site=(await(await request.get(endpoint(),{headers})).json()).data;await request.put(endpoint(),{headers,data:{revision:site.revision,draft:selectSiteTemplate(structuredClone(scope.initialSiteSnapshot),"nexus")}});await login(page,"paginas");
 const create=page.getByRole("button",{name:"Criar nova página",exact:true});await expect(create).toHaveClass(/bg-blue-600/);await create.click();await expect(page.getByLabel("Título da página",{exact:true})).toBeFocused();await page.getByLabel("Título da página",{exact:true}).fill("Perguntas da loja");await page.getByLabel("Endereço da página",{exact:true}).fill("perguntas");
 await page.getByRole("button",{name:"Recolher página: Perguntas da loja",exact:true}).click();await expect(page.getByLabel("Título da página",{exact:true})).toHaveCount(0);await page.getByRole("button",{name:"Expandir página: Perguntas da loja",exact:true}).click();await expect(page.getByLabel("Título da página",{exact:true})).toHaveValue("Perguntas da loja");await expect(page.getByLabel("Endereço da página",{exact:true})).toHaveValue("perguntas");
 await create.click();await expect(page.getByLabel("Título da página",{exact:true})).toHaveValue("Nova página");await expect(page.getByRole("button",{name:"Expandir página: Perguntas da loja",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Excluir página",exact:true}).click();await page.getByRole("alertdialog").getByRole("button",{name:"Confirmar",exact:true}).click();await expect(page.getByLabel("Título da página",{exact:true})).toHaveValue("Perguntas da loja");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`../tmp/site-click-editing/${info.project.name}-pages.png`});
});
