import test from "node:test";
import assert from "node:assert/strict";
import { isUnrecoverableSemanticOcclusionFailure } from "../dist/interfaces/api/routes/v1/production.route.js";

// Bug ao vivo (Rodada 2, Fatia 3): uma reprovação por headline/badge/etc. cobrindo rosto/olhos que
// o Repair Loop já tentou e não resolveu não deveria disparar a 2ª tentativa automática de
// `POST /production/ideas/generate` — regenerar copy/estratégia do zero não conserta um problema
// de COMPOSIÇÃO FOTOGRÁFICA, e a 2ª tentativa inteira (~2min) só somava latência à mesma
// requisição HTTP síncrona (causa real do "erro de conexão" percebido em produção).

test("isUnrecoverableSemanticOcclusionFailure: reconhece a mensagem exata que evaluateSemanticOcclusion produz para rosto coberto", () => {
  const message = 'Peça não passou no quality gate — status "rejected" (nota 50/100). Principais motivos: Elemento "headline" sobre "face" (severe): O headline cobre completamente o rosto da pessoa, tornando-a irreconhecível.';
  assert.equal(isUnrecoverableSemanticOcclusionFailure(message), true);
});

test("isUnrecoverableSemanticOcclusionFailure: reconhece também para olhos cobertos", () => {
  const message = 'Principais motivos: Elemento "badge" sobre "eyes" (severe): O selo cobre os olhos do modelo.';
  assert.equal(isUnrecoverableSemanticOcclusionFailure(message), true);
});

test("isUnrecoverableSemanticOcclusionFailure: NÃO reconhece oclusão sobre produto (não é rosto/olhos) — regeneração continua valendo a pena", () => {
  const message = 'Principais motivos: Elemento "headline" sobre "product" (severe): A headline cobre a maior parte do produto.';
  assert.equal(isUnrecoverableSemanticOcclusionFailure(message), false);
});

test("isUnrecoverableSemanticOcclusionFailure: NÃO reconhece outras causas de reprovação (alucinação, tipografia) — regeneração continua valendo a pena", () => {
  assert.equal(isUnrecoverableSemanticOcclusionFailure('Condição comercial não confirmada na copy, sem evidência na referência: "frete grátis".'), false);
  assert.equal(isUnrecoverableSemanticOcclusionFailure('Zona "price" deveria ser uma linha única, mas quebrou em 2 linhas.'), false);
});

test("isUnrecoverableSemanticOcclusionFailure: undefined/vazio nunca bloqueia a regeneração (comportamento honesto — falta de sinal não é motivo pra pular)", () => {
  assert.equal(isUnrecoverableSemanticOcclusionFailure(undefined), false);
  assert.equal(isUnrecoverableSemanticOcclusionFailure(""), false);
});
