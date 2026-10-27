"use client";
import {useEffect,useRef,useState} from "react";
import {Button} from "@/components/Button";
import {Input} from "@/components/Field";
import {Dialog,DialogContent,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {apiClient} from "@/lib/api-client";
import {availableBulkFields,bulkActionLabel,bulkPath,bulkStatusLabel,canConfirmBulk,downloadBulkFile,getBulkJob,getBulkRows,type BulkField,type BulkJob,type BulkRows} from "@/features/product-engine/bulk-api";

const selectClass="w-full min-w-0 rounded-md border border-border bg-background p-2 text-sm";
export function CatalogBulkTools({workspaceId,selectedIds,filters,canManage,canViewCost,isManager,inventoryManage,onSaved}:{workspaceId:string;selectedIds:string[];filters:Record<string,string>;canManage:boolean;canViewCost:boolean;isManager:boolean;inventoryManage:boolean;onSaved:()=>void}){
 const [open,setOpen]=useState(false),[job,setJob]=useState<BulkJob>(),[mapping,setMapping]=useState<Record<string,BulkField>>({}),[mode,setMode]=useState<"create"|"upsert"|"update">("upsert"),[createTaxonomy,setCreateTaxonomy]=useState(false);
 const [rows,setRows]=useState<BulkRows>(),[offset,setOffset]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(""),[format,setFormat]=useState("xlsx"),[editField,setEditField]=useState<BulkField>("active"),[editValue,setEditValue]=useState("true");
 const completed=useRef<string|undefined>(undefined),uploadKey=useRef<string|undefined>(undefined);
 const allowed=availableBulkFields({canViewCost,isManager,inventoryManage});
 const done=job&&["COMPLETED","COMPLETED_WITH_ERRORS"].includes(job.status);
 const accept=(next:BulkJob)=>{setJob(next);setMapping(next.mapping);setMode(next.options.mode);setCreateTaxonomy(next.options.createTaxonomy);setOffset(0);setRows(undefined);};
 async function action(run:()=>Promise<void>){if(busy)return;setBusy(true);setError("");try{await run();}catch(e){setError(e instanceof Error?e.message:"Falha na operação.");}finally{setBusy(false);}}
 useEffect(()=>{
  if(!job?.id)return;try{sessionStorage.setItem(`catalog-bulk:${workspaceId}`,job.id);}catch{}
  if(!["PENDING_PREVIEW","PENDING","PROCESSING"].includes(job.status))return;
  let active=true;const timer=setInterval(()=>{getBulkJob(workspaceId,job.id).then(next=>{if(active)setJob(next);}).catch(e=>{if(active)setError(e.message);});},1500);
  return()=>{active=false;clearInterval(timer);};
 },[job?.id,job?.status,workspaceId]);
 useEffect(()=>{if(done&&job&&completed.current!==job.id){completed.current=job.id;onSaved();}},[done,job,onSaved]);
 useEffect(()=>{if(!job||job.status==="MAPPING")return;let active=true;getBulkRows(workspaceId,job.id,offset).then(data=>{if(active)setRows(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[workspaceId,job?.id,job?.status,offset]);
 const show=()=>{setOpen(true);if(!job){try{const id=sessionStorage.getItem(`catalog-bulk:${workspaceId}`);if(id)void action(async()=>accept(await getBulkJob(workspaceId,id)));}catch{}}};
 return <>
  <div className="my-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
   {canManage?<Button variant="secondary" onClick={show}>Importar produtos</Button>:null}
   <select aria-label="Formato de exportação" className={`${selectClass} !w-auto`} value={format} onChange={e=>setFormat(e.target.value)}><option value="xlsx">XLSX</option><option value="csv">CSV</option></select>
   <Button variant="secondary" disabled={busy} onClick={()=>action(async()=>downloadBulkFile(workspaceId,`export?${new URLSearchParams({...filters,format})}`,`produtos.${format}`))}>Exportar produtos</Button>
   <Button variant="ghost" disabled={busy} onClick={()=>action(async()=>downloadBulkFile(workspaceId,`template?format=${format}`,`modelo-produtos.${format}`))}>Baixar modelo</Button>
   {canManage&&selectedIds.length>0?<div className="flex w-full flex-wrap items-end gap-2 border-t pt-3">
    <span className="w-full text-sm">{selectedIds.length} produtos selecionados</span>
    <label className="min-w-40 flex-1 text-xs">Ação em massa<select aria-label="Campo para edição em massa" className={selectClass} value={editField} onChange={e=>{setEditField(e.target.value as BulkField);setEditValue(["active","siteVisible"].includes(e.target.value)?"true":"");}}>
     <option value="active">Ativar/desativar</option><option value="siteVisible">Aparecer no site</option><option value="category">Categoria</option><option value="brand">Marca</option><option value="saleMode">Modo comercial</option><option value="price">Preço</option>{inventoryManage?<option value="stock">Saldo de estoque (sem variantes)</option>:null}
    </select></label>
    <label className="min-w-40 flex-1 text-xs">Novo valor{["active","siteVisible"].includes(editField)?<select aria-label="Novo valor" className={selectClass} value={editValue} onChange={e=>setEditValue(e.target.value)}><option value="true">Sim</option><option value="false">Não</option></select>:editField==="saleMode"?<select aria-label="Novo valor" className={selectClass} value={editValue} onChange={e=>setEditValue(e.target.value)}><option value="">Escolha</option>{["INHERIT_SITE_DEFAULT","SHOW_ONLY","WHATSAPP_DIRECT","WHATSAPP_CART","ONLINE_CHECKOUT"].map((v,i)=><option key={v} value={v}>{["Herdar do site","Somente exibir","WhatsApp direto","Carrinho WhatsApp","Checkout online"][i]}</option>)}</select>:<Input aria-label="Novo valor" value={editValue} onChange={e=>setEditValue(e.target.value)} placeholder={editField==="price"?"Ex.: 49,90":"Informe o valor"}/>}</label>
    <Button disabled={busy||!editValue} onClick={()=>action(async()=>{const next=await apiClient.post<BulkJob>(bulkPath(workspaceId,"edit"),{ids:selectedIds,field:editField,value:editValue,operationKey:crypto.randomUUID()});accept(next);setOpen(true);})}>Revisar alterações</Button>
   </div>:null}
  </div>
  {error&&!open?<p role="alert" className="mb-3 break-words text-sm text-destructive">{error}</p>:null}
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[92dvh] w-[calc(100%-1rem)] max-w-4xl overflow-y-auto p-4 sm:p-6">
   <DialogTitle>Importar produtos</DialogTitle><DialogDescription>Envie o arquivo, associe as colunas e revise o preview antes de confirmar.</DialogDescription>
   <p className="text-xs text-muted-foreground">XLSX ou CSV UTF-8 · até 20 MB / 50 mil linhas. Valores monetários em reais. Células vazias preservam o cadastro. Use [LIMPAR] em campos opcionais para removê-los. Para variantes, repita o SKU do produto e informe Cor/Tamanho ou opções em JSON.</p>
   {error?<p role="alert" className="break-words text-sm text-destructive">{error}</p>:null}
   <label className="space-y-2 rounded-lg border border-dashed p-4 text-sm">Escolher planilha ou enviar arquivo corrigido<Input type="file" accept=".xlsx,.csv" disabled={busy||Boolean(job&&["PENDING","PROCESSING"].includes(job.status))} onChange={e=>{const file=e.target.files?.[0];if(!file)return;uploadKey.current=crypto.randomUUID();void action(async()=>{if(file.size>20*1024*1024)throw Error("Arquivo excede 20 MB.");const form=new FormData();form.append("file",file);accept(await apiClient.upload<BulkJob>(bulkPath(workspaceId,"imports"),form,{headers:{"idempotency-key":uploadKey.current!}}));});e.target.value="";}}/></label>
   {job?<>
    <div role="status" aria-live="polite" className="rounded-lg bg-muted p-3"><p className="font-medium">{bulkStatusLabel[job.status]??job.status}</p><p className="text-sm">{job.summary.rows} linhas · {job.summary.newProducts} novos · {job.summary.updates} atualizações · {job.summary.ignored} ignoradas · {job.summary.warnings} avisos · {job.summary.errors} erros · {job.summary.duplicates} duplicidades</p>{["PENDING","PROCESSING"].includes(job.status)?<><progress className="mt-2 w-full" max={job.summary.rows||1} value={job.summary.processed}/><p className="text-xs">{job.summary.processed} de {job.summary.rows} linhas processadas. Você pode fechar esta janela.</p></>:null}{job.failure?<p className="text-destructive">{job.failure}</p>:null}</div>
    {["MAPPING","PREVIEW","FAILED"].includes(job.status)?<details open={job.status==="MAPPING"} className="space-y-3"><summary className="cursor-pointer text-sm font-medium">Mapeamento de colunas e configurações</summary><div className="space-y-3 pt-2">
     <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Operação<select aria-label="Modo de importação" className={selectClass} value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="create">Somente criar novos</option><option value="upsert">Criar e atualizar existentes</option><option value="update">Somente atualizar existentes</option></select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={createTaxonomy} onChange={e=>setCreateTaxonomy(e.target.checked)}/>Autorizar criação de categorias e marcas inexistentes</label></div>
     <div className="grid gap-2 sm:grid-cols-2">{job.headers.map((header,i)=><label key={header} className="min-w-0 rounded-lg border p-2 text-sm"><span className="block truncate font-medium" title={header}>{header}</span><span className="block truncate text-xs text-muted-foreground">Ex.: {job.sample[0]?.[i]||"(vazio)"}</span><select aria-label={`Mapear ${header}`} className={selectClass} value={mapping[header]??""} onChange={e=>{const next={...mapping};if(e.target.value)next[header]=e.target.value as BulkField;else delete next[header];setMapping(next);}}><option value="">Ignorar coluna</option>{allowed.map(([key,label])=><option key={key} value={key} disabled={Object.entries(mapping).some(([h,f])=>h!==header&&f===key)}>{label}</option>)}</select></label>)}</div>
     <Button disabled={busy} onClick={()=>action(async()=>accept(await apiClient.post<BulkJob>(bulkPath(workspaceId,`imports/${job.id}/preview`),{mapping,options:{mode,createTaxonomy}})))}>Validar e gerar preview</Button>
    </div></details>:null}
    {rows?<div className="space-y-2"><ul className="space-y-2">{rows.items.map(row=><li key={row.line} className="min-w-0 rounded-lg border p-3 text-sm"><p className="break-words font-medium">Linha {row.line} · {row.sku||row.name||"Produto"} · {bulkActionLabel[row.action]??row.action}</p>{row.issues.map((issue,i)=><p key={i} className={`break-words text-xs ${issue.severity==="error"?"text-destructive":"text-muted-foreground"}`}>{issue.field}{issue.value?` (${issue.value.slice(0,80)})`:""}: {issue.error}</p>)}</li>)}</ul><div className="flex flex-wrap items-center justify-between gap-2"><Button variant="ghost" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>Anterior</Button><span className="text-xs">{rows.total?offset+1:0}–{Math.min(offset+25,rows.total)} de {rows.total} grupos</span><Button variant="ghost" disabled={offset+25>=rows.total} onClick={()=>setOffset(offset+25)}>Próxima</Button></div></div>:null}
    {job.status!=="MAPPING"?<Button variant="secondary" disabled={busy} onClick={()=>action(async()=>downloadBulkFile(workspaceId,`imports/${job.id}/errors`,"relatorio-importacao.csv"))}>Baixar relatório de erros e avisos</Button>:null}
    {job.status==="PREVIEW"?<div className="space-y-2 border-t pt-3"><p className="text-sm">A confirmação importa somente os grupos válidos. Corrija os grupos com erro em uma nova planilha. Se mudar o mapeamento, gere um novo preview.</p><Button disabled={!canConfirmBulk(job,busy)||JSON.stringify(mapping)!==JSON.stringify(job.mapping)||mode!==job.options.mode||createTaxonomy!==job.options.createTaxonomy} onClick={()=>action(async()=>setJob(await apiClient.post<BulkJob>(bulkPath(workspaceId,`imports/${job.id}/confirm`))))}>Confirmar importação dos produtos válidos</Button></div>:null}
   </>:null}
  </DialogContent></Dialog>
 </>;
}
