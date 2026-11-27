/**
 * Leitura determinística do motivo de uma reprovação ("2 a frase ficou estranha", "a última imagem ficou
 * vazia", "estampa errada", "não quero postar isso hoje"). Usada por:
 * - memória criativa: em que categoria o erro cai e a que telas ele se refere;
 * - refação direcionada: o que muda (texto, legenda, imagem de uma tela, produto, logo) e o que fica.
 *
 * Sem IA: barato, previsível e testável. Na refação, o Codex ainda lê o motivo e a arte reprovada — esta
 * leitura é a trava que impede a refação de mexer no que o cliente não criticou.
 */

export const FEEDBACK_CATEGORIES = [
  "texto",
  "legenda",
  "imagem",
  "imagem_vazia",
  "cores",
  "pessoas",
  "estilo_visual",
  "qualidade_imagem",
  "produto",
  "logo",
  "repeticao",
  "informacao",
  "audio",
  // Vídeo: o que mais pesa na qualidade percebida de uma peça audiovisual.
  "voz",
  "trilha",
  "ritmo",
  "edicao",
  "animacao",
  "abertura",
  "cta",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_CATEGORY_LABELS: Readonly<Record<FeedbackCategory, string>> = {
  texto: "texto da arte",
  legenda: "legenda",
  imagem: "imagem",
  imagem_vazia: "tela sem imagem (só texto)",
  cores: "cores/paleta",
  pessoas: "pessoas na cena",
  estilo_visual: "estilo visual",
  qualidade_imagem: "qualidade da imagem (recorte, nitidez)",
  produto: "produto/estampa",
  logo: "logo",
  repeticao: "conteúdo repetido",
  informacao: "informação incorreta",
  audio: "áudio (música, narração)",
  voz: "voz/narração",
  trilha: "trilha sonora",
  ritmo: "ritmo",
  edicao: "edição/cortes",
  animacao: "animações/transições",
  abertura: "abertura/gancho",
  cta: "encerramento/CTA",
};

/** Categorias que falam da IMAGEM (cena, composição) — as que pesam contra uma linguagem visual. */
export const IMAGE_CATEGORIES: readonly FeedbackCategory[] = ["imagem", "imagem_vazia", "cores", "pessoas", "estilo_visual", "qualidade_imagem", "repeticao"];

/** `audio`: música/narração — só existe no vídeo. */
export type RejectionChanges = { text: boolean; caption: boolean; image: boolean; product: boolean; logo: boolean; audio: boolean };

export type RejectionInterpretation = {
  categories: FeedbackCategory[];
  changes: RejectionChanges;
  /** Telas citadas (1 = capa). `"all"` quando o motivo fala de todas; ausente quando não cita nenhuma. */
  screens?: number[] | "all";
  /** O cliente não quer a peça (não é um pedido de ajuste): devolve ao Bolsão sem gastar uma refação. */
  noRedo: boolean;
  /** Pedido pontual ("só desta vez", "hoje"): vale para esta peça, nunca vira aprendizado da marca. */
  oneOff: boolean;
  /** Nada reconhecível ("não gostei"): a refação decide pelo Codex, como antes. */
  unclear: boolean;
};

export const normalizeFeedback = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const ORDINALS: Record<string, number> = { primeira: 1, primeiro: 1, segunda: 2, segundo: 2, terceira: 3, terceiro: 3, quarta: 4, quarto: 4, quinta: 5, quinto: 5, sexta: 6, sexto: 6, setima: 7, setimo: 7, oitava: 8, oitavo: 8, nona: 9, nono: 9, decima: 10, decimo: 10 };
const NUMBER_WORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
// "cena"/"trecho": no vídeo, cada tela é uma cena do plano de edição.
const SCREEN_NOUN = "(?:tela|imagem|foto|slide|card|pagina|lamina|arte|cena|trecho)";
const SCREEN_NOUNS = "(?:telas|imagens|fotos|slides|cards|paginas|laminas|artes|cenas|trechos)";

/** Telas citadas no motivo. Conta ("das 5 imagens, 3 vazias") não é referência de tela. */
export function referencedScreens(text: string, screenCount: number): number[] | "all" | undefined {
  const found = new Set<number>();
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= Math.max(1, screenCount);
  const num = (token: string) => (/^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token] ?? ORDINALS[token] ?? NaN);
  if (new RegExp(`\\b(todas as|todos os) ${SCREEN_NOUNS}\\b|\\b(todas|tudo|inteir[oa])\\b`).test(text)) return "all";
  if (/\bcapa\b/.test(text)) found.add(1);
  for (const match of text.matchAll(new RegExp(`\\b(primeir[oa]|segund[oa]|terceir[oa]|quart[oa]|quint[oa]|sext[oa]|setim[oa]|oitav[oa]|non[oa]|decim[oa]) ${SCREEN_NOUN}\\b`, "g"))) {
    found.add(ORDINALS[match[1]]);
  }
  for (const match of text.matchAll(new RegExp(`\\b(\\d+)\\s?(?:a|o|ª|º) ${SCREEN_NOUN}\\b`, "g"))) found.add(Number(match[1]));
  for (const match of text.matchAll(new RegExp(`\\b${SCREEN_NOUN}s? (?:n(?:o|º|°)?\\.? ?)?(\\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)((?:\\s*(?:,|e)\\s*(?:\\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez))*)\\b`, "g"))) {
    found.add(num(match[1]));
    for (const extra of (match[2] ?? "").split(/\s*(?:,|\be\b)\s*/).filter(Boolean)) found.add(num(extra.trim()));
  }
  if (new RegExp(`\\bpenultim[oa] ${SCREEN_NOUN}\\b|\\b${SCREEN_NOUN} penultim[oa]\\b`).test(text)) found.add(screenCount - 1);
  if (new RegExp(`\\b(?<!pen)ultim[oa] ${SCREEN_NOUN}\\b|\\b${SCREEN_NOUN} (?<!pen)ultim[oa]\\b|\\ba ultima\\b(?! vez)`).test(text)) found.add(screenCount);
  const screens = [...found].filter(valid).sort((a, b) => a - b);
  return screens.length ? screens : undefined;
}

