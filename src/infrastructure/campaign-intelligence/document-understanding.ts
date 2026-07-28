import AdmZip from "adm-zip";
// pdf-parse e mammoth não publicam types próprios usados aqui — importados via require() do
// runtime ESM/CJS interop já usado em outros pontos do projeto para pacotes CJS sem `exports`
// compatível (mesmo raciocínio de `ffmpeg-static`).
import { createRequire } from "node:module";
import type { CampaignFile, DocumentAnalysis } from "../../domain/campaign-intelligence/campaign-intelligence.model.js";

/**
 * Document Understanding (seção 5): PDF (`pdf-parse`), DOCX (`mammoth`), PPTX/XLSX (o formato
 * Office Open XML é um ZIP de XML — `adm-zip` + extração de texto por regex sobre as tags de texto
 * conhecidas, sem dependência pesada, já que não existe biblioteca PPTX madura e leve para Node).
 * Tudo estruturado em headlines/paragraphs/lists/tables — nunca só o texto bruto despejado.
 */

const require = createRequire(import.meta.url);

const BULLET_PATTERN = /^\s*([-•*]|\d+[.)])\s+/;

function structureText(rawText: string): { headlines: string[]; paragraphs: string[]; lists: string[][] } {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headlines: string[] = [];
  const paragraphs: string[] = [];
  const lists: string[][] = [];
  let currentList: string[] = [];

  const flushList = () => {
    if (currentList.length >= 2) lists.push(currentList);
    currentList = [];
  };

  for (const line of lines) {
    if (BULLET_PATTERN.test(line)) {
      currentList.push(line.replace(BULLET_PATTERN, "").trim());
      continue;
    }
    flushList();
    if (line.length <= 70 && !line.endsWith(".") && !line.endsWith(",")) {
      headlines.push(line);
    } else {
      paragraphs.push(line);
    }
  }
  flushList();

  return { headlines, paragraphs, lists };
}

export async function analyzePdf(file: CampaignFile): Promise<DocumentAnalysis> {
  const pdfParse = require("pdf-parse");
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(file.absolutePath);
  const result = await pdfParse(buffer);
  const structured = structureText(result.text ?? "");
  return { fileId: file.id, pageCount: result.numpages, text: result.text ?? "", ...structured, tables: [] };
}

export async function analyzeDocx(file: CampaignFile): Promise<DocumentAnalysis> {
  const mammoth = require("mammoth");
  const result = await mammoth.extractRawText({ path: file.absolutePath });
  const structured = structureText(result.value ?? "");
  return { fileId: file.id, text: result.value ?? "", ...structured, tables: [] };
}

function extractXmlTextRuns(xml: string, tagName: string): string[] {
  const pattern = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, "g");
  const runs: string[] = [];
  for (const match of xml.matchAll(pattern)) {
    const text = match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    if (text) runs.push(text);
  }
  return runs;
}

export async function analyzePptx(file: CampaignFile): Promise<DocumentAnalysis> {
  const zip = new AdmZip(file.absolutePath);
  const slideEntries = zip.getEntries()
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
    .sort((a, b) => slideNumber(a.entryName) - slideNumber(b.entryName));

  const lists: string[][] = [];
  const allText: string[] = [];
  for (const entry of slideEntries) {
    const xml = entry.getData().toString("utf8");
    const runs = extractXmlTextRuns(xml, "a:t");
    if (runs.length > 0) lists.push(runs);
    allText.push(...runs);
  }

  const headlines = lists.map((slideRuns) => slideRuns[0]).filter(Boolean);
  const paragraphs = allText.filter((text) => !headlines.includes(text));

  return { fileId: file.id, slideCount: slideEntries.length, text: allText.join("\n"), headlines, paragraphs, lists, tables: [] };
}

export async function analyzeXlsx(file: CampaignFile): Promise<DocumentAnalysis> {
  const zip = new AdmZip(file.absolutePath);
  const sharedStringsEntry = zip.getEntry("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsEntry ? extractXmlTextRuns(sharedStringsEntry.getData().toString("utf8"), "t") : [];

  const sheetEntries = zip.getEntries()
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.entryName))
    .sort((a, b) => slideNumber(a.entryName) - slideNumber(b.entryName));

  const tables: string[][][] = [];
  for (const entry of sheetEntries) {
    const xml = entry.getData().toString("utf8");
    const rows: string[][] = [];
    const rowPattern = /<row[^>]*>([\s\S]*?)<\/row>/g;
    for (const rowMatch of xml.matchAll(rowPattern)) {
      const cellPattern = /<c[^>]*(?:t="([^"]*)")?[^>]*>(?:<v>([^<]*)<\/v>)?<\/c>/g;
      const cells: string[] = [];
      for (const cellMatch of rowMatch[1].matchAll(cellPattern)) {
        const [, type, value] = cellMatch;
        if (value === undefined) { cells.push(""); continue; }
        cells.push(type === "s" ? (sharedStrings[Number.parseInt(value, 10)] ?? "") : value);
      }
      if (cells.some(Boolean)) rows.push(cells);
    }
    if (rows.length > 0) tables.push(rows);
  }

  const text = tables.flat(2).filter(Boolean).join(" ");
  return { fileId: file.id, text, headlines: [], paragraphs: [], lists: [], tables };
}

function slideNumber(entryName: string): number {
  const match = entryName.match(/(\d+)\.xml$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}
