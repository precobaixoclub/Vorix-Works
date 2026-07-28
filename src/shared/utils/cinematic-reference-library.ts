import { normalize } from "./skill-parsing.js";

/**
 * Biblioteca interna de referências de direção cinematográfica e motor de enriquecimento de cena
 * — não é uma Skill nem uma nova camada arquitetural (`src/shared` nunca foi Skill, ADR 0002 não
 * se aplica aqui), no mesmo espírito de `visual-reference-library.ts` (usado por Sofia/Bianca/
 * Pedro) e de `content-format-classification.ts` (usado por Arthur/Eduardo). Vanessa, Diego e Rafa
 * importam este arquivo diretamente.
 *
 * Nenhuma marca é copiada — os nomes abaixo (`appleMinimalCommercial`, `nikeEnergyMomentum` etc.)
 * são só rótulos de gênero para orientar ritmo/enquadramento/fotografia/iluminação/direção/edição/
 * narrativa, nunca elementos de marca registrada (logo, tipografia, jingle) das empresas citadas.
 */

export const CINEMATIC_REFERENCE_STYLES = [
  "appleMinimalCommercial",
  "airbnbCinematicWarmth",
  "googleClarity",
  "nubankConfidentModern",
  "notionCleanNarrative",
  "nikeEnergyMomentum",
  "weddingFilmEmotional",
  "premiumCommercialPolish",
] as const;

export type CinematicReferenceStyle = (typeof CINEMATIC_REFERENCE_STYLES)[number];

export const CINEMATIC_REFERENCE_LIBRARY: Record<CinematicReferenceStyle, string> = {
  appleMinimalCommercial:
    "Referência de gênero 'anúncio minimalista premium': cortes secos e espaçados, um objeto/ideia por plano, luz controlada e macro de produto, silêncio visual entre batidas.",
  airbnbCinematicWarmth:
    "Referência de gênero 'calor cinematográfico documental': luz natural quente, câmera na mão discreta, planos médios humanos, ritmo respirado, cor quente e acolhedora.",
  googleClarity:
    "Referência de gênero 'clareza funcional': composição limpa, foco absoluto no que importa, cortes previsíveis e didáticos, iluminação neutra e uniforme.",
  nubankConfidentModern:
    "Referência de gênero 'confiança moderna': paleta contida, tipografia como protagonista, ritmo ágil mas nunca frenético, transições diretas.",
  notionCleanNarrative:
    "Referência de gênero 'narrativa limpa': plano estático e silencioso quando a ideia pede pausa, muito espaço negativo, texto como elemento visual central.",
  nikeEnergyMomentum:
    "Referência de gênero 'energia e momentum': câmera dinâmica, cortes rápidos sincronizados à batida, ângulos baixos que engrandecem o sujeito, alto contraste.",
  weddingFilmEmotional:
    "Referência de gênero 'filme de casamento emocional': luz dourada natural, câmera lenta e observacional, foco em gestos e expressões, cor quente e romântica.",
  premiumCommercialPolish:
    "Referência de gênero 'acabamento comercial premium': grading consistente, transições elegantes e discretas, tipografia cinematográfica, nunca aparência amadora.",
};

// ---------------------------------------------------------------------------------------------
// Vanessa — Diretora de Comerciais: cena cinematográfica completa por tomada
// ---------------------------------------------------------------------------------------------