// "3 vazias com um texto no canto" é queixa de IMAGEM: o texto aparece só como descrição do vazio.
const EMPTY_DESCRIPTION = /\b(?:com|so|apenas|soh)(?: um| o)? (?:texto|frase)(?: no canto| solto| sozinho)?\b/g;
const PATTERNS: Array<[FeedbackCategory, RegExp]> = [
  ["imagem_vazia", /\b(vazi[ao]s?|sem imagem|sem foto|so texto|apenas texto|sem nada|em branco|fundo liso|fundo chapado)\b/],
  ["texto", /\b(frase\w*|texto\w*|titulo\w*|escrit[ao]s?|escrita|palavra\w*|portugues|ortografi\w*|digitac\w*|gramatic\w*|headline|chamada\w*|subtitulo\w*|letra\w*|fonte|fontes|tipografi\w*|redac\w*|acentu\w*|concordancia)\b/],
  ["legenda", /\b(legenda\w*|hashtag\w*|descricao do post|caption)\b/],
  ["produto", /\b(estampa\w*|produto\w*|camis\w*|peca|pecas|roupa\w*|modelo errado|item errado|catalogo)\b/],
  ["logo", /\b(logo\w*|logotipo\w*|marca d.?agua)\b/],
  ["cores", /\b(cor|cores|paleta|escur[oa]s?|clar[oa]s?|apagad[oa]s?|saturad\w*|tons|contraste|colorid\w*|desbotad\w*)\b/],
  ["pessoas", /\b(pessoa\w*|rosto\w*|gente|mulher\w*|homem|homens|crianc\w*|maos?|dedos?|noiv[oa]s?|casal|olhos)\b/],
  ["estilo_visual", /\b(3d|render\w*|estilo|banco de imagens?|generic[oa]s?|artificial|fake|cara de ia|clich\w*|infantil|brega|cafona|feio|feia|sem graca|sem criatividade|pouco criativ\w*|mais criativ\w*|chat[oa]|sem vida|sem impacto)\b/],
  ["qualidade_imagem", /\b(pixelad\w*|borrad\w*|desfocad\w*|serrilhad\w*|recorte\w*|recortad\w*|distorc\w*|deformad\w*|baixa qualidade|resoluc\w*|emenda\w*|costura)\b/],
  ["repeticao", /\b(repetid\w*|repetiu|repete|igual|iguais|mesma coisa|parecid[oa]s?|sempre a mesma|sempre o mesmo|ja (?:foi |foram )?(?:usad|postad|publicad)\w*|ja (?:vi|usei|usamos|postei|postamos))\b/],
  ["informacao", /\b(preco\w*|valor errado|informac\w* errad\w*|data errad\w*|nao existe|nao temos|nao vendemos|nao oferecemos|inventou|inventad[oa])\b/],
  ["voz", /\b(voz|narrac\w*|locuc\w*|locutor\w*|robotic\w*|robo|sotaque|pronunci\w*|entonac\w*|falad[oa]|fala)\b/],
  ["trilha", /\b(musica\w*|trilha\w*|batida|beat|melodia)\b/],
  ["ritmo", /\b(ritmo|lent[oa]s?|arrastad\w*|corrid[oa]|demorad\w*|devagar|rapido demais|cansativ\w*)\b/],
  ["edicao", /\b(edic\w*|cortes?|montagem|sequencia)\b/],
  ["animacao", /\b(animac\w*|efeitos?|transic\w*|moviment\w*|exagerad\w*|piscando)\b/],
  ["abertura", /\b(abertura|inicio|comeco|gancho|primeiros segundos)\b/],
  ["cta", /\b(cta|encerramento|fechamento|botao|chamada final|final fraco|terminou)\b/],
  ["audio", /\b(som|audio|volume|alto demais|baixo demais|estourad\w*)\b/],
  ["imagem", /\b(imagem|imagens|foto|fotos|fotografi\w*|cena\w*|visual|ilustrac\w*|desenho\w*|fundo|cenario|composic\w*|enquadr\w*)\b/],
];
const NO_REDO = /\b(nao (quero|vou|precisa|e para|e pra|da para|da pra) (mais )?(postar|publicar|refazer|usar)|nao (posta|publica|refaz)\b|cancela\w*|deixa (pra|para) la|esquece|desist\w*|nao faz sentido (postar|publicar)|fora de (epoca|contexto)|nao combina com a gente|nao e (nosso|nossa) (publico|marca))/;
const ONE_OFF = /\b(hoje|so (dessa|desta|nessa|nesta) vez|dessa vez|desta vez|nessa vez|nesta vez|so (hoje|agora)|excepcionalmente|por enquanto|este post|esse post|nesse post|neste post)\b/;

