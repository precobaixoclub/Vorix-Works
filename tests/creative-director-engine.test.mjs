import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  deriveCampaignCreativeDNA,
  isWeddingOrganizationTheme,
  summarizeCreativeDNA,
} from "../dist/shared/utils/creative-director-engine.js";

const DNA_STRING_FIELDS = [
  "bigIdea",
  "centralMessage",
  "dominantEmotion",
  "secondaryEmotion",
  "mainPromise",
  "emotionalPromise",
  "heroScene",
  "heroFrame",
  "visualMetaphor",
  "emotionalHook",
  "storyArc",
  "heroColorMood",
  "heroLighting",
  "heroComposition",
  "narrativePace",
  "desiredAudienceFeeling",
  "expectedMemoryAfterViewing",
];

const DNA_ARRAY_FIELDS = ["creativeRisks", "thingsToAvoid", "visualKeywords", "narrativeKeywords"];

function assertCompleteDna(dna) {
  for (const field of DNA_STRING_FIELDS) {
    assert.equal(typeof dna[field], "string", `campo ${field} deveria ser string`);
    assert.ok(dna[field].trim().length > 0, `campo ${field} não deveria estar vazio`);
  }
  for (const field of DNA_ARRAY_FIELDS) {
    assert.ok(Array.isArray(dna[field]), `campo ${field} deveria ser array`);
    assert.ok(dna[field].length > 0, `campo ${field} não deveria estar vazio`);
  }
}

// ---------------------------------------------------------------------------------------------
// Geração do Campaign DNA — arquétipo específico reconhecido (casamento/organização)
// ---------------------------------------------------------------------------------------------

test("deriveCampaignCreativeDNA reconhece o arquétipo casamento/organização e devolve um DNA completo e específico", () => {
  const dna = deriveCampaignCreativeDNA({
    originalRequest: "Vocês cuidam do amor. Nós cuidamos da organização.",
    objective: "vender o site de casamento",
    centralPromise: "Um casamento all-inclusive sem estresse para os noivos.",
    valueProposition: "Curadoria completa de fornecedores premiados.",
    toneOfVoice: "leve divertido persuasivo",
    targetAudience: "Noivos e convidados de casamento",
    keyMessages: ["Tudo incluído, do buffet à decoração."],
    brandName: "Rumo ao Altar",
  });

  assertCompleteDna(dna);
  assert.ok(dna.heroScene.includes("cerimônia"));
  assert.ok(dna.heroFrame.includes("celular"));
  assert.ok(dna.visualMetaphor.includes("primeiro plano"));
  assert.equal(dna.dominantEmotion, "leveza");
  assert.equal(dna.secondaryEmotion, "alívio");
  assert.ok(dna.bigIdea.includes("Rumo ao Altar"));
});

test("deriveCampaignCreativeDNA só reconhece o arquétipo casamento/organização quando AMBOS os temas aparecem", () => {
  const onlyWedding = deriveCampaignCreativeDNA({ originalRequest: "Seu casamento merece um site oficial." });
  assert.ok(!onlyWedding.heroScene.includes("cerimônia"));

  const onlyOrganization = deriveCampaignCreativeDNA({ originalRequest: "Organizamos tudo para sua empresa com nosso ERP." });
  assert.ok(!onlyOrganization.heroFrame.includes("celular"));

  const both = deriveCampaignCreativeDNA({ originalRequest: "O casamento é sobre amor; a organização do RSVP é com a gente." });
  assert.ok(both.heroScene.includes("cerimônia"));
});

// ---------------------------------------------------------------------------------------------
// Geração do Campaign DNA — fallback genérico (compatibilidade com campanhas antigas/arbitrárias)
// ---------------------------------------------------------------------------------------------

test("deriveCampaignCreativeDNA cai no fallback genérico para uma campanha sem arquétipo reconhecido, mas ainda devolve um DNA completo", () => {
  const dna = deriveCampaignCreativeDNA({
    originalRequest: "Quero divulgar meu novo software de gestão financeira para pequenas empresas.",
    objective: "gerar leads qualificados",
    centralPromise: "Controle financeiro completo sem precisar de planilhas.",
    valueProposition: "Dashboard automático com conciliação bancária em tempo real.",
    toneOfVoice: "confiante direto",
    targetAudience: "Donos de pequenas empresas",
    keyMessages: ["Conciliação automática.", "Relatórios em um clique."],
    brandName: "FinControl",
  });

  assertCompleteDna(dna);
  assert.ok(dna.heroScene.includes("Controle financeiro completo sem precisar de planilhas"));
  assert.ok(dna.bigIdea.includes("FinControl"));
  assert.equal(dna.dominantEmotion, "confiança");
});

test("deriveCampaignCreativeDNA nunca lança exceção e sempre devolve um DNA completo mesmo sem nenhum campo de entrada (DNA ausente a montante)", () => {
  assert.doesNotThrow(() => deriveCampaignCreativeDNA({}));
  const dna = deriveCampaignCreativeDNA({});
  assertCompleteDna(dna);
});

