#!/usr/bin/env node
/**
 * Gera o pacote de pautas da Vorix Works (`vorix.editorial-pack/v1`) a partir da base de assuntos
 * reais (`vorix-works-topics.mjs`) combinada com 13 abordagens editoriais diferentes. Cada pauta é
 * um par (assunto, abordagem) único: o roteiro, a estrutura e a legenda mudam com a abordagem, e o
 * conteúdo concreto (dor, cena, capacidade, passos, perguntas, mito, erro) vem do assunto.
 *
 * Uso: node scripts/editorial/build-vorix-works-pack.mjs [saída.json]
 * O resultado é importado pela aba Produção → Pautas do workspace Vorix Works.
 */
import { writeFileSync } from "node:fs";
import { CATEGORIES, TOPICS } from "./vorix-works-topics.mjs";

const OUTPUT = process.argv[2] ?? "scripts/editorial/vorix-works-pautas.json";
const START_DATE = "2026-11-23"; // primeira segunda-feira útil depois da entrega

const PRODUCT_WITH_ARTICLE = {
  "Vorix Conversas": "o Vorix Conversas", "Vorix Meetings": "o Vorix Meetings", "Vorix Sites & Commerce": "o Vorix Sites & Commerce",
  "ecossistema Vorix": "o ecossistema Vorix", Vorix: "a Vorix", "Vorix Marketing": "o Vorix Marketing", "Vorix Works": "a Vorix Works",
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const low = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const noDot = (s) => s.replace(/[.!?]$/, "");
/** "em" + artigo: no/na/nos/nas. */
const em = (label) => label.replace(/^(os|as|o|a) /, (m, art) => ({ o: "no ", a: "na ", os: "nos ", as: "nas " })[art]);
const de = (label) => label.replace(/^(os|as|o|a) /, (m, art) => ({ o: "do ", a: "da ", os: "dos ", as: "das " })[art]);

const VISUAL = {
  carousel: "Carrossel 4:5 com a paleta e a tipografia da Vorix Works: capa com título forte e muito respiro, uma ideia por tela, numeração discreta, última tela com CTA e logotipo oficial.",
  single: "Composição editorial 4:5 com título dominante, metáfora visual ligada ao tema, paleta da Vorix Works, respiro generoso e logotipo oficial discreto.",
  video: "Vídeo vertical 9:16 de até 30 segundos, legendas grandes, gancho nos 2 primeiros segundos, vinhetas com a paleta da Vorix Works e logotipo no fechamento.",
};

/**
 * Abordagens editoriais. Cada uma define título, conceito, mensagem, estrutura narrativa, objetivo,
 * corpo da legenda, CTA e os roteiros por formato (telas de carrossel, cenas de vídeo ou composição
 * de imagem única).
 */
const APPROACHES = {
  demonstracao: {
    label: "Demonstração real da plataforma",
    title: (S) => `Na prática: ${S.demoTitle}`,
    concept: (S, P) => `Demonstração com capturas reais ${de(P)}: partir de uma situação comum (${low(noDot(S.scene))}) e mostrar ${S.demoTitle} resolvendo o problema.`,
    message: (S) => `${cap(S.benefit)}.`,
    narrative: "Situação real em 2 segundos → a tela da plataforma em uso → o resultado para a equipe → convite para ver ao vivo.",
    objective: (S, P) => `Mostrar ${P} funcionando e gerar pedidos de demonstração`,
    cta: "Peça uma demonstração",
    body: (S) => `${S.scene}\n\nNeste vídeo, mostramos ${S.demoTitle} em uso — direto da plataforma, sem tela simulada.`,
    visual: (S, P) => `Gravação de tela real ${de(P)} mostrando ${S.demoTitle}; cursor visível, zoom nos pontos-chave. ${VISUAL.video}`,
    video: (S, cta) => [
      { time: "0–2s", visual: "Pergunta em texto grande sobre fundo da marca", text: S.hook },
      { time: "2–7s", visual: "Cena cotidiana do problema", text: S.pain },
      { time: "7–20s", visual: `Captura real: ${S.demoTitle}`, text: S.capability },
      { time: "20–25s", visual: "Destaque do resultado na tela", text: `${cap(S.benefit)}.` },
      { time: "25–30s", visual: "Logotipo Vorix Works e chamada", text: cta },
    ],
  },
  problema: {
    label: "Problema cotidiano",
    title: (S) => S.problemTitle,
    concept: (S) => `Partir de uma cena reconhecível — ${low(noDot(S.scene))} — e revelar a causa por trás dela: ${low(S.pain)}`,
    message: (S) => `Quando ${S.label} tem estrutura, ${S.benefit}.`,
    narrative: "Cena do problema → consequência para o cliente → causa real → saída possível.",
    objective: (S) => `Gerar identificação com a dor de ${S.short} e abrir conversa comercial`,
    cta: "Conheça a Vorix Works",
    body: (S) => `${S.scene}\n\nParece falta de atenção, mas quase sempre é falta de estrutura: ${low(S.pain)}`,
    visual: () => `Cena cotidiana que mostra o problema em destaque (pessoa, celular, mesa de trabalho). ${VISUAL.single}`,
    single: (S) => `Imagem da cena do problema com o título "${S.problemTitle}" em destaque e, abaixo, uma linha com a saída.`,
    video: (S, cta) => [
      { time: "0–3s", visual: "Título em texto grande", text: S.problemTitle },
      { time: "3–10s", visual: "Encenação simples da situação", text: S.scene },
      { time: "10–20s", visual: "Tela real da plataforma com a solução", text: S.capability },
      { time: "20–26s", visual: "Logotipo Vorix Works e chamada", text: cta },
    ],
  },
  pergunta: {
    label: "Pergunta provocativa",
    title: (S) => S.hook,
    concept: (S) => `Uma pergunta direta para o público se reconhecer, respondida na legenda com um caminho prático: ${low(S.capability)}`,
    message: (S) => `${cap(S.benefit)}.`,
    narrative: "Pergunta → pausa para reflexão → resposta e caminho na legenda → convite.",
    objective: (S) => `Provocar reflexão sobre ${S.short} e gerar comentários e mensagens`,
    cta: "Conheça a Vorix Works",
    body: (S) => `Pense na sua última semana. ${S.pain}\n\nSe a resposta demorou para vir, vale olhar para ${S.label} com mais cuidado.`,
    visual: () => `Pergunta em tipografia grande ocupando o centro, sem imagem concorrendo. ${VISUAL.single}`,
    single: (S) => `Só a pergunta "${S.hook}" em destaque, com um detalhe gráfico da marca e o logotipo no rodapé.`,
  },
  beneficio: {
    label: "Benefício direto",
    title: (S) => S.benefitTitle,
    concept: (S) => `Destacar um benefício plausível e demonstrável — ${S.benefit} — apoiado no que a plataforma faz hoje: ${low(S.capability)}`,
    message: (S) => `${cap(S.benefit)}.`,
    narrative: "Benefício → como ele acontece na rotina → convite.",
    objective: (S, P) => `Comunicar o benefício de ${S.short} com ${P} e atrair interessados`,
    cta: "Conheça a Vorix Works",
    body: (S) => `${S.benefitTitle}. Na rotina, isso significa que ${S.benefit}.`,
    visual: (S) => `Recorte de captura real mostrando ${S.demoTitle}, integrado ao título. ${VISUAL.single}`,
    single: (S) => `Título "${S.benefitTitle}" com um recorte da captura real ${de(S.demoTitle)} ao lado.`,
  },
  institucional: {
    label: "Institucional",
    title: (S) => `Por que a Vorix ${S.why}`,
    concept: (S) => `Peça institucional que explica uma escolha de produto da Vorix: ${low(S.capability)}`,
    message: (S) => `A Vorix foi pensada para que ${S.benefit}.`,
    narrative: "Princípio da marca → como a plataforma aplica → convite.",
    objective: () => "Fortalecer o posicionamento da Vorix Works como ecossistema integrado",
    cta: "Conheça a Vorix Works",
    body: (S) => `Uma escolha de produto: ${low(S.capability)}\n\nO motivo é simples: ${S.benefit}.`,
    visual: () => `Composição sóbria e institucional, com a marca em destaque e muito espaço negativo. ${VISUAL.single}`,
    single: (S) => `Frase institucional "Por que a Vorix ${S.why}" com o logotipo grande e um elemento gráfico da marca.`,
  },
  campanha: {
    label: "Campanha comercial",
    title: (S, P) => `${S.benefitTitle}: conheça ${P}`,
    concept: (S, P) => `Peça comercial direta para quem já sente o problema (${low(noDot(S.pain))}), apresentando ${P} como caminho.`,
    message: (S) => `${cap(S.benefit)}.`,
    narrative: "Dor reconhecível → oferta clara → chamada para conversar.",
    objective: (S, P) => `Gerar contatos comerciais interessados ${em(P)}`,
    cta: "Fale com a equipe Vorix",
    body: (S) => `${S.pain}\n\nSe isso acontece na sua empresa, a gente pode ajudar.`,
    visual: () => `Peça comercial com título forte, destaque para a chamada e sem preços ou números. ${VISUAL.single}`,
    single: (S) => `Título "${S.benefitTitle}", uma linha de apoio e um botão visual com "Fale com a equipe Vorix".`,
  },
  comparacao: {
    label: "Comparação fragmentado × integrado",
    title: (S) => `${cap(S.fragmented)} ou ${S.integrated}?`,
    concept: (S) => `Comparar o processo fragmentado (${S.fragmented}) com o integrado (${S.integrated}), sem citar concorrentes.`,
    message: (S) => `Com ${S.integrated}, ${S.benefit}.`,
    narrative: "Lado A × lado B → a diferença no dia a dia → convite.",
    objective: (S) => `Mostrar a diferença prática entre trabalhar fragmentado e integrado em ${S.short}`,
    cta: "Conheça a Vorix Works",
    body: (S) => `De um lado, ${S.fragmented}. Do outro, ${S.integrated}.\n\n${S.pain} Com tudo integrado, ${S.benefit}.`,
    visual: () => `Tela dividida em duas metades contrastantes (desorganizado × organizado). ${VISUAL.carousel}`,
    single: (S) => `Tela dividida: à esquerda "${cap(S.fragmented)}", à direita "${cap(S.integrated)}", com o título no topo.`,
    slides: (S, cta) => [
      { headline: `${cap(S.fragmented)} ou ${S.integrated}?`, body: `Duas formas de cuidar ${de(S.label)}.` },
      { headline: cap(S.fragmented), body: S.pain },
      { headline: cap(S.integrated), body: S.capability },
      { headline: "Na rotina da equipe", body: `Com ${S.integrated}, ${S.benefit}.` },
      { headline: "Qual é o seu caso hoje?", body: cta },
    ],
  },
  educativo: {
    label: "Conteúdo educativo",
    title: (S) => `${S.steps.length} passos para ${S.goal}`,
    concept: (S) => `Conteúdo educativo com passos que funcionam com ou sem ferramenta, mostrando no fim onde a Vorix ajuda: ${low(S.capability)}`,
    message: (S) => `Organizar ${S.label} começa com passos simples.`,
    narrative: "Capa com a promessa → um passo por tela → onde a Vorix entra → convite para salvar.",
    objective: (S) => `Educar o público e posicionar a Vorix como referência em ${S.short}`,
    cta: "Salve este post e conheça a Vorix Works",
    body: (S) => `Comece por aqui:\n${S.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
    visual: () => `Passos numerados em destaque, ícones simples por tela. ${VISUAL.carousel}`,
    slides: (S, cta) => [
      { headline: `${S.steps.length} passos para ${S.goal}`, body: "Simples de aplicar, a partir desta semana." },
      ...S.steps.map((step, index) => ({ headline: `Passo ${index + 1}`, body: step })),
      { headline: "Onde a Vorix entra", body: S.capability },
      { headline: "Guarde para consultar", body: cta },
    ],
  },
  checklist: {
    label: "Diagnóstico em perguntas",
    title: (S) => `5 perguntas para avaliar ${S.label}`,
    concept: (S) => `Autodiagnóstico com cinco perguntas práticas sobre ${S.label}; quem responder "não sei" a alguma delas encontra o caminho no fim.`,
    message: (S) => `Se alguma pergunta ficou sem resposta, ${S.label} merece atenção.`,
    narrative: "Capa com o convite ao teste → uma pergunta por tela → leitura do resultado → convite.",
    objective: (S) => `Gerar salvamentos e autodiagnóstico sobre ${S.short}, abrindo espaço para a Vorix`,
    cta: "Salve este post e conheça a Vorix Works",
    body: (S) => `Responda com sinceridade:\n${S.questions.map((question) => `• ${question}`).join("\n")}`,
    visual: () => `Uma pergunta grande por tela, com caixa de seleção estilizada. ${VISUAL.carousel}`,
    slides: (S, cta) => [
      { headline: `5 perguntas para avaliar ${S.label}`, body: "Responda com sinceridade." },
      ...S.questions.map((question, index) => ({ headline: `Pergunta ${index + 1}`, body: question })),
      { headline: "Ficou alguma sem resposta?", body: S.capability },
      { headline: "Próximo passo", body: cta },
    ],
  },
  mito: {
    label: "Mito ou verdade",
    title: (S) => `Mito ou verdade: "${noDot(S.myth[0])}"`,
    concept: (S) => `Desmistificar uma crença comum ("${noDot(S.myth[0])}") com uma resposta qualificada: ${low(S.myth[1])}`,
    message: (S) => S.myth[1],
    narrative: "A crença → a resposta → o que ajuda na prática → convite.",
    objective: (S) => `Desfazer objeções comuns sobre ${S.short}`,
    cta: "Conheça a Vorix Works",
    body: (S) => `"${S.myth[0]}" — mito.\n\n${S.myth[1]}`,
    visual: () => `Selo "Mito" × "Verdade" em destaque, tipografia forte. ${VISUAL.single}`,
    single: (S) => `Frase "${noDot(S.myth[0])}" riscada com o selo "Mito" e, abaixo, a resposta curta.`,
    slides: (S, cta) => [
      { headline: "Mito ou verdade?", body: `"${S.myth[0]}"` },
      { headline: "Mito.", body: S.myth[1] },
      { headline: "Na prática", body: S.capability },
      { headline: "O resultado", body: `${cap(S.benefit)}.` },
      { headline: "Quer ver como funciona?", body: cta },
    ],
  },
  erro: {
    label: "Erro comum",
    title: (S) => `Erro comum: ${low(S.mistake[0])}`,
    concept: (S) => `Apresentar um erro frequente (${low(S.mistake[0])}), a consequência (${S.mistake[1]}) e a alternativa (${S.mistake[2]}).`,
    message: (S) => `A alternativa é ${S.mistake[2]}.`,
    narrative: "O erro → a consequência → a alternativa → como a Vorix ajuda → convite.",
    objective: (S) => `Mostrar o custo de um erro comum em ${S.short} e apresentar a alternativa`,
    cta: "Conheça a Vorix Works",
    body: (S) => `${S.mistake[0]} parece prático, mas ${S.mistake[1]}.\n\nA alternativa: ${S.mistake[2]}.`,
    visual: () => `Sinalização visual de alerta (sem exageros), contraste entre o erro e a alternativa. ${VISUAL.carousel}`,
    slides: (S, cta) => [
      { headline: `Erro comum: ${low(S.mistake[0])}`, body: "Muita empresa faz assim. Veja por que vale mudar." },
      { headline: "O erro", body: `${S.mistake[0]}.` },
      { headline: "A consequência", body: `${cap(S.mistake[1])}.` },
      { headline: "A alternativa", body: `${cap(S.mistake[2])}.` },
      { headline: "Com a Vorix", body: S.capability },
      { headline: "Próximo passo", body: cta },
    ],
    video: (S, cta) => [
      { time: "0–3s", visual: "Texto: \"Erro comum\"", text: `${S.mistake[0]}.` },
      { time: "3–10s", visual: "Encenação rápida do erro", text: `O problema: ${S.mistake[1]}.` },
      { time: "10–20s", visual: "Captura real da plataforma", text: `A alternativa: ${S.mistake[2]}. ${S.capability}` },
      { time: "20–26s", visual: "Logotipo Vorix Works e chamada", text: cta },
    ],
  },
  antes_depois: {
    label: "Antes e depois",
    title: (S) => `Antes e depois: ${S.label}`,
    concept: (S) => `Contrastar a rotina fragmentada (${S.before}) com a rotina organizada (${S.after}), sem prometer resultados numéricos.`,
    message: (S) => `Depois: ${S.after}.`,
    narrative: "Antes → o que muda → depois → convite.",
    objective: (S) => `Tornar visível a mudança de rotina em ${S.short}`,
    cta: "Conheça a Vorix Works",
    body: (S) => `Antes: ${S.before}.\nDepois: ${S.after}.\n\nO que muda no meio do caminho é a estrutura.`,
    visual: () => `Estrutura visual de antes × depois com a mesma composição nos dois lados. ${VISUAL.carousel}`,
    slides: (S, cta) => [
      { headline: `Antes e depois: ${S.label}`, body: "A mesma empresa, duas rotinas." },
      { headline: "Antes", body: `${cap(S.before)}.` },
      { headline: "O que muda", body: S.capability },
      { headline: "Depois", body: `${cap(S.after)}.` },
      { headline: "Quer essa rotina?", body: cta },
    ],
    video: (S, cta) => [
      { time: "0–3s", visual: "Tela dividida \"Antes | Depois\"", text: `Antes e depois: ${S.label}.` },
      { time: "3–10s", visual: "Rotina bagunçada encenada", text: `Antes: ${S.before}.` },
      { time: "10–20s", visual: "Captura real da plataforma", text: `Depois: ${S.after}.` },
      { time: "20–26s", visual: "Logotipo Vorix Works e chamada", text: cta },
    ],
  },
  bastidores: {
    label: "Bastidores da operação",
    title: (S) => `Bastidores: o que observar ${em(S.label)}`,
    concept: (S) => `Mostrar os bastidores ${de(S.label)}: o que um gestor deve observar no dia a dia e como a Vorix deixa isso visível.`,
    message: (S) => `O que não é observado não melhora: ${S.observe[0]}.`,
    narrative: "Convite aos bastidores → três pontos de atenção → onde enxergar isso → convite.",
    objective: (S) => `Ensinar o que acompanhar em ${S.short} e mostrar onde a Vorix ajuda`,
    cta: "Conheça a Vorix Works",
    body: (S) => `Três coisas para observar ${em(S.label)}:\n${S.observe.map((item) => `• ${cap(item)}`).join("\n")}`,
    visual: () => `Estética de bastidores (rotina real de escritório, telas reais desfocadas ao fundo). ${VISUAL.carousel}`,
    slides: (S, cta) => [
      { headline: `Bastidores: o que observar ${em(S.label)}`, body: "Três pontos que dizem muito sobre a operação." },
      ...S.observe.map((item, index) => ({ headline: `Ponto ${index + 1}`, body: `${cap(item)}.` })),
      { headline: "Onde enxergar isso", body: S.capability },
      { headline: "Próximo passo", body: cta },
    ],
    video: (S, cta) => [
      { time: "0–3s", visual: "Texto: \"Bastidores\"", text: `O que observar ${em(S.label)}.` },
      { time: "3–15s", visual: "Três cortes rápidos, um por ponto", text: S.observe.map((item) => cap(item)).join(". ") + "." },
      { time: "15–22s", visual: "Captura real da plataforma", text: S.capability },
      { time: "22–28s", visual: "Logotipo Vorix Works e chamada", text: cta },
    ],
  },
};

const APPROACHES_BY_FORMAT = {
  carousel: ["educativo", "checklist", "comparacao", "antes_depois", "mito", "erro", "bastidores"],
  single_image: ["pergunta", "problema", "beneficio", "mito", "institucional", "campanha", "comparacao"],
  video: ["demonstracao", "problema", "antes_depois", "bastidores", "erro"],
};
const FORMAT_CYCLE = ["carousel", "single_image", "carousel", "single_image", "carousel", "video"];

function buildIdea({ category, topic, approachKey, format, id, priority }) {
  const A = APPROACHES[approachKey];
  const P = PRODUCT_WITH_ARTICLE[category.product];
  const cta = A.cta;
  const title = A.title(topic, P);
  const caption = [
    approachKey === "pergunta" ? topic.hook : title,
    A.body(topic),
    topic.capability,
    `${cta} → vorixworks.com`,
    category.tags,
  ].join("\n\n");
  const idea = {
    id,
    title,
    category: category.name,
    commercialObjective: A.objective(topic, P),
    targetAudience: topic.audience,
    concept: A.concept(topic, P),
    keyMessage: A.message(topic),
    format,
    approach: A.label,
    visualDirection: format === "single_image" && A.single ? `${A.single(topic)} ${A.visual(topic, P)}` : A.visual(topic, P),
    narrativeStructure: A.narrative,
    caption,
    cta,
    priority,
  };
  if (format === "carousel") idea.carouselScript = A.slides(topic, cta);
  if (format === "video") idea.videoScript = A.video(topic, cta);
  return idea;
}

function buildIdeas() {
  const ideas = [];
  let sequence = 0;
  const globalCount = new Map();
  for (const category of CATEGORIES) {
    const topics = TOPICS[category.name];
    if (!topics) throw new Error(`categoria sem assuntos: ${category.name}`);
    const used = topics.map(() => new Set());
    const categoryCount = new Map();
    for (let index = 0; index < category.size; index += 1) {
      sequence += 1;
      const topicIndex = index % topics.length;
      const format = FORMAT_CYCLE[index % FORMAT_CYCLE.length];
      const options = APPROACHES_BY_FORMAT[format];
      const offset = (Math.floor(index / topics.length) + topicIndex) % options.length;
      const rotated = [...options.slice(offset), ...options.slice(0, offset)];
      // Entre as abordagens ainda livres para o assunto, a menos usada na categoria e no pacote.
      const score = (key) => (categoryCount.get(key) ?? 0) * 10 + (globalCount.get(key) ?? 0);
      const approachKey = rotated.filter((key) => !used[topicIndex].has(key)).reduce((best, key) => (best === undefined || score(key) < score(best) ? key : best), undefined);
      if (!approachKey) throw new Error(`sem abordagem livre para ${category.name} #${index}`);
      used[topicIndex].add(approachKey);
      categoryCount.set(approachKey, (categoryCount.get(approachKey) ?? 0) + 1);
      globalCount.set(approachKey, (globalCount.get(approachKey) ?? 0) + 1);
      ideas.push(buildIdea({ category, topic: topics[topicIndex], approachKey, format, id: `VWX-${String(sequence).padStart(3, "0")}`, priority: index < 8 ? "high" : "normal" }));
    }
  }
  return ideas;
}

