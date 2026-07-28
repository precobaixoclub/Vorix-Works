import test from "node:test";
import assert from "node:assert/strict";
import { deriveTimingConstraint, effectiveVisibleDurationSeconds, transitionOverheadSeconds, READABILITY_FLOOR_SECONDS } from "../dist/shared/utils/timing-rebalancing/timing-constraint-model.js";
import {
  detectTimingDeficit,
  findDonorCandidates,
  buildRebalancePlan,
  applyRebalancePlan,
  buildRebalanceRecord,
} from "../dist/shared/utils/timing-rebalancing/timing-rebalancer.js";
import { attemptTimingRebalance, buildShotTimelineForRender } from "../dist/skills/rafa-video-rendering/rafa-video-rendering.skill.js";
import { attemptCompositeSceneResolution } from "../dist/shared/utils/scene-composition/composite-shot-coverage.js";

// ---------------------------------------------------------------------------------------------
// Fixtures — espelham a cena 4 real ("Benefícios": product / detail / closing) auditada nesta sprint.
// ---------------------------------------------------------------------------------------------

function shot(overrides = {}) {
  return {
    shotId: "s4-shot-x",
    sceneOrder: 4,
    shotOrder: 2,
    purpose: "detail",
    allocatedDuration: 1.0,
    entranceTransition: "cut",
    exitTransition: "cut",
    tags: ["produto-real", "mockup", "interface"],
    ...overrides,
  };
}

function sceneShots() {
  return [
    shot({ shotId: "s4-shot-1", shotOrder: 1, purpose: "product", allocatedDuration: 1.0, tags: ["produto-real", "mockup", "interface"] }),
    shot({ shotId: "s4-shot-2", shotOrder: 2, purpose: "detail", allocatedDuration: 1.0, requiredMinimumDuration: 1.2, tags: ["produto-real", "mockup", "interface"] }),
    shot({ shotId: "s4-shot-3", shotOrder: 3, purpose: "closing", allocatedDuration: 1.0, tags: ["cta", "logo", "url"] }),
  ];
}

// ---------------------------------------------------------------------------------------------
// 1. Déficit simples resolvido por Shot adjacente.
// ---------------------------------------------------------------------------------------------
test("1. déficit simples é resolvido por Shot adjacente da mesma cena", () => {
  const shots = sceneShots();
  const donors = findDonorCandidates({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverShotOrder: 2, allShots: shots });
  const plan = buildRebalancePlan({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverAllocatedDuration: 1.0, deficit: 0.2, donors });
  assert.ok(plan);
  assert.equal(plan.transfers.length, 1);
  assert.equal(plan.transfers[0].donorShotId, "s4-shot-1");
  assert.equal(plan.receiverAfter, 1.2);
  assert.equal(plan.impact, "low");
});

// ---------------------------------------------------------------------------------------------
// 2. Shot locked não doa tempo.
// ---------------------------------------------------------------------------------------------
test("2. Shot locked (CTA/end-card) nunca é elegível como doador", () => {
  const shots = sceneShots();
  const donors = findDonorCandidates({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverShotOrder: 2, allShots: shots });
  const ctaDonor = donors.find((d) => d.shotId === "s4-shot-3");
  assert.equal(ctaDonor.constraint.timingFlexibility, "locked");
  assert.match(ctaDonor.ineligibleReason, /locked/i);
});

// ---------------------------------------------------------------------------------------------
// 3. Shot no mínimo não doa tempo.
// ---------------------------------------------------------------------------------------------
test("3. Shot já no próprio mínimo não tem folga para doar", () => {
  const shots = [
    shot({ shotId: "s4-shot-1", shotOrder: 1, allocatedDuration: READABILITY_FLOOR_SECONDS }), // já no piso de legibilidade
    shot({ shotId: "s4-shot-2", shotOrder: 2, requiredMinimumDuration: 1.2 }),
  ];
  const donors = findDonorCandidates({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverShotOrder: 2, allShots: shots });
  const donor1 = donors.find((d) => d.shotId === "s4-shot-1");
  assert.equal(donor1.availableSlack, 0);
  assert.match(donor1.ineligibleReason, /no mínimo/i);
});

