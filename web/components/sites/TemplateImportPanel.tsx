"use client";
import {useRef,useState} from "react";
import useSWR from "swr";
import {toast} from "sonner";
import {AlertTriangle,CheckCircle2,Download,FileArchive,FileText,Upload,XCircle} from "lucide-react";
import {Button} from "@/components/Button";
import {ConfirmDialog} from "@/components/ConfirmDialog";
import {getImportedTemplate,importTemplatePackage,listImportedTemplates,removeImportedTemplate,validateTemplatePackage} from "@/features/sites/api";
import {applyImportedTemplate,type ImportedTemplateSummary,type TemplateIssue,type TemplateReport} from "@/features/sites/imported-template";
import type {SiteSnapshot,TenantSite} from "@/features/sites/types";
import {cn} from "@/lib/utils";

const DOCS_URL="/modelos/importar";
const EXAMPLE_URL="/site-assets/vorix-modelo-exemplo.zip";
const errorText=(error:unknown,fallback:string)=>error instanceof Error?error.message.replace(/^[A-Z_]+:\s*/,""):fallback;

/** Relatório em texto simples, para a pessoa (ou quem fez o modelo) corrigir o pacote. */
export function reportAsText(fileName:string,report:TemplateReport){
 const line=(issue:TemplateIssue)=>`- [${issue.code}] ${issue.file?`${issue.file}${issue.line?`, linha ${issue.line}`:""}: `:""}${issue.message}${issue.hint?`\n  Como corrigir: ${issue.hint}`:""}`;
 return [`Relatório do Pacote de Modelo Vorix — ${fileName}`,`Resultado: ${report.ok?"aprovado para importar":"não pode ser importado"}`,`Arquivos: ${report.summary.files} · Seções: ${report.summary.sections} · Páginas: ${report.summary.pages} · Imagens: ${report.summary.assets}`,"",`Erros (${report.errors.length})`,...report.errors.map(line),"",`Avisos (${report.warnings.length})`,...report.warnings.map(line),"",`Documentação: https://vorixworks.com${DOCS_URL}`].join("\n");
}

