import type { ScreenCategory } from "../../../domain/company-intelligence/company-intelligence.model.js";

/**
 * Classificação automática de telas capturadas (seção 4) a partir do path da URL de origem.
 * Vocabulário PT-BR (RSVP/presentes/álbum/...) porque é o vocabulário do produto sendo
 * observado — outro domínio com outro vocabulário simplesmente cairia em "unknown" até alguém
 * estender esta lista, o que é aceitável e explícito no relatório de qualidade (itens pendentes).
 */

const CATEGORY_KEYWORDS: Array<{ category: ScreenCategory; keywords: string[] }> = [
  { category: "rsvp", keywords: ["rsvp", "confirmar-presenca", "confirmacao-presenca"] },
  { category: "gift_list", keywords: ["presente", "gift", "lista-de-presentes"] },
  { category: "album", keywords: ["foto", "album", "galeria"] },
  { category: "timeline", keywords: ["cronograma", "timeline", "programacao"] },
  { category: "table_lookup", keywords: ["mesa", "consultar-mesa", "table"] },
  { category: "party_actions", keywords: ["acoes", "acao", "sorteio", "leilao"] },
  { category: "guest_area", keywords: ["convidado", "guest"] },
  { category: "invitation", keywords: ["convite", "invitation"] },
  { category: "confirmation", keywords: ["confirmacao", "obrigado", "sucesso"] },
  { category: "couple_page", keywords: ["casal", "noivos", "couple", "historia"] },
];

export function classifyScreen(sourceUrl: string): ScreenCategory {
  const path = new URL(sourceUrl).pathname.toLowerCase();
  if (path === "/" || path === "" || path.endsWith("/demo") || path.endsWith("/site/demo")) return "home";
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => path.includes(keyword))) return category;
  }
  return "unknown";
}
