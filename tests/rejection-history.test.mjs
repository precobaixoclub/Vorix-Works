import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const ROOT = process.cwd();
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { computeRejectionPatternPenalty } = await imp("dist/infrastructure/footage-acquisition/rejection-history.js");

test("computeRejectionPatternPenalty: histórico vazio nunca penaliza", () => {
  const result = computeRejectionPatternPenalty({ author: "Fulano", originPageUrl: "https://www.pexels.com/video/woman-using-phone-111/" }, []);
  assert.equal(result.penalty, 0);
  assert.deepEqual(result.matchedReasons, []);
});

test("computeRejectionPatternPenalty: penaliza candidato do MESMO autor de uma rejeição anterior com padrão conhecido", () => {
  const history = [{ author: "Anna Tarazevich", originPageUrl: "https://www.pexels.com/video/woman-using-smartphone-8066973/", rejectionPattern: "visual_false_positive" }];
  const result = computeRejectionPatternPenalty({ author: "Anna Tarazevich", originPageUrl: "https://www.pexels.com/video/completamente-outro-video-222/" }, history);
  assert.ok(result.penalty > 0);
  assert.match(result.matchedReasons[0], /mesmo autor/i);
});

test("computeRejectionPatternPenalty: penaliza candidato com ≥2 palavras em comum no título de uma rejeição anterior, mesmo autor diferente", () => {
  const history = [{ author: "Autor A", originPageUrl: "https://www.pexels.com/video/children-out-in-the-street-trick-or-treating-5856446/", rejectionPattern: "semantic_false_positive" }];
  const result = computeRejectionPatternPenalty({ author: "Autor B", originPageUrl: "https://www.pexels.com/video/children-playing-in-the-street-parade-777/" }, history);
  assert.ok(result.penalty > 0);
});

test("computeRejectionPatternPenalty: NUNCA penaliza por apenas 1 palavra em comum (evita falso match por termo genérico)", () => {
  const history = [{ author: "Autor A", originPageUrl: "https://www.pexels.com/video/woman-using-smartphone-111/", rejectionPattern: "visual_false_positive" }];
  const result = computeRejectionPatternPenalty({ author: "Autor B", originPageUrl: "https://www.pexels.com/video/man-cooking-dinner-222/" }, history);
  assert.equal(result.penalty, 0);
});

test("computeRejectionPatternPenalty: ignora entradas de histórico sem rejectionPattern (rejeição sem relação com conteúdo visual/semântico, ex.: licença)", () => {
  const history = [{ author: "Mesmo Autor", originPageUrl: "https://www.pexels.com/video/qualquer-coisa-333/" }];
  const result = computeRejectionPatternPenalty({ author: "Mesmo Autor", originPageUrl: "https://www.pexels.com/video/outra-coisa-444/" }, history);
  assert.equal(result.penalty, 0);
});

test("computeRejectionPatternPenalty: acumula penalidade de múltiplas entradas correspondentes, mas nunca ultrapassa o teto (40)", () => {
  const history = Array.from({ length: 10 }, () => ({ author: "Autor Repetido", originPageUrl: "https://www.pexels.com/video/x-1/", rejectionPattern: "semantic_false_positive" }));
  const result = computeRejectionPatternPenalty({ author: "Autor Repetido", originPageUrl: "https://www.pexels.com/video/y-2/" }, history);
  assert.ok(result.penalty <= 40);
});

test("computeRejectionPatternPenalty: nunca lança para URLs malformadas no histórico ou no candidato", () => {
  const history = [{ author: "A", originPageUrl: "not-a-url", rejectionPattern: "no_screen" }];
  assert.doesNotThrow(() => computeRejectionPatternPenalty({ author: "A", originPageUrl: "also-not-a-url" }, history));
});