export function TemplateImportPanel({site,draft,canManage,onApply}:{site:TenantSite;draft:SiteSnapshot;canManage:boolean;onApply:(next:SiteSnapshot)=>void}){
 const input=useRef<HTMLInputElement>(null);
 const [file,setFile]=useState<File>(),[busy,setBusy]=useState<"validate"|"import"|string>(),[result,setResult]=useState<{file:string;report:TemplateReport;imported?:boolean}>();
 const [applying,setApplying]=useState<ImportedTemplateSummary>(),[removing,setRemoving]=useState<ImportedTemplateSummary>();
 const {data:templates,mutate,error}=useSWR(["site-imported-templates",site.id],()=>listImportedTemplates(site));
 const inUse=new Set([draft.theme.importedTemplateId,site.published?.theme.importedTemplateId].filter(Boolean));

 async function run(kind:"validate"|"import"){
  if(!file)return;setBusy(kind);
  try{
   if(kind==="validate"){const {report}=await validateTemplatePackage(site,file);setResult({file:file.name,report});}
   else{const response=await importTemplatePackage(site,file);setResult({file:file.name,report:response.report,imported:response.imported});if(response.imported){toast.success(`Modelo “${response.template?.name}” importado. Clique em “Usar este modelo” para aplicar.`);setFile(undefined);await mutate();}}
  }catch(caught){toast.error(errorText(caught,"Não foi possível enviar o pacote."));}
  finally{setBusy(undefined);}
 }
 async function apply(template:ImportedTemplateSummary,withContent:boolean){
  setBusy(template.id);
  try{const detail=await getImportedTemplate(site,template.id);onApply(applyImportedTemplate(draft,{id:detail.id,package:detail.package},withContent));setApplying(undefined);toast.success(withContent?"Modelo aplicado com o conteúdo dele. Edite à vontade e publique quando estiver pronto.":"Aparência do modelo aplicada ao seu conteúdo. Publique quando estiver pronto.");}
  catch(caught){toast.error(errorText(caught,"Não foi possível aplicar o modelo."));}
  finally{setBusy(undefined);}
 }

 return <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5" aria-labelledby="template-import-title">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div className="min-w-0 max-w-2xl"><h2 id="template-import-title" className="text-base font-semibold">Importar modelo externo</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Traga um site criado fora do Vorix no formato <strong className="text-foreground">Pacote de Modelo Vorix</strong> (.zip). O pacote é conferido antes: se algo não estiver de acordo, nada é importado e você vê o motivo de cada problema. Depois de importado, tudo é editado aqui, com os recursos do Vorix.</p></div>
   <div className="flex flex-wrap gap-2"><a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"><FileText size={14}/>Documentação</a><a href={EXAMPLE_URL} download className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"><Download size={14}/>Pacote de exemplo</a></div>
  </div>
  <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-3 sm:flex-row sm:items-center">
   <input ref={input} type="file" accept=".zip,application/zip" className="hidden" aria-label="Escolher pacote do modelo (.zip)" onChange={event=>{const next=event.target.files?.[0];event.target.value="";if(next){setFile(next);setResult(undefined);}}}/>
   <button type="button" disabled={!canManage||!!busy} onClick={()=>input.current?.click()} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left text-sm disabled:opacity-50"><FileArchive size={18} className="shrink-0 text-muted-foreground"/><span className="min-w-0 truncate">{file?<><strong>{file.name}</strong> <span className="text-muted-foreground">· {(file.size/1024/1024).toFixed(1).replace(".",",")} MB</span></>:<span className="text-muted-foreground">Escolha o arquivo .zip do modelo</span>}</span></button>
   <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={!canManage||!!busy} onClick={()=>input.current?.click()}><Upload size={14}/>{file?"Trocar arquivo":"Escolher .zip"}</Button><Button size="sm" variant="secondary" disabled={!canManage||!file||!!busy} loading={busy==="validate"} onClick={()=>void run("validate")}>Só validar</Button><Button size="sm" disabled={!canManage||!file||!!busy} loading={busy==="import"} onClick={()=>void run("import")}>Validar e importar</Button></div>
  </div>
  {!canManage?<p className="text-xs text-muted-foreground">Seu perfil permite visualizar. Peça a um administrador para importar modelos.</p>:null}
  {result?<ValidationReport fileName={result.file} report={result.report} imported={result.imported}/>:null}
  <div className="space-y-2">
   <h3 className="text-sm font-semibold">Modelos importados</h3>
   {error?<Button size="sm" variant="secondary" onClick={()=>void mutate()}>Tentar carregar de novo</Button>:!templates?<p className="text-xs text-muted-foreground">Carregando...</p>:!templates.length?<p className="text-xs text-muted-foreground">Nenhum modelo importado ainda.</p>:<ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{templates.map(template=><li key={template.id} className="overflow-hidden rounded-lg border border-border/60">
    <div className="aspect-[3/2] bg-muted/40">{/* eslint-disable-next-line @next/next/no-img-element */}{template.previewUrl?<img src={template.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover"/>:<span className="flex h-full items-center justify-center text-xs text-muted-foreground">Sem pré-visualização</span>}</div>
    <div className="space-y-2 p-3"><div className="flex items-start justify-between gap-2"><p className="min-w-0 text-sm font-semibold">{template.name} <span className="font-normal text-muted-foreground">v{template.version}</span></p>{draft.theme.importedTemplateId===template.id?<span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">Em uso</span>:null}</div>
     <p className="text-xs text-muted-foreground">{[template.author,`${template.sections} seções com desenho próprio`,template.pages?`${template.pages} página(s)`:undefined].filter(Boolean).join(" · ")}</p>
     {template.description?<p className="line-clamp-2 text-xs text-muted-foreground">{template.description}</p>:null}
     <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!canManage||!!busy} loading={busy===template.id} onClick={()=>setApplying(template)}>Usar este modelo</Button><Button size="sm" variant="ghost" disabled={!canManage||!!busy||inUse.has(template.id)} title={inUse.has(template.id)?"Em uso no rascunho ou no site publicado":undefined} onClick={()=>setRemoving(template)}>Remover</Button></div>
    </div></li>)}</ul>}
  </div>
  <ConfirmDialog open={!!applying} title={`Usar o modelo ${applying?.name??""}?`} description="Com o conteúdo do modelo, a página inicial, as páginas e o menu do pacote substituem os atuais no rascunho. Só a aparência mantém seu conteúdo e aplica cores, fontes e o desenho das seções. Nada muda no site publicado até você publicar, e “Restaurar versão em produção” desfaz." confirmLabel="Usar com o conteúdo do modelo" secondaryLabel="Só a aparência" secondaryVariant="primary" busy={busy===applying?.id} onCancel={()=>setApplying(undefined)} onConfirm={()=>applying?apply(applying,true):undefined} onSecondary={()=>applying?apply(applying,false):undefined}/>
  {removing?<ConfirmDialog open title={`Remover o modelo ${removing.name}?`} description="O modelo sai da lista. O conteúdo do seu site não é apagado; para usar o modelo de novo, importe o pacote outra vez." confirmLabel="Remover modelo" variant="danger" onCancel={()=>setRemoving(undefined)} onConfirm={async()=>{try{await removeImportedTemplate(site,removing.id);await mutate();setRemoving(undefined);toast.success("Modelo removido.");}catch(caught){toast.error(errorText(caught,"Não foi possível remover."));}}}/>:null}
 </section>;
}

export function ValidationReport({fileName,report,imported}:{fileName:string;report:TemplateReport;imported?:boolean}){
 const groups=new Map<string,TemplateIssue[]>();for(const issue of report.errors)groups.set(issue.file??"Pacote",[...(groups.get(issue.file??"Pacote")??[]),issue]);
 const download=()=>{const url=URL.createObjectURL(new Blob([reportAsText(fileName,report)],{type:"text/plain;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download=`relatorio-${fileName.replace(/\.zip$/i,"")}.txt`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <div role="status" aria-live="polite" className={cn("space-y-3 rounded-lg border p-3",report.ok?"border-success/40 bg-success/5":"border-destructive/40 bg-destructive/5")}>
  <div className="flex flex-wrap items-start gap-2">
   {report.ok?<CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success"/>:<XCircle size={18} className="mt-0.5 shrink-0 text-destructive"/>}
   <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{report.ok?imported?"Pacote aprovado e importado.":"Pacote aprovado: pode ser importado.":`${report.errors.length} ${report.errors.length===1?"problema impede":"problemas impedem"} a importação`}</p><p className="text-xs text-muted-foreground">{fileName} · {report.summary.files} arquivos · {report.summary.sections} seções · {report.summary.pages} página(s) · {report.summary.assets} imagens{report.warnings.length?` · ${report.warnings.length} aviso(s)`:""}</p></div>
   <Button size="sm" variant="ghost" onClick={download}><Download size={14}/>Baixar relatório</Button>
  </div>
  {!report.ok?<p className="text-xs leading-relaxed">Nada foi importado. Corrija os itens abaixo no pacote e envie de novo. Cada item diz onde está o problema e como resolver; os códigos estão explicados na <a href={`${DOCS_URL}#erros`} target="_blank" rel="noopener noreferrer" className="underline">documentação</a>.</p>:null}
  {[...groups].map(([group,issues])=><div key={group} className="space-y-1.5"><p className="break-all text-xs font-semibold">{group}</p><ul className="space-y-1.5">{issues.map((issue,index)=><IssueRow key={index} issue={issue}/>)}</ul></div>)}
  {report.warnings.length?<details className={cn(!report.ok&&"opacity-90")}><summary className="cursor-pointer text-xs font-medium">Avisos ({report.warnings.length}) — não impedem a importação</summary><ul className="mt-2 space-y-1.5">{report.warnings.map((issue,index)=><IssueRow key={index} issue={issue}/>)}</ul></details>:null}
 </div>;
}

function IssueRow({issue}:{issue:TemplateIssue}){
 return <li className="flex gap-2 rounded-md bg-background/60 p-2 text-xs">{issue.severity==="error"?<XCircle size={14} className="mt-0.5 shrink-0 text-destructive"/>:<AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning"/>}<div className="min-w-0 space-y-0.5"><p className="break-words"><span className="font-mono text-[10px] text-muted-foreground">{issue.code}</span>{issue.line?<span className="text-muted-foreground"> · linha {issue.line}</span>:null}</p><p className="break-words">{issue.message}</p>{issue.hint?<p className="break-words text-muted-foreground">Como corrigir: {issue.hint}</p>:null}</div></li>;
}
