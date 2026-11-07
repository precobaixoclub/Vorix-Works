import {test,expect} from "@playwright/test";
import {selectSiteTemplate} from "../features/sites/template-state";

test("Banner lateral: orientação coerente e ajuste imediato com salvamento automático, sem publicar",async({page,request})=>{
 const api="http://127.0.0.1:3390",scope=await(await request.get(api+"/fixture-only/scope")).json();
 expect(scope.fixtureOnly&&scope.commercialRulesFixture).toBe(true);expect(scope.email).toMatch(/\.invalid$/);expect(scope.slug).toBe("bambilu-kids");
 const token=(await(await request.post(api+"/v1/auth/login",{data:{email:scope.email,password:scope.password}})).json()).data.accessToken,headers={authorization:`Bearer ${token}`},url=`${api}/v1/sites/${scope.siteId}?workspaceId=${scope.workspaceId}`;
 const draft=selectSiteTemplate(structuredClone(scope.initialSiteSnapshot),"nexus"),hero=draft.content.blocks.find(block=>block.type==="hero")!;
 draft.layoutConfig!.heroImageUrl=hero.imageUrl??hero.slides?.[0]?.imageUrl;hero.style=undefined;
 const initial=(await(await request.get(url,{headers})).json()).data;expect((await request.put(url,{headers,data:{revision:initial.revision,draft}})).ok()).toBe(true);
 const saved=(await(await request.get(url,{headers})).json()).data,before=(await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data;
 await page.setViewportSize({width:1440,height:1000});await page.goto("/login",{waitUntil:"networkidle"});await page.getByLabel("E-mail",{exact:true}).fill(scope.email);await page.getByLabel("Senha",{exact:true}).fill(scope.password);await page.getByRole("button",{name:"Entrar",exact:true}).click();await page.waitForURL(/\/workspaces(?:\/|$)/);
 await page.goto(`/workspaces/${scope.workspaceId}/site?section=banners`);
 await expect(page.getByText("Tamanho recomendado: 1200 × 1500 px · proporção 4:5.",{exact:true})).toHaveCount(3);
 const preview=page.getByRole("region",{name:"Prévia ao vivo",exact:true}),frame=preview.frameLocator("iframe"),photo=frame.locator(".fk-hero-visual img"),fit=page.getByLabel("Ajuste da imagem",{exact:true});
 await expect(photo).toHaveCSS("object-fit","cover");
 await fit.selectOption("contain");await expect(photo).toHaveCSS("object-fit","contain");await expect(preview).toContainText("Aguardando salvamento automático");await expect(page.getByText("A foto aparece inteira.",{exact:false})).toBeVisible();
 await fit.selectOption("cover");await expect(photo).toHaveCSS("object-fit","cover");await expect(page.getByText("A foto ocupa toda a área do banner",{exact:false})).toBeVisible();
 await page.screenshot({path:"../tmp/banner-fill/editor-desktop.png"});
 await page.setViewportSize({width:390,height:844});await preview.getByRole("button",{name:"Prévia em celular",exact:true}).click();await expect(photo).toHaveCSS("object-fit","contain");
 await expect(page.getByText("Rascunho salvo automaticamente",{exact:true})).toBeVisible();await expect.poll(async()=>(await(await request.get(url,{headers})).json()).data.draft.content.blocks.find((block:any)=>block.type==="hero")?.style?.imageFit).toBe("cover");expect((await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data.content).toEqual(before.content);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
