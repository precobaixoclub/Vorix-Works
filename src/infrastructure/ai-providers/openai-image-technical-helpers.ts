/**
 * Utilitários técnicos e neutros para chamadas de geração de imagem via OpenAI — nunca decisão
 * criativa/estética, só restrição de API e correção de enquadramento. Compartilhado pelo provider
 * legado (`openai-icaro-image-provider.ts`, Pedro) e pelo provider do motor GPT
 * (`openai-creative-image-provider.ts`) — extraído aqui na migração "GPT como motor criativo
 * único" (PR 2/9) para que nenhum dos dois precise depender do módulo de guarda do outro só para
 * reaproveitar isto.
 */

export async function fetchAsBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} ao baixar ${url}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// `gpt-image-1` só aceita 3 tamanhos fixos (mais "auto"): quadrado, retrato e paisagem — nunca a
// resolução exata que Sofia calcula por formato (`resolveAspectRatio`/`KNOWN_RESOLUTIONS`, ex.:
// 1080x1920 para Story). Achado ao vivo: antes disto, TODA imagem saía "1024x1024" fixo, mesmo
// quando o formato pedido era Story (9:16) ou carrossel vertical (4:5) — a peça ficava quadrada
// quando deveria ser vertical. Mapeia para o tamanho suportado mais próximo da proporção real.
export function resolveOpenAiImageSize(aspectRatio: string | undefined): "1024x1024" | "1024x1536" | "1536x1024" {
  const normalized = (aspectRatio ?? "").trim();
  if (normalized === "16:9") return "1536x1024";
  if (normalized === "9:16" || normalized === "4:5") return "1024x1536";
  return "1024x1024";
}

// Achado ao vivo (Rodada 2): mapear pra um tamanho suportado só resolve METADE do problema —
// "1024x1536" (2:3) não é "9:16" nem "4:5" de verdade, e o prompt ainda promete a proporção real
// ao modelo, que reconciliava as duas instruções desenhando barras (pillarboxing).
// `targetAspectRatio` (repassado em `params`, lido pelo adapter em `openai-image-provider-adapter.ts`)
// carrega a proporção REAL pedida para que o adapter corte o resultado, centralizado, pro valor
// exato antes de persistir — nunca conta com o modelo pra acertar sozinho uma proporção que a API
// não suporta nativamente. A outra metade da correção é este hint: quando o corte vai acontecer
// (proporção pedida ≠ tamanho nativo da OpenAI), o modelo precisa ser instruído a preencher o
// CANVAS REAL de ponta a ponta (nunca criar bordas/molduras/fundo sólido pra "simular" a proporção
// que ele acha que devia entregar) e manter o elemento principal numa faixa central seguramente
// dentro da área que sobrevive ao corte — sem isto, mesmo cortando depois, o modelo ainda tenta
// desenhar a "proporção errada" dentro do canvas certo, arriscando cortar o próprio produto/rosto
// se ele ficou desenhado perto da borda que o corte remove.
export function resolveCropAwareCompositionHint(aspectRatio: string | undefined, nativeSize: "1024x1024" | "1024x1536" | "1536x1024"): string | undefined {
  const normalized = (aspectRatio ?? "").trim();
  if (normalized !== "9:16" && normalized !== "4:5" && normalized !== "16:9") return undefined;
  const [nativeWidth, nativeHeight] = nativeSize.split("x");
  return `A imagem final será cortada automaticamente, de forma centralizada, para a proporção ${normalized} a partir deste canvas de ${nativeWidth}x${nativeHeight} pixels — as bordas mais distantes do centro (topo/base ou laterais, dependendo do corte) NÃO aparecerão no resultado final. Componha a cena preenchendo TODO o canvas de ${nativeWidth}x${nativeHeight} de ponta a ponta, sem bordas, molduras, tarjas ou fundo de cor sólida ao redor da cena para tentar simular outra proporção. Mantenha o elemento principal (produto, pessoa, rosto) centralizado, dentro da metade central do canvas, para que o corte automático nunca corte nada importante.`;
}