// ---------------------------------------------------------------------------------------------
// 4. CTA não fica abaixo do piso.
// ---------------------------------------------------------------------------------------------
test("4. CTA/end-card nunca cai abaixo do próprio piso mínimo — classificado locked, nunca doa mesmo parcialmente", () => {
  const cta = shot({ shotId: "s4-shot-3", purpose: "closing", allocatedDuration: 1.0, tags: ["cta", "logo", "url"] });
  const constraint = deriveTimingConstraint(cta);
  assert.equal(constraint.isTimingLocked, true);
  assert.equal(constraint.timingFlexibility, "locked");
  assert.equal(constraint.minimumDuration, READABILITY_FLOOR_SECONDS);
});

// ---------------------------------------------------------------------------------------------
// 5. Interface não fica abaixo da legibilidade.
// ---------------------------------------------------------------------------------------------
test("5. Shot de interface/produto nunca doa abaixo do piso de legibilidade (reutiliza MIN_SEGMENT_DURATION_SECONDS existente)", () => {
  const productShot = shot({ shotId: "s4-shot-1", allocatedDuration: 1.0, tags: ["produto-real", "mockup", "interface"] });
  const constraint = deriveTimingConstraint(productShot);
  assert.equal(constraint.textReadabilityDependency, true);
  assert.equal(constraint.minimumDuration, READABILITY_FLOOR_SECONDS);
  // Doa no máximo até o piso, nunca abaixo.
  const donors = findDonorCandidates({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverShotOrder: 2, allShots: [productShot, shot({ shotId: "s4-shot-2", requiredMinimumDuration: 1.2 })] });
  const donor = donors.find((d) => d.shotId === "s4-shot-1");
  assert.ok(Math.abs(donor.availableSlack - (1.0 - READABILITY_FLOOR_SECONDS)) < 1e-9);
});

// ---------------------------------------------------------------------------------------------
// 6. Narração sincronizada não é cortada.
// ---------------------------------------------------------------------------------------------
test("6. realocação dentro da mesma cena preserva a duração da cena — narração (faixa contínua por cena) nunca é afetada", () => {
  const shots = sceneShots();
  const donors = findDonorCandidates({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverShotOrder: 2, allShots: shots });
  const plan = buildRebalancePlan({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverAllocatedDuration: 1.0, deficit: 0.2, donors });
  const record = buildRebalanceRecord(plan);
  assert.equal(record.validationResults.sceneDurationPreserved, true);
  const sceneTotalBefore = shots.reduce((sum, s) => sum + s.allocatedDuration, 0);
  const adjusted = applyRebalancePlan(shots, plan);
  const sceneTotalAfter = adjusted.reduce((sum, s) => sum + s.allocatedDuration, 0);
  assert.ok(Math.abs(sceneTotalBefore - sceneTotalAfter) < 1e-9);
});

// ---------------------------------------------------------------------------------------------
// 7. Realocação preserva duração total.
// ---------------------------------------------------------------------------------------------
test("7. plano de realocação nunca muda a duração total do vídeo (soma zero por construção)", () => {
  const shots = sceneShots();
  const donors = findDonorCandidates({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverShotOrder: 2, allShots: shots });
  const plan = buildRebalancePlan({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverAllocatedDuration: 1.0, deficit: 0.2, donors });
  assert.equal(plan.totalVideoDurationChange, 0);
  const record = buildRebalanceRecord(plan);
  assert.equal(record.validationResults.totalVideoDurationPreserved, true);
});

// ---------------------------------------------------------------------------------------------
// 8. Composição é reavaliada após realocação.
// ---------------------------------------------------------------------------------------------
test("8. após a realocação, a Composite Scene Resolution passa a aceitar (mesma checagem, duração real maior)", () => {
  const query = {
    executionId: "exec-timing", sceneOrder: 4, sceneName: "Benefícios", theme: "produto", emotion: "energia",
    narrativeFunction: "provar benefícios", desiredKind: "mockup",
    requiredTags: ["marca-x", "celular", "site", "produto-real", "mockup", "interface", "presentes", "album"],
    targetWidth: 1080, targetHeight: 1920, targetAspectRatio: "9:16", brandKeywords: ["Marca X"],
    shotId: "s4-shot-2", shotOrder: 2, shotPurpose: "detail",
    mockupRequirement: { what: "mockup real", strict: true },
  };
  const candidates = [
    { id: "official-gifts", provider: "media-catalog", origin: "local_library", absolutePath: "/a.png", license: { name: "l", allowsCommercialUse: true }, tags: ["presentes", "produto-real", "celular", "site"], theme: "presentes", emotion: "energia", width: 1080, height: 1920, aspectRatio: "9:16", kind: "photo", ingestionSource: "campaign_intelligence", capabilities: ["product_screen"] },
    { id: "official-album", provider: "media-catalog", origin: "local_library", absolutePath: "/b.png", license: { name: "l", allowsCommercialUse: true }, tags: ["album", "produto-real", "celular", "site"], theme: "album", emotion: "energia", width: 1080, height: 1920, aspectRatio: "9:16", kind: "photo", ingestionSource: "campaign_intelligence", capabilities: ["product_screen"] },
  ];
  const before = attemptCompositeSceneResolution({ query: { ...query, shotDurationSeconds: 1.0 }, candidates, shotAuthenticityRole: "product", minimumScore: 62, shotId: "s4-shot-2" });
  assert.equal(before.accepted, false);
  assert.ok(before.timingRequirement);
  const after = attemptCompositeSceneResolution({ query: { ...query, shotDurationSeconds: 1.2 }, candidates, shotAuthenticityRole: "product", minimumScore: 62, shotId: "s4-shot-2" });
  assert.equal(after.accepted, true);
});

