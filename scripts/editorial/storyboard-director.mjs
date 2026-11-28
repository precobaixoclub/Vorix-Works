// DIRETOR DE STORYBOARD (Codex): três propostas criativas DIFERENTES para uma pauta de vídeo, antes de
// qualquer render. Cada proposta é escrita no vocabulário do Spot (planos, câmera, transições, texto, som)
// e validada/pontuada/compilada por `src/application/video-editing/spot-storyboard.ts`.
//
// O Codex NÃO escolhe a vencedora nem declara padrão comercial: a seleção usa critérios medidos e a
// aprovação final é humana (ver docs/video-reformulacao-criativa.md).
import { NARRATIVE_ROLES, SPOT_FRAMINGS, SPOT_LANGUAGES, SPOT_SHOT_KINDS, SPOT_TRANSITIONS } from "../../dist/application/video-editing/spot-storyboard.js";

const str = (max = 400) => ({ type: "string", maxLength: max });
const obj = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });

function proposalSchema() {
  return storyboardSchema().properties.proposals.items;
}

/** Refação direcionada: só a proposta escolhida volta, corrigida nas pendências apontadas. */
export function revisionSchema() {
  return obj({ proposal: proposalSchema(), changes: { type: "array", minItems: 1, maxItems: 10, items: str(240) } });
}

/**
 * Pede ao diretor a correção da proposta ESCOLHIDA: as pendências vêm medidas (validação/QA do
 * storyboard) e/ou de pessoas. Mantém conceito e linguagem; muda só o necessário.
 */
export function revisionPrompt({ proposal, issues, notes = [] }) {
  return [
    "Você é o mesmo diretor de criação. A proposta abaixo foi ESCOLHIDA, mas o storyboard renderizado mostrou pendências.",
    "Corrija SOMENTE o necessário, mantendo o id, o conceito, a linguagem, a paleta e o tratamento de áudio. Não invente fatos.",
    "", "PENDÊNCIAS (medidas pelo motor ou observadas no storyboard):", ...issues.map((i) => `- ${i}`),
    ...(notes.length ? ["", "OBSERVAÇÕES:", ...notes.map((n) => `- ${n}`)] : []),
    "", "PROPOSTA ATUAL (JSON):", JSON.stringify(proposal),
    "", "Devolva a proposta corrigida completa e a lista do que mudou. Responda só o JSON do schema.",
  ].join("\n");
}

export function storyboardSchema() {
  const text = obj({ role: { type: "string", enum: ["headline", "kicker", "label", "cta", "body", "caption"] }, text: str(90) });
  const scene = obj({
    kind: { type: "string", enum: [...SPOT_SHOT_KINDS] },
    purpose: str(160),
    beats: { type: "integer", minimum: 2, maximum: 12 },
    materials: { type: "array", maxItems: 3, items: str(20) },
    camera: obj({ from: { type: "string", enum: [...SPOT_FRAMINGS] }, to: { type: "string", enum: [...SPOT_FRAMINGS] } }),
    texts: { type: "array", maxItems: 4, items: text },
    placement: { type: "string", enum: ["top", "bottom", "center"] },
    transition: { type: "string", enum: [...SPOT_TRANSITIONS] },
    field: { type: "string", enum: ["dark", "light", "accent", "fabric"] },
    focus: { type: "boolean" },
    storyboardNote: str(300),
    role: { type: "string", enum: [...NARRATIVE_ROLES] },
    narration: obj({ line: str(110), pauseAfterMs: { type: "integer", minimum: 0, maximum: 600 }, delivery: str(120), intent: { type: "string", enum: ["curiosidade", "surpresa", "entusiasmo", "explicacao", "emocao", "chamada"] } }),
  });
  const proposal = obj({
    id: { type: "string", enum: ["P1", "P2", "P3"] },
    title: str(80),
    concept: str(500),
    script: { type: "array", minItems: 3, maxItems: 8, items: str(160) },
    language: { type: "string", enum: [...SPOT_LANGUAGES] },
    emphasis: { type: "string", enum: ["color", "block"] },
    align: { type: "string", enum: ["left", "center"] },
    artDirection: str(600),
    animationLanguage: str(600),
    audioTreatment: obj({ mood: { type: "string", enum: ["elegant", "pop", "cinematic"] }, bpm: { type: "integer", minimum: 84, maximum: 128 }, notes: str(300) }),
    fromStructureReference: str(400),
    fromAestheticReference: str(400),
    materialsNeeded: { type: "array", maxItems: 8, items: str(120) },
    technicalResources: { type: "array", maxItems: 8, items: str(120) },
    limitations: { type: "array", maxItems: 6, items: str(200) },
    scenes: { type: "array", minItems: 4, maxItems: 9, items: scene },
    campaignKind: { type: "string", enum: ["moda", "tecnologia", "casamento", "ofertas"] },
    voiceDirection: str(240),
    conceptDevice: str(160),
  });
  return obj({ proposals: { type: "array", minItems: 3, maxItems: 3, items: proposal } });
}

