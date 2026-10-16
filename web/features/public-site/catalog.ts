import type { PublicBillingCatalog, PublicPlan } from "@/features/platform-plans/api";

export type PublicProductKey = "conversations" | "meetings" | "suite";
export type PublicProduct = {
  key: PublicProductKey;
  name: string;
  description: string;
  eyebrow: string;
  features: readonly string[];
  /** Até 4 itens para os cards de preço — a lista completa fica nas páginas de produto. */
  highlights: readonly string[];
  productHref: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  currency: string;
  provisional: boolean;
  contractable: boolean;
  highlighted: boolean;
  badge: string;
  cta: { label: string; href: string };
  plan: PublicPlan | null;
  includes: readonly ("conversations" | "meetings")[];
};

// Only fallback/reference prices live here. Billable Conversas prices always come from checkout's catalog.
export const PUBLIC_REFERENCE_PRICES = Object.freeze({ conversations: 197, meetings: 147, suite: 297 });
export const PUBLIC_CONTACT = "mailto:comercial@vorixworks.com";
const COPY = {
  conversations: {
    name: "Vorix Conversas", eyebrow: "Atendimento & vendas",
    description: "Atendimento, oportunidades e propostas em um só lugar.",
    features: ["WhatsApp centralizado", "Funil de atendimento e vendas", "Oportunidades", "Propostas comerciais", "Contatos e tarefas", "Automações operacionais", "Relatórios de performance"],
    highlights: ["WhatsApp, funil e propostas", "Contatos, tarefas e automações", "Usuários e números ajustáveis"],
    productHref: "/produtos/conversas",
  },
  meetings: {
    name: "Vorix Meetings", eyebrow: "Inteligência de reuniões",
    description: "Grave, transcreva e transforme reuniões em ação.",
    features: ["Agenda de reuniões", "Gravações centralizadas", "Transcrição automática", "Resumos com IA", "Tarefas e decisões extraídas", "Integração com Google Calendar"],
    highlights: ["Agenda com Google Calendar", "Gravação, transcrição e resumo", "Gravações simultâneas conforme o plano"],
    productHref: "/produtos/meetings",
  },
  suite: {
    name: "Vorix Suite", eyebrow: "Sua operação conectada",
    description: "Conversas e Meetings na mesma experiência Vorix.",
    features: ["Tudo do Vorix Conversas", "Tudo do Vorix Meetings", "Uma única conta", "Uma única empresa e workspace", "Experiência integrada"],
    highlights: ["Conversas + Meetings", "Uma conta, empresa e equipe", "Capacidade ajustada por produto"],
    productHref: "/precos#suite",
  },
} as const;

export type PublicProductCatalog = { products: readonly PublicProduct[]; plans: readonly PublicPlan[]; billing: PublicBillingCatalog | null };

