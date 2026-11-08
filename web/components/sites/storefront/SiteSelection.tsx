"use client";
import {useEffect,useRef,useState} from "react";
import {ArrowLeft,ArrowUpRight,Check,CheckCircle2,Copy,FileDown,Loader2,MessageCircle,Minus,Plus,ShoppingBag,Trash2} from "lucide-react";
import type {PublicSelection,SelectionItem} from "@/features/sites/selection";
import type {PublicSiteProduct} from "@/features/sites/types";
import {fetchCatalogPage} from "@/features/sites/storefront";
import {formatCurrencyCents as money} from "@/lib/format";
import styles from "./SiteSelection.module.css";

export function SiteSelection({token,customDomain=false}:{token:string;customDomain?:boolean}){
 const [selection,setSelection]=useState<PublicSelection>(),[items,setItems]=useState<SelectionItem[]>([]),[customer,setCustomer]=useState({name:"",phone:""});
 const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[loaded,setLoaded]=useState(false);
 const [catalog,setCatalog]=useState<PublicSiteProduct[]>(),[catalogSearch,setCatalogSearch]=useState(""),[catalogBusy,setCatalogBusy]=useState(false),[catalogTotal,setCatalogTotal]=useState(0);
 const navigating=useRef(false);
 const endpoint=`/api/tenant-site/selections/${encodeURIComponent(token)}`;
 async function load(){
  setError("");
  try{const response=await fetch(endpoint,{cache:"no-store"});const result=await response.json();if(!response.ok)throw Error(result.error?.message||"Este link não está disponível.");const data=result.data as PublicSelection;setSelection(data);setItems(data.snapshot.items);setEditing(!data.submittedAt);}

  catch(caught){setError(caught instanceof Error?caught.message:"Não foi possível carregar sua seleção.");}finally{setLoaded(true);}
 }
 useEffect(()=>{void load();},[token]);
 const base=customDomain?"":selection?`/s/${selection.siteSlug}`:"/";
 const dirty=!!selection&&JSON.stringify(items.map(({productId,variantId,quantity})=>({productId,variantId,quantity})))!==JSON.stringify(selection.snapshot.items.map(({productId,variantId,quantity})=>({productId,variantId,quantity})));
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{if(!navigating.current)event.preventDefault();};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty]);
 const total=items.reduce((sum,item)=>sum+(item.totalCents??item.unitPriceCents*item.quantity),0),count=items.reduce((sum,item)=>sum+item.quantity,0);
 function change(index:number,patch:Partial<SelectionItem>){setItems(current=>current.map((item,i)=>i===index?{...item,...patch,totalCents:undefined}:item));setNotice("");}
 function variant(index:number,product:PublicSiteProduct,id:string){const selected=product.variants.find(item=>item.id===id);if(!selected)return;if(items.some((item,i)=>i!==index&&item.productId===product.id&&item.variantId===id)){setError("Essa opção já está na seleção. Ajuste sua quantidade.");return;}change(index,{variantId:id,variantLabel:product.options.map(option=>`${option.name}: ${selected.optionValues[option.key]}`).join(", "),unitPriceCents:selected.priceCents,imageUrl:selected.imageUrl??product.imageUrls[0],sku:selected.sku});}
 async function save(){
  if(!selection)return;const popup=selection.whatsappUrl?window.open("","_blank"):null;setBusy(true);setError("");setNotice("");
  try{
   const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:selection.revision,items:items.map(({productId,variantId,quantity})=>({productId,variantId,quantity})),...(!selection.submittedAt&&!selection.whatsappUrl?{customer}:{} )})});
   const result=await response.json();if(!response.ok)throw Error(result.error?.message||"Não foi possível salvar. Atualize a seleção e tente novamente.");
   const data=result.data as PublicSelection;setSelection(data);setItems(data.snapshot.items);setEditing(false);setCatalog(undefined);
   if(!data.syncPending&&data.whatsappUrl){
    if(popup&&!popup.closed){popup.opener=null;popup.location.href=data.whatsappUrl;}
    else{navigating.current=true;window.location.assign(data.whatsappUrl);}
   }else popup?.close();
   setNotice(data.syncPending?"Sua seleção foi salva, mas o envio à equipe está pendente. Toque em tentar novamente.":selection.submittedAt?"Alterações salvas e enviadas à equipe.":"Pedido recebido! Agora você pode continuar a conversa com a equipe.");
  }catch(caught){popup?.close();setError(caught instanceof Error?caught.message:"Não foi possível salvar agora.");}finally{setBusy(false);}
 }
 async function copy(){try{await navigator.clipboard.writeText(window.location.href);setNotice("Link copiado. Guarde para consultar ou revisar sua seleção.");}catch{setNotice("Copie o endereço desta página para guardar sua seleção.");}}
 async function searchCatalog(append=false){
  if(!selection)return;setCatalogBusy(true);setError("");
  try{const result=await fetchCatalogPage(selection.siteSlug,{offset:append?(catalog?.length??0):0,limit:12,search:catalogSearch});setCatalog(current=>append?[...(current??[]),...result.products]:result.products);setCatalogTotal(result.total);}
  catch(caught){setError(caught instanceof Error?caught.message:"Não foi possível carregar os produtos.");}finally{setCatalogBusy(false);}
 }
 function add(product:PublicSiteProduct){
  if(product.options.length){const option=product.variants.find(item=>item.availableQuantity!==0);if(!option)return;const current=items.find(item=>item.productId===product.id&&item.variantId===option.id);if(current){setNotice("Este produto já está na seleção. Ajuste a quantidade.");return;}setItems([...items,{productId:product.id,variantId:option.id,name:product.name,variantLabel:product.options.map(item=>`${item.name}: ${option.optionValues[item.key]}`).join(", "),quantity:1,unitPriceCents:option.priceCents,currency:product.currency,imageUrl:option.imageUrl??product.imageUrls[0],sku:option.sku}]);}
  else{if(items.some(item=>item.productId===product.id&&!item.variantId)){setNotice("Este produto já está na seleção. Ajuste a quantidade.");return;}setItems([...items,{productId:product.id,name:product.name,quantity:1,unitPriceCents:product.priceCents,currency:product.currency,imageUrl:product.imageUrls[0],sku:product.sku}]);}
 }
 if(!selection)return <main className={styles.page}><div className={styles.empty}>{!loaded?<><Loader2 className={styles.spin}/><h1>Preparando sua seleção…</h1></>:<><ShoppingBag size={36}/><h1>Não foi possível abrir sua seleção</h1><p role="alert">{error}</p><button onClick={()=>void load()}>Tentar novamente</button></>}</div></main>;
 const submitted=!!selection.submittedAt;
 return <main className={styles.page}>
  <header className={styles.header}><a href={base||"/"} className={styles.brand}>{selection.logoUrl?<img src={selection.logoUrl} alt=""/>:<ShoppingBag size={24}/>}<span>{selection.siteName}</span></a><span className={styles.private}>Seleção pessoal · {selection.reference}</span></header>
  <div className={styles.wrap}>
   <a href={base||"/"} className={styles.back}><ArrowLeft size={16}/>Voltar à loja</a>
   <div className={styles.intro}><div><span className={styles.eyebrow}>ESCOLHIDO POR VOCÊ</span><h1>Sua próxima<br/><span>boa escolha.</span></h1><p>{submitted?"Tudo o que você escolheu, em um só lugar. Consulte, compartilhe ou ajuste os detalhes com calma.":"Confira cada detalhe antes de conversar com a gente. Sua seleção fica salva para você voltar quando quiser."}</p></div><div className={styles.introMark}><ShoppingBag size={52} strokeWidth={1}/><span>{count} {count===1?"item escolhido":"itens escolhidos"}</span></div></div>
   <div className={styles.status}><span className={submitted&&!selection.syncPending?styles.statusDot:styles.draftDot}/><strong>{selection.syncPending?"Envio à equipe pendente":submitted?"Seleção recebida pela equipe":"Pronta para conferir"}</strong><span>Revisão {selection.revision}</span></div>
   <div className={styles.layout}>
    <section className={styles.products} aria-label="Produtos selecionados"><div className={styles.sectionTitle}><h2>Os seus favoritos <span>({items.length})</span></h2>{submitted&&selection.editable&&!editing?<button onClick={()=>{setEditing(true);setNotice("");}}>Editar seleção</button>:null}</div>
     {!items.length?<p className={styles.empty}>Adicione um produto para continuar.</p>:items.map((item,index)=>{const product=selection.products.find(product=>product.id===item.productId)??catalog?.find(product=>product.id===item.productId);return <article key={`${item.productId}:${item.variantId??""}`} className={styles.item}>
      <div className={styles.image}>{item.imageUrl?<img src={item.imageUrl} alt={item.name} referrerPolicy="no-referrer"/>:<ShoppingBag size={40} strokeWidth={1}/>}</div>
      <div className={styles.itemCopy}><span className={styles.itemNumber}>{String(index+1).padStart(2,"0")} / SUA SELEÇÃO</span><h3>{item.name}</h3>{editing&&selection.editable&&product?.variants.length?<label className={styles.variant}>Opção<select aria-label={`Opção de ${item.name}`} value={item.variantId??""} onChange={event=>variant(index,product,event.target.value)} disabled={busy}>{product.variants.map(option=><option key={option.id} value={option.id}>{product.options.map(field=>`${field.name}: ${option.optionValues[field.key]}`).join(" · ")}{option.availableQuantity===0?" · Consultar disponibilidade":""}</option>)}</select></label>:item.variantLabel?<p>{item.variantLabel}</p>:null}
       {item.sku?<small>Referência do produto: {item.sku}</small>:null}
       {item.specifications?.length?<details><summary>Detalhes do produto</summary><dl>{item.specifications.map(spec=><div key={spec.label}><dt>{spec.label}</dt><dd>{spec.value}</dd></div>)}</dl></details>:null}
       <div className={styles.itemBottom}>{editing&&selection.editable?<div className={styles.stepper}><button aria-label={`Diminuir quantidade de ${item.name}`} disabled={busy||item.quantity<=1} onClick={()=>change(index,{quantity:item.quantity-1})}><Minus size={14}/></button><span aria-live="polite">{item.quantity}</span><button aria-label={`Aumentar quantidade de ${item.name}`} disabled={busy||item.quantity>=99} onClick={()=>change(index,{quantity:item.quantity+1})}><Plus size={14}/></button></div>:<span className={styles.quantity}>{item.quantity} {item.quantity===1?"unidade":"unidades"}</span>}<div className={styles.price}><strong>{money(item.totalCents??item.unitPriceCents*item.quantity,item.currency)}</strong><small>{money(item.unitPriceCents,item.currency)} / un.</small></div></div>
       {editing&&selection.editable?<button className={styles.remove} disabled={busy} onClick={()=>setItems(items.filter((_,i)=>i!==index))}><Trash2 size={13}/>Remover</button>:null}
      </div></article>;})}
     {editing&&selection.editable?<div className={styles.addMore}><button disabled={busy||catalogBusy||items.length>=50} onClick={()=>void searchCatalog()}><Plus size={17}/>{catalogBusy?"Buscando produtos…":"Adicionar mais produtos"}</button></div>:null}
     {catalog&&editing?<div className={styles.catalog}><form onSubmit={event=>{event.preventDefault();void searchCatalog();}}><label htmlFor="selection-search">Encontre mais favoritos</label><div><input id="selection-search" value={catalogSearch} placeholder="Buscar na loja" onChange={event=>setCatalogSearch(event.target.value)}/><button disabled={catalogBusy}>Buscar</button></div></form><div className={styles.catalogGrid}>{catalog.filter(product=>product.commerce?.allowedActions.some(action=>action==="whatsapp"||action==="add_to_cart")&&!product.commerce.allowedActions.includes("buy_now")).map(product=><button key={product.id} disabled={busy||items.length>=50} onClick={()=>add(product)}>{product.imageUrls[0]?<img src={product.imageUrls[0]} alt=""/>:<ShoppingBag/>}<strong>{product.name}</strong><span>{money(product.priceCents,product.currency)}</span><span>Adicionar <Plus size={12}/></span></button>)}</div>{catalog.length<catalogTotal?<button disabled={catalogBusy} onClick={()=>void searchCatalog(true)}>Carregar mais produtos</button>:null}<button onClick={()=>setCatalog(undefined)}>Fechar catálogo</button></div>:null}
    </section>
    <aside className={styles.aside}><form className={styles.summary} onSubmit={event=>{event.preventDefault();void save();}}><span className={styles.eyebrow}>CADA DETALHE CONTA</span><h2>Resumo da seleção</h2><div className={styles.total}><span>{count} {count===1?"item":"itens"}</span><strong>{money(total,selection.snapshot.currency)}</strong></div><p className={styles.hint}>{dirty?"Estimativa das alterações. Preços e benefícios serão conferidos ao salvar.":"Total estimado dos produtos. Entrega, disponibilidade e pagamento serão combinados com a equipe."}</p>
     {!submitted&&!selection.whatsappUrl&&selection.editable?<div className={styles.customer}><h3>Como podemos falar com você?</h3><label>Seu nome<input autoComplete="name" required minLength={2} maxLength={160} value={customer.name} disabled={busy} onChange={event=>setCustomer({...customer,name:event.target.value})}/></label><label>Seu WhatsApp com DDD<input type="tel" autoComplete="tel" required maxLength={40} placeholder="(11) 91234-5678" value={customer.phone} disabled={busy} onChange={event=>setCustomer({...customer,phone:event.target.value})}/></label><p>Usaremos seus dados para atender esta solicitação.</p></div>:null}
     {error?<div role="alert" className={styles.error}>{error}<button type="button" onClick={()=>void load()}>Atualizar seleção</button></div>:null}
     {notice?<p role="status" className={selection.syncPending?styles.error:styles.notice}>{notice}</p>:null}
     {selection.editable&&(!submitted||editing||selection.syncPending)?<button className={styles.primary} disabled={busy||!items.length} type="submit">{busy?<Loader2 size={17} className={styles.spin}/>:<Check size={17}/>}<span>{busy?"Salvando sua seleção…":selection.syncPending?"Tentar envio novamente":submitted?"Salvar e atualizar pedido":selection.whatsappUrl?"Finalizar pelo WhatsApp":"Confirmar minha seleção"}</span></button>:null}
     {submitted&&!selection.syncPending&&!editing&&selection.whatsappUrl?<a href={selection.whatsappUrl} className={styles.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle size={18}/>Continuar pelo WhatsApp<ArrowUpRight size={16}/></a>:null}
     {submitted&&!selection.whatsappUrl&&!selection.syncPending?<p className={styles.notice}><CheckCircle2 size={18}/>A equipe recebeu sua seleção e vai entrar em contato.</p>:null}
     {editing&&submitted?<button type="button" className={styles.secondary} disabled={busy} onClick={()=>{setItems(selection.snapshot.items);setEditing(false);setError("");setCatalog(undefined);}}>Cancelar alterações</button>:null}
     {!selection.editable?<p className={styles.hint}>Esta seleção está disponível para consulta. Para fazer um novo pedido, volte à loja ou fale com a equipe.</p>:null}
     <div className={styles.share}><button type="button" onClick={()=>void copy()}><Copy size={15}/>Copiar link</button><button type="button" disabled={editing&&dirty} onClick={()=>window.print()}><FileDown size={15}/>Salvar PDF</button></div><p className={styles.linkNote}>Guarde este link para voltar à seleção. Quem tiver o link poderá consultar e revisar os itens enquanto ela estiver aberta.</p>
    </form><div className={styles.timeline}><CheckCircle2 size={20}/><div><strong>{submitted?"Você pode voltar quando quiser":"Do seu jeito, no seu tempo"}</strong><p>{submitted?"As alterações ficam no mesmo pedido, para a equipe acompanhar tudo com você.":"Confirme sua seleção para a equipe receber os itens e preparar seu atendimento."}</p></div></div></aside>
   </div>
   <footer className={styles.footer}><span>{selection.siteName} · Sua seleção, com todos os detalhes.</span><span>{selection.reference} · Revisão {selection.revision}</span></footer>
   {selection.history.length?<details className={styles.history}><summary>Histórico da seleção</summary><ul>{selection.history.map(revision=><li key={revision.revision}>Revisão {revision.revision} · {new Date(revision.at).toLocaleString("pt-BR")}</li>)}</ul></details>:null}
  </div>
 </main>;
}