export const SHOT_TYPES = ["close", "detalhe", "medio", "aberto", "drone", "macro"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export type SceneNarrativeRole = "hook" | "cta" | "development";

export type CinematicSceneDecision = {
  shotType: ShotType;
  cameraPosition: string;
  cameraHeight: string;
  simulatedLens: string;
  depthOfField: string;
  mainFocus: string;
  lighting: string;
  colorTemperature: string;
  emotion: string;
  pace: string;
  cameraMovement: string;
  cameraMovementSpeed: string;
  idealTakeDurationSeconds: number;
  composition: string;
  ruleOfThirds: string;
  gazeDirection: string;
  feeling: string;
  narrativeMotive: string;
  referenceStyle: CinematicReferenceStyle;
  /** O que esta cena precisa realizar visualmente — nunca "mostrar algo bonito", sempre um objetivo funcional dentro do comercial. */
  visualObjective: string;
  /** Como esta cena escala a história visual em relação à cena anterior — nenhuma cena deve parecer isolada. */
  progression: string;
  /** O fio visual/emocional herdado da cena anterior. "N/A" só para a primeira cena do vídeo. */
  continuityFromPrevious: string;
  /** O que esta cena deixa em aberto para a cena seguinte resolver. "N/A" só para a última cena do vídeo. */
  continuityToNext: string;
  /** Descritor qualitativo de quanto tempo esta cena "pede" emocionalmente — distinto de `idealTakeDurationSeconds` (o número real). */
  emotionalDuration: string;
};

const HOOK_DECISION: Omit<CinematicSceneDecision, "idealTakeDurationSeconds"> = {
  shotType: "close",
  cameraPosition: "Frontal, direto para a câmera, no eixo dos olhos do sujeito/produto.",
  cameraHeight: "Altura dos olhos — cria conexão imediata e direta com quem assiste.",
  simulatedLens: "Lente 35mm simulada, leve distorção humana, sensação de proximidade.",
  depthOfField: "Profundidade de campo rasa: sujeito/produto em foco absoluto, fundo totalmente desfocado.",
  mainFocus: "O rosto ou o elemento visual que carrega o gancho, sem nenhuma distração ao redor.",
  lighting: "Luz frontal suave e direta, sem sombras duras, para máxima clareza do gancho.",
  colorTemperature: "Neutra a levemente quente (5000K-5600K) — legível e convidativa, nunca fria.",
  emotion: "Curiosidade ou tensão imediata.",
  pace: "Acelerado — precisa capturar atenção em menos de 1 segundo.",
  cameraMovement: "Estático ou punch-in sutil.",
  cameraMovementSpeed: "Rápida quando houver punch-in — o movimento reforça a urgência, não distrai dela.",
  composition: "Centralizada, pouco espaço negativo ao redor do foco principal.",
  ruleOfThirds: "Deliberadamente ignorada aqui — centralização total reforça confronto direto com quem assiste.",
  gazeDirection: "Direto para a lente da câmera (quebra da quarta parede).",
  feeling: "Impacto imediato, quase confrontador, que impede o dedo de continuar rolando o feed.",
  narrativeMotive: "Prender a atenção antes que a promessa central seja sequer explicada.",
  referenceStyle: "nikeEnergyMomentum",
  visualObjective: "Interromper o scroll em menos de 1 segundo com uma pergunta ou afirmação que o público reconhece na hora.",
  progression: "Ponto de partida — não há cena anterior; o vídeo nasce aqui, no auge da tensão inicial.",
  continuityFromPrevious: "N/A — é a primeira cena do vídeo, não herda nada da cena anterior.",
  continuityToNext: "Deixa uma tensão em aberto que só a cena seguinte começa a resolver.",
  emotionalDuration: "A mais curta do vídeo — dura o suficiente para prender, nunca o suficiente para explicar.",
};

const CTA_DECISION: Omit<CinematicSceneDecision, "idealTakeDurationSeconds"> = {
  shotType: "close",
  cameraPosition: "Frontal, retomando o eixo do gancho para fechar o ciclo visual do vídeo.",
  cameraHeight: "Altura dos olhos, igual ao gancho, para dar sensação de retorno/resolução.",
  simulatedLens: "Lente 35mm simulada, igual ao gancho — consistência de linguagem entre abertura e fechamento.",
  depthOfField: "Profundidade de campo rasa: elemento de marca/CTA em foco absoluto.",
  mainFocus: "O elemento de marca, produto ou botão de CTA — nunca dividido com outro elemento.",
  lighting: "Luz frontal estável, sem variação — transmite segurança na decisão pedida ao espectador.",
  colorTemperature: "Neutra a levemente quente, coerente com o restante do vídeo.",
  emotion: "Confiança e convite.",
  pace: "Moderado — dá tempo do espectador processar a ação pedida, sem se arrastar.",
  cameraMovement: "Estático, sem movimento algum.",
  cameraMovementSpeed: "N/A — o estatismo aqui é a decisão, não a ausência de uma.",
  composition: "Centralizada, com destaque de marca/produto ancorado na base do quadro.",
  ruleOfThirds: "Ignorada de propósito — centralização total funciona como âncora de decisão final.",
  gazeDirection: "Direto para a lente, reforçando o convite direto à ação.",
  feeling: "Resolução e clareza — o espectador sabe exatamente o que fazer a seguir.",
  narrativeMotive: "Converter a atenção construída ao longo do vídeo em uma ação concreta.",
  referenceStyle: "appleMinimalCommercial",
  visualObjective: "Fechar o ciclo aberto pelo gancho com uma ação clara, sem introduzir nenhuma informação nova.",
  progression: "Resolução final — converte toda a tensão acumulada nas cenas anteriores em uma decisão concreta.",
  continuityFromPrevious: "Retoma o eixo visual do gancho (mesmo enquadramento, mesma altura de câmera) para fechar o ciclo.",
  continuityToNext: "N/A — é a última cena do vídeo.",
  emotionalDuration: "Firme e suficiente — nem apressada (pareceria desesperada) nem longa demais (perderia urgência).",
};

/**
 * Rotação de composição por "beat" (posição da cena dentro do bloco de desenvolvimento) —
 * existe para resolver uma colisão real: Bruno atribui o mesmo `rhythm` (normalmente "moderado")
 * a todas as cenas de desenvolvimento, e antes desta rotação `developmentDecision(rhythm)` gerava
 * a MESMA composição/enquadramento/ângulo para todas elas (só a duração variava). Cada entrada
 * aqui muda apenas os campos de composição/enquadramento/foco — os campos derivados do ritmo
 * (shotType, cameraMovement, pace, emotion, referenceStyle, feeling) continuam vindo de `isFast`,
 * preservando o comportamento e os testes existentes para esses campos específicos.
 */
const DEVELOPMENT_BEAT_VARIANTS: Array<
  Pick<
    CinematicSceneDecision,
    | "cameraPosition"
    | "composition"
    | "ruleOfThirds"
    | "gazeDirection"
    | "mainFocus"
    | "visualObjective"
    | "progression"
    | "continuityFromPrevious"
    | "continuityToNext"
    | "emotionalDuration"
  >
> = [
  {
    cameraPosition: "Frontal-lateral, ângulo de três quartos, natural e observacional.",
    composition: "Sujeito levemente descentralizado à direita, com espaço lateral à esquerda para elementos gráficos de apoio.",
    ruleOfThirds: "Aplicada: sujeito/elemento principal posicionado sobre a linha ou interseção do terço direito.",
    gazeDirection: "Levemente fora de eixo (não direto à câmera) — sustenta o tom observacional da cena.",
    mainFocus: "O elemento humano vivendo o benefício — a pessoa, não a interface, é o que os olhos encontram primeiro.",
    // beat 0 = função "build": primeira escalada real do vídeo.
    visualObjective: "Estabelecer prova concreta que sustenta a promessa do gancho — não mais uma alegação, mas um primeiro fato visual.",
    progression: "Primeira escalada: sai da promessa abstrata do gancho para o primeiro fato concreto.",
    continuityFromPrevious: "Herda a energia do gancho e a converte em prova — o mesmo assunto, agora com evidência.",
    continuityToNext: "Abre espaço para a cena seguinte aprofundar em contexto humano, não apenas repetir a prova.",
    emotionalDuration: "Curta e direta — prova rápida, sem se demorar, para manter o impulso do gancho.",
  },
  {
    cameraPosition: "Plano mais aberto, câmera recuada, revelando o contexto ao redor do sujeito.",
    composition: "Sujeito descentralizado à esquerda, muito espaço negativo à direita para respiro visual.",
    ruleOfThirds: "Aplicada: sujeito/elemento principal posicionado sobre a linha ou interseção do terço esquerdo.",
    gazeDirection: "Olhar direcionado para fora de quadro, sugerindo continuidade da história além do que é mostrado.",
    mainFocus: "O contexto e a atmosfera ao redor — o ambiente reforça a mensagem antes de qualquer detalhe.",
    // beat 1 = função "payoff": ápice emocional do bloco de desenvolvimento.
    visualObjective: "Entregar o momento de maior identificação do vídeo — o instante em que o espectador se reconhece na cena.",
    progression: "Ápice emocional do bloco de desenvolvimento — a cena mais generosa em tempo, o payoff da tensão construída até aqui.",
    continuityFromPrevious: "Aprofunda a prova concreta da cena anterior, agora em contexto humano e emocional.",
    continuityToNext: "Deixa uma pergunta em aberto — 'e o detalhe que sustenta tudo isso?' — que a cena seguinte responde.",
    emotionalDuration: "A mais generosa do vídeo — o payoff precisa de tempo para respirar e convencer de verdade.",
  },
  {
    cameraPosition: "Próxima e ligeiramente elevada, ângulo de observação íntimo sobre o detalhe/produto em uso.",
    composition: "Elemento centralizado no terço inferior do quadro, topo do quadro como espaço negativo.",
    ruleOfThirds: "Aplicada: elemento principal ancorado na interseção inferior, criando leitura de cima para baixo.",
    gazeDirection: "Foco no gesto/mão/tela — nenhum rosto em quadro, o detalhe carrega a emoção sozinho.",
    mainFocus: "O produto integrado ao gesto humano — mão, tela ou objeto no exato momento de uso, nunca isolado.",
    // beat 2 = função "release": respiro proposital antes do CTA.
    visualObjective: "Aprofundar em um detalhe específico que valida tudo o que já foi mostrado, preparando o terreno para o CTA.",
    progression: "Desacelera de propósito — um respiro depois do ápice emocional, antes da retomada de energia no CTA.",
    continuityFromPrevious: "Puxa um detalhe específico do momento de identificação anterior, sem repetir o mesmo enquadramento.",
    continuityToNext: "Prepara a transição de energia para o CTA — a cena mais calma do vídeo, logo antes do fechamento.",
    emotionalDuration: "Breve e contemplativa — um respiro proposital antes da retomada de ritmo no CTA.",
  },
];

function developmentDecision(rhythm: string, beatIndex: number): Omit<CinematicSceneDecision, "idealTakeDurationSeconds"> {
  const normalized = normalize(rhythm);
  const isFast = normalized.includes("dinamico") || normalized.includes("acelerado");
  const variant = DEVELOPMENT_BEAT_VARIANTS[((beatIndex % DEVELOPMENT_BEAT_VARIANTS.length) + DEVELOPMENT_BEAT_VARIANTS.length) % DEVELOPMENT_BEAT_VARIANTS.length];
  return {
    shotType: isFast ? "detalhe" : "medio",
    cameraPosition: variant.cameraPosition,
    cameraHeight: "Altura dos olhos a levemente acima — postura confiante sem intimidar.",
    simulatedLens: isFast ? "Lente 50mm simulada, leve compressão, foco isolado no detalhe." : "Lente 50mm simulada, perspectiva natural e equilibrada.",
    depthOfField: "Profundidade de campo rasa a moderada: sujeito nítido, fundo suavemente desfocado mantendo contexto.",
    mainFocus: variant.mainFocus,
    lighting: "Luz natural suave, direcional, com sombra suave para dar volume sem dureza.",
    colorTemperature: "Quente (4200K-4800K) — acolhedora, coerente com contexto de casamento/celebração.",
    emotion: isFast ? "Energia e progresso." : "Confiança tranquila.",
    pace: isFast ? "Dinâmico — cortes mais curtos, câmera com leve movimento contínuo." : "Moderado — espaço para o espectador absorver a mensagem.",
    cameraMovement: isFast ? "Leve movimento lateral contínuo (tracking sutil)." : "Leve deriva estática (drift), quase imperceptível.",
    cameraMovementSpeed: isFast ? "Rápida o suficiente para transmitir progresso, sem tremular." : "Muito lenta — reforça estabilidade e naturalidade.",
    composition: variant.composition,
    ruleOfThirds: variant.ruleOfThirds,
    gazeDirection: variant.gazeDirection,
    feeling: isFast ? "Momentum, sensação de que algo está em andamento." : "Naturalidade e proximidade humana.",
    narrativeMotive: "Sustentar e aprofundar a promessa central entre o gancho e o CTA, sem repetir o mesmo golpe visual do gancho.",
    referenceStyle: isFast ? "nubankConfidentModern" : "airbnbCinematicWarmth",
    visualObjective: variant.visualObjective,
    progression: variant.progression,
    continuityFromPrevious: variant.continuityFromPrevious,
    continuityToNext: variant.continuityToNext,
    emotionalDuration: variant.emotionalDuration,
  };
}

/**
 * Motor central de enriquecimento cinematográfico de Vanessa: recebe o papel narrativo da cena
 * (gancho/CTA/desenvolvimento), o ritmo já definido por Bruno, a duração real da cena e a posição
 * da cena dentro do bloco de desenvolvimento (`beatIndex`, 0-based; ignorado para hook/cta), e
 * devolve as 19 decisões cinematográficas explícitas pedidas — nunca deixa a cena com apenas um
 * enquadramento solto em texto livre. Função pura e determinística. `beatIndex` é opcional
 * (padrão 0) só para preservar assinatura compatível com chamadas existentes.
 */
export function enrichCinematicScene(role: SceneNarrativeRole, rhythm: string, durationSeconds: number, beatIndex = 0): CinematicSceneDecision {
  const base = role === "hook" ? HOOK_DECISION : role === "cta" ? CTA_DECISION : developmentDecision(rhythm, beatIndex);
  return { ...base, idealTakeDurationSeconds: Math.max(1, Math.round(durationSeconds)) };
}

// ---------------------------------------------------------------------------------------------
// Diego — Editor profissional: vocabulário de corte, transição e animação
// ---------------------------------------------------------------------------------------------

export const CUT_TYPES = ["hard_cut", "match_cut", "j_cut", "l_cut", "montage_cut"] as const;
export type CutType = (typeof CUT_TYPES)[number];

export const TRANSITION_STYLES = ["cut", "fade", "dissolve", "slide", "wipe", "whip", "glow"] as const;
export type TransitionStyle = (typeof TRANSITION_STYLES)[number];

export const TEXT_ANIMATION_STYLES = ["fade_in", "slide_up", "pop", "typewriter", "none"] as const;
export type TextAnimationStyle = (typeof TEXT_ANIMATION_STYLES)[number];

export const EASING_CURVES = ["linear", "ease_in_out", "ease_out", "ease_in", "back_out"] as const;
export type EasingCurve = (typeof EASING_CURVES)[number];

export type EditingSceneDecision = {
  cutType: CutType;
  cutSpeed: string;
  rhythm: string;
  breathingPoint: boolean;
  transition: TransitionStyle;
  zoom: boolean;
  pan: boolean;
  pushIn: boolean;
  pullOut: boolean;
  speedRamp: boolean;
  whip: boolean;
  fade: boolean;
  blur: boolean;
  glow: boolean;
  mask: boolean;
  motionBlur: boolean;
  textAnimation: TextAnimationStyle;
  ctaEntry: string;
  ctaExit: string;
  easing: EasingCurve;
  animationTimingSeconds: number;
  syncNotes: string;
  /** Por que esta cena tem a duração/ritmo de corte que tem — Diego como diretor de ritmo, nunca só executor de tempo fixo. */
  pacingIntent: string;
};

/**
 * Rotação de "flavor" de edição por beat de desenvolvimento — mesmo raciocínio da rotação de
 * composição de Vanessa acima: sem isso, todas as cenas de desenvolvimento com o mesmo `rhythm`
 * recebiam a mesma transição/animação de texto/máscara/glow/blur, só diferindo em campos ligados
 * a `isFast` (que continuam vindo de lá, preservando os testes existentes). Cada variante também
 * ativa no máximo um efeito visual "raro" (mask OU glow OU blur), nunca mais de um ao mesmo tempo,
 * para não sobrecarregar a cena.
 */
const DEVELOPMENT_EDIT_FLAVORS: Array<Pick<EditingSceneDecision, "transition" | "textAnimation" | "mask" | "glow" | "blur">> = [
  { transition: "dissolve", textAnimation: "slide_up", mask: false, glow: false, blur: false },
  { transition: "wipe", textAnimation: "fade_in", mask: true, glow: false, blur: false },
  { transition: "slide", textAnimation: "pop", mask: false, glow: true, blur: false },
  { transition: "fade", textAnimation: "typewriter", mask: false, glow: false, blur: true },
];

/**
 * Justificativa de ritmo por beat de desenvolvimento (0=build, 1=payoff, 2=release — mesmo índice
 * usado por Bruno para atribuir `sceneFunction` e por `DEVELOPMENT_BEAT_VARIANTS` acima). Diego
 * como diretor de ritmo explica por que cada cena tem a duração que tem, nunca apenas executa um
 * tempo fixo herdado da quantidade de cenas.
 */
const DEVELOPMENT_PACING_INTENT: string[] = [
  "Ritmo de progressão — nem apressado nem contemplativo, o corte segue o mesmo impulso do gancho.",
  "Cena mais longa do plano de edição — é aqui que a prova precisa de tempo real para convencer, não só aparecer.",
  "Respiro proposital antes do CTA — corte mais lento, o oposto do ritmo do gancho, de propósito.",
];

/**
 * Motor de decisões de edição de Diego: traduz o papel narrativo da cena + o ritmo de Bruno + a
 * posição da cena dentro do bloco de desenvolvimento (`beatIndex`, 0-based; ignorado para
 * hook/cta) em um pacote completo de decisões técnicas de corte, transição e animação — nunca
 * deixa "tipo de corte" como a única decisão registrada (era o único campo antes desta evolução).
 * `beatIndex` é opcional (padrão 0) só para preservar assinatura compatível com chamadas existentes.
 */
export function enrichEditingDecision(role: SceneNarrativeRole, rhythm: string, hasCta: boolean, beatIndex = 0): EditingSceneDecision {
  const normalized = normalize(rhythm);
  const isFast = normalized.includes("dinamico") || normalized.includes("acelerado");

  if (role === "hook") {
    return {
      cutType: "hard_cut",
      cutSpeed: "Imediato — 0 quadros de transição na entrada.",
      rhythm: "Acelerado",
      breathingPoint: false,
      transition: "cut",
      zoom: true,
      pan: false,
      pushIn: true,
      pullOut: false,
      speedRamp: false,
      whip: false,
      fade: false,
      blur: false,
      glow: false,
      mask: false,
      motionBlur: false,
      textAnimation: "pop",
      ctaEntry: "N/A — sem CTA nesta cena.",
      ctaExit: "N/A — sem CTA nesta cena.",
      easing: "ease_out",
      animationTimingSeconds: 0.25,
      syncNotes: "Texto do gancho aparece exatamente no primeiro quadro, sincronizado com o punch-in da câmera.",
      pacingIntent: "Corte imediato e cena mais curta do vídeo — a brevidade é a própria decisão de ritmo, gera urgência.",
    };
  }

  if (role === "cta") {
    return {
      cutType: "hard_cut",
      cutSpeed: "Imediato — sem fade de saída, encerramento abrupto reforça urgência.",
      rhythm: "Moderado",
      breathingPoint: true,
      transition: "glow",
      zoom: false,
      pan: false,
      pushIn: false,
      pullOut: false,
      speedRamp: false,
      whip: false,
      fade: false,
      blur: false,
      glow: true,
      mask: false,
      motionBlur: false,
      textAnimation: "fade_in",
      ctaEntry: "Entrada com leve fade + escala de 96% a 100% (easing ease_out) sincronizada ao corte de entrada da cena.",
      ctaExit: "Sem saída — o CTA permanece na tela até o encerramento do vídeo.",
      easing: "ease_out",
      animationTimingSeconds: 0.4,
      syncNotes: "CTA entra exatamente no início da cena final, sincronizado com o realce visual (glow) de fundo.",
      pacingIntent: "Duração firme, nem curta nem longa — tempo suficiente para a decisão assentar sem parecer hesitação.",
    };
  }

  const flavor = DEVELOPMENT_EDIT_FLAVORS[((beatIndex % DEVELOPMENT_EDIT_FLAVORS.length) + DEVELOPMENT_EDIT_FLAVORS.length) % DEVELOPMENT_EDIT_FLAVORS.length];
  const pacingIntent = DEVELOPMENT_PACING_INTENT[((beatIndex % DEVELOPMENT_PACING_INTENT.length) + DEVELOPMENT_PACING_INTENT.length) % DEVELOPMENT_PACING_INTENT.length];
  return {
    cutType: isFast ? "montage_cut" : "match_cut",
    cutSpeed: isFast ? "Rápida — cortes a cada 1,5-2,5s." : "Moderada — cortes a cada 2,5-4s.",
    rhythm: isFast ? "Dinâmico" : "Moderado",
    breathingPoint: !isFast,
    transition: isFast ? "whip" : flavor.transition,
    zoom: !isFast,
    pan: isFast,
    pushIn: !isFast,
    pullOut: false,
    speedRamp: isFast,
    whip: isFast,
    fade: false,
    blur: isFast || flavor.blur,
    glow: flavor.glow,
    mask: flavor.mask,
    motionBlur: isFast,
    textAnimation: isFast ? "slide_up" : flavor.textAnimation,
    ctaEntry: hasCta ? "Entrada com slide-up discreto, sincronizada à fala." : "N/A — sem CTA nesta cena.",
    ctaExit: hasCta ? "Saída com fade rápido antes do corte para a próxima cena." : "N/A — sem CTA nesta cena.",
    easing: isFast ? "back_out" : "ease_in_out",
    animationTimingSeconds: isFast ? 0.2 : 0.35,
    syncNotes: "Animação de texto sincronizada ao início da fala da cena, nunca antes ou depois da narração.",
    pacingIntent,
  };
}

// ---------------------------------------------------------------------------------------------
// Áudio — trilhas e efeitos sonoros locais (sem API externa)
// ---------------------------------------------------------------------------------------------

export const MUSIC_TRACK_CATEGORIES = ["romantica", "elegante", "emocional", "inspiradora", "moderna", "minimalista", "wedding"] as const;
export type MusicTrackCategory = (typeof MUSIC_TRACK_CATEGORIES)[number];

export type MusicTrackReference = {
  category: MusicTrackCategory;
  name: string;
  description: string;
  /** Caminho local relativo por convenção — ver docs/video-cinematic-enrichment-report.md para o estado real dos arquivos. */
  localPath: string;
};

export const MUSIC_TRACK_LIBRARY: Record<MusicTrackCategory, MusicTrackReference> = {
  romantica: { category: "romantica", name: "Romântica", description: "Piano e cordas suaves, andamento lento, clima afetivo.", localPath: "assets/audio/music/romantica.mp3" },
  elegante: { category: "elegante", name: "Elegante", description: "Piano solo ou quarteto de cordas, sofisticada e discreta.", localPath: "assets/audio/music/elegante.mp3" },
  emocional: { category: "emocional", name: "Emocional", description: "Crescendo suave de cordas, constrói sentimento ao longo do vídeo.", localPath: "assets/audio/music/emocional.mp3" },
  inspiradora: { category: "inspiradora", name: "Inspiradora", description: "Piano + percussão leve, andamento crescente, motivacional sem ser corporativa.", localPath: "assets/audio/music/inspiradora.mp3" },
  moderna: { category: "moderna", name: "Moderna", description: "Synths minimalistas, batida discreta, clima contemporâneo.", localPath: "assets/audio/music/moderna.mp3" },
  minimalista: { category: "minimalista", name: "Minimalista", description: "Poucos elementos, muito espaço, quase ambiente.", localPath: "assets/audio/music/minimalista.mp3" },
  wedding: { category: "wedding", name: "Wedding", description: "Clima de cerimônia, cordas e piano, tom celebratório e caloroso.", localPath: "assets/audio/music/wedding.mp3" },
};

const MUSIC_KEYWORD_MAP: Array<{ keywords: string[]; category: MusicTrackCategory }> = [
  { keywords: ["casamento", "noivos", "noiva", "noivo", "cerimonia", "wedding"], category: "wedding" },
  { keywords: ["romantic", "romantico", "romantica", "amor", "afeto"], category: "romantica" },
  { keywords: ["elegante", "sofisticad", "premium", "luxo"], category: "elegante" },
  { keywords: ["emocao", "emocional", "sensivel", "profundo"], category: "emocional" },
  { keywords: ["inspira", "motiva", "conquista", "realizacao"], category: "inspiradora" },
  { keywords: ["moderno", "moderna", "tech", "inovador"], category: "moderna" },
  { keywords: ["minimalista", "minimal", "simples", "clean"], category: "minimalista" },
];

/** Seleção determinística de trilha a partir de qualquer texto de contexto disponível (tom de voz, ângulo, briefing). */
export function selectMusicTrack(...contextTexts: Array<string | undefined>): MusicTrackReference {
  const normalized = normalize(contextTexts.filter(Boolean).join(" "));
  for (const entry of MUSIC_KEYWORD_MAP) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword))) return MUSIC_TRACK_LIBRARY[entry.category];
  }
  return MUSIC_TRACK_LIBRARY.wedding;
}

