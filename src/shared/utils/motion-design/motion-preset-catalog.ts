// Motion Preset Catalog — catálogo estático dos estilos de animação que a Motion Design Engine
// pode aplicar a um Motion Plan. Cada preset é uma combinação fixa e completa de animação de
// fundo, texto, ícones, CTA, entrada, saída, transição, intensidade e velocidade — nunca parcial.
//
// Este catálogo é dado puro (sem I/O, sem estado); `getMotionPreset`/`listMotionPresets` são as
// únicas formas de acesso para que o catálogo continue sendo a fonte única de verdade.

import { MOTION_PRESET_IDS, type MotionPreset, type MotionPresetId } from "./motion-design.types.js";

const MOTION_PRESET_CATALOG: Readonly<Record<MotionPresetId, MotionPreset>> = {
  elegant: {
    id: "elegant",
    name: "Elegant",
    description: "Zoom lento e contido, tipografia entrando com suavidade — para marcas premium que não podem parecer apressadas.",
    background: "slow_zoom_in",
    text: "fade_up",
    icons: "fade",
    cta: "fade_in",
    entrance: "fade_in",
    exit: "fade_out",
    transition: "cross_fade",
    intensity: "subtle",
    speed: "slow",
    bestFor: {
      campaignTypes: ["institutional", "emotional_storytelling", "product_launch"],
      platforms: ["reels", "stories", "feed"],
      emotions: ["tranquilidade", "sofisticação", "confiança", "leveza"],
    },
  },
  corporate: {
    id: "corporate",
    name: "Corporate",
    description: "Movimento previsível e discreto, texto em blocos claros — para comunicação institucional e B2B.",
    background: "static",
    text: "slide_in",
    icons: "fade",
    cta: "fade_in",
    entrance: "slide_up",
    exit: "fade_out",
    transition: "hard_cut",
    intensity: "subtle",
    speed: "medium",
    bestFor: {
      campaignTypes: ["institutional", "b2b", "product_launch"],
      platforms: ["feed", "carousel", "stories"],
      emotions: ["confiança", "clareza", "seriedade"],
    },
  },
  luxury: {
    id: "luxury",
    name: "Luxury",
    description: "Parallax sutil e revelação lenta de detalhe — para posicionamento premium/aspiracional.",
    background: "parallax_drift",
    text: "fade_up",
    icons: "fade",
    cta: "scale",
    entrance: "fade_in",
    exit: "fade_out",
    transition: "cross_fade",
    intensity: "subtle",
    speed: "slow",
    bestFor: {
      campaignTypes: ["product_launch", "emotional_storytelling", "institutional"],
      platforms: ["reels", "stories", "feed"],
      emotions: ["sofisticação", "exclusividade", "aspiração"],
    },
  },
  modern: {
    id: "modern",
    name: "Modern",
    description: "Ken Burns com leve inclinação e texto entrando por escala — equilíbrio entre energia e clareza.",
    background: "ken_burns_pan",
    text: "scale_in",
    icons: "pop",
    cta: "scale",
    entrance: "zoom_in",
    exit: "cut",
    transition: "cross_fade",
    intensity: "moderate",
    speed: "medium",
    bestFor: {
      campaignTypes: ["product_launch", "promotional", "app_demo"],
      platforms: ["reels", "feed", "stories"],
      emotions: ["modernidade", "praticidade", "confiança"],
    },
  },
  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "Quase estático, uma única variação de foco por cena — para mensagens que não podem competir com movimento.",
    background: "static",
    text: "static",
    icons: "none",
    cta: "fade_in",
    entrance: "fade_in",
    exit: "fade_out",
    transition: "hard_cut",
    intensity: "subtle",
    speed: "slow",
    bestFor: {
      campaignTypes: ["institutional", "emotional_storytelling"],
      platforms: ["feed", "carousel"],
      emotions: ["tranquilidade", "clareza", "sobriedade"],
    },
  },
  dynamic: {
    id: "dynamic",
    name: "Dynamic",
    description: "Cortes rápidos, zoom acentuado e ícones entrando com força — para manter atenção em formatos curtos.",
    background: "slow_zoom_out",
    text: "word_pop",
    icons: "bounce",
    cta: "pulse_loop",
    entrance: "zoom_in",
    exit: "cut",
    transition: "whip_pan",
    intensity: "strong",
    speed: "fast",
    bestFor: {
      campaignTypes: ["promotional", "app_demo", "product_launch"],
      platforms: ["reels", "tiktok", "shorts"],
      emotions: ["energia", "urgência", "entusiasmo"],
    },
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    description: "Ritmo nativo de TikTok: texto pop palavra a palavra, ícones saltando, cortes secos e imediatos.",
    background: "subtle_blur_pulse",
    text: "word_pop",
    icons: "bounce",
    cta: "shake",
    entrance: "pop",
    exit: "cut",
    transition: "hard_cut",
    intensity: "strong",
    speed: "fast",
    bestFor: {
      campaignTypes: ["promotional", "app_demo", "ugc_style"],
      platforms: ["tiktok", "shorts", "reels"],
      emotions: ["energia", "humor", "urgência"],
    },
  },
  instagram_reel: {
    id: "instagram_reel",
    name: "Instagram Reel",
    description: "Zoom suave com legendas em ritmo de fala e ícones discretos — o padrão nativo de Reels bem produzidos.",
    background: "ken_burns_pan",
    text: "fade_up",
    icons: "pulse",
    cta: "slide_up",
    entrance: "slide_up",
    exit: "fade_out",
    transition: "cross_fade",
    intensity: "moderate",
    speed: "medium",
    bestFor: {
      campaignTypes: ["promotional", "emotional_storytelling", "product_launch", "app_demo"],
      platforms: ["reels", "stories"],
      emotions: ["leveza", "praticidade", "confiança", "modernidade"],
    },
  },
  fast_promo: {
    id: "fast_promo",
    name: "Fast Promo",
    description: "Máxima urgência: entradas rápidas, CTA pulsando o tempo todo — para promoções e prazos curtos.",
    background: "slow_zoom_out",
    text: "word_pop",
    icons: "bounce",
    cta: "pulse_loop",
    entrance: "pop",
    exit: "cut",
    transition: "glitch",
    intensity: "strong",
    speed: "fast",
    bestFor: {
      campaignTypes: ["promotional"],
      platforms: ["reels", "tiktok", "shorts", "stories"],
      emotions: ["urgência", "escassez", "entusiasmo"],
    },
  },
  storytelling: {
    id: "storytelling",
    name: "Storytelling",
    description: "Ritmo contemplativo com pan lento e texto surgindo como legenda de cinema — para narrativas emocionais longas.",
    background: "ken_burns_pan",
    text: "fade_up",
    icons: "fade",
    cta: "fade_in",
    entrance: "fade_in",
    exit: "fade_out",
    transition: "cross_fade",
    intensity: "moderate",
    speed: "slow",
    bestFor: {
      campaignTypes: ["emotional_storytelling", "institutional"],
      platforms: ["reels", "stories", "feed"],
      emotions: ["emoção", "nostalgia", "tranquilidade", "conexão"],
    },
  },
};

/** Único ponto de acesso a um preset por id — lança se o id não existir no catálogo (nunca deveria, dado `MotionPresetId`). */
export function getMotionPreset(id: MotionPresetId): MotionPreset {
  const preset = MOTION_PRESET_CATALOG[id];
  if (!preset) {
    throw new Error(`MOTION_PRESET_NOT_FOUND: preset "${id}" não existe no Motion Preset Catalog.`);
  }
  return preset;
}

/** Lista todos os presets do catálogo, na ordem estável de `MOTION_PRESET_IDS`. */
export function listMotionPresets(): MotionPreset[] {
  return MOTION_PRESET_IDS.map((id) => MOTION_PRESET_CATALOG[id]);
}

export function isKnownMotionPresetId(id: string): id is MotionPresetId {
  return (MOTION_PRESET_IDS as readonly string[]).includes(id);
}
