/**
 * Contato oficial de SUPORTE do site público (pedido explícito do usuário — polimento final do
 * site: "definir oficialmente como contato público de suporte"). Número autorizado, nunca trocar
 * por outro — DISTINTO do contato COMERCIAL (`comercial@vorixworks.com`, já existente no footer):
 * suporte é atendimento técnico pós-venda, comercial é pré-venda/parceria, propositalmente duas
 * portas diferentes (ver `PublicFooter`).
 */
export const SUPPORT_WHATSAPP_E164 = "+5546991081743";
export const SUPPORT_WHATSAPP_DISPLAY = "(46) 99108-1743";

const SUPPORT_WHATSAPP_MESSAGE = "Olá! Preciso de ajuda com o Vorix.";

/** `wa.me` nunca envia a mensagem sozinho — só pré-preenche o campo de texto do WhatsApp; quem
 * clica ainda decide se manda. Formato técnico (`wa.me/55...`) nunca é mostrado ao usuário, só o
 * telefone legível (`SUPPORT_WHATSAPP_DISPLAY`) — ver `SupportWhatsAppLink`. */
export function getSupportWhatsAppUrl(): string {
  const digits = SUPPORT_WHATSAPP_E164.replace("+", "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(SUPPORT_WHATSAPP_MESSAGE)}`;
}
