import test from "node:test";
import assert from "node:assert/strict";
import { rectanglesOverlap, resolveZoneCollisions } from "../dist/shared/utils/zone-collision.js";

function zone(type, position, priority = 1) {
  return { type, priority, position };
}

// ---------------------------------------------------------------------------------------------
// rectanglesOverlap
// ---------------------------------------------------------------------------------------------

test("rectanglesOverlap: retângulos que se sobrepõem de verdade são detectados", () => {
  assert.equal(rectanglesOverlap({ xPct: 6, yPct: 6, widthPct: 88, heightPct: 18 }, { xPct: 68, yPct: 6, widthPct: 26, heightPct: 12 }), true);
});

test("rectanglesOverlap: retângulos lado a lado sem sobreposição não são detectados", () => {
  assert.equal(rectanglesOverlap({ xPct: 0, yPct: 0, widthPct: 40, heightPct: 20 }, { xPct: 50, yPct: 0, widthPct: 40, heightPct: 20 }), false);
});

test("rectanglesOverlap: retângulos que só se tocam na borda (sem área comum) não contam como sobreposição", () => {
  assert.equal(rectanglesOverlap({ xPct: 0, yPct: 0, widthPct: 40, heightPct: 20 }, { xPct: 40, yPct: 0, widthPct: 40, heightPct: 20 }), false);
});

// ---------------------------------------------------------------------------------------------
// resolveZoneCollisions
// ---------------------------------------------------------------------------------------------

test("resolveZoneCollisions: headline x badge (caso real achado ao vivo) — headline (maior área) encolhe a largura, badge permanece intacto", () => {
  const zones = [
    zone("headline", { xPct: 6, yPct: 6, widthPct: 88, heightPct: 18 }, 2),
    zone("badge", { xPct: 68, yPct: 6, widthPct: 26, heightPct: 12 }, 3),
  ];

  const resolved = resolveZoneCollisions(zones);

  const headline = resolved.find((z) => z.type === "headline");
  const badge = resolved.find((z) => z.type === "badge");
  assert.deepEqual(badge.position, zones[1].position, "badge (menor área) nunca deveria ser alterado");
  assert.ok(headline.position.widthPct < 88, "headline deveria ter a largura reduzida");
  assert.ok(headline.position.heightPct === 18, "headline nunca deveria ter a ALTURA reduzida numa colisão horizontal (preserva nº de linhas)");
  assert.equal(rectanglesOverlap(headline.position, badge.position), false, "depois do reflow, as duas zonas não deveriam mais se sobrepor");
});

test("resolveZoneCollisions: headline nunca invade a coluna do badge — largura final para antes do início do badge, com folga", () => {
  const zones = [
    zone("headline", { xPct: 6, yPct: 6, widthPct: 88, heightPct: 18 }, 2),
    zone("badge", { xPct: 68, yPct: 6, widthPct: 26, heightPct: 12 }, 3),
  ];

  const resolved = resolveZoneCollisions(zones);
  const headline = resolved.find((z) => z.type === "headline");

  assert.ok(headline.position.xPct + headline.position.widthPct <= 68, "headline não deveria ultrapassar o início do badge");
});

test("resolveZoneCollisions: zonas sem sobreposição nenhuma saem inalteradas", () => {
  const zones = [
    zone("price", { xPct: 6, yPct: 62, widthPct: 44, heightPct: 16 }),
    zone("cta", { xPct: 6, yPct: 84, widthPct: 88, heightPct: 10 }),
  ];

  const resolved = resolveZoneCollisions(zones);

  assert.deepEqual(resolved, zones);
});

test("resolveZoneCollisions: nunca encolhe uma zona abaixo da largura/altura mínima, mesmo com colisão severa", () => {
  const zones = [
    zone("headline", { xPct: 6, yPct: 6, widthPct: 88, heightPct: 18 }),
    zone("badge", { xPct: 8, yPct: 6, widthPct: 84, heightPct: 12 }), // quase toda a largura do headline
  ];

  const resolved = resolveZoneCollisions(zones);
  const headline = resolved.find((z) => z.type === "headline");

  assert.ok(headline.position.widthPct >= 15, `largura não deveria cair abaixo do mínimo, veio ${headline.position.widthPct}`);
});

test("resolveZoneCollisions: três zonas encadeadas (A colide com B, B colide com C) resolvem sem deixar sobreposição residual", () => {
  const zones = [
    zone("headline", { xPct: 0, yPct: 0, widthPct: 100, heightPct: 20 }),
    zone("badge", { xPct: 60, yPct: 0, widthPct: 40, heightPct: 15 }),
    zone("rating", { xPct: 85, yPct: 0, widthPct: 15, heightPct: 10 }),
  ];

  const resolved = resolveZoneCollisions(zones);

  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      assert.equal(rectanglesOverlap(resolved[i].position, resolved[j].position), false, `${resolved[i].type} ainda colide com ${resolved[j].type}`);
    }
  }
});

test("resolveZoneCollisions: colisão predominantemente vertical corta altura, não largura", () => {
  const zones = [
    zone("benefits", { xPct: 10, yPct: 10, widthPct: 30, heightPct: 60 }),
    zone("specs", { xPct: 10, yPct: 50, widthPct: 30, heightPct: 20 }),
  ];

  const resolved = resolveZoneCollisions(zones);
  const benefits = resolved.find((z) => z.type === "benefits");

  assert.equal(benefits.position.widthPct, 30, "colisão vertical não deveria alterar a largura");
  assert.ok(benefits.position.heightPct < 60, "altura deveria ser reduzida");
});
