import test from "node:test";
import assert from "node:assert/strict";
import { parseEditorialPack } from "../dist/domain/editorial/editorial-idea.model.js";
import { buildEditorialTemplateCsv, editorialCsvToPack, EDITORIAL_SHEET_COLUMNS } from "../dist/domain/editorial/editorial-spreadsheet.js";

test("Modelo de planilha: round-trip (baixar modelo → importar → pautas válidas, um de cada formato)", () => {
  const csv = buildEditorialTemplateCsv();
  assert.ok(csv.startsWith("﻿"), "CSV com BOM UTF-8");
  const pack = editorialCsvToPack(csv);
  const ideas = parseEditorialPack(pack);
  assert.equal(ideas.length, 3);
  const byFormat = Object.fromEntries(ideas.map((idea) => [idea.format, idea]));
  assert.ok(byFormat.single_image && byFormat.carousel && byFormat.video, "os três formatos presentes");
  assert.ok(Array.isArray(byFormat.carousel.carouselScript) && byFormat.carousel.carouselScript.length >= 2, "carrossel com telas decodificadas");
  assert.equal(byFormat.carousel.carouselScript[0].headline.length > 0, true);
  assert.equal(byFormat.carousel.carouselScript[0].body.length > 0, true);
  assert.ok(Array.isArray(byFormat.video.videoScript) && byFormat.video.videoScript.length >= 2, "vídeo com cenas decodificadas");
  assert.ok(byFormat.video.videoScript[0].time && byFormat.video.videoScript[0].visual && byFormat.video.videoScript[0].text);
});

test("Importar planilha: CSV mínimo manual (imagem única) vira pauta válida", () => {
  const headers = EDITORIAL_SHEET_COLUMNS.join(",");
  const row = [
    "ID-1", "Título teste", "Categoria", "Objetivo comercial", "Público-alvo",
    "Conceito da pauta", "Mensagem principal", "single_image", "Abordagem",
    "Direção visual", "Estrutura narrativa", "Legenda do post", "Chamada para ação",
    "high", "", "", "", "",
  ].map((v) => `"${v}"`).join(",");
  const ideas = parseEditorialPack(editorialCsvToPack(`${headers}\n${row}\n`));
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0].externalId, "ID-1");
  assert.equal(ideas[0].priority, "high");
});

test("Importar planilha: coluna obrigatória ausente falha com mensagem clara", () => {
  const csv = "id,title\nX-1,Só título\n";
  assert.throws(() => editorialCsvToPack(csv), /faltam colunas obrigatórias/);
});

test("Importar planilha: carrossel sem roteiro é recusado pela validação do pacote", () => {
  const headers = EDITORIAL_SHEET_COLUMNS.join(",");
  const row = [
    "ID-2", "Carrossel", "Cat", "Obj", "Publico", "Conceito", "Mensagem",
    "carousel", "Abordagem", "Visual", "Narrativa", "Legenda", "CTA",
    "normal", "", "", "", "",
  ].map((v) => `"${v}"`).join(",");
  assert.throws(() => parseEditorialPack(editorialCsvToPack(`${headers}\n${row}\n`)), /carrossel sem roteiro/);
});

test("Parser CSV: campo entre aspas com vírgula e quebra de linha é preservado", () => {
  const headers = EDITORIAL_SHEET_COLUMNS.join(",");
  const caption = "Linha um, com vírgula\nLinha dois";
  const row = [
    "ID-3", "Título", "Cat", "Obj", "Publico", "Conceito", "Mensagem",
    "single_image", "Abordagem", "Visual", "Narrativa", caption, "CTA",
    "normal", "", "", "", "",
  ].map((v) => `"${v.replace(/"/g, '""')}"`).join(",");
  const ideas = parseEditorialPack(editorialCsvToPack(`${headers}\r\n${row}\r\n`));
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0].caption, caption);
});

test("Importar planilha: cabeçalhos aceitam variação de caixa e ordem é irrelevante por nome", () => {
  const csv = [
    "TITLE,ID,FORMAT,CATEGORY,commercialObjective,targetAudience,CONCEPT,keyMessage,approach,visualDirection,narrativeStructure,CAPTION,cta",
    '"T","A-1","single_image","C","O","P","Conceito","Msg","Ab","Vis","Narr","Leg","CTA"',
  ].join("\n");
  const ideas = parseEditorialPack(editorialCsvToPack(csv));
  assert.equal(ideas[0].externalId, "A-1");
  assert.equal(ideas[0].title, "T");
});