export function buildPublicProductCatalog(billing: PublicBillingCatalog | null): PublicProductCatalog {
  const official = billing?.priceSource === "plan_versions";
  const plans = official ? (billing?.plans ?? []).filter(plan => plan.code !== "FREE" && Number.isFinite(plan.monthlyPriceUsd) && plan.monthlyPriceUsd > 0 && !!plan.currency).sort((a, b) => a.monthlyPriceUsd - b.monthlyPriceUsd) : [];
  const start = plans[0] ?? null;
  const eligible = (key: "conversations" | "meetings") => billing?.solutions.find(solution => solution.key === key)?.contractable === true;
  const meetingsOffer = official ? billing?.meetingsOffer ?? null : null;
  const conversationsContractable = eligible("conversations") && !!start;
  // Meetings só é vendável com preço oficial no catálogo E o gate comercial aberto (gravação em
  // produção). Suite = Conversas + Meetings, cobrada pela soma das partes (sem preço próprio).
  const meetingsContractable = eligible("meetings") && !!meetingsOffer;
  const products: PublicProduct[] = (["conversations", "meetings", "suite"] as const).map(key => {
    const plan = key === "conversations" ? start : null;
    const contractable = key === "conversations" ? conversationsContractable : key === "meetings" ? meetingsContractable : conversationsContractable && meetingsContractable;
    const monthlyPrice = key === "conversations" ? plan?.monthlyPriceUsd ?? (official ? PUBLIC_REFERENCE_PRICES.conversations : null)
      : key === "meetings" ? meetingsOffer?.baseMonthlyPrice ?? PUBLIC_REFERENCE_PRICES.meetings
      : start && meetingsOffer ? start.monthlyPriceUsd + meetingsOffer.baseMonthlyPrice : PUBLIC_REFERENCE_PRICES.suite;
    const provisional = key === "conversations" ? !plan : key === "meetings" ? !meetingsOffer : !(start && meetingsOffer);
    return {
      key, ...COPY[key], monthlyPrice,
      annualPrice: plan && Number.isFinite(plan.yearlyPriceUsd) && plan.yearlyPriceUsd > 0 ? plan.yearlyPriceUsd : null,
      currency: plan?.currency ?? meetingsOffer?.currency ?? "BRL", provisional, contractable, highlighted: key === "suite",
      badge: key === "suite" ? "Experiência integrada" : contractable ? "Disponível para sua equipe" : key === "meetings" ? "Disponível em breve" : "Conheça a solução",
      cta: key === "conversations"
        ? (contractable ? { label: "Contratar Conversas", href: `/signup?plan=${encodeURIComponent(plan!.code)}` } : { label: "Falar com o time", href: PUBLIC_CONTACT })
        : key === "meetings"
          ? (contractable ? { label: "Contratar Meetings", href: "#monte" } : { label: "Conhecer Meetings", href: COPY.meetings.productHref })
          : { label: "Monte sua Suite", href: "#monte" },
      plan, includes: key === "suite" ? ["conversations", "meetings"] : [key],
    };
  });
  return { products, plans, billing };
}

export function formatPublicPrice(product: Pick<PublicProduct, "currency" | "monthlyPrice">, value = product.monthlyPrice): string {
  if (value === null) return "Consultar condições";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: product.currency, minimumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
}

export const PUBLIC_FAQ = [
  ["Conversas e Meetings são produtos separados?", "Sim. Cada solução tem sua própria operação. As duas compartilham a mesma conta, empresa, equipe e workspace na plataforma Vorix."],
  ["Posso contratar somente uma solução?", "Sim. Conversas já tem planos disponíveis. Meetings é independente de Conversas, mas sua contratação ainda depende da liberação comercial."],
  ["Posso adicionar outro produto depois?", "A plataforma foi construída para isso. Novas soluções podem ser adicionadas à mesma empresa conforme a disponibilidade comercial, sem criar outra conta."],
  ["O Meetings funciona sem Conversas?", "Sim, a arquitetura do Meetings é independente. Sua disponibilidade comercial e os critérios de integração com Google ainda estão em validação."],
  ["Como funciona a inteligência artificial?", "A IA ajuda a extrair informações e transformar contexto em ação. O uso de créditos e os recursos disponíveis dependem do plano e da operação."],
  ["Como funcionam as gravações simultâneas?", "No Meetings, a capacidade depende do plano e das contas de gravação saudáveis e disponíveis. Uma conta de gravação atende uma reunião por vez. A oferta comercial ainda está em validação."],
  ["Como funciona o preço do Vorix?", "Você parte de um plano e ajusta a capacidade de cada produto. Em Conversas, usuários e números conectados; no Meetings, gravações simultâneas. Os valores de Conversas vêm do mesmo catálogo usado na contratação."],
  ["Contas de gravação são cobradas como licença?", "Não. O que define a capacidade do Meetings são as gravações simultâneas do plano. As contas Google de gravação que você conecta são infraestrutura: uma conta a mais pode ficar como reserva."],
  ["Os dados da minha empresa ficam separados?", "O Vorix aplica isolamento por empresa e permissões de acesso por usuário. A equipe trabalha no contexto dos workspaces aos quais tem acesso."],
] as const;