const KINDS = {
  type_mask: "TIPOGRAFIA VAZADA: uma ou duas palavras GIGANTES (headline) com a FOTO dentro das letras; as letras chegam e depois a máscara se abre até a foto inteira. Revela o produto pela palavra.",
  editorial_split: "COMPOSIÇÃO EDITORIAL ASSIMÉTRICA: a foto num painel de ~60% (enquadramento pela câmera) com profundidade (a foto anda mais devagar que o painel) e uma coluna tipográfica (kicker + headline) com filetes; como página de revista.",
  hook_type: "GANCHO: frase curta GIGANTE já no 1º quadro, entrando de perto com desfoque de movimento, sobre o detalhe da foto (materials: 1 foto; camera detail/macro). Sem quadro vazio.",
  trace_draw: "O TRAÇO SE DESENHA: a estampa real (recorte da foto, cores originais) é revelada ao longo da linha com uma ponta de luz, em campo de cor; no fim pousa exatamente onde está na camiseta do plano seguinte (use transition match_print no plano seguinte). Ideal para estampa de traço/lettering.",
  print_assemble: "A ESTAMPA SE MONTA: cada elemento da estampa (recortado da foto) entra numa meia batida e a estampa pousa no produto do plano seguinte (match_print). Ideal para estampa de ícones.",
  fullbleed: "FOTO EM TELA CHEIA com câmera com intenção (camera from→to), texto legível pela luz da foto; focus=true desenha colchetes de foco na estampa.",
  macro: "MACRO da estampa com textura do tecido, deriva lenta e brilho que atravessa.",
  bands: "COMPARAÇÃO EMPILHADA: 2 ou 3 fotos em faixas horizontais, a estampa no centro de cada faixa, mesma escala; texts role=label viram os rótulos (ex.: A, B) em bloco de destaque.",
  countdown: "CONTAGEM 3-2-1 sobre a comparação empilhada (as fotos continuam na tela), um número por batida (beats ≥ 3).",
  variant_cycle: "TROCA DE COR com a estampa travada no mesmo lugar: faixa na cor da próxima peça varre o quadro a cada troca (2–3 fotos do MESMO modelo).",
  type_card: "CARTELA TIPOGRÁFICA em campo de cor da marca (use pouco: tira o produto da tela).",
  logo_resolve: "ASSINATURA: a logo oficial nasce de uma linha de luz, título curto e botão com a chamada (texts: headline + cta). materials só com fotos se a marca permitir cartões de foto.",
};

const TRANSITIONS = {
  morph: "a estampa CONTINUA de um plano para o outro (mesmo elemento muda de posição e tamanho): transição motivada pelo produto",
  cut: "corte seco na batida", color_wipe: "faixa de cor da marca varre e revela o próximo plano", mask_reveal: "o próximo plano abre do centro por máscara",
  iris_print: "o próximo plano abre em círculo a partir da estampa", match_print: "continuidade: a estampa fica no mesmo lugar e o resto aparece", dissolve: "fusão curta", slide_up: "o próximo plano sobe por cima",
};

/**
 * `references`: [{ role: "structure"|"aesthetic"|"both", label, note, guidance: string[], sheet }]
 * (`guidance` = linhas MEDIDAS por `referenceGuidance`; `sheet` = miniaturas que vão como imagem).
 */