export const SOUND_EFFECT_NAMES = ["whoosh", "sweep", "click", "pop", "sparkle", "notification", "rise", "impact_leve"] as const;
export type SoundEffectName = (typeof SOUND_EFFECT_NAMES)[number];

export type SoundEffectReference = {
  name: SoundEffectName;
  description: string;
  useCase: string;
  localPath: string;
};

export const SOUND_EFFECT_LIBRARY: Record<SoundEffectName, SoundEffectReference> = {
  whoosh: { name: "whoosh", description: "Rajada de ar curta.", useCase: "Transições rápidas (whip, slide).", localPath: "assets/audio/sfx/whoosh.mp3" },
  sweep: { name: "sweep", description: "Varredura sonora ascendente ou descendente.", useCase: "Transições de dissolve/fade entre cenas.", localPath: "assets/audio/sfx/sweep.mp3" },
  click: { name: "click", description: "Clique curto e seco.", useCase: "Entrada de texto na tela (pop/typewriter).", localPath: "assets/audio/sfx/click.mp3" },
  pop: { name: "pop", description: "Estalo curto e satisfatório.", useCase: "Animação de texto tipo 'pop' no gancho.", localPath: "assets/audio/sfx/pop.mp3" },
  sparkle: { name: "sparkle", description: "Brilho sonoro leve e cristalino.", useCase: "Realces (glow) e momentos de destaque de marca.", localPath: "assets/audio/sfx/sparkle.mp3" },
  notification: { name: "notification", description: "Toque curto de notificação.", useCase: "Entrada do CTA final.", localPath: "assets/audio/sfx/notification.mp3" },
  rise: { name: "rise", description: "Subida tensa e contínua.", useCase: "Cenas de desenvolvimento levando a um clímax.", localPath: "assets/audio/sfx/rise.mp3" },
  impact_leve: { name: "impact_leve", description: "Impacto curto e discreto (nunca pesado).", useCase: "Hard cuts do gancho e fechamento do CTA.", localPath: "assets/audio/sfx/impact-leve.mp3" },
};

