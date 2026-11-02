import {test,expect,type Page} from "@playwright/test";
import {loginCookie,mockConversasBackend,WORKSPACE_ID,TENANT_ID} from "./fixtures/mock-backend";

async function fixture(page:Page) {
 await mockConversasBackend(page);
 const now=new Date().toISOString(),label="João da Silva · (46) 99999-9999";
 const stages=["Novo","Negociação","Aguardando faturamento","Ganha","Perdida"].map((name,position)=>({id:`billing-stage-${position}`,pipelineId:"billing-pipeline",name,position,isWon:position===3,isLost:position===4,isAwaitingBilling:position===2,requiredFields:[],createdAt:now}));
 let deal={id:"billing-deal",tenantId:TENANT_ID,workspaceId:WORKSPACE_ID,pipelineId:"billing-pipeline",stageId:stages[2].id,contactId:"contact-old",contactDisplayName:label,billingProposalId:"billing-proposal" as string|undefined,title:"Compra de luminárias",valueCents:19000,currency:"BRL",ownerUserId:"user-qa",valueMode:"manual",status:"open",createdAt:now,updatedAt:now,lastStageChangedAt:now,closedAt:undefined as string|undefined,firstClosedAt:undefined as string|undefined};
 let proposal={id:"billing-proposal",tenantId:TENANT_ID,workspaceId:WORKSPACE_ID,dealId:deal.id,contactId:"contact-old",contactDisplayName:label,title:"Luminárias",number:"PROP-2026-001",version:1,status:"accepted",items:[{name:"Lâmpada",quantity:2,unitPriceCents:9500,subtotalCents:19000}],totalCents:19000,discountCents:0,currency:"BRL",createdAt:now,updatedAt:now,respondedAt:now,billedAt:undefined as string|undefined,billedByUserId:undefined as string|undefined};
 const invoices:unknown[]=[],reopens:Record<string,unknown>[]=[];
 await page.route("**/v1/**",async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  let data:unknown;
  if(path==="/v1/pipelines")data=[{id:"billing-pipeline",name:"Comercial",isDefault:true}];
  else if(path.endsWith("/stages"))data=stages;
  else if(path==="/v1/deals")data=[deal];
  else if(path===`/v1/deals/${deal.id}`)data=deal;
  else if(path===`/v1/deals/${deal.id}/invoice`){invoices.push(req.postDataJSON());proposal={...proposal,status:"invoiced",billedAt:now,billedByUserId:"user-qa"};deal={...deal,status:"won",stageId:stages[3].id,closedAt:now,firstClosedAt:now};data=deal;}
  else if(path===`/v1/deals/${deal.id}/reopen`){const body=req.postDataJSON();reopens.push(body);deal={...deal,status:"open",stageId:body.targetStageId,billingProposalId:undefined,closedAt:undefined};proposal={...proposal,status:"cancelled"};data=deal;}
  else if(path===`/v1/deals/${deal.id}/commercial`)data={dealId:deal.id,status:deal.status,currency:"BRL",valueCents:19000,items:[],totals:{itemCount:0,totalCents:19000,mrrCents:0},visibility:{isManager:true,canViewCost:true,canViewMargin:true},policy:{},evaluation:{health:"healthy",reasons:[],requiresApproval:false},approval:{required:false},probability:{value:20},weightedValueCents:3800,aging:{daysOpen:1,daysInStage:1}};
  else if(path===`/v1/deals/${deal.id}/insights`)data={risks:[],explanations:[],aiAvailable:false,goalImpact:{available:false}};
  else if(path==="/v1/proposals")data=[proposal];
  else if(path.startsWith("/v1/proposals/")&&path.endsWith("/tracking"))data={events:[],deliveries:[],versions:[proposal],recipients:[]};
  else if(path.endsWith("/timeline"))data=[];
  else if(path==="/v1/commercial-settings")data={workspaceId:WORKSPACE_ID,dealVisibility:"all",visibility:{isManager:true,canViewCost:true,canViewMargin:true}};
  else if(path==="/v1/products/stock-risk")data={products:[],deals:[]};
  else if(["/v1/contacts","/v1/tasks","/v1/products","/v1/proposal-templates","/v1/sales-reasons","/v1/sales-competitors","/v1/deal-custom-fields","/v1/price-books"].includes(path))data=[];
  else return route.fallback();
  await route.fulfill({json:{ok:true,data}});
 });
 return {label,invoices,reopens,stages};
}
test.beforeEach(async({context})=>loginCookie(context));

