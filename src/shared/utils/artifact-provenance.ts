/**
 * Proveniência de artefato — migração "GPT como motor criativo único" (PR 3/9). Torna
 * estrutural (não apenas documentado em comentário) que conteúdo fallback/placeholder/debug nunca
 * seja tratado como peça publicável. Todo `ArtifactDeliveryPort.writeFile()`/`createZip()` passa a
 * exigir este campo (quebra de compilação proposital nos call sites existentes) — quem escreve um
 * arquivo declara, no mesmo lugar, se ele pode virar entrega final.
 */
export const ARTIFACT_PRODUCERS = [
  /** Pixels/texto realmente gerados por uma chamada de IA (Pedro, Nora em modo API real, etc.). */
  "real_ai_generation",
  /** Saída do motor criativo GPT (`src/application/creative-engine/**`). */
  "gpt_creative_engine",
  /** Composição determinística real a partir de dados/assets reais (caption/metadata/html de
   * entrega, relatórios técnicos, ZIP de carrossel, overlay Satori+sharp) — nunca fabricado. */
  "deterministic_composition",
  /** Caixa de dispositivo HTML/CSS com o texto do prompt escrito na tela (`mockup_generation`,
   * Autonomous Engine) — self-documentado como "nunca para publicação". */
  "placeholder_mockup",
  /** Narração sintetizada por voz local (SAPI) como fallback (`narration_regeneration`,
   * Autonomous Engine) — mesmo espírito de `placeholder_mockup`. */
  "synthetic_narration",
  /** Pacote de trabalho (prompt/contexto/schema) entregue a um humano/IDE para intervenção
   * assistida — nunca o conteúdo final em si (esse chega por fora do `ArtifactDeliveryPort`,
   * lido via `readFile`, e por isso nunca tem sidecar de proveniência). */
  "developer_assisted",
] as const;
export type ArtifactProducer = (typeof ARTIFACT_PRODUCERS)[number];

export type ArtifactProvenance = {
  producer: ArtifactProducer;
  publishable: boolean;
  /** Motivo legível — obrigatório sempre que `publishable: false`, por convenção dos call sites
   * (não imposto no tipo para não acoplar a validação de negócio ao shape de dado). */
  reason?: string;
};

/** Fail-closed: só considera publicável quando a proveniência está presente E diz
 * explicitamente `publishable: true`. Use onde o próprio código deveria sempre ter escrito o
 * artefato via `ArtifactDeliveryPort` — ausência de proveniência ali é sinal de bug, nunca
 * presumida publicável. */
export function isPublishable(provenance: ArtifactProvenance | undefined): boolean {
  return provenance?.publishable === true;
}

export function assertPublishable(provenance: ArtifactProvenance | undefined, context: string): void {
  if (isPublishable(provenance)) return;
  const detail = provenance
    ? `proveniência "${provenance.producer}" marcada publishable=false${provenance.reason ? ` (motivo: ${provenance.reason})` : ""}`
    : "proveniência ausente";
  throw new Error(`NON_PUBLISHABLE_ARTIFACT: ${context} — ${detail}.`);
}

/** Fail-open: só rejeita quando existe proveniência EXPLÍCITA marcando `publishable: false`.
 * Use nos poucos pontos (intervenção assistida — Pedro/Nora lendo um arquivo que um humano/IDE
 * salvou por fora do `ArtifactDeliveryPort`) onde a AUSÊNCIA de proveniência é o caso normal e
 * legítimo, nunca um sinal de problema — só a presença de uma tag negativa explícita (ex.: o
 * `mockup_generation` escreveu por cima do mesmo caminho esperado) deve bloquear a aceitação. */
export function isExplicitlyNonPublishable(provenance: ArtifactProvenance | undefined): boolean {
  return provenance !== undefined && provenance.publishable === false;
}
