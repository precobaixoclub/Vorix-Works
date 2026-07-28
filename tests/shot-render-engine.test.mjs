import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeShotTimelineForRender,
  projectClipsAsRenderScenes,
  MIN_CLIP_DURATION_SECONDS,
} from "../dist/infrastructure/video-rendering/shot-render-planner.js";
import { compileFfmpegArgs, compileFfmpegArgsWithPlan } from "../dist/infrastructure/video-rendering/timeline-to-filter-compiler.js";

// ---------------------------------------------------------------------------------------------
// SHOT RENDER ENGINE — normalizeShotTimelineForRender
// ---------------------------------------------------------------------------------------------

function baseRequest(overrides = {}) {
  return {
    executionId: "exec-shot-render",
    outputRelativePath: "videos/final.mp4",
    width: 1080,
    height: 1920,
    fps: 30,
    totalDurationSeconds: 12,
    scenes: [],
    assets: [
      { id: "bg-1", kind: "image", absolutePath: "/fake/bg1.png" },
      { id: "bg-2", kind: "image", absolutePath: "/fake/bg2.png" },
      { id: "shot-a", kind: "image", absolutePath: "/fake/shotA.png" },
      { id: "shot-b", kind: "image", absolutePath: "/fake/shotB.png" },
      { id: "shot-c", kind: "image", absolutePath: "/fake/shotC.png" },
      { id: "shot-d", kind: "image", absolutePath: "/fake/shotD.png" },
    ],
    audioTracks: [],
    ...overrides,
  };
}

function fallbackScene(order, startSeconds, durationSeconds, extras = {}) {
  return {
    order,
    startSeconds,
    durationSeconds,
    background: { type: "image", assetId: `bg-${order + 1}` },
    overlays: [],
    zoom: "none",
    pan: "none",
    ...extras,
  };
}

function shot(sceneOrder, order, startSeconds, durationSeconds, extras = {}) {
  return {
    shotId: `s${sceneOrder}-shot-${order}`,
    shotOrder: order,
    sceneOrder,
    purpose: extras.purpose ?? "detail",
    startSeconds,
    durationSeconds,
    action: extras.action ?? `Shot ${order} da cena ${sceneOrder}`,
    ...extras,
  };
}

test("SHOT RENDER ENGINE: normalizeShotTimelineForRender preserva scene.order 1:1 quando NENHUMA cena tem shotTimeline (legacy)", () => {
  const request = baseRequest({
    scenes: [fallbackScene(0, 0, 4), fallbackScene(1, 4, 4), fallbackScene(2, 8, 4)],
  });
  const plan = normalizeShotTimelineForRender(request);
  assert.equal(plan.clips.length, 3);
  assert.deepEqual(plan.clips.map((c) => c.order), [0, 1, 2]);
  assert.deepEqual(plan.clips.map((c) => c.origin), ["scene_fallback", "scene_fallback", "scene_fallback"]);
  assert.equal(plan.totalShots, 0);
  assert.equal(plan.fallbackSceneOrders.length, 0, "legacy path não deve emitir warning de fallback");
});

test("SHOT RENDER ENGINE: normalizeShotTimelineForRender achata cenas com shotTimeline em clipes sequenciais", () => {
  const request = baseRequest({
    scenes: [
      fallbackScene(0, 0, 6, {
        shotTimeline: [
          shot(0, 1, 0, 3, { assetId: "shot-a", motionAction: "push_in" }),
          shot(0, 2, 3, 3, { assetId: "shot-b", motionAction: "static_hold" }),
        ],
      }),
      fallbackScene(1, 6, 6, {
        shotTimeline: [
          shot(1, 1, 6, 2, { assetId: "shot-c", motionAction: "pan_left" }),
          shot(1, 2, 8, 2, { assetId: "shot-d", motionAction: "zoom_out" }),
          shot(1, 3, 10, 2, { assetId: "shot-a", motionAction: "drift" }),
        ],
      }),
    ],
  });
  const plan = normalizeShotTimelineForRender(request);
  assert.equal(plan.clips.length, 5, "esperava 2 + 3 = 5 clipes");
  assert.equal(plan.totalShots, 5);
  assert.deepEqual(plan.clips.map((c) => c.order), [0, 1, 2, 3, 4]);
  assert.deepEqual(plan.clips.map((c) => c.clipId), ["s0-shot-1", "s0-shot-2", "s1-shot-1", "s1-shot-2", "s1-shot-3"]);
});

