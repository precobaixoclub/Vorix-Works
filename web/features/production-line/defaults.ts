import type { ContentBlueprint, PostingRule, ProductionLineConfig, ProductionSkillStage } from "./types";

export const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube Shorts",
};

export const FORMAT_LABEL: Record<string, string> = {
  single_image: "Imagem",
  carousel: "Carrossel",
  video: "Vídeo",
};

export const DEFAULT_BLUEPRINTS: ContentBlueprint[] = [
  {
    id: "offer-image",
    name: "Oferta direta do produto principal",
    format: "single_image",
    ideaText: "Criar uma postagem simples destacando uma oferta forte, com produto em evidência e chamada clara para comprar ou chamar no WhatsApp.",
    objective: "Gerar desejo por uma oferta clara e fácil de entender.",
    theme: "Promoções, preços, vantagens e chamada para ação.",
    captionDirection: "Legenda curta, objetiva, com benefício no primeiro período e CTA no fim.",
    creativeDirection: "Arte com produto em destaque, preço visível e contraste alto.",
    mediaCount: 1,
    channels: ["instagram", "facebook"],
    approvalMode: "manual",
    sourceLinks: [],
    referenceImages: [],
    status: "available",
  },
  {
    id: "education-carousel",
    name: "Carrossel com dicas para o cliente",
    format: "carousel",
    ideaText: "Explicar um tema útil em formato de carrossel, ensinando algo rápido e conduzindo o público para salvar ou chamar.",
    objective: "Explicar um tema e conduzir o público para salvar, comentar ou chamar.",
    theme: "Dicas, comparativos, erros comuns e passo a passo.",
    captionDirection: "Legenda com contexto, resumo dos slides e CTA para interação.",
    creativeDirection: "Slides com título forte, blocos curtos e identidade consistente.",
    mediaCount: 5,
    channels: ["instagram", "facebook"],
    approvalMode: "manual",
    sourceLinks: [],
    referenceImages: [],
    status: "available",
  },
  {
    id: "short-video",
    name: "Vídeo curto demonstrando benefício",
    format: "video",
    ideaText: "Criar um vídeo vertical curto com gancho inicial, demonstração rápida e chamada final para conhecer a oferta.",
    objective: "Transformar uma ideia em vídeo vertical curto para descoberta.",
    theme: "Gancho, demonstração rápida, prova e CTA.",
    captionDirection: "Legenda simples com promessa, contexto e hashtags enxutas.",
    creativeDirection: "Cortes rápidos, texto na tela e ritmo de Reels/TikTok.",
    mediaCount: 1,
    channels: ["instagram", "tiktok", "youtube"],
    approvalMode: "manual",
    sourceLinks: [],
    referenceImages: [],
    status: "available",
  },
];

export const DEFAULT_POSTING_RULES: PostingRule[] = [
  {
    id: "weekly-production",
    name: "Ritmo semanal",
    channels: ["instagram", "facebook"],
    timezone: "America/Sao_Paulo",
    times: ["09:00", "18:30"],
    maxPostsPerDay: 2,
    spacingMinutes: 240,
    publishMode: "manual",
    weeklyMix: [
      { id: "mix-image", format: "single_image", quantity: 2, weekdays: ["mon", "wed"], times: ["09:00"] },
      { id: "mix-carousel", format: "carousel", quantity: 1, weekdays: ["fri"], times: ["18:30"] },
      { id: "mix-video", format: "video", quantity: 1, weekdays: ["tue"], times: ["18:30"] },
    ],
    sequence: [
      { id: "seq-offer", blueprintId: "offer-image", quantity: 2, everyDays: 2 },
      { id: "seq-carousel", blueprintId: "education-carousel", quantity: 1, everyDays: 3 },
      { id: "seq-video", blueprintId: "short-video", quantity: 1, everyDays: 5 },
    ],
  },
];

export const DEFAULT_PRODUCTION_CONFIG: ProductionLineConfig = {
  blueprints: DEFAULT_BLUEPRINTS,
  postingRules: DEFAULT_POSTING_RULES,
};

export const PRODUCTION_STAGES: ProductionSkillStage[] = [
  {
    id: "joao",
    name: "Joao",
    role: "estratégia",
    mode: "automatic",
    inputs: "objetivo, canal, público",
    outputs: "ângulo e promessa",
  },
  {
    id: "eduardo",
    name: "Eduardo",
    role: "planejamento editorial",
    mode: "automatic",
    inputs: "sequência e calendário",
    outputs: "pauta priorizada",
  },
  {
    id: "maria",
    name: "Maria",
    role: "copywriting",
    mode: "automatic",
    inputs: "pauta e tom de voz",
    outputs: "legenda e CTA",
  },
  {
    id: "sofia",
    name: "Sofia",
    role: "direção de arte",
    mode: "automatic",
    inputs: "formato e referência",
    outputs: "brief visual",
  },
  {
    id: "bianca",
    name: "Bianca",
    role: "design social",
    mode: "automatic",
    inputs: "brief visual",
    outputs: "layout dos posts",
  },
  {
    id: "pedro",
    name: "Pedro",
    role: "imagem",
    mode: "automatic",
    inputs: "layout e assets",
    outputs: "imagem final",
  },
  {
    id: "vanessa",
    name: "Vanessa",
    role: "direção de vídeo",
    mode: "automatic",
    inputs: "roteiro e canal",
    outputs: "plano de cenas",
  },
  {
    id: "rafa",
    name: "Rafa",
    role: "renderização",
    mode: "automatic",
    inputs: "cenas e mídia",
    outputs: "vídeo final",
  },
  {
    id: "lucas",
    name: "Lucas",
    role: "qualidade",
    mode: "review",
    inputs: "peça gerada",
    outputs: "aprovação técnica",
  },
  {
    id: "ana",
    name: "Ana",
    role: "publicação",
    mode: "configured",
    inputs: "regras e credenciais",
    outputs: "post agendado",
  },
];
