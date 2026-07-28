import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyContentObjective,
  classifyRecommendedFormat,
  pipelineForRecommendedFormat,
  RECOMMENDED_CONTENT_FORMATS,
} from "../dist/shared/utils/content-format-classification.js";
import { normalize } from "../dist/shared/utils/skill-parsing.js";

test("pipelineForRecommendedFormat mapeia exatamente conforme a regra: imagem/carrossel/story -> imagem; reels/video -> vídeo", () => {
  assert.equal(pipelineForRecommendedFormat("imagem_unica"), "image");
  assert.equal(pipelineForRecommendedFormat("carrossel"), "image");
  assert.equal(pipelineForRecommendedFormat("story"), "image");
  assert.equal(pipelineForRecommendedFormat("reels"), "video");
  assert.equal(pipelineForRecommendedFormat("video"), "video");
});

test("RECOMMENDED_CONTENT_FORMATS cobre exatamente os 5 valores esperados, sem mais nem menos", () => {
  assert.deepEqual([...RECOMMENDED_CONTENT_FORMATS].sort(), ["carrossel", "imagem_unica", "reels", "story", "video"].sort());
});

test("classifyRecommendedFormat prioriza Story mesmo quando o texto também menciona vídeo (regressão do achado de criatividade)", () => {
  const text = normalize("crie um Story sobre vídeo de casamento para o Rumo ao Altar");
  const objective = classifyContentObjective(text);
  const format = classifyRecommendedFormat(text, objective);
  assert.equal(format, "story");
  assert.equal(pipelineForRecommendedFormat(format), "image");
});

test("classifyRecommendedFormat recomenda reels para demonstração de funcionalidade, mesmo sem a palavra 'vídeo'/'reels' no texto (regressão do achado de criatividade)", () => {
  const text = normalize("crie um post mostrando como funciona o site de casamento do Rumo ao Altar");
  const objective = classifyContentObjective(text);
  assert.equal(objective, "demonstracao");
  const format = classifyRecommendedFormat(text, objective);
  assert.equal(format, "reels");
  assert.equal(pipelineForRecommendedFormat(format), "video");
});

test("classifyRecommendedFormat é uma função pura: mesma entrada sempre produz a mesma saída", () => {
  const text = normalize("crie um carrossel sobre lista de presentes com taxa zero");
  const objective1 = classifyContentObjective(text);
  const objective2 = classifyContentObjective(text);
  assert.equal(objective1, objective2);
  assert.equal(classifyRecommendedFormat(text, objective1), classifyRecommendedFormat(text, objective2));
});