test("SHOT RENDER ENGINE: cada shot com assetId vira background image próprio (não herda da cena)", () => {
  const request = baseRequest({
    scenes: [
      fallbackScene(0, 0, 6, {
        background: { type: "image", assetId: "bg-1" },
        shotTimeline: [
          shot(0, 1, 0, 3, { assetId: "shot-a" }),
          shot(0, 2, 3, 3, { assetId: "shot-b" }),
        ],
      }),
    ],
  });
  const plan = normalizeShotTimelineForRender(request);
  assert.equal(plan.clips[0].background.assetId, "shot-a", "shot 1 deveria usar seu próprio asset");
  assert.equal(plan.clips[1].background.assetId, "shot-b", "shot 2 deveria usar seu próprio asset");
});

test("SHOT RENDER ENGINE: shot sem assetId herda o fundo da cena e emite warning explícito", () => {
  const request = baseRequest({
    scenes: [
      fallbackScene(0, 0, 4, {
        background: { type: "image", assetId: "bg-1" },
        shotTimeline: [
          shot(0, 1, 0, 2 /* sem assetId */),
          shot(0, 2, 2, 2, { assetId: "shot-b" }),
        ],
      }),
    ],
  });
  const plan = normalizeShotTimelineForRender(request);
  assert.equal(plan.clips[0].background.assetId, "bg-1", "shot 1 sem assetId deve herdar bg da cena");
  assert.ok(plan.warnings.some((w) => w.includes("SHOT_RENDER_ASSET_INHERITED") && w.includes("s0-shot-1")));
});

test("SHOT RENDER ENGINE: mapeamento semântico de motionAction para zoom/pan (nunca por índice)", () => {
  const request = baseRequest({
    scenes: [
      fallbackScene(0, 0, 8, {
        shotTimeline: [
          shot(0, 1, 0, 2, { assetId: "shot-a", motionAction: "push_in" }),
          shot(0, 2, 2, 2, { assetId: "shot-b", motionAction: "pan_left" }),
          shot(0, 3, 4, 2, { assetId: "shot-c", motionAction: "zoom_out" }),
          shot(0, 4, 6, 2, { assetId: "shot-d", motionAction: "static_hold" }),
        ],
      }),
    ],
    totalDurationSeconds: 8,
  });
  const plan = normalizeShotTimelineForRender(request);
  assert.equal(plan.clips[0].zoom, "in", "push_in -> zoom=in");
  assert.equal(plan.clips[1].pan, "right_to_left", "pan_left -> pan=right_to_left");
  assert.equal(plan.clips[2].zoom, "out", "zoom_out -> zoom=out");
  assert.equal(plan.clips[3].zoom ?? "none", "none", "static_hold NÃO deve aplicar zoom");
});

test("SHOT RENDER ENGINE: motionAction desconhecido emite warning semântico sem quebrar renderização", () => {
  const request = baseRequest({
    scenes: [
      fallbackScene(0, 0, 4, {
        shotTimeline: [
          shot(0, 1, 0, 2, { assetId: "shot-a", motionAction: "tilt_up" }),
          shot(0, 2, 2, 2, { assetId: "shot-b", motionAction: "MOTION_QUE_NAO_EXISTE" }),
        ],
      }),
    ],
    totalDurationSeconds: 4,
  });
  const plan = normalizeShotTimelineForRender(request);
  assert.ok(plan.warnings.some((w) => w.includes("SHOT_RENDER_MOTION_FALLBACK")), "tilt_up deve gerar fallback semântico");
  assert.ok(plan.warnings.some((w) => w.includes("SHOT_RENDER_MOTION_UNKNOWN")), "motion não reconhecido deve gerar warning");
});