// ---------------------------------------------------------------------------------------------
// 9. Múltiplos doadores podem cobrir um déficit.
// ---------------------------------------------------------------------------------------------
test("9. múltiplos doadores parciais juntos cobrem um déficit que nenhum cobre sozinho", () => {
  const shots = [
    shot({ shotId: "s4-shot-1", shotOrder: 1, allocatedDuration: 0.7, tags: [] }), // slack 0.3 (piso 0.4 genérico)
    shot({ shotId: "s4-shot-2", shotOrder: 2, requiredMinimumDuration: 1.5 }),
    shot({ shotId: "s4-shot-3", shotOrder: 3, allocatedDuration: 0.7, purpose: "reaction", tags: [] }), // decorativo, slack 0.3
  ];
  const donors = findDonorCandidates({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverShotOrder: 2, allShots: shots });
  const plan = buildRebalancePlan({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverAllocatedDuration: 1.0, deficit: 0.5, donors });
  assert.ok(plan);
  assert.ok(plan.transfers.length >= 2);
  const totalTransferred = plan.transfers.reduce((sum, t) => sum + t.amount, 0);
  assert.ok(Math.abs(totalTransferred - 0.5) < 1e-9);
});

// ---------------------------------------------------------------------------------------------
// 10. Solução mais local é preferida.
// ---------------------------------------------------------------------------------------------
test("10. doador adjacente da mesma cena é preferido sobre um doador flexível de outra cena, mesmo com menos folga", () => {
  const shots = [
    shot({ shotId: "s4-shot-1", shotOrder: 1, allocatedDuration: 0.8, tags: ["produto-real", "mockup", "interface"] }), // adjacente, slack 0.2
    shot({ shotId: "s4-shot-2", shotOrder: 2, requiredMinimumDuration: 1.2 }),
    shot({ shotId: "s5-shot-1", sceneOrder: 5, shotOrder: 1, purpose: "establishing", allocatedDuration: 2.0, tags: [] }), // outra cena, muita folga
  ];
  const donors = findDonorCandidates({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverShotOrder: 2, allShots: shots });
  assert.equal(donors[0].shotId, "s4-shot-1");
  assert.equal(donors[0].tier, 1);
});

// ---------------------------------------------------------------------------------------------
// 11. Alteração mínima é preferida.
// ---------------------------------------------------------------------------------------------
test("11. um único doador suficiente é preferido a dividir entre vários (menor número de Shots alterados)", () => {
  const shots = [
    shot({ shotId: "s4-shot-1", shotOrder: 1, allocatedDuration: 2.0, tags: [] }), // slack 1.6, cobre sozinho
    shot({ shotId: "s4-shot-2", shotOrder: 2, requiredMinimumDuration: 1.2 }),
    shot({ shotId: "s4-shot-3", shotOrder: 3, purpose: "reaction", allocatedDuration: 2.0, tags: [] }),
  ];
  const donors = findDonorCandidates({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverShotOrder: 2, allShots: shots });
  const plan = buildRebalancePlan({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverAllocatedDuration: 1.0, deficit: 0.2, donors });
  assert.equal(plan.transfers.length, 1);
});

// ---------------------------------------------------------------------------------------------
// 12. Transição é considerada na duração útil.
// ---------------------------------------------------------------------------------------------
test("12. duração efetivamente visível desconta a sobreposição de transição (cut ~= 0 overhead, dissolve consome tempo real)", () => {
  assert.ok(transitionOverheadSeconds("cut") < 0.01);
  assert.equal(transitionOverheadSeconds("dissolve"), 0.6);
  const withCut = effectiveVisibleDurationSeconds(1.2, "cut");
  const withDissolve = effectiveVisibleDurationSeconds(1.2, "dissolve");
  assert.ok(withDissolve < withCut);
  assert.ok(Math.abs(withDissolve - 0.6) < 1e-9);
});

