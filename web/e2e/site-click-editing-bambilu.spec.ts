import {test,expect} from "@playwright/test";
import {selectSiteTemplate} from "../features/sites/template-state";

test("Bambilu: clicar no conteúdo padrão abre a configuração e só editar altera o rascunho",async({page,request})=>{
 const api="http://127.0.0.1:3390",scope=await(await request.get(api+"/fixture-only/scope")).json();expect(scope.fixtureOnly&&scope.commercialRulesFixture).toBe(true);expect(scope.slug).toBe("bambilu-kids");expect(scope.email).toMatch(/\.invalid$/);
 const token=(await(await request.post(api+"/v1/auth/login",{data:{email:scope.email,password:scope.password}})).json()).data.accessToken,headers={authorization:`Bearer ${token}`},endpoint=`${api}/v1/sites/${scope.siteId}?workspaceId=${scope.workspaceId}`;
 const draft=selectSiteTemplate(structuredClone(scope.initialSiteSnapshot),"nexus");draft.content.blocks=draft.content.blocks.filter(block=>block.type!=="image_text");draft.content.pages=[];
 const site=(await(await request.get(endpoint,{headers})).json()).data;await request.put(endpoint,{headers,data:{revision:site.revision,draft}});const saved=(await(await request.get(endpoint,{headers})).json()).data,before=(await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data;
 await page.setViewportSize({width:1440,height:1000});await page.goto("/login",{waitUntil:"networkidle"});await page.getByLabel("E-mail",{exact:true}).fill(scope.email);await page.getByLabel("Senha",{exact:true}).fill(scope.password);await page.getByRole("button",{name:"Entrar",exact:true}).click();await page.waitForURL(/\/workspaces(?:\/|$)/);await page.goto(`/workspaces/${scope.workspaceId}/site?section=paginas`);
 await expect(page.getByText("Sua primeira página começa aqui",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Criar nova página",exact:true})).toHaveClass(/bg-blue-600/);
 const preview=page.getByRole("region",{name:"Prévia ao vivo",exact:true}),frame=preview.frameLocator("iframe");
 await frame.locator(".fk-editorial h2").click();await expect(page.getByLabel("Título da seção",{exact:true})).toBeFocused();await expect(page.getByLabel("Título da seção",{exact:true})).toHaveValue("Para brincar, descobrir e crescer.");await expect(preview).toContainText("Prévia atualizada");
 await page.getByLabel("Título da seção",{exact:true}).fill("Conheça a nossa marca");await expect(frame.getByRole("heading",{name:"Conheça a nossa marca",exact:true})).toBeVisible();await expect(frame.locator(".fk-editorial")).toHaveCount(1);await expect(preview).toContainText("Alterações não salvas");
 await page.getByRole("switch",{name:"Mostrar esta seção",exact:true}).click();await expect(frame.locator(".fk-editorial")).toHaveCount(0);await page.getByRole("switch",{name:"Mostrar esta seção",exact:true}).click();await expect(frame.locator(".fk-editorial")).toHaveCount(1);
 await frame.locator(".fk-editorial img").click();await expect(page.getByRole("button",{name:"Adicionar imagem — Imagem da seção",exact:true})).toBeFocused();
 const current=(await(await request.get(endpoint,{headers})).json()).data;expect(current.draft).toEqual(saved.draft);expect(current.revision).toBe(saved.revision);expect((await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data.content).toEqual(before.content);
 await page.screenshot({path:"../tmp/site-click-editing/bambilu-default.png"});
});