test("SHOT RENDER ENGINE: transitionToNext usa exitTransition do shot; último shot da cena usa transitionToNext da cena", () => {
  const request = baseRequest({
    scenes: [
      fallbackScene(0, 0, 6, {
        transitionToNext: "dissolve",
        shotTimeline: [
          shot(0, 1, 0, 2, { assetId: "shot-a", exitTransition: "whip" }),
          shot(0, 2, 2, 2, { assetId: "shot-b", exitTransition: "cut" }),
          shot(0, 3, 4, 2, { assetId: "shot-c" /* sem exitTransition — último shot herda dissolve da cena */ }),
        ],
      }),
    ],
    totalDurationSeconds: 6,
  });
  const plan = normalizeShotTimelineForRender(request);
  assert.equal(plan.clips[0].transitionToNext, "whip");
  assert.equal(plan.clips[1].transitionToNext, "cut");
  assert.equal(plan.clips[2].transitionToNext, "dissolve", "último shot deve herdar transitionToNext da cena");
});

test("SHOT RENDER ENGINE: shot com duração abaixo do mínimo é elevado ao mínimo (0.4s) com warning", () => {
  const request = baseRequest({
    scenes: [
      fallbackScene(0, 0, 4, {
        shotTimeline: [
          shot(0, 1, 0, 0.2 /* muito curto */, { assetId: "shot-a" }),
          shot(0, 2, 0.4, 3.6, { assetId: "shot-b" }),
        ],
      }),
    ],
    totalDurationSeconds: 4,
  });
  const plan = normalizeShotTimelineForRender(request);
  assert.equal(plan.clips[0].durationSeconds, MIN_CLIP_DURATION_SECONDS);
  assert.ok(plan.warnings.some((w) => w.includes("SHOT_RENDER_SHOT_TOO_SHORT")));
});

test("SHOT RENDER ENGINE: startSeconds cumulativo é reflowed automaticamente (sem gaps entre clipes)", () => {
  const request = baseRequest({
    scenes: [
      fallbackScene(0, 0, 6, {
        shotTimeline: [
          shot(0, 1, 0, 2, { assetId: "shot-a" }),
          shot(0, 2, 2, 2, { assetId: "shot-b" }),
          shot(0, 3, 4, 2, { assetId: "shot-c" }),
        ],
      }),
    ],
    totalDurationSeconds: 6,
  });
  const plan = normalizeShotTimelineForRender(request);
  // O compilador espera continuidade absoluta (start[N+1] === end[N]).
  assert.equal(plan.clips[0].startSeconds, 0);
  assert.equal(plan.clips[1].startSeconds, 2);
  assert.equal(plan.clips[2].startSeconds, 4);
  const sum = plan.clips.reduce((total, c) => total + c.durationSeconds, 0);
  assert.equal(sum, 6);
});

test("SHOT RENDER ENGINE: fallback de cena sem shotTimeline (misturado com cenas que têm) emite warning explícito", () => {
  const request = baseRequest({
    scenes: [
      fallbackScene(0, 0, 4, {
        overlays: [{ role: "headline", text: "Gancho" }],
        shotTimeline: [
          shot(0, 1, 0, 2, { assetId: "shot-a" }),
          shot(0, 2, 2, 2, { assetId: "shot-b" }),
        ],
      }),
      fallbackScene(1, 4, 4 /* SEM shotTimeline */, {
        overlays: [{ role: "headline", text: "Desenvolvimento" }],
      }),
    ],
    totalDurationSeconds: 8,
  });
  const plan = normalizeShotTimelineForRender(request);
  assert.equal(plan.clips.length, 3, "2 shots + 1 fallback = 3 clipes");
  assert.equal(plan.fallbackSceneOrders.length, 1);
  assert.equal(plan.fallbackSceneOrders[0], 1);
  assert.ok(plan.warnings.some((w) => w.includes("SHOT_RENDER_SCENE_FALLBACK") && w.includes("cena 1")));
});