export function interpretRejection(reason: string | undefined, options: { screenCount?: number } = {}): RejectionInterpretation {
  const text = normalizeFeedback(reason ?? "");
  const screenCount = Math.max(1, options.screenCount ?? 1);
  const noRedo = NO_REDO.test(text);
  const categoryText = PATTERNS[0][1].test(text) ? text.replace(EMPTY_DESCRIPTION, " ") : text;
  const categories = PATTERNS.filter(([category, pattern]) => pattern.test(category === "texto" ? categoryText : text)).map(([category]) => category);
  // "imagem" genérica junto de uma queixa visual específica é redundante.
  const specific = categories.filter((category) => category !== "imagem" || !categories.some((other) => other !== "imagem" && IMAGE_CATEGORIES.includes(other)));
  const has = (...wanted: FeedbackCategory[]) => specific.some((category) => wanted.includes(category));
  const unclear = specific.length === 0 && !noRedo;
  const changes: RejectionChanges = unclear
    ? { text: true, caption: true, image: true, product: false, logo: false, audio: false }
    : {
      text: has("texto", "informacao"),
      caption: has("legenda", "informacao"),
      image: has(...IMAGE_CATEGORIES) || has("produto"),
      product: has("produto"),
      logo: has("logo"),
      audio: has("audio", "voz", "trilha"),
    };
  const screens = referencedScreens(text, screenCount);
  return { categories: specific, changes, ...(screens ? { screens } : {}), noRedo, oneOff: ONE_OFF.test(text), unclear };
}