// ---------------------------------------------------------------------------------------------
// 13. Ausência de doador mantém Assisted Mode.
// ---------------------------------------------------------------------------------------------
test("13. sem nenhum doador elegível, o plano é undefined (TIMING_REBALANCE_NOT_POSSIBLE) — Assisted Mode mantido", () => {
  const shots = [
    shot({ shotId: "s4-shot-1", shotOrder: 1, purpose: "closing", allocatedDuration: 1.0, tags: ["cta", "logo", "url"] }), // locked
    shot({ shotId: "s4-shot-2", shotOrder: 2, requiredMinimumDuration: 1.2 }),
  ];
  const donors = findDonorCandidates({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverShotOrder: 2, allShots: shots });
  const plan = buildRebalancePlan({ receiverShotId: "s4-shot-2", receiverSceneOrder: 4, receiverAllocatedDuration: 1.0, deficit: 0.2, donors });
  assert.equal(plan, undefined);
});

// ---------------------------------------------------------------------------------------------
// 14. Timeline original permanece auditável.
// ---------------------------------------------------------------------------------------------
test("14. attemptTimingRebalance nunca muta a timeline original — devolve uma cópia com as durações ajustadas", () => {
  const originalTimeline = [
    {
      order: 4, name: "Benefícios", startSeconds: 13, endSeconds: 16, durationSeconds: 3,
      shotTimeline: [
        { shotId: "s4-shot-1", shotOrder: 1, sceneOrder: 4, purpose: "product", startSeconds: 13, endSeconds: 14, durationSeconds: 1, entranceTransition: "cut", exitTransition: "cut", visualAssetRequirement: { tags: ["produto-real", "mockup", "interface"] } },
        { shotId: "s4-shot-2", shotOrder: 2, sceneOrder: 4, purpose: "detail", startSeconds: 14, endSeconds: 15, durationSeconds: 1, entranceTransition: "cut", exitTransition: "cut", visualAssetRequirement: { tags: ["produto-real", "mockup", "interface"] } },
        { shotId: "s4-shot-3", shotOrder: 3, sceneOrder: 4, purpose: "closing", startSeconds: 15, endSeconds: 16, durationSeconds: 1, entranceTransition: "cut", exitTransition: "cut", visualAssetRequirement: { tags: ["cta", "logo", "url"] } },
      ],
    },
  ];
  const snapshot = JSON.parse(JSON.stringify(originalTimeline));
  const result = attemptTimingRebalance({
    timeline: originalTimeline,
    timingDeficits: [{ shotId: "s4-shot-2", sceneOrder: 4, allocatedDuration: 1.0, deficit: 0.2 }],
  });
  assert.deepEqual(originalTimeline, snapshot, "timeline original não pode ser mutada");
  assert.ok(result);
  const adjustedShot2 = result.timeline[0].shotTimeline.find((s) => s.shotId === "s4-shot-2");
  assert.equal(adjustedShot2.durationSeconds, 1.2);
});

// ---------------------------------------------------------------------------------------------
// 15. Rerun não recalcula etapas desnecessárias.
// ---------------------------------------------------------------------------------------------
test("15. attemptTimingRebalance só altera os Shots efetivamente envolvidos (receptor + doador) — todos os outros saem idênticos", () => {
  const originalTimeline = [
    {
      order: 4, name: "Benefícios", startSeconds: 13, endSeconds: 16, durationSeconds: 3,
      shotTimeline: [
        { shotId: "s4-shot-1", shotOrder: 1, sceneOrder: 4, purpose: "product", startSeconds: 13, endSeconds: 14, durationSeconds: 1, entranceTransition: "cut", exitTransition: "cut", visualAssetRequirement: { tags: ["produto-real", "mockup", "interface"] } },
        { shotId: "s4-shot-2", shotOrder: 2, sceneOrder: 4, purpose: "detail", startSeconds: 14, endSeconds: 15, durationSeconds: 1, entranceTransition: "cut", exitTransition: "cut", visualAssetRequirement: { tags: ["produto-real", "mockup", "interface"] } },
        { shotId: "s4-shot-3", shotOrder: 3, sceneOrder: 4, purpose: "closing", startSeconds: 15, endSeconds: 16, durationSeconds: 1, entranceTransition: "cut", exitTransition: "cut", visualAssetRequirement: { tags: ["cta", "logo", "url"] } },
      ],
    },
    {
      order: 5, name: "Outra Cena", startSeconds: 16, endSeconds: 18, durationSeconds: 2,
      shotTimeline: [
        { shotId: "s5-shot-1", shotOrder: 1, sceneOrder: 5, purpose: "establishing", startSeconds: 16, endSeconds: 18, durationSeconds: 2, entranceTransition: "cut", exitTransition: "cut", visualAssetRequirement: { tags: [] } },
      ],
    },
  ];
  const result = attemptTimingRebalance({
    timeline: originalTimeline,
    timingDeficits: [{ shotId: "s4-shot-2", sceneOrder: 4, allocatedDuration: 1.0, deficit: 0.2 }],
  });
  assert.ok(result);
  // Cena 5 (sem Shot envolvido no déficit) sai byte-a-byte idêntica — mesma referência de objeto.
  assert.equal(result.timeline[1], originalTimeline[1]);
  const shot3After = result.timeline[0].shotTimeline.find((s) => s.shotId === "s4-shot-3");
  assert.equal(shot3After.durationSeconds, 1.0, "Shot não envolvido no déficit não muda");
});

