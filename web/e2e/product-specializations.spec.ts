import {test,expect,type Page,type Locator} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import path from "node:path";

const api="http://127.0.0.1:3390";
let scope:{fixtureOnly:boolean;productVerticalsFixture:boolean;email:string;password:string;workspaceId:string;slug:string;houseId:string;rentalId:string};
let token:string;
test.beforeAll(async({request})=>{
 scope=await(await request.get(api+"/fixture-only/scope")).json();
 expect(scope.fixtureOnly&&scope.productVerticalsFixture).toBe(true);
 expect(scope.email).toMatch(/\.invalid$/);
 token=(await(await request.post(api+"/v1/auth/login",{data:{email:scope.email,password:scope.password}})).json()).data.accessToken;
 expect((await request.get(`http://127.0.0.1:3391/s/${scope.slug}`)).ok()).toBe(true);
 for(const route of["site/products","deals"])expect((await request.get(`http://127.0.0.1:3391/workspaces/${scope.workspaceId}/${route}`)).ok()).toBe(true);
});
async function login(page:Page){
 await page.goto("/login");await page.getByLabel("E-mail",{exact:true}).fill(scope.email);await page.getByLabel("Senha",{exact:true}).fill(scope.password);
 await page.getByRole("button",{name:"Entrar",exact:true}).click();await page.waitForURL(/\/workspaces(?:\/|$)/);
 await page.goto(`/workspaces/${scope.workspaceId}/site/products`);
}
async function section(dialog:Locator,name:string){await dialog.getByRole("navigation",{name:"Navegação da seção"}).getByRole("button",{name,exact:true}).click();}
async function edit(page:Page,name:string){await page.getByText(name,{exact:true}).first().click();const dialog=page.getByRole("dialog",{name:"Editar produto"});await expect(dialog).toBeVisible();return dialog;}
async function proof(page:Page,name:string,project:string){const dir=path.resolve("../tmp/site-builder-browser/evidence");await mkdir(dir,{recursive:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const dialog=page.getByRole("dialog").first(),modal=await dialog.count()>0;if(modal)await dialog.evaluate(element=>{element.scrollTop=0;});await page.screenshot({path:path.join(dir,`${project}-${name}.png`),fullPage:!modal});}

test("novo automóvel salva ficha, zero km, documentação e sete fotos",async({page},info)=>{
 await login(page);await page.getByRole("button",{name:/Novo produto|Cadastrar produto/}).first().click();
 const dialog=page.getByRole("dialog",{name:"Cadastrar produto"}),name=`Carro zero km ${info.project.name}`;
 await dialog.getByLabel("O que você vai cadastrar?",{exact:true}).selectOption("VEHICLE");await dialog.getByLabel("Nome",{exact:true}).fill(name);
 await section(dialog,"Ficha do veículo");await dialog.getByLabel("Marca do veículo",{exact:true}).fill("Marca fixture");await dialog.getByLabel("Modelo",{exact:true}).fill("Modelo zero");
 await dialog.getByLabel("Condição do veículo",{exact:true}).selectOption("new");await dialog.getByLabel("Ano de fabricação",{exact:true}).fill("2026");await dialog.getByLabel("Ano do modelo",{exact:true}).fill("2027");await dialog.getByLabel("Quilometragem (km)",{exact:true}).fill("0");await dialog.getByLabel("IPVA pago",{exact:true}).selectOption("false");
 await proof(page,"vehicle-specialized-form",info.project.name);
 await section(dialog,"Preços");await dialog.getByLabel("Preço de venda",{exact:true}).fill("125000,00");
 await section(dialog,"Fotos");const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=","base64");
 await dialog.getByLabel("Escolher fotos do produto",{exact:true}).setInputFiles(Array.from({length:7},(_,i)=>({name:`car-${i}.png`,mimeType:"image/png",buffer:png})));
 await expect(dialog.getByRole("button",{name:"Remover foto",exact:true})).toHaveCount(7);
 await dialog.getByRole("button",{name:"Cadastrar produto",exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.reload();const saved=await edit(page,name);await section(saved,"Ficha do veículo");await expect(saved.getByLabel("Modelo",{exact:true})).toHaveValue("Modelo zero");await expect(saved.getByLabel("Quilometragem (km)",{exact:true})).toHaveValue("0");await expect(saved.getByLabel("IPVA pago",{exact:true})).toHaveValue("false");await section(saved,"Fotos");await expect(saved.getByRole("button",{name:"Remover foto",exact:true})).toHaveCount(7);
});

test("casa tem campos próprios, localização privada e disponibilidade sem estoque",async({page,request},info)=>{
 await login(page);await page.getByRole("button",{name:/Novo produto|Cadastrar produto/}).first().click();const dialog=page.getByRole("dialog",{name:"Cadastrar produto"}),name=`Casa browser ${info.project.name}`;
 await dialog.getByLabel("O que você vai cadastrar?",{exact:true}).selectOption("REAL_ESTATE");await dialog.getByLabel("Nome",{exact:true}).fill(name);
 await dialog.getByRole("button",{name:"Cadastrar produto",exact:true}).click();await expect(dialog.getByLabel("Cidade do imóvel",{exact:true})).toBeVisible();
 await dialog.getByLabel("Cidade do imóvel",{exact:true}).fill("Sorocaba");await dialog.getByLabel("Estado do imóvel",{exact:true}).selectOption("SP");await dialog.getByLabel("Bairro",{exact:true}).fill("Centro");await dialog.getByLabel("Rua / avenida",{exact:true}).fill("ENDERECO SIGILOSO BROWSER");await dialog.getByLabel("Número do imóvel",{exact:true}).fill("777");
 await expect(dialog.getByText("Preencha a cidade e o estado do imóvel.",{exact:true})).toHaveCount(0);
 await section(dialog,"Ficha do imóvel");await dialog.getByLabel("Área construída (m²)",{exact:true}).fill("140");await dialog.getByLabel("Área do terreno (m²)",{exact:true}).fill("280");await dialog.getByLabel("Quartos (incluindo suítes)",{exact:true}).fill("3");await dialog.getByLabel("Suítes",{exact:true}).fill("1");await dialog.getByLabel("Vagas de garagem",{exact:true}).fill("2");await dialog.getByLabel("Anotações internas do imóvel (não aparecem no site)",{exact:true}).fill("SEGREDO INTERNO BROWSER");await proof(page,"house-specialized-form",info.project.name);
 await section(dialog,"Preços");await dialog.getByLabel("Valor de venda",{exact:true}).fill("700000,00");await section(dialog,"Site");await dialog.getByRole("switch",{name:"Exibir no site da empresa"}).check();
 await dialog.getByRole("button",{name:"Cadastrar produto",exact:true}).click();await expect(dialog).toHaveCount(0);await page.reload();const saved=await edit(page,name);await section(saved,"Disponibilidade");await expect(saved.getByLabel("Situação do imóvel",{exact:true})).toHaveValue("available");await expect(saved.getByRole("heading",{name:"Movimentar estoque"})).toHaveCount(0);
 const view=(await(await request.get(`${api}/v1/public/sites/${scope.slug}`)).json()).data;const product=view.products.find((p:{name:string})=>p.name===name);expect(product.realEstate.address).toEqual({city:"Sorocaba",state:"SP",neighborhood:"Centro"});expect(JSON.stringify(view)).not.toContain("SEGREDO INTERNO BROWSER");expect(JSON.stringify(view)).not.toContain("ENDERECO SIGILOSO BROWSER");
});

test("tipo escolhido esconde campos incompatíveis e preserva rascunho da família",async({page},info)=>{
 await login(page);await page.getByRole("button",{name:/Novo produto|Cadastrar produto/}).first().click();const dialog=page.getByRole("dialog",{name:"Cadastrar produto"});
 await dialog.getByLabel("O que você vai cadastrar?",{exact:true}).selectOption("VEHICLE");await section(dialog,"Ficha do veículo");await dialog.getByLabel("Marca do veículo",{exact:true}).fill("Marca preservada");await dialog.getByLabel("Categoria do veículo",{exact:true}).selectOption("motorcycle");await expect(dialog.getByLabel("Portas",{exact:true})).toHaveCount(0);await expect(dialog.getByLabel("Cilindrada (cm³)",{exact:true})).toBeVisible();
 await section(dialog,"Geral");await dialog.getByLabel("O que você vai cadastrar?",{exact:true}).selectOption("REAL_ESTATE");await section(dialog,"Ficha do imóvel");await dialog.getByLabel("Tipo de imóvel",{exact:true}).selectOption("land");await expect(dialog.getByLabel("Quartos (incluindo suítes)",{exact:true})).toHaveCount(0);await expect(dialog.getByLabel("Área construída (m²)",{exact:true})).toHaveCount(0);await expect(dialog.getByLabel("Área do terreno (m²)",{exact:true})).toBeVisible();await proof(page,"land-conditional-form",info.project.name);
 await section(dialog,"Geral");await dialog.getByLabel("O que você vai cadastrar?",{exact:true}).selectOption("GENERAL");await expect(dialog.getByRole("button",{name:"Ficha do imóvel",exact:true})).toHaveCount(0);
 await dialog.getByLabel("O que você vai cadastrar?",{exact:true}).selectOption("VEHICLE");await section(dialog,"Ficha do veículo");await expect(dialog.getByLabel("Marca do veículo",{exact:true})).toHaveValue("Marca preservada");await expect(dialog.getByLabel("Categoria do veículo",{exact:true})).toHaveValue("motorcycle");
});

test("aluguel mantém valor mensal, condomínio e IPTU separados no produto público",async({page,request},info)=>{
 await login(page);const dialog=await edit(page,"Apartamento de aluguel fixture");await section(dialog,"Preços");await expect(dialog.getByLabel("Aluguel mensal",{exact:true})).toHaveValue(/2.?500,00/);await expect(dialog.getByLabel("Condomínio mensal",{exact:true})).toHaveValue(/450,00/);await expect(dialog.getByLabel("Periodicidade do IPTU",{exact:true})).toHaveValue("yearly");
 await dialog.getByRole("button",{name:"Salvar alterações",exact:true}).click();await expect(dialog).toHaveCount(0);
 const product=(await(await request.get(`${api}/v1/products/${scope.rentalId}?workspaceId=${scope.workspaceId}`,{headers:{authorization:`Bearer ${token}`}})).json()).data;expect(product.billingType).toBe("monthly");expect(product.priceCents).toBe(250000);expect(product.trackStock).toBe(false);
 await page.goto(`/s/${scope.slug}/produto/apartamento-aluguel-fixture`);await expect(page.getByRole("heading",{name:"Apartamento de aluguel fixture",exact:true})).toBeVisible();await expect(page.locator("dd").filter({hasText:"/ano"})).toBeVisible();await expect(page.locator("dd").filter({hasText:"450,00/mês"})).toBeVisible();await expect(page.getByText("RUA PRIVADA FIXTURE",{exact:false})).toHaveCount(0);await proof(page,"rental-public-details",info.project.name);
});

test("catálogo filtra imóveis e veículos por suas características",async({page},info)=>{
 await page.goto(`/s/${scope.slug}`);await page.getByText("Refinar busca",{exact:false}).click();await page.getByLabel("Tipo de produto no site",{exact:true}).selectOption("REAL_ESTATE");await page.getByLabel("Finalidade",{exact:true}).selectOption("rent");await page.getByLabel("Cidade do imóvel",{exact:true}).selectOption("Campinas");await page.getByLabel("Mínimo de quartos",{exact:true}).fill("2");await expect(page.getByRole("heading",{name:"Apartamento de aluguel fixture",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"Casa de fixture",exact:true})).toHaveCount(0);await expect(page.getByRole("heading",{name:"SUV de fixture",exact:true})).toHaveCount(0);await proof(page,"property-public-filters",info.project.name);
 await page.getByRole("button",{name:"Limpar filtros",exact:true}).click();await page.getByLabel("Tipo de produto no site",{exact:true}).selectOption("VEHICLE");await page.getByLabel("Marca do veículo",{exact:true}).selectOption("Montadora fixture");await page.getByLabel("Ano mínimo",{exact:true}).fill("2025");await page.getByLabel("Quilometragem máxima (km)",{exact:true}).fill("20000");await expect(page.getByRole("heading",{name:"SUV de fixture",exact:true})).toBeVisible();await page.getByLabel("Quilometragem máxima (km)",{exact:true}).fill("0");await expect(page.getByRole("heading",{name:"SUV de fixture",exact:true})).toHaveCount(0);
});

test("marcar imóvel vendido retira o anúncio e a opção de nova negociação",async({page,request})=>{
 const headers={authorization:`Bearer ${token}`},url=`${api}/v1/products/${scope.houseId}`;
 const original=(await(await request.get(`${url}?workspaceId=${scope.workspaceId}`,{headers})).json()).data;
 try{
  await login(page);const dialog=await edit(page,"Casa de fixture");await section(dialog,"Disponibilidade");await dialog.getByLabel("Situação do imóvel",{exact:true}).selectOption("sold");await dialog.getByRole("button",{name:"Salvar alterações",exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button").filter({has:page.getByText("Casa de fixture",{exact:true})}).first().getByText("Vendido",{exact:true})).toBeVisible();
  await page.goto(`/workspaces/${scope.workspaceId}/deals`);await page.getByRole("button",{name:"Nova oportunidade",exact:true}).click();const deal=page.getByRole("dialog",{name:"Criar oportunidade"});await deal.getByRole("combobox").filter({hasText:"Adicionar produto ou serviço"}).click();await expect(page.getByRole("option").filter({hasText:"Casa de fixture"})).toHaveCount(0);await expect(page.getByRole("option").filter({hasText:"Apartamento de aluguel fixture"})).toBeVisible();
  await page.goto(`/s/${scope.slug}`);await expect(page.getByRole("heading",{name:"Casa de fixture",exact:true})).toHaveCount(0);await expect(page.getByRole("heading",{name:"Apartamento de aluguel fixture",exact:true})).toBeVisible();
 }finally{
  const restored=await request.patch(url,{headers,data:{workspaceId:scope.workspaceId,details:original.details}});expect(restored.ok()).toBe(true);
 }
});