/** Seleção determinística de efeitos sonoros por cena, a partir do papel narrativo e do tipo de transição já decidido por Diego. */
export function selectSoundEffectsForScene(role: SceneNarrativeRole, transition: TransitionStyle): SoundEffectReference[] {
  const effects: SoundEffectReference[] = [];
  if (role === "hook") effects.push(SOUND_EFFECT_LIBRARY.impact_leve, SOUND_EFFECT_LIBRARY.pop);
  if (role === "cta") effects.push(SOUND_EFFECT_LIBRARY.notification, SOUND_EFFECT_LIBRARY.sparkle);
  if (role === "development") {
    if (transition === "whip") effects.push(SOUND_EFFECT_LIBRARY.whoosh);
    else if (transition === "dissolve" || transition === "fade") effects.push(SOUND_EFFECT_LIBRARY.sweep);
    else if (transition === "glow") effects.push(SOUND_EFFECT_LIBRARY.sparkle);
  }
  return effects;
}

// ---------------------------------------------------------------------------------------------
// AGENCY FILM PIPELINE 2.0 — Shot Planning
// ---------------------------------------------------------------------------------------------
//
// A partir da sprint AGENCY FILM PIPELINE 2.0, a menor unidade da pipeline de vídeo deixa de ser
// a CENA e passa a ser o SHOT. Uma cena é um bloco narrativo (função dentro do vídeo); um Shot é
// uma tomada — uma câmera, uma ação, uma duração, um propósito. Toda cena tem pelo menos 2 Shots
// (`MIN_SHOTS_PER_SCENE`), nunca é composta por um único asset. Bruno decide os Shots por cena;
// Vanessa dirige a fotografia por Shot; o VisualAssetResolver busca asset por Shot; Diego costura
// a sequência entre Shots; Nora sincroniza a fala com as trocas de Shot; Rafa renderiza cada
// Shot com entrada/movimento/saída próprios; Lucas reprova vídeos com poucos Shots, sem
// diversidade, com molduras repetidas ou aparência de slideshow.
//
// Este bloco é shared util (não é Skill nem camada arquitetural nova), no mesmo espírito de
// `enrichCinematicScene` / `enrichEditingDecision` acima — funções puras e determinísticas,
// importáveis diretamente por Bruno, Vanessa, Diego, Rafa, Lucas e pela infraestrutura de vídeo.

