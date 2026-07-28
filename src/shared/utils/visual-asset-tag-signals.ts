/**
 * Vocabulário de tags compartilhado entre o `VisualAssetResolver` (infraestrutura, decide
 * aceitar/rejeitar candidatos) e o Asset Diversity Gate (`shared/utils/asset-diversity-gate.ts`,
 * usado diretamente pelas Skills). Vive em `src/shared/utils` — não é uma Skill nem
 * infraestrutura com I/O — para que os dois lados classifiquem "isto é um asset humano/de
 * produto/de contexto/de end card" com EXATAMENTE o mesmo critério, nunca duas listas paralelas
 * que poderiam divergir silenciosamente.
 */
export const HUMAN_TAG_SIGNAL = ["pessoa", "casal", "noivos", "contexto-humano", "foto-contexto"];
export const PRODUCT_TAG_SIGNAL = ["produto-real", "interface", "screenshot", "mockup-produto", "mockup"];
export const MOCKUP_TAG_SIGNAL = ["mockup", "mockup-produto"];
export const SCREENSHOT_TAG_SIGNAL = ["screenshot", "interface"];
export const CONTEXT_TAG_SIGNAL = ["contexto-humano", "foto-contexto", "contexto"];
export const END_CARD_TAG_SIGNAL = ["end-card", "cta", "logo", "logo-oficial", "marca", "url"];
