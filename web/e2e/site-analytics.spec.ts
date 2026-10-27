import {test,expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import path from "node:path";
test("site metrics, funnel, filters, journey, future event consumer and empty site on every screen",async({page,request},info)=>{
 const scope=await (await request.get("http://127.0.0.1:3890/fixture-only/scope")).json();expect(scope.fixtureOnly).toBe(true);
 const visit=page.waitForResponse(r=>r.url().includes("/api/tenant-site/commerce/events")&&r.request().postDataJSON()?.type==="SITE_VIEW");
 await page.goto(`/s/${scope.slug}/produto/camiseta-analytics?utm_source=browser&utm_campaign=qa`);expect((await visit).status()).toBe(204);await expect(page.getByRole("heading",{name:"Camiseta Analytics",exact:true})).toBeVisible();
 await page.goto("/login");await page.getByLabel("E-mail",{exact:true}).fill(scope.email);await page.getByLabel("Senha",{exact:true}).fill(scope.password);await page.getByRole("button",{name:"Entrar",exact:true}).click();await page.waitForURL(/\/workspaces(?:\/|$)/);
 await page.goto(`/workspaces/${scope.workspaceId}/site/analytics`);await expect(page.getByRole("heading",{name:"Funil comercial",exact:true})).toBeVisible({timeout:15000});
 await expect(page.getByText("Camiseta Analytics",{exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"Origem e campanhas",exact:true})).toBeVisible();
 if(!scope.futureSeeded)await expect(page.getByText("Checkouts iniciados",{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 const dir=path.resolve("../tmp/site-analytics-evidence");await mkdir(dir,{recursive:true});await page.screenshot({path:path.join(dir,`${info.project.name}-dashboard.png`),fullPage:true});
 const journey=page.getByRole("button").filter({hasText:/VX-/}).first();await journey.click();const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();await expect(dialog.getByText("Visualizou produto",{exact:true})).toBeVisible();await page.keyboard.press("Escape");
 await page.getByLabel("Período",{exact:true}).selectOption("7d");await expect(page.getByRole("heading",{name:"Funil comercial",exact:true})).toBeVisible();
 await page.getByLabel("Origem",{exact:true}).fill("instagram");await expect(page.getByText("instagram",{exact:true}).first()).toBeVisible();await page.getByLabel("Origem",{exact:true}).fill("");
 await request.post("http://127.0.0.1:3890/fixture-only/future-events");await page.getByRole("button",{name:"Atualizar",exact:true}).click();await expect(page.getByText("Checkouts iniciados",{exact:true})).toBeVisible();
 await page.getByLabel("Site",{exact:true}).selectOption(scope.emptySiteId);await expect(page.getByRole("heading",{name:"Ainda não há dados suficientes.",exact:true})).toBeVisible();await expect(page.getByText("0%",{exact:true})).toHaveCount(0);await page.screenshot({path:path.join(dir,`${info.project.name}-empty.png`),fullPage:true});
});
