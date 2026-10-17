/**
 * Relatórios do Vorix Conversas — catálogo FECHADO de seções (cada uma é renderizada no painel a
 * partir de dados já calculados pelo backend: métricas comerciais, de atendimento e do Sales
 * Engine). Modelos fixos e modelos do cliente (manuais ou criados com IA) são só listas de chaves
 * deste catálogo — nunca SQL nem dado livre.
 */
export const REPORT_SECTIONS = [
  { key: "commercial_overview", title: "Visão comercial", description: "Oportunidades criadas, pipeline aberto, vendas ganhas e perdidas, conversão, ticket médio e ciclo de venda." },
  { key: "revenue_by_origin", title: "Receita por origem", description: "Vendas ganhas e receita agrupadas pela origem do contato (WhatsApp, Instagram, indicação...)." },
  { key: "stage_aging", title: "Tempo por etapa", description: "Quantas oportunidades estão abertas em cada etapa do funil e há quantos dias, em média." },
  { key: "loss_reasons", title: "Motivos de perda", description: "Por que as oportunidades foram perdidas, com a contagem de cada motivo." },
  { key: "sales_funnel", title: "Funil de vendas", description: "Entradas por etapa do funil, taxa de avanço e tempo médio em cada etapa." },
  { key: "seller_conversion", title: "Conversão por vendedor", description: "Ganhos, perdas e taxa de conversão de cada vendedor." },
  { key: "top_products", title: "Produtos mais vendidos", description: "Quantidade, receita, ticket médio e margem dos produtos e serviços vendidos." },
  { key: "proposals_performance", title: "Propostas", description: "Propostas criadas, enviadas, visualizadas, aceitas e recusadas, com taxas e tempos." },
  { key: "discounts_approvals", title: "Descontos e aprovações", description: "Vendas com desconto, desconto médio e pedidos de aprovação comercial." },
  { key: "margin", title: "Margem", description: "Receita, custo, lucro bruto e margem das vendas (visível só para quem pode ver custo)." },
  { key: "attendance_overview", title: "Atendimento", description: "Conversas recebidas, abertas, pendentes e resolvidas, tempo de primeira resposta e de atendimento, IA × humano." },
  { key: "agent_volume", title: "Volume por atendente", description: "Quantidade de mensagens enviadas por cada atendente." },
  { key: "csat", title: "Satisfação (CSAT)", description: "Nota média de satisfação, respostas recebidas e nota por atendente." },
  { key: "closing_reasons", title: "Motivos de encerramento", description: "Por que as conversas foram encerradas." },
] as const;

export type ReportSectionKey = (typeof REPORT_SECTIONS)[number]["key"];
export const REPORT_SECTION_KEYS: readonly ReportSectionKey[] = REPORT_SECTIONS.map((section) => section.key);

export function isReportSectionKey(value: string): value is ReportSectionKey {
  return (REPORT_SECTION_KEYS as readonly string[]).includes(value);
}

export type ReportTemplateDefinition = { id: string; name: string; description: string; sections: readonly ReportSectionKey[] };

/** Modelos fixos — disponíveis para todos os workspaces, não editáveis. */
export const SYSTEM_REPORT_TEMPLATES: readonly ReportTemplateDefinition[] = [
  { id: "system:executive_summary", name: "Resumo executivo", description: "O essencial do período: vendas, origem da receita e qualidade do atendimento.", sections: ["commercial_overview", "revenue_by_origin", "attendance_overview", "csat"] },
  { id: "system:sales_funnel", name: "Funil e conversão", description: "Onde as oportunidades avançam, travam e se perdem.", sections: ["commercial_overview", "sales_funnel", "stage_aging", "loss_reasons"] },
  { id: "system:team_performance", name: "Desempenho da equipe", description: "Conversão por vendedor, volume e satisfação por atendente.", sections: ["seller_conversion", "agent_volume", "csat", "discounts_approvals"] },
  { id: "system:products_margin", name: "Produtos e margem", description: "O que mais vende, com que margem e com quanto desconto.", sections: ["top_products", "margin", "discounts_approvals"] },
  { id: "system:attendance", name: "Atendimento", description: "Volume, tempos de resposta, satisfação e motivos de encerramento.", sections: ["attendance_overview", "agent_volume", "csat", "closing_reasons"] },
  { id: "system:proposals", name: "Propostas", description: "Do envio ao aceite: taxas, tempos e descontos concedidos.", sections: ["proposals_performance", "discounts_approvals", "commercial_overview"] },
];
