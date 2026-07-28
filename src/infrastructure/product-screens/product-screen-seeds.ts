import type { ProductScreenContentCropRect, ProductScreenDeviceTarget, ProductScreenSourceType } from "../../application/ports/product-screen-catalog.port.js";
import type { MediaAssetLicense } from "../../application/ports/media-catalog.port.js";

/**
 * PRODUCT COMPOSITING ENGINE — semente manual dos únicos arquivos locais que realmente são telas
 * do produto Rumo ao Altar (mockups aprovados gerados por Pedro em sprints anteriores). Nunca
 * escaneado "às cegas": os outros arquivos de `assets/visual/library/rumo-ao-altar/` (fotos de
 * contexto, marca, lembretes) NÃO são telas de produto e ficam de fora deliberadamente, para nunca
 * inventar uma tela a partir de uma imagem que não é interface nenhuma.
 *
 * Cada mockup é uma peça de marketing completa (moldura de celular + silhueta + texto promocional
 * ao redor) — `contentCropRect` foi determinado por inspeção visual real (crop iterativo com
 * FFmpeg + revisão de cada resultado) e recorta só o retângulo de conteúdo de tela real, sem a
 * moldura preta do aparelho nem o texto de marketing fora do aparelho. O arquivo original NUNCA é
 * modificado — o crop acontece sob demanda, apenas em diretório de cache, no momento da composição.
 */

const SHARED_MOBILE_CROP: ProductScreenContentCropRect = { x: 476, y: 257, width: 418, height: 1112 };

/** Mesmo texto/termos já usados para os outros mockups locais do Rumo ao Altar no catálogo de mídia geral (ver `.zuno-data/media-catalog.json`) — nunca inventado, mantém consistência com a licença já registrada para esses arquivos. */
const LOCAL_MOCKUP_LICENSE: MediaAssetLicense = {
  name: "Mockup local proprio do produto Rumo ao Altar",
  allowsCommercialUse: true,
  requiresAttribution: false,
};

export type ProductScreenSeed = {
  relativePath: string;
  functionality: string;
  deviceTarget: ProductScreenDeviceTarget;
  sourceType: ProductScreenSourceType;
  contentCropRect?: ProductScreenContentCropRect;
  tags: string[];
  license: MediaAssetLicense;
};

export const PRODUCT_SCREEN_SEEDS: ProductScreenSeed[] = [
  {
    relativePath: "rumo-ao-altar/rsvp-mobile-mockup.png",
    functionality: "rsvp",
    deviceTarget: "phone",
    sourceType: "mockup",
    contentCropRect: SHARED_MOBILE_CROP,
    tags: ["rsvp", "confirmar-presenca", "convite"],
    license: LOCAL_MOCKUP_LICENSE,
  },
  {
    relativePath: "rumo-ao-altar/gifts-pix-mobile-mockup.png",
    functionality: "gift_list",
    deviceTarget: "phone",
    sourceType: "mockup",
    contentCropRect: SHARED_MOBILE_CROP,
    tags: ["presentes", "lista-de-presentes", "pix"],
    license: LOCAL_MOCKUP_LICENSE,
  },
  {
    relativePath: "rumo-ao-altar/album-schedule-mobile-mockup.png",
    functionality: "collaborative_album",
    deviceTarget: "phone",
    sourceType: "mockup",
    contentCropRect: SHARED_MOBILE_CROP,
    tags: ["album", "fotos", "cronograma", "memorias"],
    license: LOCAL_MOCKUP_LICENSE,
  },
  {
    relativePath: "rumo-ao-altar/site-official-mobile-mockup.png",
    functionality: "homepage",
    deviceTarget: "phone",
    sourceType: "mockup",
    contentCropRect: SHARED_MOBILE_CROP,
    tags: ["site-oficial", "visao-geral", "homepage"],
    license: LOCAL_MOCKUP_LICENSE,
  },
  {
    relativePath: "rumo-ao-altar/end-card-site-official.png",
    functionality: "end_card",
    deviceTarget: "phone",
    sourceType: "mockup",
    contentCropRect: SHARED_MOBILE_CROP,
    tags: ["end-card", "cta", "logo-oficial"],
    license: LOCAL_MOCKUP_LICENSE,
  },
];
