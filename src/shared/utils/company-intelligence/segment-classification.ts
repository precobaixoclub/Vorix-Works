/**
 * Classificação de segmento por palavra-chave (determinística, sem LLM) — mesmo espírito de
 * `inferDeviceFromText` na Footage Acquisition. Cobre os segmentos já observados no benchmark de
 * 30 campanhas desta sessão; um domínio fora dessa lista cai em "não classificado" e isso é
 * reportado honestamente no relatório de qualidade em vez de forçar um palpite.
 */

const SEGMENT_KEYWORDS: Array<{ segment: string; keywords: string[] }> = [
  { segment: "casamentos", keywords: ["casamento", "noivos", "noiva", "noivo", "cerimonialista", "rsvp"] },
  { segment: "imobiliária", keywords: ["imóvel", "imóveis", "imobiliária", "aluguel", "corretor"] },
  { segment: "restaurante", keywords: ["restaurante", "cardápio", "prato", "reserva de mesa"] },
  { segment: "clínica", keywords: ["clínica", "consulta", "paciente", "tratamento", "saúde"] },
  { segment: "academia", keywords: ["academia", "treino", "personal trainer", "musculação"] },
  { segment: "hotelaria", keywords: ["hotel", "pousada", "hospedagem", "reserva"] },
  { segment: "moda", keywords: ["loja de roupas", "moda", "vestuário", "coleção"] },
  { segment: "automotivo", keywords: ["concessionária", "veículo", "carro seminovo", "revenda"] },
  { segment: "jurídico", keywords: ["advogado", "advocacia", "jurídico", "processo"] },
  { segment: "contabilidade", keywords: ["contabilidade", "contador", "fiscal", "imposto"] },
  { segment: "educação", keywords: ["escola", "curso", "matrícula", "aluno"] },
  { segment: "turismo", keywords: ["turismo", "viagem", "pacote turístico", "passeio"] },
  { segment: "pet", keywords: ["pet shop", "veterinário", "banho e tosa"] },
  { segment: "odontologia", keywords: ["odontologia", "dentista", "ortodontia"] },
  { segment: "arquitetura", keywords: ["arquitetura", "projeto arquitetônico", "interiores"] },
  { segment: "energia solar", keywords: ["energia solar", "painel solar", "fotovoltaico"] },
  { segment: "seguros", keywords: ["seguro", "seguradora", "apólice"] },
  { segment: "eventos", keywords: ["produtora de eventos", "cerimonial", "festa"] },
  { segment: "tecnologia", keywords: ["software", "saas", "aplicativo", "plataforma"] },
  { segment: "e-commerce", keywords: ["e-commerce", "loja online", "frete", "carrinho de compras"] },
];

export function classifySegment(text: string): string {
  const haystack = text.toLowerCase();
  const match = SEGMENT_KEYWORDS.find(({ keywords }) => keywords.some((keyword) => haystack.includes(keyword)));
  return match?.segment ?? "não classificado";
}