/**
 * As 6 finalidades narrativas de um Shot dentro de uma cena. Espelha por convenção
 * `VisualSequenceRole` de `application/ports/visual-asset-provider.port.ts` — cada Shot já
 * corresponde a um papel visual coerente (estabelecer, detalhar, humanizar, mostrar produto,
 * reagir, encerrar), o que permite ao resolvedor pedir tipos de asset diferentes por Shot.
 */
export const SHOT_PURPOSES = ["establishing", "detail", "human_interaction", "product", "reaction", "closing"] as const;
export type ShotPurpose = (typeof SHOT_PURPOSES)[number];

/**
 * Vocabulário de entrada/ação/saída de um Shot. Nenhum Shot deve ficar totalmente estático em um
 * vídeo — o campo `action` define o que a câmera faz DURANTE o Shot (mesmo que discreto, como
 * `drift`); os campos `entrance`/`exit` definem como o Shot ENTRA e SAI, para que a montagem
 * seja lida como filme e não como slideshow. Todo movimento tem `motivation` obrigatória — nunca
 * movimento gratuito.
 */
export const SHOT_ENTRANCE_STYLES = [
  "cut_in",
  "fade_in",
  "slide_in_left",
  "slide_in_right",
  "slide_in_up",
  "slide_in_down",
  "push_in",
  "pull_out_reveal",
  "whip_in",
  "mask_reveal",
  "match_cut_in",
] as const;
export type ShotEntranceStyle = (typeof SHOT_ENTRANCE_STYLES)[number];

export const SHOT_ACTION_STYLES = [
  "drift",
  "static_hold",
  "push_in",
  "pull_out",
  "pan_left",
  "pan_right",
  "track_left",
  "track_right",
  "tilt_up",
  "tilt_down",
  "zoom_in",
  "zoom_out",
  "parallax",
  "handheld_breathe",
] as const;
export type ShotActionStyle = (typeof SHOT_ACTION_STYLES)[number];

export const SHOT_EXIT_STYLES = [
  "cut_out",
  "fade_out",
  "whip_out",
  "push_out",
  "pull_out_release",
  "mask_hide",
  "match_cut_out",
] as const;
export type ShotExitStyle = (typeof SHOT_EXIT_STYLES)[number];

export type ShotMotionIntent = {
  /** Como o Shot ENTRA. */
  entrance: ShotEntranceStyle;
  /** O que a câmera faz DURANTE o Shot (sempre há algo, mesmo que discreto). */
  action: ShotActionStyle;
  /** Como o Shot SAI (o que faz o próximo Shot entrar). */
  exit: ShotExitStyle;
  /** Justificativa do movimento — nunca movimento gratuito. */
  motivation: string;
};

export type ShotAssetRequirement = {
  /** Tipo de mídia preferido para este Shot — o resolvedor prioriza vídeo/b-roll/cinemagraph em cima de fotografia. */
  preferredMediaKind: "photo" | "illustration" | "mockup" | "graphic" | "video" | "b_roll" | "cinemagraph";
  /** Papel visual deste Shot, alimentado direto no `sequenceRoles` do VisualAssetResolver. */
  sequenceRole: ShotPurpose;
  /** Descrição concreta do que deve aparecer no quadro (ex.: "Mão segurando celular"). Não é asset ID. */
  whatShouldAppear: string;
  /** Emoção que o asset precisa transmitir isoladamente. */
  emotion: string;
  /** Tipo de enquadramento pedido ao resolvedor (redundante com `cinematography.shotType`, mas expresso em vocabulário do resolvedor). */
  framing: string;
  /** Sensação de movimento na cena real (não o movimento de câmera — o que se move dentro do quadro). */
  movement: string;
  /** Iluminação pedida ao resolvedor. */
  lighting: string;
  /** Função narrativa deste asset dentro da cena. */
  narrativeFunction: string;
  /** Tags obrigatórias para o resolvedor filtrar candidatos. */
  tags: string[];
  /** Tags proibidas — nunca reutilizar assets com estas tags dentro da mesma cena. */
  forbiddenTags: string[];
};

