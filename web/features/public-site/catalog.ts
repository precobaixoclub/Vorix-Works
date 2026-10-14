import type { PublicBillingCatalog, PublicPlan } from "@/features/platform-plans/api";

export type PublicProductKey = "conversations" | "meetings" | "suite";
export type PublicProduct = {
  key: PublicProductKey;
  name: string;
  description: string;
  eyebrow: string;
  features: readonly string[];
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
    productHref: "/produtos/conversas",
  },
  meetings: {
    name: "Vorix Meetings", eyebrow: "Inteligência de reuniões",
    description: "Grave, transcreva e transforme reuniões em ação.",
    features: ["Agenda de reuniões", "Gravações centralizadas", "Transcrição automática", "Resumos com IA", "Tarefas e decisões extraídas", "Integração com Google Calendar"],
    productHref: "/produtos/meetings",
  },
  suite: {
    name: "Vorix Suite", eyebrow: "Sua operação conectada",
    description: "Conversas e Meetings na mesma experiência Vorix.",
    features: ["Tudo do Vorix Conversas", "Tudo do Vorix Meetings", "Uma única conta", "Uma única empresa e workspace", "Experiência integrada"],
    productHref: "/precos#suite",
  },
} as const;

export type PublicProductCatalog = { products: readonly PublicProduct[]; plans: readonly PublicPlan[]; billing: PublicBillingCatalog | null };

export function buildPublicProductCatalog(billing: PublicBillingCatalog | null): PublicProductCatalog {
  const official = billing?.priceSource === "plan_versions";
  const plans = official ? (billing?.plans ?? []).filter(plan => plan.code !== "FREE" && Number.isFinite(plan.monthlyPriceUsd) && plan.monthlyPriceUsd > 0 && !!plan.currency).sort((a, b) => a.monthlyPriceUsd - b.monthlyPriceUsd) : [];
  const start = plans[0] ?? null;
  const eligible = (key: "conversations" | "meetings") => billing?.solutions.find(solution => solution.key === key)?.contractable === true;
  // No product-specific Meetings or bundle offer exists in billing yet. A future official offer
  // must supply both price and acquisition route before its purchase CTA can be enabled centrally.
  const products: PublicProduct[] = (["conversations", "meetings", "suite"] as const).map(key => {
    const plan = key === "conversations" ? start : null;
    const contractable = key === "conversations" && eligible("conversations") && !!plan;
    return {
      key, ...COPY[key], monthlyPrice: plan?.monthlyPriceUsd ?? (key !== "conversations" || official ? PUBLIC_REFERENCE_PRICES[key] : null),
      annualPrice: plan && Number.isFinite(plan.yearlyPriceUsd) && plan.yearlyPriceUsd > 0 ? plan.yearlyPriceUsd : null,
      currency: plan?.currency ?? "BRL", provisional: !plan, contractable, highlighted: key === "suite",
      badge: key === "suite" ? "Experiência integrada" : contractable ? "Disponível para sua equipe" : "Conheça a solução",
      cta: contractable ? { label: "Começar com Conversas", href: `/signup?plan=${encodeURIComponent(plan!.code)}` }
        : { label: key === "meetings" ? "Conhecer Meetings" : key === "suite" ? "Falar sobre a Suite" : "Falar com o time", href: key === "meetings" ? COPY.meetings.productHref : PUBLIC_CONTACT },
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
  ["Os dados da minha empresa ficam separados?", "O Vorix aplica isolamento por empresa e permissões de acesso por usuário. A equipe trabalha no contexto dos workspaces aos quais tem acesso."],
] as const;
