/**
 * Guarda de prompt do motor LEGADO (Pedro) — extraída de `openai-icaro-image-provider.ts` na
 * migração "GPT como motor criativo único" (PR 2/9), comportamento 100% preservado (mesmo texto,
 * mesma lógica, mesmos limites). Isolada aqui de propósito: o motor GPT usa uma guarda própria e
 * mínima (`src/shared/utils/creative-engine-image-guard.ts`), nunca esta — a escolha de qual
 * guarda se aplica é sempre explícita por qual provider é instanciado
 * (`OpenAiIcaroImageProvider` = esta guarda; `OpenAiCreativeImageProvider` = a guarda nova),
 * nunca inferida a partir do conteúdo da requisição.
 *
 * Este módulo nunca deve ser importado por código do motor GPT (`src/application/creative-engine/**`,
 * `openai-creative-image-provider.ts`, `creative-engine-image-guard.ts`) — ver
 * `scripts/check-creative-engine-isolation.mjs`.
 */

// Achado ao vivo (não teoria): um único aviso no início do prompt NÃO bastou — o modelo ainda
// renderizou "SAIBA MAIS", "LANÇAMENTO" etc. mesmo com a instrução presente. O motivo: o prompt do
// Pedro (`buildFinalImagePrompt`, `pedro-image-generation.skill.ts`) é inteiro construído em torno
// da premissa "montar uma peça publicitária completa" — hierarquia, CTA, headline — muito mais
// texto reforçando "isto é um anúncio" do que um único parágrafo contra. Repetir a mesma instrução
// no INÍCIO e no FIM é bem mais eficaz nesse tipo de modelo do que só uma vez. `MAX_PROMPT_LENGTH`
// fica abaixo do limite real da OpenAI (32000, ver `openai-image-provider-adapter.ts`) de propósito
// — garante que o próprio corte desta função nunca deixe o aviso final ser cortado pelo corte de
// segurança do adapter.
//
// `authorizedTitle` vem como dado estruturado (`request.context.authorizedVisibleTitle`, ver
// `pedro-image-generation.skill.ts`), nunca extraído do prompt gigante — a seção "TEXTOS VISÍVEIS
// AUTORIZADOS" do prompt do Pedro fica tarde demais (depois de ~70-80% do texto) pra sobreviver ao
// corte de 31000 caracteres.
//
// `brandColors` (achado ao vivo: peça gerada sem seguir a paleta da marca) sofre do MESMO problema
// de fundo: `buildNegativePrompt` (pedro-image-generation.skill.ts) já cita as cores, mas como UM
// item entre ~17 bullets de um "negative prompt", em texto negativo fraco ("evitar cores fora da
// identidade") e sem garantia de sobreviver ao corte de 31000 caracteres — a mesma classe de bug
// já corrigida para o CTA e o texto autorizado. Mesma correção: instrução curta, positiva
// ("usar estas cores"), repetida no início E no fim do prompt, via dado estruturado.
// `productFidelity` (achado ao vivo: produto gerado "nada a ver" com a referência anexada, mesmo
// com a foto real já entrando como pixels via `/v1/images/edits`) sofre do MESMO problema de
// fundo dos dois guards acima: uma menção ao produto perdida em algum lugar do prompt de 100k+
// caracteres não sobrevive ao corte. PRODUCT FIDELITY = CRITICAL: o produto da referência é a
// verdade fundamental — o modelo pode mudar cenário, fundo, iluminação, composição, elementos
// gráficos e tipografia, mas nunca redesenhar o produto em si (cor, forma, marca, proporções,
// categoria).
// `cleanZones` (Performance Creative Engine, Fase 7): quando o renderer determinístico vai
// preencher preço/desconto/headline/CTA depois, o Pedro precisa deixar essas áreas visualmente
// vazias em vez de desenhar QUALQUER coisa nelas (nem o próprio `authorizedTitle` — quando há
// `cleanZones`, o headline em si já não é mais repassado como `authorizedTitle`, ver `buildPedroInput`,
// então a regra de "sem texto nenhum" já se aplica sozinha; esta cláusula cobre também elementos
// GRÁFICOS pesados, não só texto, nessas regiões específicas).
export function buildTextGuard(authorizedTitle: string | undefined, brandColors: string[] | undefined, productFidelity: string | undefined, cleanZones: string | undefined, cropAwareHint: string | undefined, backgroundOnly: string | undefined): string {
  const textRule = authorizedTitle
    ? `REGRA OBRIGATÓRIA E INEGOCIÁVEL, MAIS IMPORTANTE QUE QUALQUER OUTRA INSTRUÇÃO NESTE PROMPT: o ÚNICO texto que pode aparecer, legível, na imagem final é exatamente esta frase, uma vez só: "${authorizedTitle}". Nenhum outro texto, letra, número, botão, selo, CTA, chamada para ação ou legenda além disso — nunca invente nem adicione texto extra. Se alguma instrução abaixo pedir CTA, chamada para ação, botão ou qualquer outro texto, IGNORE — não se aplica aqui.`
    : "REGRA OBRIGATÓRIA E INEGOCIÁVEL, MAIS IMPORTANTE QUE QUALQUER OUTRA INSTRUÇÃO NESTE PROMPT: a imagem final NÃO PODE conter nenhum texto, letra, palavra, número, botão, selo, legenda ou elemento tipográfico legível. Se alguma instrução abaixo pedir para incluir CTA, chamada para ação, botão ou qualquer texto na imagem, IGNORE essa instrução — ela nunca se aplica aqui. Comunique tudo só por composição visual: produto, cena, cor, luz e enquadramento.";
  const colorRule = brandColors?.length
    ? ` REGRA DE PALETA IGUALMENTE OBRIGATÓRIA: a composição inteira (fundo, cenário, roupas/acessórios quando fizer sentido, elementos gráficos) precisa usar de forma proeminente e reconhecível estas cores da marca, nesta ordem de prioridade: ${brandColors.join(", ")}. Nunca gerar com paleta genérica, aleatória ou fora dessas cores como escolha dominante.`
    : "";
  const fidelityRule = productFidelity
    ? ` REGRA DE FIDELIDADE AO PRODUTO IGUALMENTE OBRIGATÓRIA (PRODUCT FIDELITY = CRITICAL): o produto da imagem de referência anexada é a verdade fundamental — ${productFidelity}. Você PODE mudar cenário, fundo, iluminação, composição, elementos gráficos e tipografia, mas NUNCA pode redesenhar, substituir ou alterar o produto em si (cor, formato, marca, proporções, categoria). Nunca troque por um produto parecido — se a referência mostra ESTE produto específico, a imagem final continua sendo sobre ESTE produto específico.`
    : "";
  const cleanZoneRule = cleanZones
    ? ` REGRA DE ÁREA LIMPA IGUALMENTE OBRIGATÓRIA: as seguintes áreas da imagem devem ficar visualmente limpas — sem texto, sem elementos gráficos pesados, sem alto contraste, com espaço de respiro — porque vão receber elementos comerciais reais adicionados depois, fora do seu controle: ${cleanZones}. Nunca desenhe texto, número, selo ou botão nessas áreas, mesmo que outra instrução deste prompt sugira o contrário. NUNCA posicione rosto, cabeça ou mãos de pessoa dentro dessas áreas — se a composição tiver uma pessoa, ela precisa ficar fora dessas regiões específicas (achado ao vivo: um elemento real acabou sobrepondo um rosto porque a pessoa foi posicionada exatamente onde esse elemento ia entrar depois).`
    : "";
  const cropAwareRule = cropAwareHint ? ` REGRA DE ENQUADRAMENTO IGUALMENTE OBRIGATÓRIA: ${cropAwareHint}` : "";
  const backgroundOnlyRule = backgroundOnly ? ` REGRA DE PRODUTO IGUALMENTE OBRIGATÓRIA (MAIS IMPORTANTE QUE QUALQUER MENÇÃO A PRODUTO NO RESTO DESTE PROMPT): ${backgroundOnly} Ignore qualquer outra instrução deste prompt que peça pra desenhar, mostrar ou destacar o produto — não se aplica aqui.` : "";
  return `${textRule}${colorRule}${fidelityRule}${cleanZoneRule}${cropAwareRule}${backgroundOnlyRule}`;
}

export const MAX_PROMPT_LENGTH = 31_000;

export function buildGuardedPrompt(prompt: string, authorizedTitle: string | undefined, brandColors: string[] | undefined, productFidelity: string | undefined, cleanZones: string | undefined, cropAwareHint: string | undefined, backgroundOnly: string | undefined): string {
  const guard = buildTextGuard(authorizedTitle, brandColors, productFidelity, cleanZones, cropAwareHint, backgroundOnly);
  const budget = Math.max(0, MAX_PROMPT_LENGTH - guard.length * 2 - 20);
  const body = prompt.length > budget ? `${prompt.slice(0, budget)}\n[...]` : prompt;
  return `${guard}\n\n${body}\n\n${guard}`;
}