/**
 * Unidade cinematográfica mínima da pipeline de vídeo. Todo Shot pertence a uma cena, tem sua
 * própria decisão cinematográfica, seu próprio pedido de asset e seu próprio movimento —
 * nenhum Shot é uma imagem parada com texto por cima.
 */
export type Shot = {
  /** Id determinístico "s{sceneOrder}-shot-{order}". */
  id: string;
  /** Ordem da cena em que este Shot vive (1-based, mesma ordem de Bruno). */
  sceneOrder: number;
  /** Ordem deste Shot dentro da cena (1-based). */
  order: number;
  /** Nome legível do Shot (ex.: "Detalhe — mão no celular"). */
  name: string;
  /** Finalidade narrativa deste Shot dentro da cena. Nenhuma cena tem dois Shots adjacentes com o mesmo propósito. */
  purpose: ShotPurpose;
  /** O que efetivamente acontece dentro do Shot (ex.: "Mão segurando celular e tocando na tela"). */
  action: string;
  /** Início absoluto no vídeo. Bruno mantém a linha do tempo contínua entre Shots e cenas. */
  startSeconds: number;
  /** Duração do Shot em segundos. Bruno garante que a soma dos Shots é igual à duração da cena. */
  durationSeconds: number;
  /** 19 decisões cinematográficas — reutiliza o motor de Vanessa (`enrichCinematicScene`). */
  cinematography: CinematicSceneDecision;
  /** Pedido explícito para o VisualAssetResolver — nunca "usar uma foto qualquer". */
  assetRequirement: ShotAssetRequirement;
  /** Entrada/ação/saída do Shot com motivação explícita. */
  motion: ShotMotionIntent;
  /** Transição herdada do Shot anterior (`cut` para o primeiro Shot do vídeo). */
  transitionFromPrevious: TransitionStyle;
  /** Transição para o próximo Shot (`cut` para o último Shot do vídeo). */
  transitionToNext: TransitionStyle;
  /** Fio narrativo herdado do Shot anterior. "N/A" no primeiro Shot do vídeo. */
  continuityFromPrevious: string;
  /** O que este Shot deixa em aberto para o próximo. "N/A" no último Shot do vídeo. */
  continuityToNext: string;
  /** Por que este Shot existe dentro da cena. Nunca renderizado; guia Vanessa/Diego/Rafa/Lucas. */
  narrativeRole: string;
};

export type ShotPlan = {
  sceneOrder: number;
  sceneName: string;
  totalDurationSeconds: number;
  shots: Shot[];
};

/** Mínimo de Shots por cena. Sprint AGENCY FILM PIPELINE 2.0 proíbe cenas de um único plano. */
export const MIN_SHOTS_PER_SCENE = 2;
/** Máximo prático de Shots por cena. Acima disso, o corte fica frenético para o tempo típico de uma cena curta. */
export const MAX_SHOTS_PER_SCENE = 5;

/**
 * Recipes de Shot por papel narrativo de cena. Cada recipe define uma sequência coerente de
 * `ShotPurpose` (2 a 4 Shots) — nunca dois Shots adjacentes com o mesmo propósito. As três
 * variantes de `development` (build/payoff/release) espelham a rotação já usada por Vanessa e
 * Diego em `DEVELOPMENT_BEAT_VARIANTS` / `DEVELOPMENT_EDIT_FLAVORS`, para manter continuidade
 * entre cenas de desenvolvimento sem repetir a mesma sequência de planos.
 */
const SHOT_RECIPES: {
  hook: ShotPurpose[];
  cta: ShotPurpose[];
  development: ShotPurpose[][];
} = {
  hook: ["detail", "reaction"],
  cta: ["human_interaction", "product", "closing"],
  development: [
    // Beat 0 (build): estabelece → detalhe → humaniza. Primeira prova concreta.
    ["establishing", "detail", "human_interaction"],
    // Beat 1 (payoff): humaniza → reage → produto. Ápice emocional.
    ["human_interaction", "reaction", "product"],
    // Beat 2 (release): produto → detalhe → encerra. Respiro antes do CTA.
    ["product", "detail", "closing"],
  ],
};

/**
 * Vocabulário/preferências por `ShotPurpose` — o que o resolvedor precisa saber para achar um
 * asset compatível com o propósito do Shot, e que tipo de plano cinematográfico casa melhor com
 * cada propósito. Puro e determinístico. Nenhuma dessas escolhas é aleatória — cada propósito
 * pede uma composição diferente para forçar diversidade visual dentro da cena.
 */
const SHOT_PURPOSE_PROFILES: Record<
  ShotPurpose,
  {
    preferredShotType: ShotType;
    preferredMediaKind: ShotAssetRequirement["preferredMediaKind"];
    frameLabel: string;
    action: string;
    motionEntrance: ShotEntranceStyle;
    motionAction: ShotActionStyle;
    motionExit: ShotExitStyle;
    motivation: string;
    transitionOut: TransitionStyle;
    emotion: string;
    narrativeFunction: string;
    tagsBase: string[];
    forbiddenTagsBase: string[];
    movement: string;
    lighting: string;
  }
