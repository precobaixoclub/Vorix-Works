import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, parseAlertBody, renderPlatformEmail } from "../dist/application/notification/platform-email-template.js";
import { PLATFORM_EMAIL_EVENTS } from "../dist/application/notification/platform-email-alerts.js";

const SENT = new Date("2026-11-23T15:04:00Z");

test("corpo do alerta: 'Rótulo: valor' vira linha de detalhe; o resto vira parágrafo", () => {
  const parsed = parseAlertBody("Marca: Rumo ao Altar\nHorário: 23/11/2026 às 12:00 (Brasília)\nO Codex do servidor precisa ser autorizado novamente.");
  assert.deepEqual(parsed.rows, [{ label: "Marca", value: "Rumo ao Altar" }, { label: "Horário", value: "23/11/2026 às 12:00 (Brasília)" }]);
  assert.deepEqual(parsed.paragraphs, ["O Codex do servidor precisa ser autorizado novamente."]);
});

test("cada evento tem layout próprio: etiqueta, título, detalhes, botão e rodapé com o motivo do envio", () => {
  for (const event of [...PLATFORM_EMAIL_EVENTS, "test"]) {
    const { html, text } = renderPlatformEmail({ event, subject: "Assunto do alerta", body: "Conta: Loja Exemplo\nPlano: Pro", link: "https://vorixworks.com/admin/tenants/t1", sentAt: SENT });
    assert.match(html, /<!doctype html>/i, event);
    assert.match(html, /Assunto do alerta/);
    assert.match(html, /Loja Exemplo/);
    assert.match(html, /href="https:\/\/vorixworks\.com\/admin\/tenants\/t1"/);
    assert.match(html, /Admin → Notificações por e-mail/);
    assert.match(html, /23\/11\/2026, 12:04/, "horário de Brasília");
    assert.match(text, /Conta: Loja Exemplo\nPlano: Pro/);
    assert.match(text, /https:\/\/vorixworks\.com\/admin\/tenants\/t1/);
  }
});

test("sem link não há botão; conteúdo vindo do cliente é escapado (nada de HTML injetado)", () => {
  const { html } = renderPlatformEmail({ event: "account_created", subject: "Nova conta <b>", body: "Nome: <script>alert(1)</script>\nWorkspace: A & B", sentAt: SENT });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /Nova conta &lt;b&gt;/);
  assert.doesNotMatch(html, /Ver conta &rarr;/, "sem link, sem botão");
  assert.equal(escapeHtml(`"'`), "&quot;&#39;");
});

test("teste de canal usa a frase do corpo como introdução, sem tabela vazia", () => {
  const { html, text } = renderPlatformEmail({ event: "test", subject: "Teste de notificação do Vorix", body: "Este e-mail confirma que o canal de notificações do Vorix pode enviar para este endereço.", sentAt: SENT });
  assert.match(html, /Este e-mail confirma que o canal/);
  assert.doesNotMatch(html, /border:1px solid #ECE9F3;border-radius:12px/, "sem tabela de detalhes vazia");
  assert.match(text, /^Teste de notificação do Vorix\n\nEste e-mail confirma/);
});