test("deriveCampaignCreativeDNA produz um DNA completo mesmo com apenas originalRequest (caso do Eduardo, primeira Skill a rodar, e do Pedro, que nunca recebe joaoStrategy)", () => {
  const dna = deriveCampaignCreativeDNA({ originalRequest: "Quero um carrossel de lançamento do novo produto." });
  assertCompleteDna(dna);
});

// ---------------------------------------------------------------------------------------------
// Consistência entre Skills — mesma função pura, mesmo contexto de campanha, sem coordenação
// ---------------------------------------------------------------------------------------------

test("deriveCampaignCreativeDNA converge para o mesmo DNA quando Skills diferentes enviam subconjuntos distintos do mesmo contexto de campanha", () => {
  const sharedFields = {
    originalRequest: "Vocês cuidam do amor. Nós cuidamos da organização.",
    centralPromise: "Um casamento all-inclusive sem estresse para os noivos.",
    valueProposition: "Curadoria completa de fornecedores premiados.",
    toneOfVoice: "leve divertido persuasivo",
    targetAudience: "Noivos e convidados de casamento",
    keyMessages: ["Tudo incluído, do buffet à decoração."],
  };

  // Vanessa/Diego/Rafa enviam objective + brandName; Nora não envia nem objective nem brandName.
  const asVanessaDiegoRafa = deriveCampaignCreativeDNA({ ...sharedFields, objective: "vender o pacote", brandName: "Rumo ao Altar" });
  const asNora = deriveCampaignCreativeDNA({ ...sharedFields });

  assert.equal(asVanessaDiegoRafa.heroScene, asNora.heroScene);
  assert.equal(asVanessaDiegoRafa.dominantEmotion, asNora.dominantEmotion);
  assert.equal(asVanessaDiegoRafa.visualMetaphor, asNora.visualMetaphor);
});

test("deriveCampaignCreativeDNA é determinística: o mesmo input sempre produz o mesmo DNA", () => {
  const input = {
    originalRequest: "Quero divulgar meu novo produto.",
    centralPromise: "Economize tempo todos os dias.",
    targetAudience: "Profissionais ocupados",
  };

  assert.deepEqual(deriveCampaignCreativeDNA(input), deriveCampaignCreativeDNA(input));
});

// ---------------------------------------------------------------------------------------------
// isWeddingOrganizationTheme / summarizeCreativeDNA
// ---------------------------------------------------------------------------------------------

test("isWeddingOrganizationTheme exige menção a casamento/noivos/cerimônia E a organização/organizar", () => {
  assert.equal(isWeddingOrganizationTheme({ originalRequest: "Seu casamento merece um site oficial." }), false);
  assert.equal(isWeddingOrganizationTheme({ originalRequest: "Organizamos sua rotina com nosso app." }), false);
  assert.equal(isWeddingOrganizationTheme({ originalRequest: "Cuidamos da organização do seu casamento." }), true);
  assert.equal(isWeddingOrganizationTheme({ originalRequest: "Noivos, deixem a organização com a gente." }), true);
});

test("summarizeCreativeDNA devolve um resumo de uma linha com Big Idea, emoção dominante e metáfora visual", () => {
  const dna = deriveCampaignCreativeDNA({ originalRequest: "Cuidamos da organização do seu casamento." });
  const summary = summarizeCreativeDNA(dna);

  assert.equal(typeof summary, "string");
  assert.equal(summary.split("\n").length, 1);
  assert.ok(summary.includes(dna.bigIdea));
  assert.ok(summary.includes(dna.dominantEmotion));
  assert.ok(summary.includes(dna.visualMetaphor));
});

// ---------------------------------------------------------------------------------------------
// Isolamento arquitetural — src/shared não é uma Skill (ADR 0002): nunca deve importar de
// src/skills, nem depender de nada além de outros utilitários compartilhados.
// ---------------------------------------------------------------------------------------------

test("creative-director-engine.ts nunca importa de src/skills nem de nenhuma Skill específica (ADR 0002)", async () => {
  const source = await readFile("src/shared/utils/creative-director-engine.ts", "utf8");
  const importLines = source.split("\n").filter((line) => line.trim().startsWith("import"));

  assert.ok(importLines.length > 0);
  for (const line of importLines) {
    assert.ok(!line.includes("/skills/"), `import inesperado de uma Skill: ${line}`);
  }
});

test("creative-director-engine não mantém estado nem faz I/O: é uma função pura (mesma entrada, mesma saída, sem efeitos colaterais)", () => {
  const input = { originalRequest: "Campanha de teste.", centralPromise: "Promessa de teste." };
  const before = deriveCampaignCreativeDNA(input);
  deriveCampaignCreativeDNA({ originalRequest: "Outra campanha completamente diferente sobre carros elétricos." });
  const after = deriveCampaignCreativeDNA(input);

  assert.deepEqual(before, after);
});
