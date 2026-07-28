import type { ScreenCategory } from "../../../domain/campaign-intelligence/campaign-intelligence.model.js";

/**
 * Classificação de tela (seção 6), reusando o mesmo vocabulário de categorias do Company
 * Intelligence (`ScreenCategory`) — mas por TEXTO (OCR + nome do arquivo), não por path de URL,
 * já que um arquivo de campanha não tem URL. `classifyScreen` do Company Intelligence não é
 * reusável aqui por isso (ver relatório de arquitetura desta sprint); esta função é a variante
 * apropriada para texto livre, mantendo a mesma taxonomia de categorias.
 */

const CATEGORY_KEYWORDS: Array<{ category: ScreenCategory; keywords: string[] }> = [
  { category: "rsvp", keywords: ["rsvp", "confirmar presença", "confirmação de presença", "confirmar presenca"] },
  { category: "gift_list", keywords: ["presente", "lista de presentes", "pix", "gift"] },
  { category: "album", keywords: ["foto", "álbum", "album", "galeria", "qr code"] },
  { category: "timeline", keywords: ["cronograma", "timeline", "programação", "programacao"] },
  { category: "table_lookup", keywords: ["mesa", "consultar mesa", "table"] },
  { category: "party_actions", keywords: ["ações da festa", "acoes da festa", "sorteio", "leilão", "rifa"] },
  { category: "guest_area", keywords: ["convidado", "check-in", "checkin", "guest"] },
  { category: "invitation", keywords: ["convite", "invitation"] },
  { category: "confirmation", keywords: ["confirmação", "confirmacao", "obrigado", "sucesso"] },
  { category: "couple_page", keywords: ["casal", "noivos", "história", "historia", "couple"] },
];

export function classifyCampaignScreen(text: string): ScreenCategory {
  const haystack = text.toLowerCase();
  if (/\b(home|início|inicio|página inicial|pagina inicial)\b/.test(haystack)) return "home";
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => haystack.includes(keyword))) return category;
  }
  return "unknown";
}
