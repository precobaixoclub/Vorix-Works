"use client";
import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from "react";
import {Check,Copy,CreditCard,Lock,MapPin,Package,QrCode,Store,Truck} from "lucide-react";
import type {CheckoutQuote,PublicOrder,PublicTenantSite,ShippingOption} from "@/features/sites/types";
import {fetchPublicOrder,placeOrder,quoteCheckout} from "@/features/sites/storefront";
import {formatCurrencyCents} from "@/lib/format";

/**
 * Vorix Commerce, Fase 2 — checkout público em uma página (mobile-first): dados → entrega → pagamento,
 * com o resumo sempre visível. Preço, frete e total vêm do servidor; a tela nunca calcula valor.
 */
type Field={value:string;error?:string};
const onlyDigits=(value:string)=>value.replace(/\D/g,"");
const maskPostal=(value:string)=>{const d=onlyDigits(value).slice(0,8);return d.length>5?`${d.slice(0,5)}-${d.slice(5)}`:d;};
const money=(cents:number,currency="BRL")=>formatCurrencyCents(cents,currency);

export function CheckoutPage({site,basePath}:{site:PublicTenantSite;basePath:string}){
 const [quote,setQuote]=useState<CheckoutQuote>(),[loadError,setLoadError]=useState<string>(),[quoting,setQuoting]=useState(false);
 const [form,setForm]=useState<Record<string,Field>>({name:{value:""},email:{value:""},phone:{value:""},document:{value:""},postalCode:{value:""},street:{value:""},number:{value:""},complement:{value:""},district:{value:""},city:{value:""},state:{value:""}});
 const [optionId,setOptionId]=useState<string>(),[method,setMethod]=useState<"PIX"|"CARD"|"SANDBOX">(),[submitting,setSubmitting]=useState(false),[error,setError]=useState<string>();
 const [requestKey]=useState(()=>crypto.randomUUID());const errorRef=useRef<HTMLParagraphElement>(null);
 const load=useCallback(async(postal?:string)=>{
  setQuoting(true);
  try{const next=await quoteCheckout(site.slug,postal);setQuote(next);setLoadError(undefined);setMethod(current=>current&&next.paymentMethods.some(item=>item.method===current)?current:next.paymentMethods[0]?.method);setOptionId(current=>next.shippingOptions.some(item=>item.id===current)?current:next.shippingOptions[0]?.id);}
  catch(caught){setLoadError(caught instanceof Error?caught.message:"Não foi possível carregar o checkout.");}
  finally{setQuoting(false);}
 },[site.slug]);
 useEffect(()=>{void load();},[load]);
 const set=(name:string,value:string)=>{setForm(current=>({...current,[name]:{value}}));setError(undefined);};
 const option:ShippingOption|undefined=quote?.shippingOptions.find(item=>item.id===optionId);
 const needsAddress=!!option?.requiresAddress;
 const total=(quote?.subtotalCents??0)+(option?.priceCents??0);
 async function onPostal(value:string){
  const masked=maskPostal(value);set("postalCode",masked);
  const digits=onlyDigits(masked);if(digits.length!==8)return;
  void load(digits);
  // Endereço sugerido pelo CEP (ViaCEP público); o comprador pode corrigir.
  try{const response=await fetch(`https://viacep.com.br/ws/${digits}/json/`);const data=await response.json();if(!data.erro)setForm(current=>({...current,street:{value:current.street.value||data.logradouro||""},district:{value:current.district.value||data.bairro||""},city:{value:current.city.value||data.localidade||""},state:{value:current.state.value||data.uf||""}}));}catch{}
 }
 function validate():boolean{
  const next={...form};let ok=true;const fail=(name:string,message:string)=>{next[name]={...next[name],error:message};ok=false;};
  if(form.name.value.trim().split(/\s+/).length<2)fail("name","Informe nome e sobrenome.");
  if(!/^\S+@\S+\.\S+$/.test(form.email.value.trim()))fail("email","Informe um e-mail válido.");
  if(!/^\d{10,13}$/.test(onlyDigits(form.phone.value)))fail("phone","Informe um telefone com DDD.");
  if(quote?.requireDocument&&!/^(\d{11}|\d{14})$/.test(onlyDigits(form.document.value)))fail("document","Informe seu CPF ou CNPJ.");
  if(needsAddress){for(const [key,label] of [["postalCode","o CEP"],["street","a rua"],["number","o número"],["district","o bairro"],["city","a cidade"],["state","a UF"]] as const)if(!form[key].value.trim())fail(key,`Informe ${label}.`);}
  setForm(next);return ok;
 }
 async function submit(event?:FormEvent,card?:{token:string;paymentMethodId:string;installments:number}){
  event?.preventDefault();if(!quote||!option||!method||submitting)return;
  if(!validate()){setError("Revise os campos destacados.");requestAnimationFrame(()=>document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());return;}
  if(method==="CARD"&&!card){setError("Preencha os dados do cartão abaixo.");return;}
  setSubmitting(true);setError(undefined);
  try{
   const order:PublicOrder=await placeOrder(site.slug,{requestKey,deliveryOptionId:option.id,
    customer:{name:form.name.value.trim(),email:form.email.value.trim(),phone:form.phone.value,...(form.document.value.trim()?{document:form.document.value}:{})},
    ...(needsAddress?{address:{postalCode:form.postalCode.value,street:form.street.value,number:form.number.value,complement:form.complement.value||undefined,district:form.district.value,city:form.city.value,state:form.state.value}}:{}),
    payment:{method,...(card?{cardToken:card.token,cardPaymentMethodId:card.paymentMethodId,installments:card.installments}:{})}});
   if(order.publicToken)window.location.assign(`${basePath}/pedido/${encodeURIComponent(order.publicToken)}`);
  }catch(caught){setError(caught instanceof Error?caught.message:"Não foi possível finalizar a compra.");setSubmitting(false);requestAnimationFrame(()=>errorRef.current?.focus());}
 }
 if(loadError&&!quote)return <section className="ts-section"><div className="ts-container ck-narrow"><h1>Finalizar compra</h1><p role="alert" className="ck-error">{loadError}</p><a className="ts-button" href={basePath||"/"}>Voltar à loja</a></div></section>;
 if(!quote)return <section className="ts-section"><div className="ts-container ck-narrow" aria-busy="true"><h1>Finalizar compra</h1><p>Carregando seu carrinho...</p></div></section>;
 const input=(name:string,label:string,props:Record<string,unknown>={})=><label className={`ck-field ${form[name].error?"has-error":""}`}><span>{label}</span><input name={name} value={form[name].value} aria-invalid={!!form[name].error} aria-describedby={form[name].error?`${name}-error`:undefined} onChange={event=>set(name,event.target.value)} {...props}/>{form[name].error?<small id={`${name}-error`}>{form[name].error}</small>:null}</label>;
 const paymentLabel=(item:CheckoutQuote["paymentMethods"][number])=>item.method==="PIX"?<><QrCode size={18} aria-hidden="true"/>PIX</>:item.method==="CARD"?<><CreditCard size={18} aria-hidden="true"/>Cartão de crédito</>:<><Lock size={18} aria-hidden="true"/>{item.label}</>;
 return <section className="ts-section ck"><div className="ts-container">
  <nav className="ts-breadcrumb" aria-label="Caminho"><a href={basePath||"/"}>Início</a><span>/</span><span>Finalizar compra</span></nav>
  <h1 className="ck-title">Finalizar compra</h1>
  {quote.sandbox?<p className="ck-sandbox" role="note">Loja em modo de teste: nenhum valor será cobrado.</p>:null}
  <form className="ck-grid" onSubmit={submit} noValidate>
   <div className="ck-steps">
    <fieldset className="ck-card"><legend><span className="ck-step">1</span>Seus dados</legend>
     <div className="ck-row">{input("name","Nome completo",{autoComplete:"name",required:true,maxLength:160})}</div>
     <div className="ck-row ck-two">{input("email","E-mail",{type:"email",autoComplete:"email",inputMode:"email",required:true,maxLength:320})}{input("phone","Celular (WhatsApp)",{type:"tel",autoComplete:"tel",inputMode:"tel",required:true,maxLength:20,placeholder:"(11) 99999-9999"})}</div>
     {quote.requireDocument?<div className="ck-row">{input("document","CPF ou CNPJ",{inputMode:"numeric",autoComplete:"off",maxLength:18})}</div>:null}
    </fieldset>
    <fieldset className="ck-card"><legend><span className="ck-step">2</span>Entrega</legend>
     <div className="ck-row ck-postal">{input("postalCode","CEP para calcular o frete",{inputMode:"numeric",autoComplete:"postal-code",maxLength:9,placeholder:"00000-000",onChange:(event:{target:{value:string}})=>void onPostal(event.target.value)})}</div>
     <div className="ck-options" role="radiogroup" aria-label="Formas de entrega" aria-busy={quoting}>
      {quote.shippingOptions.length?quote.shippingOptions.map(item=><label key={item.id} className={`ck-option ${optionId===item.id?"is-selected":""}`}><input type="radio" name="delivery" value={item.id} checked={optionId===item.id} onChange={()=>setOptionId(item.id)}/>{item.kind==="PICKUP"?<Store size={20} aria-hidden="true"/>:<Truck size={20} aria-hidden="true"/>}<span className="ck-option-copy"><strong>{item.label}</strong><small>{item.description??(item.days!==undefined?(item.kind==="PICKUP"?`Pronto em até ${item.days} dia(s)`:`Chega em até ${item.days} dia(s) úteis`):"")}</small></span><b>{item.priceCents?money(item.priceCents,quote.currency):"Grátis"}</b></label>)
      :<p className="ck-muted">{onlyDigits(form.postalCode.value).length===8?"Ainda não entregamos neste CEP.":"Informe o CEP para ver as opções de entrega."}</p>}
     </div>
     {needsAddress?<div className="ck-address"><div className="ck-row ck-street">{input("street","Rua",{autoComplete:"address-line1",maxLength:200})}{input("number","Número",{autoComplete:"off",maxLength:20,inputMode:"numeric"})}</div><div className="ck-row">{input("complement","Complemento (opcional)",{autoComplete:"address-line2",maxLength:100})}</div><div className="ck-row ck-three">{input("district","Bairro",{maxLength:120})}{input("city","Cidade",{autoComplete:"address-level2",maxLength:120})}{input("state","UF",{autoComplete:"address-level1",maxLength:2})}</div></div>:null}
    </fieldset>
    <fieldset className="ck-card"><legend><span className="ck-step">3</span>Pagamento</legend>
     <div className="ck-options" role="radiogroup" aria-label="Formas de pagamento">{quote.paymentMethods.map(item=><label key={item.method} className={`ck-option ${method===item.method?"is-selected":""}`}><input type="radio" name="payment" value={item.method} checked={method===item.method} onChange={()=>setMethod(item.method)}/>{paymentLabel(item)}</label>)}</div>
     {method==="PIX"?<p className="ck-muted">O QR Code e o código copia e cola aparecem na próxima tela. Seus produtos ficam reservados por {quote.reservationMinutes} minutos.</p>:null}
     {method==="CARD"?<CardForm publicKey={quote.paymentMethods.find(item=>item.method==="CARD")?.publicKey} amountCents={total} disabled={!option||submitting} onToken={card=>void submit(undefined,card)}/>:null}
    </fieldset>
   </div>
   <aside className="ck-summary" aria-label="Resumo do pedido">
    <div className="ck-card"><h2>Resumo</h2>
     <ul className="ck-items">{quote.items.map(item=><li key={`${item.productId}:${item.variantId??""}`}><span className="ck-thumb">{item.imageUrl?<img src={item.imageUrl} alt="" loading="lazy"/>:<Package size={20} aria-hidden="true"/>}<em>{item.quantity}</em></span><span className="ck-item-copy"><strong>{item.name}</strong>{item.variantLabel?<small>{item.variantLabel}</small>:null}</span><b>{money(item.unitPriceCents*item.quantity,item.currency)}</b></li>)}</ul>
     {quote.otherItems?<p className="ck-muted">{quote.otherItems} item(ns) sob consulta continuam no carrinho para o WhatsApp.</p>:null}
     <dl className="ck-totals"><div><dt>Subtotal</dt><dd>{money(quote.subtotalCents,quote.currency)}</dd></div><div><dt>Frete</dt><dd>{option?(option.priceCents?money(option.priceCents,quote.currency):"Grátis"):"—"}</dd></div><div className="ck-total"><dt>Total</dt><dd>{money(total,quote.currency)}</dd></div></dl>
     {error?<p className="ck-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>:null}
     {method!=="CARD"?<button type="submit" className="ts-button ck-cta" disabled={submitting||!option||!method}>{submitting?"Finalizando...":<><Lock size={16} aria-hidden="true"/>Finalizar compra · {money(total,quote.currency)}</>}</button>:null}
     <p className="ck-secure"><Lock size={14} aria-hidden="true"/>Pagamento processado com segurança. Não guardamos dados do cartão.</p>
    </div>
   </aside>
  </form>
  {method!=="CARD"?<div className="ck-sticky"><span><small>Total</small><strong>{money(total,quote.currency)}</strong></span><button type="button" className="ts-button" disabled={submitting||!option||!method} onClick={()=>void submit()}>{submitting?"Finalizando...":"Finalizar compra"}</button></div>:null}
 </div></section>;
}

/** Cartão via Mercado Pago (Card Payment Brick): o número do cartão nunca passa pelo Vorix, só o token. */
declare global{interface Window{MercadoPago?:new(key:string,options?:Record<string,unknown>)=>{bricks:()=>{create:(name:string,container:string,settings:Record<string,unknown>)=>Promise<{unmount:()=>void}>}}}}
function CardForm({publicKey,amountCents,disabled,onToken}:{publicKey?:string;amountCents:number;disabled:boolean;onToken:(card:{token:string;paymentMethodId:string;installments:number})=>void}){
 const [state,setState]=useState<"loading"|"ready"|"error">("loading");const tokenRef=useRef(onToken);tokenRef.current=onToken;
 useEffect(()=>{
  if(!publicKey){setState("error");return;}
  let brick:{unmount:()=>void}|undefined,cancelled=false;
  const start=async()=>{
   if(!window.MercadoPago)await new Promise<void>((resolve,reject)=>{const script=document.createElement("script");script.src="https://sdk.mercadopago.com/js/v2";script.onload=()=>resolve();script.onerror=()=>reject(Error("sdk"));document.head.appendChild(script);});
   if(cancelled||!window.MercadoPago)return;
   brick=await new window.MercadoPago(publicKey,{locale:"pt-BR"}).bricks().create("cardPayment","ck-card-brick",{initialization:{amount:amountCents/100},customization:{paymentMethods:{maxInstallments:12}},callbacks:{onReady:()=>setState("ready"),onError:()=>setState("error"),onSubmit:(data:{token:string;payment_method_id:string;installments:number})=>{tokenRef.current({token:data.token,paymentMethodId:data.payment_method_id,installments:data.installments});return Promise.resolve();}}});
  };
  start().catch(()=>setState("error"));
  return()=>{cancelled=true;brick?.unmount();};
 },[publicKey,amountCents]);
 return <div className="ck-card-form" aria-disabled={disabled}>{state==="loading"?<p className="ck-muted">Carregando pagamento com cartão...</p>:null}{state==="error"?<p className="ck-error" role="alert">Pagamento com cartão indisponível agora. Escolha outra forma de pagamento.</p>:null}<div id="ck-card-brick"/></div>;
}

/** Página do pedido: PIX (QR + copia e cola + prazo) e status que se atualiza sozinho. */
export function OrderStatusPage({token,basePath}:{token:string;basePath:string}){
 const [order,setOrder]=useState<PublicOrder>(),[error,setError]=useState<string>(),[copied,setCopied]=useState(false),[nowMs,setNowMs]=useState(()=>Date.now());
 useEffect(()=>{
  let alive=true,timer:ReturnType<typeof setTimeout>|undefined;
  const tick=async()=>{try{const next=await fetchPublicOrder(token);if(!alive)return;setOrder(next);setError(undefined);if(next.status==="AWAITING_PAYMENT")timer=setTimeout(tick,5000);}catch(caught){if(alive){setError(caught instanceof Error?caught.message:"Não foi possível consultar o pedido.");timer=setTimeout(tick,10000);}}};
  void tick();return()=>{alive=false;if(timer)clearTimeout(timer);};
 },[token]);
 useEffect(()=>{const id=setInterval(()=>setNowMs(Date.now()),1000);return()=>clearInterval(id);},[]);
 const remaining=useMemo(()=>{const end=order?.reservationExpiresAt?Date.parse(order.reservationExpiresAt):NaN;if(!Number.isFinite(end))return undefined;const seconds=Math.max(0,Math.floor((end-nowMs)/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;},[order?.reservationExpiresAt,nowMs]);
 if(!order)return <section className="ts-section"><div className="ts-container ck-narrow" aria-busy={!error}><h1>Seu pedido</h1>{error?<p role="alert" className="ck-error">{error}</p>:<p>Carregando...</p>}</div></section>;
 const pix=order.payment?.status==="PENDING"?order.payment.instructions:undefined;
 const paid=["PAID","CONFIRMED","PROCESSING","SHIPPED","DELIVERED"].includes(order.status);
 async function copy(){if(!pix?.pixQrCode)return;try{await navigator.clipboard.writeText(pix.pixQrCode);setCopied(true);setTimeout(()=>setCopied(false),2500);}catch{}}
 return <section className="ts-section ck"><div className="ts-container ck-narrow">
  <p className="ck-eyebrow">Pedido #{order.number}</p>
  <h1 className="ck-title">{paid?`Obrigado, ${order.customerName}! Pagamento confirmado.`:order.status==="CANCELLED"?"Pedido cancelado":`Quase lá, ${order.customerName}!`}</h1>
  <p className={`ck-status ck-status-${paid?"ok":order.status==="CANCELLED"?"bad":"wait"}`} role="status" aria-live="polite">{paid?<Check size={16} aria-hidden="true"/>:null}{order.statusLabel}</p>
  {order.status==="AWAITING_PAYMENT"&&pix?<div className="ck-card ck-pix">
   {pix.sandbox?<p className="ck-sandbox" role="note">Pedido de teste: nenhum valor será cobrado. A loja confirma o pagamento pelo painel.</p>:<><h2>Pague com PIX</h2>
   {pix.pixQrCodeBase64?<img className="ck-qr" src={`data:image/png;base64,${pix.pixQrCodeBase64}`} alt="QR Code PIX para pagamento"/>:null}
   {pix.pixQrCode?<div className="ck-copy"><label htmlFor="ck-pix-code">PIX copia e cola</label><textarea id="ck-pix-code" readOnly value={pix.pixQrCode} rows={3} onFocus={event=>event.currentTarget.select()}/><button type="button" className="ts-button" onClick={copy}>{copied?<><Check size={16} aria-hidden="true"/>Código copiado</>:<><Copy size={16} aria-hidden="true"/>Copiar código</>}</button></div>:null}</>}
   {remaining?<p className="ck-muted">Seus produtos ficam reservados por mais <strong className="tabular">{remaining}</strong>. Esta página atualiza sozinha quando o pagamento for confirmado.</p>:null}
  </div>:null}
  <div className="ck-card"><h2>Resumo</h2>
   <ul className="ck-items">{order.items.map((item,index)=><li key={index}><span className="ck-thumb">{item.imageUrl?<img src={item.imageUrl} alt="" loading="lazy"/>:<Package size={20} aria-hidden="true"/>}<em>{item.quantity}</em></span><span className="ck-item-copy"><strong>{item.name}</strong>{item.variantLabel?<small>{item.variantLabel}</small>:null}</span><b>{money(item.totalCents,order.currency)}</b></li>)}</ul>
   <dl className="ck-totals"><div><dt>Subtotal</dt><dd>{money(order.subtotalCents,order.currency)}</dd></div>{order.discountCents?<div><dt>Desconto</dt><dd>−{money(order.discountCents,order.currency)}</dd></div>:null}<div><dt>Entrega · {order.delivery.label}</dt><dd>{order.shippingCents?money(order.shippingCents,order.currency):"Grátis"}</dd></div><div className="ck-total"><dt>Total</dt><dd>{money(order.totalCents,order.currency)}</dd></div></dl>
   <p className="ck-muted"><MapPin size={14} aria-hidden="true"/>{order.delivery.kind==="PICKUP"?"Retirada no local — avisaremos quando estiver pronto.":order.delivery.days!==undefined?`Entrega em até ${order.delivery.days} dia(s) úteis após a confirmação.`:"Entrega após a confirmação do pagamento."}</p>
  </div>
  <a className="ts-button ts-button-secondary" href={basePath||"/"}>Continuar comprando</a>
 </div></section>;
}

export const CHECKOUT_STYLES=`
.ck-title{margin:.2em 0 .6em}.ck-narrow{max-width:720px}.ck-eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:.78em;opacity:.7;margin:0}
.ck-grid{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:28px;align-items:start}.ck-steps{display:grid;gap:18px;min-width:0}
.ck-card{border:1px solid var(--site-line);border-radius:var(--site-radius);padding:20px;background:var(--site-bg);display:grid;gap:14px;min-width:0;margin:0}.ck-card h2{font-size:1.1em;margin:0}
.ck-card legend{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.05em;padding:0 6px}.ck-step{display:grid;place-items:center;width:26px;height:26px;border-radius:999px;background:var(--site-primary);color:var(--site-on-primary);font-size:.8em}
.ck-row{display:grid;gap:12px}.ck-two{grid-template-columns:1fr 1fr}.ck-three{grid-template-columns:1.2fr 1.2fr .5fr}.ck-street{grid-template-columns:1fr 120px}.ck-postal{max-width:260px}
.ck-field{display:grid;gap:6px;font-size:.9em;font-weight:600;min-width:0}.ck-field input{min-height:48px;border:1px solid var(--site-line);border-radius:calc(var(--site-radius)*.6);padding:10px 14px;font:inherit;font-weight:400;background:var(--site-bg);color:var(--site-fg);width:100%}
.ck-field input:focus-visible,.ck-option:focus-within,.ck-copy textarea:focus-visible,.ck .ts-button:focus-visible{outline:3px solid var(--site-primary);outline-offset:2px}
.ck-field.has-error input{border-color:#b42318}.ck-field small{color:#b42318;font-weight:500}
.ck-options{display:grid;gap:10px}.ck-option{display:flex;align-items:center;gap:12px;min-height:56px;padding:12px 14px;border:1px solid var(--site-line);border-radius:calc(var(--site-radius)*.6);cursor:pointer}.ck-option.is-selected{border-color:var(--site-primary);background:var(--site-soft)}
.ck-option input{width:18px;height:18px;accent-color:var(--site-primary);flex:none}.ck-option-copy{display:grid;flex:1;min-width:0}.ck-option-copy small{opacity:.75}.ck-option b{font-variant-numeric:tabular-nums;white-space:nowrap}
.ck-summary{position:sticky;top:20px}.ck-items{list-style:none;margin:0;padding:0;display:grid;gap:12px}.ck-items li{display:grid;grid-template-columns:56px 1fr auto;gap:12px;align-items:center}
.ck-thumb{position:relative;width:56px;height:56px;border-radius:calc(var(--site-radius)*.6);background:var(--site-surface);display:grid;place-items:center;overflow:hidden}.ck-thumb img{width:100%;height:100%;object-fit:cover}.ck-thumb em{position:absolute;top:2px;right:2px;min-width:20px;height:20px;border-radius:999px;background:var(--site-fg);color:var(--site-bg);font-size:11px;font-style:normal;display:grid;place-items:center;font-weight:700}
.ck-item-copy{display:grid;min-width:0}.ck-item-copy strong{overflow-wrap:anywhere;font-size:.92em}.ck-item-copy small{opacity:.75}.ck-items b,.ck-totals dd,.tabular{font-variant-numeric:tabular-nums}
.ck-totals{margin:0;display:grid;gap:8px;border-top:1px solid var(--site-line);padding-top:12px}.ck-totals div{display:flex;justify-content:space-between;gap:12px}.ck-totals dd{margin:0}.ck-total{font-weight:700;font-size:1.15em}
.ck-cta{width:100%}.ck-secure{display:flex;align-items:center;gap:6px;font-size:.8em;opacity:.75;margin:0}.ck-muted{opacity:.8;font-size:.9em;margin:0;display:flex;gap:6px;align-items:flex-start}
.ck-error{color:#b42318;background:rgba(180,35,24,.08);border-radius:8px;padding:10px 12px;margin:0}.ck-sandbox{background:#fff7e6;color:#7a4b00;border:1px solid #f5c26b;border-radius:8px;padding:10px 12px;margin:0 0 12px}
.ck-status{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;font-weight:600;font-size:.9em;margin:0 0 18px}.ck-status-ok{background:#e7f6ec;color:#11633a}.ck-status-wait{background:#fff7e6;color:#7a4b00}.ck-status-bad{background:#fdecec;color:#8a1c1c}
.ck-pix{justify-items:center;text-align:center;margin-bottom:18px}.ck-qr{width:min(240px,70vw);height:auto;image-rendering:pixelated;border-radius:8px;background:#fff;padding:8px}
.ck-copy{display:grid;gap:8px;width:100%;text-align:left}.ck-copy textarea{width:100%;font-family:ui-monospace,monospace;font-size:.8em;border:1px solid var(--site-line);border-radius:8px;padding:10px;resize:none;background:var(--site-surface);color:var(--site-fg)}
.ck .ck-narrow>.ck-card{margin-bottom:18px}.tenant-site:has(.ck) .sc-cart-launcher{display:none}.ck-sticky{display:none}.ck-card-form{min-height:60px}
@media(max-width:960px){.ck-grid{grid-template-columns:1fr}.ck-summary{position:static;order:-1}}
@media(max-width:700px){
 .ck-two,.ck-three{grid-template-columns:1fr}.ck-street{grid-template-columns:1fr 110px}.ck-postal{max-width:none}.ck-card{padding:16px}
 .ck-summary .ck-cta{display:none}.ck{padding-bottom:96px}
 .ck-sticky{position:fixed;left:0;right:0;bottom:0;z-index:55;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:var(--site-bg);border-top:1px solid var(--site-line);box-shadow:0 -10px 30px rgba(15,23,42,.12)}
 .ck-sticky span{display:grid}.ck-sticky small{opacity:.7;font-size:.75em}.ck-sticky strong{font-variant-numeric:tabular-nums;font-size:1.1em}.ck-sticky .ts-button{min-height:48px}
}
`;