// ---------------------------------------------------------------------------------------------
// SHOT RENDER ENGINE — compileFfmpegArgs com clipes achatados
// ---------------------------------------------------------------------------------------------

test("SHOT RENDER ENGINE: compileFfmpegArgs emite um filter chain por Shot (não por cena) quando shotTimeline está presente", () => {
  const request = baseRequest({
    scenes: [
      fallbackScene(0, 0, 6, {
        shotTimeline: [
          shot(0, 1, 0, 2, { assetId: "shot-a", motionAction: "push_in" }),
          shot(0, 2, 2, 2, { assetId: "shot-b", motionAction: "static_hold" }),
          shot(0, 3, 4, 2, { assetId: "shot-c", motionAction: "pan_left" }),
        ],
      }),
    ],
    totalDurationSeconds: 6,
  });
  const { args, plan } = compileFfmpegArgsWithPlan({
    request,
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "regular.ttf", bold: "bold.ttf" },
    supportsGradients: true,
  });
  assert.equal(plan.totalShots, 3);
  assert.equal(plan.clips.length, 3);
  // 3 assets diferentes devem virar 3 inputs.
  assert.ok(args.some((arg) => arg === "/fake/shotA.png"), "shot-a asset como input FFmpeg");
  assert.ok(args.some((arg) => arg === "/fake/shotB.png"), "shot-b asset como input FFmpeg");
  assert.ok(args.some((arg) => arg === "/fake/shotC.png"), "shot-c asset como input FFmpeg");
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  // 3 chain labels distintos (um por Shot).
  assert.match(filterComplex, /\[s0\]/);
  assert.match(filterComplex, /\[s1\]/);
  assert.match(filterComplex, /\[s2\]/);
});

test("SHOT RENDER ENGINE: compileFfmpegArgs aplica transições entre Shots (xfade por Shot, não só entre cenas)", () => {
  const request = baseRequest({
    scenes: [
      fallbackScene(0, 0, 4, {
        transitionToNext: "dissolve",
        shotTimeline: [
          shot(0, 1, 0, 2, { assetId: "shot-a", exitTransition: "whip" }),
          shot(0, 2, 2, 2, { assetId: "shot-b" /* último da cena — herda dissolve */ }),
        ],
      }),
    ],
    totalDurationSeconds: 4,
  });
  const args = compileFfmpegArgs({
    request,
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "regular.ttf", bold: "bold.ttf" },
    supportsGradients: true,
  });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  // whip vira `hblur` no vocabulário do xfade FFmpeg.
  assert.match(filterComplex, /xfade=transition=hblur/, "transição whip entre Shot 1 e Shot 2");
});

test("SHOT RENDER ENGINE: compileFfmpegArgs NÃO adiciona -shortest (evita truncamento por áudio curto)", () => {
  const request = baseRequest({
    scenes: [fallbackScene(0, 0, 8), fallbackScene(1, 8, 4)],
    audioTracks: [
      {
        assetId: "narration",
        role: "narration",
        startSeconds: 0,
        volume: 1.0,
      },
    ],
    assets: [
      { id: "bg-1", kind: "image", absolutePath: "/fake/bg1.png" },
      { id: "bg-2", kind: "image", absolutePath: "/fake/bg2.png" },
      { id: "narration", kind: "audio", absolutePath: "/fake/narration.wav" },
    ],
    totalDurationSeconds: 12,
  });
  const args = compileFfmpegArgs({
    request,
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "regular.ttf", bold: "bold.ttf" },
    supportsGradients: true,
  });
  assert.ok(!args.includes("-shortest"), "renderer NUNCA deve usar -shortest — corta o vídeo quando áudio termina antes");
  assert.ok(args.includes("-t"), "deve usar -t <totalDuration> para governar a duração final");
});

