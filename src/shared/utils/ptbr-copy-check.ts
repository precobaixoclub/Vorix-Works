/**
 * Preflight de copy pt-BR: aponta palavras comuns escritas SEM acento obrigatório ("voces",
 * "confirmacao", "Conheca"). Só AVISA — nunca corrige: o texto renderizado continua sendo
 * exatamente o que o plano/usuário escreveu, e o gate textual nunca remove acento para comparar.
 */

/** Forma sem acento (minúscula) → forma correta. Lista curta e conservadora: só palavras cuja
 * versão sem acento não existe como outra palavra válida em pt-BR. */
const PTBR_MISSING_ACCENT_WORDS: Readonly<Record<string, string>> = {
  voce: "você",
  voces: "vocês",
  conheca: "conheça",
  confirmacao: "confirmação",
  informacao: "informação",
  informacoes: "informações",
  promocao: "promoção",
  promocoes: "promoções",
  organizacao: "organização",
  celebracao: "celebração",
  cerimonia: "cerimônia",
  comeca: "começa",
  facil: "fácil",
  rapido: "rápido",
  unico: "único",
  so: "só",
  ja: "já",
  nao: "não",
  sao: "são",
  entao: "então",
  tambem: "também",
  preco: "preço",
  precos: "preços",
  servico: "serviço",
  servicos: "serviços",
  memoria: "memória",
  memorias: "memórias",
  experiencia: "experiência",
  presenca: "presença",
  aniversario: "aniversário",
  calendario: "calendário",
  solucao: "solução",
  solucoes: "soluções",
  atencao: "atenção",
  condicoes: "condições",
  opcao: "opção",
  opcoes: "opções",
};

export type PtBrCopyWarning = { field: string; word: string; suggestion: string };

export function findPtBrMissingAccents(fields: Readonly<Record<string, string | undefined>>): PtBrCopyWarning[] {
  const warnings: PtBrCopyWarning[] = [];
  for (const [field, text] of Object.entries(fields)) {
    if (!text) continue;
    for (const word of text.normalize("NFC").match(/[\p{L}]+/gu) ?? []) {
      const lower = word.toLocaleLowerCase("pt-BR");
      const suggestion = PTBR_MISSING_ACCENT_WORDS[lower];
      if (!suggestion || suggestion === lower) continue;
      if (!warnings.some((item) => item.field === field && item.word === word)) warnings.push({ field, word, suggestion });
    }
  }
  return warnings;
}

export function describePtBrCopyWarnings(warnings: readonly PtBrCopyWarning[]): string {
  return warnings.map((item) => `${item.field}: "${item.word}" → "${item.suggestion}"?`).join("; ");
}