// ---------------------------------------------------------------------------------------------
// 16. Shot simples não sofre alteração indevida.
// ---------------------------------------------------------------------------------------------
test("16. sem nenhum déficit reportado, attemptTimingRebalance não é sequer chamado a alterar nada (guard de entrada)", () => {
  const result = attemptTimingRebalance({ timeline: [], timingDeficits: [] });
  assert.equal(result, undefined);
});

// ---------------------------------------------------------------------------------------------
// 17. Production Readiness recebe a timeline final (via fan-out de render corretamente somando a duração da cena).
// ---------------------------------------------------------------------------------------------
test("17. a timeline final pós-realocação produz clipes cuja soma de duração bate com a duração da cena original", () => {
  const diegoShot2 = { shotId: "s4-shot-2", shotOrder: 2, sceneOrder: 4, purpose: "detail", startSeconds: 13.8, endSeconds: 15.0, durationSeconds: 1.2, action: "a", entranceTransition: "cut", exitTransition: "cut" };
  const entry = { order: 4, shotTimeline: [diegoShot2] };
  const clips = buildShotTimelineForRender({ entry, visualAssetByShotId: new Map() });
  assert.equal(clips.length, 1);
  assert.equal(clips[0].durationSeconds, 1.2);
});

// ---------------------------------------------------------------------------------------------
// 18. Lucas recebe o vídeo com a duração correta (duração total do vídeo preservada fim a fim).
// ---------------------------------------------------------------------------------------------
test("18. duração total do vídeo (soma de todas as cenas) é idêntica antes e depois da realocação", () => {
  const originalTimeline = [
    {
      order: 4, name: "Benefícios", startSeconds: 13, endSeconds: 16, durationSeconds: 3,
      shotTimeline: [
        { shotId: "s4-shot-1", shotOrder: 1, sceneOrder: 4, purpose: "product", startSeconds: 13, endSeconds: 14, durationSeconds: 1, entranceTransition: "cut", exitTransition: "cut", visualAssetRequirement: { tags: ["produto-real", "mockup", "interface"] } },
        { shotId: "s4-shot-2", shotOrder: 2, sceneOrder: 4, purpose: "detail", startSeconds: 14, endSeconds: 15, durationSeconds: 1, entranceTransition: "cut", exitTransition: "cut", visualAssetRequirement: { tags: ["produto-real", "mockup", "interface"] } },
        { shotId: "s4-shot-3", shotOrder: 3, sceneOrder: 4, purpose: "closing", startSeconds: 15, endSeconds: 16, durationSeconds: 1, entranceTransition: "cut", exitTransition: "cut", visualAssetRequirement: { tags: ["cta", "logo", "url"] } },
      ],
    },
  ];
  const totalBefore = originalTimeline.flatMap((e) => e.shotTimeline).reduce((sum, s) => sum + s.durationSeconds, 0);
  const result = attemptTimingRebalance({
    timeline: originalTimeline,
    timingDeficits: [{ shotId: "s4-shot-2", sceneOrder: 4, allocatedDuration: 1.0, deficit: 0.2 }],
  });
  const totalAfter = result.timeline.flatMap((e) => e.shotTimeline).reduce((sum, s) => sum + s.durationSeconds, 0);
  assert.ok(Math.abs(totalBefore - totalAfter) < 1e-9);
});