test("SHOT RENDER ENGINE: narração/SFX ganham apad=whole_dur para nunca cortar o vídeo antes do fim", () => {
  const request = baseRequest({
    scenes: [fallbackScene(0, 0, 8), fallbackScene(1, 8, 4)],
    audioTracks: [
      { assetId: "music", role: "music", startSeconds: 0, volume: 0.4 },
      { assetId: "narration", role: "narration", startSeconds: 0, volume: 1.0 },
      { assetId: "sfx1", role: "sound_effect", startSeconds: 2, volume: 0.8 },
    ],
    assets: [
      { id: "bg-1", kind: "image", absolutePath: "/fake/bg1.png" },
      { id: "bg-2", kind: "image", absolutePath: "/fake/bg2.png" },
      { id: "music", kind: "audio", absolutePath: "/fake/music.mp3" },
      { id: "narration", kind: "audio", absolutePath: "/fake/narration.wav" },
      { id: "sfx1", kind: "audio", absolutePath: "/fake/sfx1.wav" },
    ],
    totalDurationSeconds: 12,
  });
  const args = compileFfmpegArgs({
    request,
    overlayTextFiles: new Map(),
    outputAbsolutePath: "/tmp/out.mp4",
    fonts: { regular: "regular.ttf", bold: "bold.ttf" },
    supportsGradients: true,
  });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  // apad em narração e SFX; NÃO em música (que já tem stream_loop -1).
  const narrationApadCount = (filterComplex.match(/apad=whole_dur=12\.000/g) ?? []).length;
  assert.ok(narrationApadCount >= 2, `esperava >=2 apad (narration + sfx); encontrado ${narrationApadCount}`);
});

test("SHOT RENDER ENGINE: shot-render-plan projeta assetId por Shot (não repete asset da cena em múltiplos Shots)", () => {
  const request = baseRequest({
    scenes: [
      fallbackScene(0, 0, 6, {
        background: { type: "image", assetId: "bg-1" },
        shotTimeline: [
          shot(0, 1, 0, 2, { assetId: "shot-a" }),
          shot(0, 2, 2, 2, { assetId: "shot-b" }),
          shot(0, 3, 4, 2, { assetId: "shot-c" }),
        ],
      }),
    ],
    totalDurationSeconds: 6,
  });
  const plan = normalizeShotTimelineForRender(request);
  const backgroundAssetIds = plan.clips.map((c) => (c.background.type === "image" ? c.background.assetId : null));
  const distinct = new Set(backgroundAssetIds);
  assert.equal(distinct.size, 3, "cada Shot deveria ter asset distinto do da cena");
  assert.ok(!backgroundAssetIds.includes("bg-1"), "asset da cena não deve aparecer se todos os Shots têm asset próprio");
});

// ---------------------------------------------------------------------------------------------
// SHOT RENDER ENGINE — Regressão da pipeline de imagem (sem shotTimeline)
// ---------------------------------------------------------------------------------------------

test("SHOT RENDER ENGINE: LEGACY path preserva 1:1 quando nenhuma cena tem shotTimeline (backward compat)", () => {
  const request = baseRequest({
    scenes: [
      fallbackScene(0, 0, 4, {
        overlays: [{ role: "headline", text: "Hook legacy" }],
        motion: {
          rhythm: "medium",
          elements: [
            { id: "headline-legacy", role: "headline", text: "Hook legacy", startSeconds: 0, durationSeconds: 4, entrance: "slide_up", easing: "ease_out", priority: 10 },
          ],
        },
      }),
      fallbackScene(1, 4, 4),
    ],
    totalDurationSeconds: 8,
  });
  const plan = normalizeShotTimelineForRender(request);
  assert.equal(plan.clips.length, 2);
  assert.equal(plan.totalShots, 0);
  assert.deepEqual(plan.clips.map((c) => c.order), [0, 1], "orders preservados 1:1");
  // Motion original preservado (sem rescale).
  assert.equal(plan.clips[0].motion?.elements.length, 1);
  assert.equal(plan.clips[0].motion?.elements[0].id, "headline-legacy");
});