test("proposta antiga resolve o contato canônico e confirma faturamento sem cortar no celular",async({page},info)=>{
 const state=await fixture(page);await page.goto(`/workspaces/${WORKSPACE_ID}/proposals`);
 await expect(page.getByText(state.label,{exact:false}).filter({visible:true})).toBeVisible();
 await expect(page.getByText("Aceita — aguardando faturamento",{exact:true})).toBeVisible();
 await page.getByPlaceholder("Buscar proposta, cliente ou oportunidade").fill("PROP-2026-001");
 await expect(page.getByText(state.label,{exact:false}).filter({visible:true})).toBeVisible();
 await page.getByRole("button").filter({hasText:"Luminárias"}).first().click();
 await page.getByRole("button",{name:"Marcar como faturado",exact:true}).filter({visible:true}).click();
 expect(state.invoices).toHaveLength(0);
 const confirm=page.getByRole("alertdialog",{name:"Marcar como faturado?"});await expect(confirm).toBeVisible();
 await confirm.getByRole("button",{name:"Marcar como faturado",exact:true}).click();
 await expect(confirm).toBeHidden();await expect.poll(()=>state.invoices.length).toBe(1);
 await expect(page.getByText("Faturada",{exact:true}).first()).toBeVisible();
 await expect(page.getByText(/Lead 123|lead_xxx|contact-old/)).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath("proposal-invoiced.png"),fullPage:true});
});

test("Kanban mantém pendência visível e oferece faturamento rápido com confirmação",async({page},info)=>{
 const state=await fixture(page);await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
 if(info.project.name.includes("mobile"))await page.getByRole("button",{name:/Aguardando faturamento/}).click();
 await expect(page.getByText(state.label,{exact:false}).filter({visible:true})).toBeVisible();
 await page.getByRole("button",{name:"Marcar como faturado",exact:true}).filter({visible:true}).click();
 const confirm=page.getByRole("alertdialog",{name:"Marcar como faturado?"});await confirm.getByRole("button",{name:"Marcar como faturado",exact:true}).click();
 await expect.poll(()=>state.invoices.length).toBe(1);await expect(confirm).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("reabre venda faturada escolhendo a fase e preserva o registro de fechamento",async({page},info)=>{
 const state=await fixture(page);await page.goto(`/workspaces/${WORKSPACE_ID}/deals`);
 if(info.project.name.includes("mobile"))await page.getByRole("button",{name:/Aguardando faturamento/}).click();
 await page.getByRole("button",{name:"Marcar como faturado",exact:true}).filter({visible:true}).click();
 const confirm=page.getByRole("alertdialog",{name:"Marcar como faturado?"});await confirm.getByRole("button",{name:"Marcar como faturado",exact:true}).click();await expect(confirm).toBeHidden();
 if(info.project.name.includes("mobile"))await page.getByRole("button",{name:/Ganha/}).filter({visible:true}).click();
 await page.getByRole("article").filter({hasText:"Compra de luminárias",visible:true}).click();
 const detail=page.getByRole("dialog",{name:"Compra de luminárias",exact:true});await detail.getByRole("button",{name:"Reabrir",exact:true}).click();
 const reopen=page.getByRole("alertdialog",{name:"Reabrir oportunidade",exact:true});await reopen.getByRole("combobox",{name:"Fase de retorno"}).selectOption(state.stages[0].id);
 await reopen.getByRole("button",{name:"Reabrir oportunidade",exact:true}).click();await expect(reopen).toBeHidden();
 await expect.poll(()=>state.reopens[0]?.targetStageId).toBe(state.stages[0].id);
 await expect(detail.getByRole("button",{name:"Ganha",exact:true})).toBeVisible();
 await expect(detail.getByText(/Primeiro fechamento:/)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
