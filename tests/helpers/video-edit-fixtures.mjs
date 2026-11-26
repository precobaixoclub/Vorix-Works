// Planos de edição de exemplo para os testes do motor de vídeo (DaVinci).

export const TEXT_STYLE = { size: 0.05, colorHex: "#FFFFFF", backgroundHex: "#111111", bold: true };

/** Anúncio com imagens (modo B): 4 clipes, todas as transições com sobreposição, logo, trilha. */
export function imagesAdPlan(overrides = {}) {
  const clips = [
    { id: "c1", assetId: "p1", purpose: "abertura", sourceInSeconds: 0, durationSeconds: 4, recordStartSeconds: 0, motion: { type: "push_in", intensity: 0.5 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.4 }, transitionIn: { type: "dip_to_black", durationSeconds: 0.5 }, keepSourceAudio: false, overlays: [{ id: "o1", role: "hook", text: "Estampas que contam histórias", startOffsetSeconds: 0.3, durationSeconds: 3, position: "top", animation: "slide_up", style: TEXT_STYLE }] },
    { id: "c2", assetId: "p2", purpose: "detalhe", sourceInSeconds: 0, durationSeconds: 4, recordStartSeconds: 3.5, motion: { type: "pan_left", intensity: 0.4 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "cross_dissolve", durationSeconds: 0.5 }, keepSourceAudio: false, overlays: [] },
    { id: "c3", assetId: "p3", purpose: "variedade", sourceInSeconds: 0, durationSeconds: 4, recordStartSeconds: 7, motion: { type: "pull_out", intensity: 0.3 }, framing: { fit: "fit", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "push_left", durationSeconds: 0.5 }, keepSourceAudio: false, overlays: [] },
    { id: "c4", assetId: "p1", purpose: "cta", sourceInSeconds: 0, durationSeconds: 4.5, recordStartSeconds: 10.5, motion: { type: "static", intensity: 0 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "zoom_in", durationSeconds: 0.5 }, keepSourceAudio: false, overlays: [{ id: "o2", role: "cta", text: "Compre agora no site", startOffsetSeconds: 1, durationSeconds: 3.5, position: "bottom", animation: "pop", style: TEXT_STYLE }] },
  ];
  return {
    version: 1,
    planId: "plan-ad-1",
    workspaceId: "ws-cmkv",
    mode: "images_ad",
    aspect: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 15,
    assets: [
      { id: "p1", kind: "image", role: "product_photo", fileName: "photo-ax.jpg", width: 1200, height: 1500, protectedFidelity: true },
      { id: "p2", kind: "image", role: "product_photo", fileName: "photo-bx.jpg", width: 1500, height: 1000, protectedFidelity: true },
      { id: "p3", kind: "image", role: "product_photo", fileName: "photo-cx.png", width: 1000, height: 1000 },
      { id: "logo", kind: "image", role: "logo", fileName: "logo-x.png", width: 800, height: 400 },
      { id: "song", kind: "audio", role: "music", fileName: "song-x.wav", sourceDurationSeconds: 30 },
    ],
    clips,
    logo: { assetId: "logo", placement: "top_right", scale: 0.2, startSeconds: 10.5, durationSeconds: 4.5 },
    music: { assetId: "song", gainDb: -14, fadeInSeconds: 0.5, fadeOutSeconds: 1.5, duckUnderSpeech: false },
    captions: { enabled: false, style: TEXT_STYLE, position: "bottom", segments: [] },
    sourceAudioGainDb: 0,
    strategy: "produto-heroi",
    prompt: "Propaganda premium de 15 segundos",
    ...overrides,
  };
}

/** Edição de gravação (modo A): 3 trechos com fala, legendas, trilha com ducking. */
export function footagePlan(overrides = {}) {
  return {
    version: 1,
    planId: "plan-reels-1",
    workspaceId: "ws-vorix",
    mode: "edit_footage",
    aspect: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 12,
    assets: [
      { id: "v1", kind: "video", role: "footage", fileName: "take-ax.mp4", sourceDurationSeconds: 60, width: 1920, height: 1080 },
      { id: "song", kind: "audio", role: "music", fileName: "song-x.wav", sourceDurationSeconds: 30 },
    ],
    clips: [
      { id: "c1", assetId: "v1", purpose: "gancho", sourceInSeconds: 12, durationSeconds: 4, recordStartSeconds: 0, motion: { type: "push_in", intensity: 0.3 }, framing: { fit: "fill", focusX: 0.45, focusY: 0.4 }, transitionIn: { type: "cut", durationSeconds: 0 }, keepSourceAudio: true, overlays: [] },
      { id: "c2", assetId: "v1", purpose: "argumento", sourceInSeconds: 30, durationSeconds: 4, recordStartSeconds: 4, motion: { type: "static", intensity: 0 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.4 }, transitionIn: { type: "cut", durationSeconds: 0 }, keepSourceAudio: true, overlays: [] },
      { id: "c3", assetId: "v1", purpose: "fechamento", sourceInSeconds: 50, durationSeconds: 4, recordStartSeconds: 8, motion: { type: "push_in", intensity: 0.2 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.4 }, transitionIn: { type: "cut", durationSeconds: 0 }, keepSourceAudio: true, overlays: [{ id: "o1", role: "cta", text: "Teste grátis", startOffsetSeconds: 1, durationSeconds: 3, position: "bottom", animation: "fade", style: TEXT_STYLE }] },
    ],
    captions: {
      enabled: true,
      style: { size: 0.045, colorHex: "#FFFFFF", backgroundHex: "#000000", bold: true },
      position: "bottom",
      segments: [
        { startSeconds: 0.2, endSeconds: 2, text: "Você perde clientes" },
        { startSeconds: 2, endSeconds: 3.9, text: "por responder tarde" },
        { startSeconds: 9, endSeconds: 11.5, text: "A Vorix responde por você" },
      ],
    },
    music: { assetId: "song", gainDb: -18, fadeInSeconds: 0.3, fadeOutSeconds: 1, duckUnderSpeech: true },
    sourceAudioGainDb: 0,
    strategy: "fala-direta",
    prompt: "Reels de 12 segundos",
    ...overrides,
  };
}
