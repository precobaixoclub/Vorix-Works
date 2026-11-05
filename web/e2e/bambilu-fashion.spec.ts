import {test, expect, type Page, type Locator} from "@playwright/test";

const base = "/s/bambilu-kids";
const widths = [360, 390, 430, 768, 1024, 1440];
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for(const photo of await page.locator(".sp-photo,[data-fashion-product-photo]").all()) {
    await expect(photo).toHaveCSS("object-fit", "contain");
    await expect(photo).toHaveCSS("transform", "none");
  }
}
async function swipe(page: Page, gallery: Locator) {
  const box = (await gallery.locator(".sp-stage").boundingBox())!;
  const x = box.x + box.width * .55, y = box.y + box.height * .6;
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [{x, y}]});
  await client.send("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [{x: x - 65, y}]});
  await client.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
  await client.detach();
}

test("Fashion Kids: composição, grid, swatches, ofertas e busca sem mutações", async ({page}) => {
  const errors: string[] = [], mutations: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/tenant-site/commerce/**", route => {
    if(!route.request().url().endsWith("/events"))mutations.push(route.request().url());
    return route.fulfill({status: 204});
  });
  await page.goto(base);
  await expect(page.locator(".fk-hero h1")).toContainText("cada fase.");
  await expect(page.locator(".fk-editorial")).toBeVisible();
  await expect(page.getByRole("link", {name: "Meninas", exact: true})).toHaveCount(0);
  await expect(page.getByRole("button", {name: /Abrir carrinho/})).toHaveCount(0);
  const grid = page.locator("#catalogo .ts-product-grid");
  const card = grid.locator('[data-product-card="shirt"]');
  await expect(card.locator(".sp-swatch")).toHaveCount(4);
  await expect(card.locator(".sp-more")).toHaveText("+3");
  await expect(card.getByRole("button", {name: "Prévia: Cor Preto", exact: true}).locator("span")).toHaveCSS("background-color", "rgb(37, 40, 37)");
  await card.locator(".fk-card-offer summary").click();
  await expect(card.locator(".sc-quantity-offer")).toContainText("R$ 55,00");
  await expect(card.locator(".sc-quantity-offer")).toContainText("R$ 50,00");
  await card.getByRole("button", {name: "Prévia: Cor Preto", exact: true}).hover();
  await expect(card.locator(".sp-photo")).toHaveAttribute("src", /color-1/);
  for(const width of widths) {
    await page.setViewportSize({width, height: 1000});
    await card.scrollIntoViewIfNeeded();
    await fits(page);
    const columns = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width <= 700 ? 2 : width <= 1100 ? 3 : 4);
    const boxes = await grid.locator(".fk-product-image").evaluateAll(els => els.map(el => ({width: el.clientWidth, height: el.clientHeight})));
    expect(new Set(boxes.map(b => `${b.width}x${b.height}`)).size).toBeLessThanOrEqual(2);
    expect(boxes[0].width).toBeLessThan(width <= 430 ? width * .5 : width * .4);
  }
  await page.setViewportSize({width: 390, height: 1000});
  await page.getByRole("button", {name: "Buscar na coleção", exact: true}).click();
  await expect(page.getByRole("textbox", {name: "Buscar no site", exact: true})).toBeFocused();
  await page.getByRole("textbox", {name: "Buscar no site", exact: true}).fill("horizontal");
  await page.locator("#fk-search").getByRole("button", {name: "Buscar", exact: true}).click();
  await expect(grid.locator("[data-product-card]")).toHaveCount(1);
  await expect(grid.locator("[data-product-card]")).toHaveAttribute("data-product-card", "landscape");
  await fits(page);
  expect(errors).toEqual([]); expect(mutations).toEqual([]);
});

test("Fashion Kids: seleção e swipe preservam a galeria e o CTA de interesse", async ({page}) => {
  await page.route("**/api/tenant-site/commerce/**", route => route.fulfill({status: 204}));
  await page.goto(base + "/produto/camisa");
  const gallery = page.locator('[data-product-gallery="detail"]');
  await page.getByLabel("Tamanho", {exact: true}).selectOption("P");
  await page.getByRole("radio", {name: "Cinza", exact: true}).click();
  await expect(gallery.locator(".sp-photo")).toHaveAttribute("src", /combination/);
  await expect(page.locator(".ts-detail-price")).toHaveText("R$ 60,00");
  await expect(page.locator(".ts-detail-copy .sc-quantity-offer")).toContainText("R$ 55,00");
  for(const width of widths) {
    await page.setViewportSize({width, height: 1000});
    await gallery.scrollIntoViewIfNeeded(); await fits(page);
  }
  await page.setViewportSize({width: 390, height: 1000});
  await gallery.scrollIntoViewIfNeeded();
  await swipe(page, gallery);
  await expect(gallery.locator(".sp-counter")).toHaveText("2 / 3");
  await expect(page).toHaveURL(new RegExp(base + "/produto/camisa$"));
  await gallery.getByRole("button", {name: "Ver foto 3", exact: true}).click();
  await expect(gallery.locator(".sp-photo")).toHaveAttribute("src", /general/);
  await gallery.locator(".sp-stage").focus(); await page.keyboard.press("ArrowLeft");
  await expect(gallery.locator(".sp-counter")).toHaveText("2 / 3");
  await page.locator(".sc-actions").getByRole("button", {name: "Tenho interesse", exact: true}).click();
  await expect(page.locator("#pedir-informacoes")).toBeInViewport();
  await expect(page.getByRole("button", {name: /Comprar agora|Adicionar ao carrinho/})).toHaveCount(0);
});

test("Fashion Kids: menu compacto, toque em cores e swipe nos cards", async ({browser}) => {
  const context = await browser.newContext({viewport: {width: 360, height: 900}, isMobile: true, hasTouch: true});
  const page = await context.newPage();
  await page.route("**/api/tenant-site/commerce/**", route => route.fulfill({status: 204}));
  await page.goto(base);
  await page.getByRole("button", {name: "Abrir menu", exact: true}).click();
  await expect(page.getByRole("navigation", {name: "Menu do celular"})).toBeVisible();
  await page.getByRole("navigation", {name: "Menu do celular"}).getByRole("link", {name: "Coleção", exact: true}).click();
  await expect(page.getByRole("navigation", {name: "Menu do celular"})).toHaveCount(0);
  const card = page.locator('#catalogo [data-product-card="shirt"]'), gallery = card.locator('[data-product-gallery="card"]');
  await card.getByRole("button", {name: "Prévia: Cor Verde", exact: true}).tap();
  await expect(gallery.locator(".sp-photo")).toHaveAttribute("src", /color-2/);
  await gallery.scrollIntoViewIfNeeded(); await swipe(page, gallery);
  await expect(gallery.locator(".sp-counter")).toHaveText("2 / 2");
  await expect(page).toHaveURL(new RegExp(base + "#catalogo$"));
  await fits(page); await context.close();
});
