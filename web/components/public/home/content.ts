import {
  BarChart3,
  CalendarDays,
  Check,
  FileCheck2,
  FileText,
  Globe2,
  Headphones,
  Layers3,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  Package,
  ReceiptText,
  ShoppingCart,
  Sparkles,
  UserRound,
  Video,
  Workflow,
} from "lucide-react";
import { PUBLIC_CONTACT } from "@/features/public-site/catalog";

export type HomeProductKey =
  | "conversations"
  | "meetings"
  | "marketing"
  | "site";
export const DEMO_CONTACT = `${PUBLIC_CONTACT}?subject=${encodeURIComponent("Quero conhecer o ecossistema Vorix")}`;
export const HOME_PRODUCTS = [
  {
    key: "conversations",
    name: "Vorix Conversas",
    short: "Conversas",
    eyebrow: "O relacionamento começa aqui",
    description:
      "WhatsApp, atendimento, CRM e propostas. O contexto acompanha cada negociação, do primeiro oi ao fechamento.",
    image: "conversas/inbox",
    Icon: MessageCircle,
    href: "/produtos/conversas",
    features: [
      "Atendimento em equipe",
      "Funil e propostas",
      "Histórico do cliente",
    ],
    status: "Atendimento e vendas",
  },
  {
    key: "meetings",
    name: "Vorix Meetings",
    short: "Meetings",
    eyebrow: "Cada conversa também é conhecimento",
    description:
      "Gravações, transcrições e resumos com IA. Vincule a contatos e oportunidades e organize decisões e tarefas.",
    image: "meetings/summary",
    Icon: Video,
    href: "/produtos/meetings",
    features: [
      "Transcrição e resumo",
      "Decisões e tarefas",
      "Histórico das reuniões",
    ],
    status: "Conexão Google sujeita à homologação",
  },
  {
    key: "marketing",
    name: "Vorix Marketing",
    short: "Marketing",
    eyebrow: "Mais consistência para sua presença",
    description:
      "Criação, calendário e organização de conteúdo. Planeje a comunicação da empresa no mesmo ecossistema.",
    image: "marketing/content",
    Icon: Megaphone,
    href: "#marketing",
    features: [
      "Criação de conteúdo",
      "Calendário editorial",
      "Gestão de publicações",
    ],
    status: "Publicação social em homologação",
  },
  {
    key: "site",
    name: "Vorix Sites & Commerce",
    short: "Sites & Commerce",
    eyebrow: "Sua vitrine encontra sua operação",
    description:
      "Site, catálogo, produtos e pedidos conectados. Quem se interessa pelo seu produto já chega com contexto.",
    image: "commerce/site",
    Icon: ShoppingCart,
    href: "/produtos/site",
    features: [
      "Sites e catálogo",
      "Variações e estoque",
      "Pedidos e oportunidades",
    ],
    status: "Pagamentos e frete em homologação · marketplaces Beta",
  },
] as const;

export const JOURNEY = [
  {
    title: "Cliente chama",
    detail: "WhatsApp ou site",
    Icon: MessageCircle,
    example: "Um novo interesse",
  },
  {
    title: "Atendimento",
    detail: "Sua equipe acolhe",
    Icon: Headphones,
    example: "Conversa com contexto",
  },
  {
    title: "Contato",
    detail: "Histórico organizado",
    Icon: UserRound,
    example: "Um cadastro conectado",
  },
  {
    title: "Oportunidade",
    detail: "Negociação no funil",
    Icon: Layers3,
    example: "O próximo passo claro",
  },
  {
    title: "Proposta",
    detail: "Oferta e condições",
    Icon: FileText,
    example: "Tudo pronto para decidir",
  },
  {
    title: "Aceite",
    detail: "Decisão registrada",
    Icon: FileCheck2,
    example: "Proposta aceita",
  },
  {
    title: "Faturamento",
    detail: "Conferência comercial",
    Icon: ReceiptText,
    example: "A equipe confirma",
  },
  {
    title: "Venda",
    detail: "Resultado no histórico",
    Icon: Check,
    example: "Ciclo concluído",
  },
] as const;
export const CAPABILITIES = [
  {
    Icon: LayoutDashboard,
    title: "Atendimento e funil",
    text: "Priorize conversas, distribua o atendimento e acompanhe cada oportunidade.",
  },
  {
    Icon: FileCheck2,
    title: "Propostas e fechamento",
    text: "Envie condições, acompanhe o aceite e organize o faturamento da venda.",
  },
  {
    Icon: Package,
    title: "Catálogo, estoque e pedidos",
    text: "Produtos, variações e disponibilidade no contexto de cada negociação.",
  },
  {
    Icon: Globe2,
    title: "Sites que geram conversas",
    text: "Uma vitrine conectada ao catálogo e aos interessados que chegam por ela.",
  },
  {
    Icon: Video,
    title: "Reuniões com memória",
    text: "Gravação, transcrição e decisões para revisar depois da chamada.",
  },
  {
    Icon: BarChart3,
    title: "Indicadores para agir",
    text: "Enxergue atendimento, funil, vendas e resultados por período.",
  },
] as const;
export const AUTOMATIONS = [
  {
    Icon: Workflow,
    title: "Atendimento bem distribuído",
    text: "Regras de equipe organizam a chegada e a responsabilidade pelas conversas.",
  },
  {
    Icon: CalendarDays,
    title: "Próximos passos visíveis",
    text: "Tarefas, atividades e automações ajudam a manter o acompanhamento comercial.",
  },
  {
    Icon: Sparkles,
    title: "IA onde faz diferença",
    text: "Resumos de reuniões e apoio à criação, com consumo e acesso conforme o plano.",
  },
] as const;