> = {
  establishing: {
    preferredShotType: "aberto",
    preferredMediaKind: "video",
    frameLabel: "Plano aberto — estabelece onde estamos.",
    action: "Câmera revela o contexto amplo da cena, apresenta o mundo antes do detalhe.",
    motionEntrance: "fade_in",
    motionAction: "drift",
    motionExit: "match_cut_out",
    motivation: "Estabelecer o mundo antes de mergulhar no detalhe — o espectador precisa ancorar onde a história acontece.",
    transitionOut: "dissolve",
    emotion: "Curiosidade contemplativa.",
    narrativeFunction: "Situar o espectador no espaço/contexto da cena antes de qualquer detalhe.",
    tagsBase: ["ambiente", "contexto", "amplo"],
    forbiddenTagsBase: ["mockup_isolado", "tela_centralizada"],
    movement: "Elementos vivos ao fundo (pessoas passando, vento, luz mudando).",
    lighting: "Luz natural ampla, sem foco duro em nenhum ponto específico.",
  },
  detail: {
    preferredShotType: "detalhe",
    preferredMediaKind: "b_roll",
    frameLabel: "Plano detalhe — mão, tela, objeto em uso.",
    action: "Detalhe funcional específico — mão segurando o celular, dedo tocando a tela, produto sendo usado.",
    motionEntrance: "match_cut_in",
    motionAction: "push_in",
    motionExit: "cut_out",
    motivation: "Trazer o espectador para dentro do gesto — o detalhe carrega a prova concreta que o plano aberto não consegue.",
    transitionOut: "cut",
    emotion: "Foco e intimidade.",
    narrativeFunction: "Provar concretamente com um detalhe funcional o que o plano anterior sugeriu.",
    tagsBase: ["detalhe", "gesto", "mao"],
    forbiddenTagsBase: ["plano_aberto", "paisagem"],
    movement: "Dedo/mão em movimento sobre o objeto, movimento sutil e humano.",
    lighting: "Luz focal no gesto, contexto suavemente escuro por contraste.",
  },
  human_interaction: {
    preferredShotType: "medio",
    preferredMediaKind: "video",
    frameLabel: "Plano médio — pessoa interagindo com o produto/contexto.",
    action: "Pessoa (ou casal) vivendo o benefício — segurando o celular, sorrindo, apontando para a tela.",
    motionEntrance: "slide_in_right",
    motionAction: "drift",
    motionExit: "match_cut_out",
    motivation: "Humanizar a promessa — o espectador precisa ver alguém como ele vivendo o resultado.",
    transitionOut: "dissolve",
    emotion: "Identificação humana.",
    narrativeFunction: "Provar o benefício por meio de uma pessoa real vivendo o momento, não por texto.",
    tagsBase: ["pessoa", "interacao", "humano"],
    forbiddenTagsBase: ["mockup_isolado", "tela_centralizada"],
    movement: "Corpo, mãos e olhar em movimento natural.",
    lighting: "Luz natural quente, direcional, com sombras suaves — nunca luz de estúdio dura.",
  },
  product: {
    preferredShotType: "close",
    preferredMediaKind: "cinemagraph",
    frameLabel: "Plano próximo — o produto integrado à cena, nunca centralizado sozinho.",
    action: "Produto na mão de alguém, sobre uma mesa realista, integrado ao ambiente — nunca flutuando no vazio.",
    motionEntrance: "push_in",
    motionAction: "static_hold",
    motionExit: "pull_out_release",
    motivation: "Mostrar o produto de perto sem tirar o produto do mundo real — evitar aparência de mockup solto.",
    transitionOut: "cut",
    emotion: "Reconhecimento e confiança.",
    narrativeFunction: "Firmar a identidade do produto no momento em que a promessa já foi provada.",
    tagsBase: ["produto", "close", "integrado"],
    forbiddenTagsBase: ["mockup_flutuando", "fundo_neutro"],
    movement: "Micro-movimento (dedo passando na tela, produto sendo levantado).",
    lighting: "Luz que abraça o produto sem apagá-lo do ambiente.",
  },
  reaction: {
    preferredShotType: "close",
    preferredMediaKind: "video",
    frameLabel: "Close — rosto reagindo, sorriso, olhar de alívio.",
    action: "Rosto capturado no instante da reação — sorriso, alívio, admiração, cumplicidade.",
    motionEntrance: "whip_in",
    motionAction: "handheld_breathe",
    motionExit: "cut_out",
    motivation: "Deixar a emoção humana fechar a prova — nenhum texto consegue substituir uma reação.",
    transitionOut: "cut",
    emotion: "Alívio ou celebração contida.",
    narrativeFunction: "Traduzir em emoção humana o que os planos anteriores mostraram funcionalmente.",
    tagsBase: ["rosto", "sorriso", "reacao"],
    forbiddenTagsBase: ["mockup", "tela"],
    movement: "Micro-expressões faciais, olhar direto ou fora de eixo.",
    lighting: "Luz natural suave direcionada ao rosto, coerente com a cena.",
  },
  closing: {
    preferredShotType: "medio",
    preferredMediaKind: "video",
    frameLabel: "Plano médio de fechamento — cena que encerra o ciclo emocional local.",
    action: "Encerramento visual da cena — casal abraçando, mão soltando o celular, câmera se afastando.",
    motionEntrance: "mask_reveal",
    motionAction: "pull_out",
    motionExit: "fade_out",
    motivation: "Fechar o ciclo emocional da cena de forma que a próxima cena/transição possa começar limpa.",
    transitionOut: "fade",
    emotion: "Contemplação e resolução.",
    narrativeFunction: "Fechar o arco emocional da cena antes de a próxima cena começar.",
    tagsBase: ["fechamento", "abraco", "resolucao"],
    forbiddenTagsBase: ["mockup", "tela_centralizada"],
    movement: "Movimento amplo lento — corpo, câmera se afastando, luz mudando.",
    lighting: "Luz que se dissolve suavemente, preparando terreno para a próxima cena.",
  },
};

function transitionAfterPurpose(purpose: ShotPurpose): TransitionStyle {
  return SHOT_PURPOSE_PROFILES[purpose].transitionOut;
}

function buildShotAssetRequirement(purpose: ShotPurpose, featureFocus: string | undefined, otherPurposes: ShotPurpose[]): ShotAssetRequirement {
  const profile = SHOT_PURPOSE_PROFILES[purpose];
  const focusTags = featureFocus ? [normalize(featureFocus).replace(/\s+/g, "_")] : [];
  // Cada Shot proíbe tags de assets já pedidos em Shots vizinhos, para forçar diversidade visual dentro da mesma cena.
  const forbiddenFromNeighbors = otherPurposes
    .filter((other) => other !== purpose)
    .flatMap((other) => SHOT_PURPOSE_PROFILES[other].tagsBase);
  return {
    preferredMediaKind: profile.preferredMediaKind,
    sequenceRole: purpose,
    whatShouldAppear: profile.frameLabel,
    emotion: profile.emotion,
    framing: profile.frameLabel,
    movement: profile.movement,
    lighting: profile.lighting,
    narrativeFunction: profile.narrativeFunction,
    tags: [...profile.tagsBase, ...focusTags],
    forbiddenTags: [...profile.forbiddenTagsBase, ...forbiddenFromNeighbors],
  };
}

function buildShotMotionIntent(purpose: ShotPurpose): ShotMotionIntent {
  const profile = SHOT_PURPOSE_PROFILES[purpose];
  return {
    entrance: profile.motionEntrance,
    action: profile.motionAction,
    exit: profile.motionExit,
    motivation: profile.motivation,
  };
}

function overrideCinematographyForShot(base: CinematicSceneDecision, purpose: ShotPurpose, durationSeconds: number): CinematicSceneDecision {
  const profile = SHOT_PURPOSE_PROFILES[purpose];
  return {
    ...base,
    shotType: profile.preferredShotType,
    idealTakeDurationSeconds: Math.max(1, Math.round(durationSeconds)),
    // Reforça o motivo narrativo com o vocabulário do propósito do Shot, para Lucas e Rafa lerem
    // por que aquele plano existe (não só que ele existe).
    narrativeMotive: `${base.narrativeMotive} (Shot ${purpose}: ${profile.narrativeFunction})`,
  };
}

export type ShotPlanRequest = {
  sceneOrder: number;
  sceneName: string;
  sceneRole: SceneNarrativeRole;
  sceneRhythm: string;
  sceneStartSeconds: number;
  sceneDurationSeconds: number;
  sceneAction: string;
  /** Beat index (0=build, 1=payoff, 2=release) — ignorado para hook/cta. */
  beatIndex?: number;
  /** Feature/prova principal da cena (ex.: "RSVP"). Usado para forçar tags de asset. */
  featureFocus?: string;
};

/**
 * Motor determinístico de shot planning. Para cada cena, devolve entre 2 e 4 Shots cobrindo
 * exatamente a duração da cena, com propósitos, cinematografia, motion e transições distintos.
 * Nenhuma cena sai com menos de `MIN_SHOTS_PER_SCENE` Shots. A soma das durações dos Shots é
 * igual à duração da cena. Cada Shot tem cinematografia, asset requirement, motion e transições
 * próprias — Vanessa/Diego/Rafa consomem esse plano por Shot, não por cena.
 */