/** Datas sugeridas: um dia útil por pauta a partir de START_DATE, intercalando categorias e formatos. */
function assignSuggestedDates(ideas) {
  const byCategory = new Map();
  for (const idea of ideas) byCategory.set(idea.category, [...(byCategory.get(idea.category) ?? []), idea]);
  // Fila ponderada: cada categoria aparece na proporção do seu tamanho, prioridade alta primeiro.
  const queue = [...ideas].sort((a, b) => {
    const rank = (idea) => (byCategory.get(idea.category).indexOf(idea) + 0.5) / byCategory.get(idea.category).length;
    return (a.priority === b.priority ? 0 : a.priority === "high" ? -1 : 1) || rank(a) - rank(b);
  });
  const ordered = [];
  while (queue.length) {
    const previous = ordered[ordered.length - 1];
    const before = ordered[ordered.length - 2];
    const run = previous && before && previous.format === before.format ? previous.format : undefined;
    let index = queue.findIndex((idea) => idea.category !== previous?.category && idea.format !== run);
    if (index < 0) index = Math.max(0, queue.findIndex((idea) => idea.category !== previous?.category));
    ordered.push(...queue.splice(index, 1));
  }
  const date = new Date(`${START_DATE}T00:00:00Z`);
  for (const idea of ordered) {
    while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
    idea.suggestedDate = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 1);
  }
}

const ideas = buildIdeas();
assignSuggestedDates(ideas);
const pack = { schema: "vorix.editorial-pack/v1", workspace: "Vorix Works", generatedFrom: "scripts/editorial/build-vorix-works-pack.mjs", total: ideas.length, ideas };
writeFileSync(OUTPUT, `${JSON.stringify(pack, null, 2)}\n`);
console.log(`${ideas.length} pautas → ${OUTPUT}`);
