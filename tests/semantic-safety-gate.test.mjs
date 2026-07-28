import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const ROOT = process.cwd();
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { evaluateSemanticSafetyPreDownload, evaluateSemanticSafetyPostAnalysis, runAssistedSemanticCheckIfConfigured } = await imp("dist/infrastructure/footage-acquisition/semantic-safety-gate.js");

// Casos reais e comprovados desta saga (URLs verdadeiras encontradas na validação real da sprint anterior).
const REAL_HALLOWEEN_URL = "https://www.pexels.com/video/children-out-in-the-street-trick-or-treating-5856446/";
const REAL_PHONE_URL = "https://www.pexels.com/video/a-person-using-a-smartphone-app-to-order-food-online-13441336/";
const REAL_UNRELATED_URL = "https://www.pexels.com/video/ants-on-the-wall-5000184/";

test("evaluateSemanticSafetyPreDownload: bloqueia fantasia/Halloween usando o caso real que causou o falso positivo comprovado da sprint anterior", () => {
  const result = evaluateSemanticSafetyPreDownload({ originPageUrl: REAL_HALLOWEEN_URL });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /fantasia|halloween/i);
});

test("evaluateSemanticSafetyPreDownload: nunca bloqueia um candidato genuinamente compatível (caso real true positive)", () => {
  const result = evaluateSemanticSafetyPreDownload({ originPageUrl: REAL_PHONE_URL });
  assert.equal(result.blocked, false);
  assert.equal(result.riskFlag, false);
});

test("evaluateSemanticSafetyPreDownload: título totalmente não relacionado (sem palavra proibida) não é bloqueado por este gate — outros sinais (rejection-history/score) cobrem esse caso", () => {
  const result = evaluateSemanticSafetyPreDownload({ originPageUrl: REAL_UNRELATED_URL });
  assert.equal(result.blocked, false);
});

test("evaluateSemanticSafetyPreDownload: bloqueia conteúdo religioso quando o Shot NÃO é sobre cerimônia (mesmo bug original desta saga: 'padre rezando' para Shot de celular)", () => {
  const result = evaluateSemanticSafetyPreDownload({
    originPageUrl: "https://www.pexels.com/video/priest-praying-in-a-chapel-1234567/",
    shotContext: { narrativeGoal: "mostrar facilidade", mainAction: "casal usando celular", protagonist: "casal recém-noivos" },
  });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /religios/i);
});

test("evaluateSemanticSafetyPreDownload: NÃO bloqueia conteúdo religioso quando o Shot é, ele mesmo, sobre a cerimônia", () => {
  const result = evaluateSemanticSafetyPreDownload({
    originPageUrl: "https://www.pexels.com/video/priest-praying-in-a-chapel-1234567/",
    shotContext: { narrativeGoal: "cerimônia de casamento", mainAction: "padre conduzindo cerimônia", protagonist: "celebrante" },
  });
  assert.equal(result.blocked, false);
});

test("evaluateSemanticSafetyPreDownload: sem shotContext, a checagem religiosa é pulada por segurança (nunca aplicada com contexto adivinhado)", () => {
  const result = evaluateSemanticSafetyPreDownload({ originPageUrl: "https://www.pexels.com/video/priest-praying-in-a-chapel-1234567/" });
  assert.equal(result.blocked, false);
});

test("evaluateSemanticSafetyPreDownload: sinaliza riskFlag (não bloqueia) para objetos que mimetizam tela (quadro/janela/TV)", () => {
  const result = evaluateSemanticSafetyPreDownload({ originPageUrl: "https://www.pexels.com/video/painting-hanging-on-a-wall-9999999/" });
  assert.equal(result.blocked, false);
  assert.equal(result.riskFlag, true);
});

test("evaluateSemanticSafetyPreDownload: URL sem slug reconhecível não bloqueia nem sinaliza (nunca inventa texto)", () => {
  const result = evaluateSemanticSafetyPreDownload({ originPageUrl: "not-a-valid-url" });
  assert.equal(result.blocked, false);
  assert.equal(result.riskFlag, false);
});

test("evaluateSemanticSafetyPostAnalysis: força needs_human_review quando riskFlag textual coincide com detecção visual positiva", () => {
  const result = evaluateSemanticSafetyPostAnalysis({ riskFlag: true, visualStage: "compositing_candidate" });
  assert.equal(result.forceHumanReview, true);
});

test("evaluateSemanticSafetyPostAnalysis: nunca força revisão quando não há riskFlag textual, mesmo com detecção visual positiva", () => {
  const result = evaluateSemanticSafetyPostAnalysis({ riskFlag: false, visualStage: "compositing_candidate" });
  assert.equal(result.forceHumanReview, false);
});

test("evaluateSemanticSafetyPostAnalysis: nunca força revisão quando há riskFlag mas a validação visual não encontrou nada (sem sinal visual para combinar)", () => {
  const result = evaluateSemanticSafetyPostAnalysis({ riskFlag: true, visualStage: "no_device_detected" });
  assert.equal(result.forceHumanReview, false);
});

test("runAssistedSemanticCheckIfConfigured: nunca chama nada quando nenhum classificador é injetado (undefined é o padrão honesto)", async () => {
  const result = await runAssistedSemanticCheckIfConfigured("qualquer texto");
  assert.equal(result, undefined);
});

test("runAssistedSemanticCheckIfConfigured: chama o classificador injetado quando presente", async () => {
  const result = await runAssistedSemanticCheckIfConfigured("texto suspeito", async (text) => ({ suspicious: true, reason: `analisado: ${text}` }));
  assert.deepEqual(result, { suspicious: true, reason: "analisado: texto suspeito" });
});
