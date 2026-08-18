import test from "node:test";
import assert from "node:assert/strict";
import { isZoneWithinSafeArea, clampZoneToSafeArea, resolveSafeZoneMargins } from "../dist/shared/utils/ad-safe-zones.js";

test("isZoneWithinSafeArea: zona centralizada está sempre segura", () => {
  const position = { xPct: 30, yPct: 40, widthPct: 40, heightPct: 20 };
  assert.equal(isZoneWithinSafeArea(position, "instagram_stories"), true);
});

test("isZoneWithinSafeArea: zona colada no topo invade a margem de Stories (barra de progresso/usuário)", () => {
  const position = { xPct: 30, yPct: 0, widthPct: 40, heightPct: 10 };
  assert.equal(isZoneWithinSafeArea(position, "instagram_stories"), false);
});

test("isZoneWithinSafeArea: zona colada na base invade a margem de Reels (legenda/CTA/ícones)", () => {
  const position = { xPct: 10, yPct: 85, widthPct: 40, heightPct: 15 };
  assert.equal(isZoneWithinSafeArea(position, "instagram_reels"), false);
});

test("isZoneWithinSafeArea: feed estático tem margem bem menor que Stories/Reels/TikTok", () => {
  const feedMargins = resolveSafeZoneMargins("instagram_feed");
  const storiesMargins = resolveSafeZoneMargins("instagram_stories");
  assert.ok(feedMargins.bottom < storiesMargins.bottom);
  assert.ok(feedMargins.top < storiesMargins.top);
});

test("isZoneWithinSafeArea: plataforma desconhecida cai num default sensato (nunca quebra)", () => {
  const position = { xPct: 10, yPct: 10, widthPct: 20, heightPct: 10 };
  assert.equal(typeof isZoneWithinSafeArea(position, undefined), "boolean");
});

test("clampZoneToSafeArea: reposiciona uma zona que invade a margem pra dentro da área segura", () => {
  const position = { xPct: 0, yPct: 0, widthPct: 30, heightPct: 10 };
  const clamped = clampZoneToSafeArea(position, "instagram_stories");
  assert.equal(isZoneWithinSafeArea(clamped, "instagram_stories"), true);
  assert.equal(clamped.widthPct, 30, "clamp nunca redimensiona, só reposiciona");
  assert.equal(clamped.heightPct, 10);
});
