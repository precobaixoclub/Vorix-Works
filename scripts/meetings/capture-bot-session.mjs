#!/usr/bin/env node
/**
 * Ferramenta INTERNA de homologação, suporte e diagnóstico do pool vorix_managed.
 * Clientes conectam/reconectam contas em Meetings → Configurações → Contas de gravação.
 * Este script nunca é requisito nem fluxo principal de provisionamento de clientes.
 *
 * Abre um Chromium VISÍVEL. Uma PESSOA faz o login da conta do bot (inclusive MFA/desafios — esta
 * ferramenta não automatiza, não contorna e não vê a senha). Quando o meet.google.com abre logado,
 * a sessão (storageState do Playwright) é gravada com permissão 0600 em `--out`.
 *
 * Depois: Admin → Bots de gravação → "Enviar sessão" (o servidor cifra) → "Testar sessão".
 * Apague o arquivo local em seguida.
 *
 * Uso: node scripts/meetings/capture-bot-session.mjs --out bot-01.json [--chromium /caminho/chromium]
 */
import { chmod, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const out = option("--out");
if (!out) {
  console.error("Informe --out <arquivo.json>.");
  process.exit(1);
}
const executablePath = option("--chromium") ?? process.env.MEETINGS_CHROMIUM_PATH;

const browser = await chromium.launch({ headless: false, ...(executablePath ? { executablePath } : { channel: "chrome" }) });
const context = await browser.newContext({ locale: "pt-BR" });
const page = await context.newPage();
await page.goto("https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmeet.google.com%2F");
console.log("Faça o login da conta do BOT na janela aberta. Aguardando o Google Meet carregar logado (até 10 min)…");

const deadline = Date.now() + 10 * 60_000;
let loggedIn = false;
while (Date.now() < deadline && !page.isClosed()) {
  const url = page.url();
  if (url.startsWith("https://meet.google.com/")) {
    // Logado = existe o menu da conta Google (e não o botão "Fazer login").
    const account = await page.locator('a[href*="accounts.google.com/SignOutOptions"], [aria-label*="Google Account"], [aria-label*="Conta do Google"]').count().catch(() => 0);
    const signIn = await page.locator('a[href*="ServiceLogin"]').count().catch(() => 0);
    if (account > 0 && signIn === 0) {
      loggedIn = true;
      break;
    }
  }
  await page.waitForTimeout(2000);
}

if (!loggedIn) {
  console.error("Não foi possível confirmar o login no Google Meet. Nada foi salvo.");
  await browser.close();
  process.exit(2);
}

const state = await context.storageState();
await writeFile(out, JSON.stringify(state), { mode: 0o600 });
await chmod(out, 0o600).catch(() => undefined);
console.log(`Sessão salva em ${out} (permissão 0600). Envie pelo Admin → Bots de gravação e apague este arquivo depois.`);
await browser.close();
