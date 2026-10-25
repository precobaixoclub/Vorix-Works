/** WhatsApp uses a single asterisk for emphasis. Keep the link on its own line. */
export const DEFAULT_PROPOSAL_WHATSAPP_TEMPLATE = "{{saudacao}}\n\n*PROPOSTA COMERCIAL*\n{{titulo}}\n\nPreparei esta proposta para você. Confira os detalhes e as condições no link abaixo.\n\n*Valor total:* {{valor}}\n{{linha_validade}}\n\n*Ver proposta completa*\n{{proposal_link}}\n\nSe tiver alguma dúvida, é só responder por aqui.";
export const DEFAULT_PROPOSAL_REMINDER_TEMPLATE = "{{saudacao}}\n\n*Vamos conversar sobre sua proposta?*\n{{titulo}}\n\n*Valor total:* {{valor}}\n{{linha_validade}}\n\nConfira os detalhes no link abaixo. Estou à disposição para esclarecer suas dúvidas.\n\n{{proposal_link}}";

export type ProposalMessageVariables = {
  nome?: string;
  valor: string;
  validade?: string;
  proposal_link: string;
  numero?: string;
  titulo?: string;
  vendedor?: string;
  empresa?: string;
};

/** Phone numbers, JIDs and formatting characters are not personal greetings. */
export function proposalRecipientName(name?: string): string | undefined {
  const cleaned = name?.replace(/[\r\n*_~`]/g, " ").trim();
  if (!cleaned || /@|https?:\/\//i.test(cleaned) || !/\p{L}/u.test(cleaned) || /\d{5}/.test(cleaned)) return undefined;
  return cleaned.split(/\s+/)[0];
}

export function renderProposalMessage(template: string, vars: ProposalMessageVariables): string {
  const name = proposalRecipientName(vars.nome);
  const values: Record<string, string | undefined> = {
    ...vars,
    nome: name ?? "",
    saudacao: name ? `Olá, ${name}!` : "Olá!",
    titulo: vars.titulo?.replace(/[\r\n*_~`]/g, " ").trim(),
    linha_validade: vars.validade ? `*Válida até:* ${vars.validade}` : "",
  };
  let rendered = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
  // Preserve legacy custom templates without leaving an empty greeting or validity label.
  rendered = rendered.replace(/Olá,\s*!/g, "Olá!").replace(/^\s*\*?(?:Validade|Válida até):\*?\s*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return rendered.includes(vars.proposal_link) ? rendered : `${rendered}\n\n${vars.proposal_link}`;
}