export function planShotsForScene(request: ShotPlanRequest): ShotPlan {
  const beatIndex = ((request.beatIndex ?? 0) % SHOT_RECIPES.development.length + SHOT_RECIPES.development.length) % SHOT_RECIPES.development.length;
  const purposes =
    request.sceneRole === "hook"
      ? SHOT_RECIPES.hook
      : request.sceneRole === "cta"
        ? SHOT_RECIPES.cta
        : SHOT_RECIPES.development[beatIndex];

  const totalShots = purposes.length;
  // Distribui a duração da cena entre os Shots, garantindo que a soma bate com a duração total
  // (o último Shot absorve o resíduo do arredondamento). Todos os Shots têm no mínimo 0.4s —
  // qualquer coisa abaixo disso é invisível a 30fps e vira flicker.
  const rawPerShot = Math.max(0.4, request.sceneDurationSeconds / totalShots);
  const shots: Shot[] = [];
  let cursor = request.sceneStartSeconds;
  for (let i = 0; i < totalShots; i++) {
    const isLast = i === totalShots - 1;
    const purpose = purposes[i];
    const duration = isLast
      ? Math.max(0.4, request.sceneStartSeconds + request.sceneDurationSeconds - cursor)
      : Number.parseFloat(rawPerShot.toFixed(2));
    const baseCinematography = enrichCinematicScene(request.sceneRole, request.sceneRhythm, duration, beatIndex);
    const cinematography = overrideCinematographyForShot(baseCinematography, purpose, duration);
    const motion = buildShotMotionIntent(purpose);
    const assetRequirement = buildShotAssetRequirement(purpose, request.featureFocus, purposes);
    const previousPurpose = i > 0 ? purposes[i - 1] : undefined;
    const nextPurpose = i < totalShots - 1 ? purposes[i + 1] : undefined;
    const profile = SHOT_PURPOSE_PROFILES[purpose];
    shots.push({
      id: `s${request.sceneOrder}-shot-${i + 1}`,
      sceneOrder: request.sceneOrder,
      order: i + 1,
      name: `${request.sceneName} — ${profile.frameLabel}`,
      purpose,
      action: profile.action,
      startSeconds: Number.parseFloat(cursor.toFixed(2)),
      durationSeconds: Number.parseFloat(duration.toFixed(2)),
      cinematography,
      assetRequirement,
      motion,
      transitionFromPrevious: previousPurpose ? transitionAfterPurpose(previousPurpose) : "cut",
      transitionToNext: nextPurpose ? transitionAfterPurpose(purpose) : "cut",
      continuityFromPrevious: previousPurpose
        ? `Herda de ${previousPurpose} — mesma cena, agora em ${purpose}.`
        : `Primeiro Shot da cena "${request.sceneName}" — abre com ${purpose}.`,
      continuityToNext: nextPurpose
        ? `Prepara ${nextPurpose} do próximo Shot desta cena.`
        : `Último Shot da cena "${request.sceneName}" — entrega o gancho para a próxima cena.`,
      narrativeRole: `Cena ${request.sceneOrder} (${request.sceneRole}, beat ${beatIndex}) — Shot ${i + 1}/${totalShots} com propósito ${purpose}.`,
    });
    cursor += duration;
  }

  return {
    sceneOrder: request.sceneOrder,
    sceneName: request.sceneName,
    totalDurationSeconds: Number.parseFloat(request.sceneDurationSeconds.toFixed(2)),
    shots,
  };
}

// ---------------------------------------------------------------------------------------------
// Diversidade e Anti-Slideshow — guards puros para Bruno, Rafa e Lucas
// ---------------------------------------------------------------------------------------------

export type ShotDiversityReport = {
  totalShots: number;
  distinctShotTypes: number;
  distinctPurposes: number;
  distinctMotionActions: number;
  distinctEntrances: number;
  distinctTransitions: number;
  repeatedShotTypeRuns: Array<{ startShotOrder: number; endShotOrder: number; shotType: ShotType; length: number }>;
  slideshowLikeRatio: number;
  slideshowLikeShots: number[];
};

/**
 * Calcula um relatório determinístico de diversidade visual sobre uma lista de Shots. Serve tanto
 * para Bruno/Diego reforçarem variedade na hora de planejar quanto para Lucas reprovar vídeos
 * cuja diversidade estiver abaixo de mínimos. A função não decide o que é "aprovado" — só reporta
 * os fatos observáveis.
 */
export function computeShotDiversityReport(shots: Shot[]): ShotDiversityReport {
  const totalShots = shots.length;
  const distinctShotTypes = new Set(shots.map((shot) => shot.cinematography.shotType)).size;
  const distinctPurposes = new Set(shots.map((shot) => shot.purpose)).size;
  const distinctMotionActions = new Set(shots.map((shot) => shot.motion.action)).size;
  const distinctEntrances = new Set(shots.map((shot) => shot.motion.entrance)).size;
  const distinctTransitions = new Set(shots.map((shot) => shot.transitionToNext)).size;

  const repeatedShotTypeRuns: ShotDiversityReport["repeatedShotTypeRuns"] = [];
  let runStart = 0;
  for (let i = 1; i <= shots.length; i++) {
    const brokeRun = i === shots.length || shots[i].cinematography.shotType !== shots[i - 1].cinematography.shotType;
    if (brokeRun) {
      const length = i - runStart;
      if (length >= 2) {
        repeatedShotTypeRuns.push({
          startShotOrder: shots[runStart].order,
          endShotOrder: shots[i - 1].order,
          shotType: shots[runStart].cinematography.shotType,
          length,
        });
      }
      runStart = i;
    }
  }

  // Um Shot é "slideshow-like" quando entra sem transição, fica estático a cena inteira e sai
  // sem transição — ou seja, se comporta como uma imagem parada no meio de um vídeo.
  const slideshowLikeShots: number[] = [];
  for (const shot of shots) {
    const staticMotion = shot.motion.action === "static_hold";
    const hardEntrance = shot.motion.entrance === "cut_in";
    const hardExit = shot.motion.exit === "cut_out";
    const longEnoughToNotice = shot.durationSeconds >= 1.5;
    if (staticMotion && hardEntrance && hardExit && longEnoughToNotice) slideshowLikeShots.push(shot.order);
  }
  const slideshowLikeRatio = totalShots === 0 ? 0 : slideshowLikeShots.length / totalShots;

  return {
    totalShots,
    distinctShotTypes,
    distinctPurposes,
    distinctMotionActions,
    distinctEntrances,
    distinctTransitions,
    repeatedShotTypeRuns,
    slideshowLikeRatio,
    slideshowLikeShots,
  };
}

/**
 * Limites mínimos de diversidade de Shots aceitos pela pipeline AGENCY FILM PIPELINE 2.0. Lucas
 * reprova vídeos abaixo destes limites; Bruno/Diego usam como referência ao planejar. Valores
 * calibrados para vídeos curtos (3-6 cenas, 6-15 Shots totais).
 */
export const SHOT_DIVERSITY_MINIMUMS = {
  minDistinctShotTypes: 3,
  minDistinctPurposes: 3,
  minDistinctMotionActions: 3,
  minDistinctEntrances: 2,
  minDistinctTransitions: 2,
  maxRepeatedShotTypeRunLength: 2,
  /** Máximo aceitável de Shots com aparência de slideshow (estáticos, sem transição). */
  maxSlideshowLikeRatio: 0.2,
} as const;

