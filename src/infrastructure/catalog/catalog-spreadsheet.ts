import ExcelJS from "exceljs";
import AdmZip from "adm-zip";
import type { BulkDownload } from "../../application/ports/catalog-bulk.port.js";

export const MAX_CATALOG_ROWS=50_000;
export const MAX_CATALOG_BYTES=20*1024*1024;
const MAX_COLUMNS=80,MAX_CELL=16_000,MAX_EXPANDED=100*1024*1024;
export type CatalogSheet={headers:string[];rows:{line:number;cells:string[]}[]};
const fail=(message:string):never=>{throw new Error(`BULK_VALIDATION: ${message}`);};
export function parseCatalogCsv(bytes:Buffer):CatalogSheet{
 const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes).replace(/^\uFEFF/,"");
 let commas=0,semicolons=0,inHeaderQuotes=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(inHeaderQuotes&&text[i+1]==='"')i++;else inHeaderQuotes=!inHeaderQuotes;}else if(!inHeaderQuotes){if(c==="\n"||c==="\r")break;if(c===",")commas++;if(c===";")semicolons++;}}
 const delimiter=semicolons>commas?";":",";
 const records:{line:number;cells:string[]}[]=[];let cells:string[]=[],cell="",quoted=false,closed=false,line=1,start=1;
 const finishCell=()=>{if(cell.length>MAX_CELL)fail("Célula excede 16 mil caracteres.");cells.push(cell);cell="";closed=false;if(cells.length>MAX_COLUMNS)fail("Máximo de 80 colunas.");};
 const finishRow=()=>{finishCell();if(cells.some(v=>v.trim()))records.push({line:start,cells});cells=[];start=line+1;if(records.length>MAX_CATALOG_ROWS+1)fail("Máximo de 50 mil linhas por arquivo.");};
 for(let i=0;i<text.length;i++){
  const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else{cell+=c;if(c==="\n")line++;}continue;}
  if(c==='"'){if(cell||closed)fail(`Aspas inválidas na linha ${line}.`);quoted=true;}
  else if(c===delimiter)finishCell();
  else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;finishRow();line++;}
  else{if(closed)fail(`Texto após aspas na linha ${line}.`);cell+=c;}
  if(cell.length>MAX_CELL)fail("Célula excede 16 mil caracteres.");
 }
 if(quoted)fail("Aspas não fechadas no CSV.");if(cell||cells.length||closed)finishRow();
 return validateSheet(records);
}
function validateSheet(records:{line:number;cells:string[]}[]):CatalogSheet{
 if(records.length<2)fail("Inclua cabeçalhos e pelo menos uma linha de dados.");
 const headers=records[0].cells.map(h=>h.trim());
 if(headers.some(h=>!h||h.length>160)||new Set(headers).size!==headers.length)fail("Cabeçalhos devem ser preenchidos e únicos, com até 160 caracteres.");
 for(const row of records.slice(1))if(row.cells.length>headers.length)fail(`Linha ${row.line} tem mais células que o cabeçalho.`);
 return {headers,rows:records.slice(1).map(r=>({...r,cells:headers.map((_,i)=>r.cells[i]??"")}))};
}
export async function readCatalogSheet(name:string,bytes:Buffer):Promise<CatalogSheet>{
 if(!bytes.length||bytes.length>MAX_CATALOG_BYTES)fail("Envie um arquivo de até 20 MB.");
 if(/\.csv$/i.test(name))return parseCatalogCsv(bytes);
 if(!/\.xlsx$/i.test(name))fail("Use XLSX ou CSV UTF-8.");
 const zip=new AdmZip(bytes);const entries=zip.getEntries();
 if(entries.length>1000||entries.reduce((n:number,e:{header:{size:number}})=>n+e.header.size,0)>MAX_EXPANDED)fail("XLSX expandido excede o limite permitido.");
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
 const sheet=workbook.worksheets[0];if(!sheet)fail("Planilha vazia.");
 if(sheet.rowCount>MAX_CATALOG_ROWS+1||sheet.columnCount>MAX_COLUMNS)fail("Limite: 50 mil linhas e 80 colunas.");
 const records:{line:number;cells:string[]}[]=[];
 sheet.eachRow((row,line)=>{
  const cells:string[]=[];for(let i=1;i<=sheet.columnCount;i++){
   const cell=row.getCell(i);if(cell.type===ExcelJS.ValueType.Formula||cell.type===ExcelJS.ValueType.Error)fail(`Fórmula/erro na linha ${line}: substitua pelo valor.`);
   const text=cell.text;if(text.length>MAX_CELL)fail(`Célula muito longa na linha ${line}.`);cells.push(text);
  }
  if(cells.some(v=>v.trim()))records.push({line,cells});
 });
 return validateSheet(records);
}
export async function writeCatalogSheet(format:"csv"|"xlsx",headers:string[],rows:AsyncIterable<string[]>|Iterable<string[]>,basename="produtos"):Promise<BulkDownload>{
 if(format==="csv"){
  const escape=(v:string)=>`"${(/^[\s]*[=+\-@\t\r]/.test(v)?"'":"")+v.replace(/"/g,'""')}"`;
  const lines=[headers.map(escape).join(";")];for await(const row of rows){if(lines.length>MAX_CATALOG_ROWS)fail("Exportação excede 50 mil linhas. Use filtros para dividir o catálogo.");lines.push(row.map(escape).join(";"));}
  return {filename:`${basename}.csv`,contentType:"text/csv; charset=utf-8",bytes:Buffer.from("\uFEFF"+lines.join("\r\n"))};
 }
 const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet("Produtos");sheet.addRow(headers);sheet.getRow(1).font={bold:true};sheet.views=[{state:"frozen",ySplit:1}];
 for await(const row of rows){if(sheet.rowCount>MAX_CATALOG_ROWS)fail("Exportação excede 50 mil linhas. Use filtros para dividir o catálogo.");sheet.addRow(row);}sheet.columns.forEach(column=>{column.width=22;column.numFmt="@";});
 return {filename:`${basename}.xlsx`,contentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",bytes:Buffer.from(await workbook.xlsx.writeBuffer())};
}