export function storyboardPrompt({ idea, brand, materials, references = [], taste = { preferred: [], rejected: [] }, facts = [], feedback = [], genre }) {
  const lines = [];
  lines.push("Você é o diretor de criação E o editor audiovisual sênior de uma agência. Crie TRÊS propostas de vídeo vertical 9:16 para a pauta abaixo, antes de qualquer render.");
  lines.push("Como EDITOR: cada plano precisa justificar a duração e o que acrescenta à história; corte o que não acrescenta.");
  lines.push("Os três CONCEITOS precisam ser diferentes no DISPOSITIVO NARRATIVO (conceptDevice: o 'como a história é contada' — ex.: lupa de detetive, duelo, a linha que vira palavra, bastidor, contagem) e na proposta visual; variar só cores, fontes ou efeitos não conta.");
  if (genre) lines.push(`Ritmo do gênero: ${genre} (não use corte rápido como regra universal).`);
  if (feedback.length) lines.push("AVALIAÇÃO HUMANA da versão anterior desta pauta (obrigatório resolver):", ...feedback.map((f) => `- ${f}`));
  lines.push("", "PAUTA (real, do Bolsão da marca):");
  lines.push(`- Título: ${idea.title}`, `- Objetivo: ${idea.commercialObjective}`, `- Público: ${idea.targetAudience}`, `- Conceito: ${idea.concept}`, `- Direção visual: ${idea.visualDirection}`, `- Estrutura: ${idea.narrativeStructure}`, `- CTA: ${idea.cta}`);
  if (idea.videoScript?.length) lines.push(`- Roteiro sugerido: ${idea.videoScript.map((s) => `[${s.time}] ${s.text} (${s.visual})`).join(" | ")}`);
  if (idea.creativePrompt) lines.push(`- Regras de arte da pauta: ${idea.creativePrompt}`);
  lines.push("", `MARCA: ${brand.name}. Tom: ${brand.tone}. Cores: escuro ${brand.palette.dark}, claro ${brand.palette.light}, destaque ${brand.palette.accent}. Fonte de título: ${brand.display}. Logo oficial disponível no fim.`);
  lines.push("Fatos que podem aparecer em texto (NÃO invente nenhum outro: preço, frete, prazo, material, depoimento, promoção):", ...facts.map((f) => `- ${f}`));
  lines.push("", "MATERIAIS (só estes; as imagens anexadas mostram cada um):", ...materials.map((m) => `- ${m.id}: ${m.label}`));
  if (references.length) {
    lines.push("", "VÍDEOS DE REFERÊNCIA (medidos pelo motor; as miniaturas vão anexadas). Use a LINGUAGEM, nunca copie textos, layouts ou cenas:");
    for (const ref of references) {
      lines.push(`- ${ref.label} — papel: ${ref.role === "structure" ? "ESTRUTURA (gancho, ritmo, cortes, progressão, texto curto, CTA)" : ref.role === "aesthetic" ? "ESTÉTICA (composição, elegância, transições, organização, acabamento)" : "estrutura e estética"}${ref.note ? `. Pedido do cliente: ${ref.note}` : ""}`);
      for (const g of ref.guidance) lines.push(`    · ${g}`);
      if (ref.observed?.length) for (const o of ref.observed) lines.push(`    · observado nas miniaturas: ${o}`);
    }
  }
  lines.push("", "VOCABULÁRIO DE PLANOS (kind):", ...Object.entries(KINDS).map(([k, v]) => `- ${k}: ${v}`));
  lines.push("Enquadramentos (camera.from/to): full (corpo), chest (peito), print (estampa a 74% da largura), macro (estampa a 92%), detail (um terço da estampa, bem perto), top, bottom.");
  lines.push("Transições:", ...Object.entries(TRANSITIONS).map(([k, v]) => `- ${k}: ${v}`));
  lines.push("Campos de cor (field): dark, light, accent ou fabric (a cor da peça).");
  lines.push("Enquadramento detail2 = outra parte da estampa (o lado direito), para uma segunda pista.");
  lines.push("Papel narrativo (role) de cada plano: hook, clue (pista), question, tension, reveal, proof (prova do produto), offer, cta. Nenhum plano sem função; nenhum plano repetindo o anterior.");
  lines.push("", "REGRAS:");
  lines.push("1. As três propostas precisam ser VISUALMENTE DISTINTAS: linguagens diferentes (editorial, graphic, cinematic — uma de cada), aberturas diferentes e sequências de planos diferentes. Proibido entregar variações pequenas da mesma ideia.");
  lines.push("2. Todas unem a referência de ESTRUTURA (prender nos primeiros segundos, progressão clara, texto curto, CTA claro) com a de ESTÉTICA (visual limpo e premium, transições coordenadas, organização dos elementos) — com a identidade da marca.");
  lines.push("3. Gancho: o 1º plano tem no máximo 2 s e um título de até 4 palavras. Nada de tela vazia ou fade do preto.");
  lines.push("4. Ritmo: planos de 1,2 a 3 s (máx. 4,2 s; só a troca de cor e a assinatura podem passar). Duração total entre 14 e 22 s. A duração é em BATIDAS (beats) do andamento escolhido (bpm 96–124): o corte cai na batida.");
  lines.push("5. Movimento com intenção: nenhum plano parado; mas não acumule efeitos — no máximo 3 tipos de transição por proposta.");
  lines.push("6. Produto: as fotos são oficiais — nunca peça para recolorir, redesenhar, escurecer ou distorcer a estampa. A estampa é a protagonista. Mostre a peça inteira pelo menos uma vez.");
  lines.push("7. Texto: frases curtas; marque a palavra de ênfase com *asteriscos*; caption = legenda em pílula que acende palavra a palavra (use em 1 ou 2 planos, no máximo); label em bands = letra da opção.");
  lines.push("8. Último plano: logo_resolve com headline curto e cta (a chamada da pauta). Não repita a pergunta do gancho depois da resposta: feche com a resposta/benefício e a ação.");
  lines.push("", "IMPACTO (anúncio que performa, não demonstração de efeitos):");
  lines.push("- O 1º quadro já é o gancho: um detalhe intrigante + pergunta ou afirmação curta; o som bate junto.");
  lines.push("- Curiosidade e progressão: cada plano entrega UMA informação nova (pista → pista → pergunta → tensão → revelação → prova → CTA).");
  lines.push("- Ritmo VARIÁVEL: pistas rápidas (2–3 batidas), um respiro antes da revelação, impacto na revelação, fechamento que respira.");
  lines.push("- Em quiz/revelação, PRESERVE O MISTÉRIO: antes do plano reveal, mostre só fragmentos (detail/detail2) e a comparação; o traço/estampa completo e a peça inteira aparecem só a partir da revelação (ex.: trace_draw como PAGAMENTO da revelação).");
  lines.push("- Texto na tela: no máximo 5 palavras por plano. Animação só quando conta algo.");
  lines.push("", "NARRAÇÃO (escrita para VOZ humana, em português do Brasil falado):");
  lines.push("- Uma fala curta por plano (até 10 palavras) ou vazia quando o plano deve respirar.");
  lines.push("- TEXTO DA TELA = PALAVRAS DA FALA: o headline/caption de um plano com fala usa as MESMAS palavras ditas naquele plano (um trecho da fala, na mesma ordem) — o texto aparece palavra a palavra no instante em que é falado. Nunca escreva na tela uma frase diferente da que a voz diz.");
  lines.push("- intent de cada fala: curiosidade, surpresa, entusiasmo, explicacao, emocao ou chamada — é o que define velocidade, entonação final e respiro. Publicidade: frases curtas, ritmo de conversa ágil, sem reticências e sem pausas dramáticas longas (pauseAfterMs ≤ 250, exceto antes da revelação).");
  lines.push("- Frases como alguém diria a um amigo: 'Olha esse traço.', 'Pensa rápido.', 'Era a A.' Use reticências para suspense e *asteriscos* na palavra de ênfase.");
  lines.push("- pauseAfterMs = respiro depois da fala; delivery = como dizer (ex.: 'baixo, curioso', 'sorrindo, com certeza').");
  lines.push("- campaignKind define a interpretação: moda (envolvente e sofisticada), tecnologia (clara, segura, dinâmica), casamento (acolhedora, emocional), ofertas (enérgica sem soar artificial). voiceDirection resume a voz em uma frase.");
  if (taste.rejected.length || taste.preferred.length) lines.push(`9. Preferências da marca registradas por humanos — evite: ${taste.rejected.join(", ") || "—"}; prefira: ${taste.preferred.join(", ") || "—"}.`);
  lines.push("", "Em cada proposta preencha: conceito, roteiro (frases), cenas (storyboardNote descreve o quadro como um storyboard), direção de arte, linguagem de animação, tratamento de áudio (mood/bpm), o que vem de cada referência, materiais necessários, recursos técnicos e limitações previstas (o que só filmagem real ou outra foto resolveria).");
  lines.push("Responda só o JSON do schema.");
  return lines.join("\n");
}
