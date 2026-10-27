"use client";
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {MessageCircle,Minus,Plus,ShoppingBag,Trash2,X} from "lucide-react";
import type {ProductCommerce,PublicCart,PublicSiteProduct,PublicTenantSite} from "@/features/sites/types";
import {checkoutCart,fetchCart,openWhatsapp,setCartItem,startProductWhatsapp,storeCartToken,trackSiteEvent,captureUtm} from "@/features/sites/storefront";
import {formatCurrencyCents} from "@/lib/format";

/**
 * Vorix Commerce, Fase 1 — camada comercial da vitrine. O backend já diz o que cada produto pode
 * (`product.commerce`); aqui só existe apresentação: CTA do produto, CTA fixo no celular, carrinho
 * e "Finalizar pelo WhatsApp". Para o visitante é um site comum — nada de CRM ou intenção.
 */
type StorefrontState={site:PublicTenantSite;basePath:string;preview:boolean;cart?:PublicCart;cartOpen:boolean;openCart:()=>void;closeCart:()=>void;resetCart:()=>void;updateItem:(input:{productId:string;variantId?:string;quantity:number})=>Promise<PublicCart|undefined>};
const StorefrontContext=createContext<StorefrontState|undefined>(undefined);
export const useStorefront=()=>useContext(StorefrontContext);

export function StorefrontProvider({site,basePath,preview,path,children}:{site:PublicTenantSite;basePath:string;preview:boolean;path:string[];children:ReactNode}){
 const [cart,setCart]=useState<PublicCart>(),[cartOpen,setCartOpen]=useState(false);
 const cartEnabled=!!site.commerce?.cartEnabled&&!preview;
 useEffect(()=>{if(preview)return;captureUtm(site.slug);if(!(path[0]==="produto"))trackSiteEvent(site.slug,"SITE_VIEW");},[preview,site.slug,path.join("/")]);
 useEffect(()=>{if(!cartEnabled)return;let alive=true;fetchCart(site.slug).then(value=>{if(alive)setCart(value);}).catch(()=>undefined);return()=>{alive=false;};},[cartEnabled,site.slug]);
 const updateItem=useCallback(async(input:{productId:string;variantId?:string;quantity:number})=>{const next=await setCartItem(site.slug,input);setCart(next);return next;},[site.slug]);
 const value=useMemo(()=>({site,basePath,preview,cart,cartOpen,openCart:()=>setCartOpen(true),closeCart:()=>setCartOpen(false),resetCart:()=>{storeCartToken(site.slug,undefined);setCart(undefined);},updateItem}),[site,basePath,preview,cart,cartOpen,updateItem]);
 return <StorefrontContext.Provider value={value}>{children}{cartEnabled?<><CartLauncher/><CartDrawer/></>:null}</StorefrontContext.Provider>;
}

function CartLauncher(){
 const store=useStorefront()!;const count=store.cart?.itemCount??0;
 if(!count)return null;
 return <button type="button" className="sc-cart-launcher" onClick={store.openCart} aria-label={`Abrir carrinho, ${count} ${count===1?"item":"itens"}`} aria-haspopup="dialog"><ShoppingBag size={20} aria-hidden="true"/><span className="sc-cart-count" aria-hidden="true">{count}</span></button>;
}

function CartDrawer(){
 const store=useStorefront()!;const {cart,cartOpen,closeCart,site}=store;
 const panel=useRef<HTMLDivElement>(null),returnFocus=useRef<Element|null>(null);
 const [busyLine,setBusyLine]=useState<string>(),[error,setError]=useState<string>(),[checkingOut,setCheckingOut]=useState(false),[requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
 useEffect(()=>{
  if(!cartOpen)return;returnFocus.current=document.activeElement;
  const node=panel.current;node?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==="Escape"){event.preventDefault();closeCart();return;}
   if(event.key!=="Tab"||!node)return;
   const focusable=[...node.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],input:not([disabled])")];if(!focusable.length)return;
   const first=focusable[0],last=focusable[focusable.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  document.addEventListener("keydown",onKey);const overflow=document.body.style.overflow;document.body.style.overflow="hidden";
  return()=>{document.removeEventListener("keydown",onKey);document.body.style.overflow=overflow;(returnFocus.current as HTMLElement|null)?.focus?.();};
 },[cartOpen,closeCart]);
 if(!cartOpen)return null;
 const items=cart?.items??[],blocked=items.some(item=>!item.available);
 async function change(productId:string,variantId:string|undefined,quantity:number){
  const key=`${productId}:${variantId??""}`;setBusyLine(key);setError(undefined);
  try{await store.updateItem({productId,variantId,quantity});}catch(caught){setError(caught instanceof Error?caught.message:"Não foi possível atualizar o carrinho.");}finally{setBusyLine(undefined);}
 }
 async function finish(){
  setCheckingOut(true);setError(undefined);
  try{await openWhatsapp(()=>checkoutCart(site.slug,requestKey),store.basePath);setRequestKey(crypto.randomUUID());closeCart();store.resetCart();}
  catch(caught){setError(caught instanceof Error?caught.message:"Não foi possível abrir o WhatsApp.");}
  finally{setCheckingOut(false);}
 }
 return <div className="sc-drawer-layer">
  <div className="sc-drawer-backdrop" onClick={closeCart} aria-hidden="true"/>
  <div ref={panel} className="sc-drawer" role="dialog" aria-modal="true" aria-labelledby="sc-cart-title">
   <header className="sc-drawer-header"><h2 id="sc-cart-title">Seu carrinho</h2><button type="button" className="sc-icon-button" onClick={closeCart} aria-label="Fechar carrinho" data-autofocus><X size={20}/></button></header>
   {!items.length?<div className="sc-drawer-empty"><ShoppingBag size={32} aria-hidden="true"/><p>Seu carrinho está vazio.</p><button type="button" className="ts-button ts-button-secondary" onClick={closeCart}>Continuar navegando</button></div>:<>
    <ul className="sc-cart-lines">{items.map(item=>{const key=`${item.productId}:${item.variantId??""}`,busy=busyLine===key,max=item.availableQuantity===undefined?99:Math.min(99,item.availableQuantity);return <li key={key} className={item.available?"":"is-unavailable"}>
     <div className="sc-line-image">{item.imageUrl?<img src={item.imageUrl} alt="" loading="lazy"/>:<ShoppingBag aria-hidden="true"/>}</div>
     <div className="sc-line-copy"><a href={item.slug?`${store.basePath}/produto/${encodeURIComponent(item.slug)}`:undefined}>{item.name}</a>{item.variantLabel?<span>{item.variantLabel}</span>:null}<strong>{formatCurrencyCents(item.unitPriceCents*item.quantity,item.currency)}</strong>{!item.available?<em role="note">{item.availableQuantity?`Só temos ${item.availableQuantity} disponível(is). Ajuste a quantidade.`:"Indisponível no momento. Remova para continuar."}</em>:null}
      <div className="sc-stepper" role="group" aria-label={`Quantidade de ${item.name}`}><button type="button" aria-label="Diminuir quantidade" disabled={busy||item.quantity<=1} onClick={()=>change(item.productId,item.variantId,item.quantity-1)}><Minus size={15}/></button><span aria-live="polite">{item.quantity}</span><button type="button" aria-label="Aumentar quantidade" disabled={busy||item.quantity>=max} onClick={()=>change(item.productId,item.variantId,item.quantity+1)}><Plus size={15}/></button><button type="button" className="sc-remove" aria-label={`Remover ${item.name}`} disabled={busy} onClick={()=>change(item.productId,item.variantId,0)}><Trash2 size={15}/></button></div>
     </div></li>;})}</ul>
    <footer className="sc-drawer-footer">
     <p className="sc-subtotal" aria-live="polite"><span>Total estimado</span><strong>{formatCurrencyCents(cart!.subtotalCents,cart!.currency)}</strong></p>
     <small>Você confirma os itens, a entrega e o pagamento direto com a nossa equipe no WhatsApp.</small>
     {error?<p role="alert" className="sc-error">{error}</p>:null}
     <button type="button" className="ts-button sc-full" disabled={checkingOut||blocked} onClick={finish}><MessageCircle size={18} aria-hidden="true"/>{checkingOut?"Abrindo o WhatsApp...":"Finalizar pelo WhatsApp"}</button>
     <button type="button" className="ts-button ts-button-secondary sc-full" onClick={closeCart}>Continuar navegando</button>
    </footer>
   </>}
  </div>
 </div>;
}

/** CTA do produto. Some do fluxo enganoso: sem opção completa ou sem saldo, nunca oferece compra. */
export function ProductCommerceActions({product,variantId,complete,onInterest}:{product:PublicSiteProduct;variantId?:string;complete:boolean;onInterest?:()=>void}){
 const store=useStorefront();const site=store?.site,preview=!!store?.preview;
 const [quantity,setQuantity]=useState(1),[busy,setBusy]=useState<"cart"|"whatsapp">(),[message,setMessage]=useState<{kind:"ok"|"error";text:string}>();
 const mainRef=useRef<HTMLDivElement>(null),[stickyVisible,setStickyVisible]=useState(false);
 useEffect(()=>{if(!preview&&site)trackSiteEvent(site.slug,"PRODUCT_VIEW",product.id);},[preview,site?.slug,product.id]);
 // CTA fixo no celular: aparece quando o botão principal saiu da tela por cima (rolagem/resize com rAF).
 useEffect(()=>{
  let frame=0;const update=()=>{frame=0;const node=mainRef.current;if(node)setStickyVisible(node.getBoundingClientRect().bottom<0);};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
  update();window.addEventListener("scroll",schedule,{passive:true});window.addEventListener("resize",schedule);
  return()=>{window.removeEventListener("scroll",schedule);window.removeEventListener("resize",schedule);if(frame)cancelAnimationFrame(frame);};
 },[]);
 useEffect(()=>{setMessage(undefined);setQuantity(1);},[variantId]);
 // Resposta antiga (sem `commerce`): mantém o comportamento anterior — WhatsApp quando há número.
 const commerce:Pick<ProductCommerce,"saleMode"|"allowedActions"|"ctaLabel"|"availability">=product.commerce??(site?.content.whatsapp?{saleMode:"WHATSAPP_DIRECT",allowedActions:["whatsapp"],ctaLabel:"Falar no WhatsApp",availability:"untracked"}:{saleMode:"SHOW_ONLY",allowedActions:[],ctaLabel:"",availability:"untracked"});
 const variant=variantId?product.variants.find(item=>item.id===variantId):undefined;
 const available=variant?variant.availableQuantity:product.availableQuantity;
 const optionOut=complete&&available===0;
 const canCart=commerce.allowedActions.includes("add_to_cart")&&complete&&!optionOut;
 const canWhatsapp=commerce.allowedActions.includes("whatsapp")&&!!site;
 const canInquiry=commerce.allowedActions.includes("inquiry");
 const whatsappLabel=optionOut||commerce.availability==="unavailable"?"Consultar disponibilidade":"Falar no WhatsApp";
 const needsOptions=product.options.length>0&&!complete;
 async function addToCart(){
  if(!store||preview)return;setBusy("cart");setMessage(undefined);
  try{await store.updateItem({productId:product.id,variantId,quantity:quantity+((store.cart?.items.find(item=>item.productId===product.id&&(item.variantId??"")===(variantId??""))?.quantity)??0)});setMessage({kind:"ok",text:"Adicionado ao carrinho."});store.openCart();}
  catch(caught){setMessage({kind:"error",text:caught instanceof Error?caught.message:"Não foi possível adicionar."});}finally{setBusy(undefined);}
 }
 async function talk(){
  if(!site||preview)return;setBusy("whatsapp");setMessage(undefined);
  try{await openWhatsapp(()=>startProductWhatsapp(site.slug,{productId:product.id,variantId,quantity}),store!.basePath);}
  catch(caught){setMessage({kind:"error",text:caught instanceof Error?caught.message:"Não foi possível abrir o WhatsApp."});}finally{setBusy(undefined);}
 }
 const disabledTitle=preview?"Desabilitado na prévia":undefined;
 const primary=canCart
  ?<button type="button" className="ts-button sc-grow" disabled={preview||!!busy} title={disabledTitle} onClick={addToCart}><ShoppingBag size={18} aria-hidden="true"/>{busy==="cart"?"Adicionando...":"Adicionar ao carrinho"}</button>
  :canWhatsapp&&(complete||!product.options.length||optionOut)
   ?<button type="button" className="ts-button sc-grow" disabled={preview||!!busy||needsOptions} title={disabledTitle} onClick={talk}><MessageCircle size={18} aria-hidden="true"/>{busy==="whatsapp"?"Abrindo o WhatsApp...":whatsappLabel}</button>
   :commerce.saleMode==="SHOW_ONLY"&&canInquiry
    ?<button type="button" className="ts-button sc-grow" onClick={onInterest}>{commerce.ctaLabel}</button>
    :null;
 const secondary=canCart&&canWhatsapp?<button type="button" className="ts-button ts-button-secondary" disabled={preview||!!busy} title={disabledTitle} onClick={talk}><MessageCircle size={18} aria-hidden="true"/><span className="sc-hide-narrow">Falar no WhatsApp</span><span className="sc-show-narrow">WhatsApp</span></button>:null;
 return <>
  <div ref={mainRef} className="sc-actions">
   {needsOptions&&(commerce.allowedActions.includes("add_to_cart")||canWhatsapp)?<p className="ts-meta">Escolha {product.options.map(option=>option.name.toLowerCase()).join(" e ")} para continuar.</p>:null}
   {optionOut?<p className="ts-meta" role="status">Esta opção está sem saldo no momento.</p>:null}
   {canCart?<div className="sc-stepper sc-stepper-large" role="group" aria-label="Quantidade"><button type="button" aria-label="Diminuir quantidade" disabled={quantity<=1} onClick={()=>setQuantity(quantity-1)}><Minus size={16}/></button><span aria-live="polite">{quantity}</span><button type="button" aria-label="Aumentar quantidade" disabled={quantity>=(available===undefined?99:Math.min(99,available))} onClick={()=>setQuantity(quantity+1)}><Plus size={16}/></button></div>:null}
   {primary||secondary?<div className="sc-action-row">{primary}{secondary}</div>:!needsOptions&&commerce.saleMode!=="SHOW_ONLY"?<p className="ts-meta">{commerce.ctaLabel||"Indisponível no momento"}</p>:null}
   {message?<p role={message.kind==="error"?"alert":"status"} className={message.kind==="error"?"sc-error":"sc-ok"}>{message.text}</p>:null}
  </div>
  {primary&&!preview?<div className={`sc-sticky-cta ${stickyVisible?"is-visible":""}`} aria-hidden={!stickyVisible}><div className="sc-sticky-copy"><strong>{product.name}</strong><span>{formatCurrencyCents(variant?.priceCents??product.priceCents,product.currency)}</span></div><div className="sc-action-row" inert={!stickyVisible}>{primary}</div></div>:null}
 </>;
}

export const STOREFRONT_STYLES=`
.sc-actions{display:grid;gap:12px;margin:6px 0 4px}.sc-action-row{display:flex;flex-wrap:wrap;gap:10px}.sc-grow{flex:1 1 220px}.sc-full{width:100%}
.sc-stepper{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--site-line);border-radius:999px;padding:3px;width:max-content}
.sc-stepper button{display:grid;place-items:center;width:36px;height:36px;border-radius:999px;border:0;background:transparent;color:inherit;cursor:pointer}.sc-stepper button:hover:not(:disabled){background:var(--site-soft)}.sc-stepper button:disabled{opacity:.35;cursor:not-allowed}
.sc-stepper span{min-width:28px;text-align:center;font-variant-numeric:tabular-nums;font-weight:600}.sc-stepper-large button{width:44px;height:44px}.sc-stepper .sc-remove{margin-left:6px}
.sc-error{color:#b42318;font-size:.86em}.sc-ok{color:var(--site-primary);font-size:.86em}
.sc-actions button:focus-visible,.sc-drawer button:focus-visible,.sc-drawer a:focus-visible,.sc-cart-launcher:focus-visible,.sc-sticky-cta button:focus-visible{outline:3px solid var(--site-primary);outline-offset:3px}
.sc-cart-launcher{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:60;display:grid;place-items:center;width:58px;height:58px;border-radius:999px;border:0;background:var(--site-primary);color:var(--site-on-primary);box-shadow:0 12px 30px rgba(15,23,42,.25);cursor:pointer}
.sc-cart-count{position:absolute;top:-4px;right:-4px;min-width:24px;height:24px;padding:0 6px;border-radius:999px;background:var(--site-fg);color:var(--site-bg);font-size:12px;font-weight:700;display:grid;place-items:center;font-variant-numeric:tabular-nums}
.sc-drawer-layer{position:fixed;inset:0;z-index:80}.tenant-site:has(.sc-drawer) .sc-cart-launcher{display:none}.sc-drawer-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.45)}
.sc-drawer{position:absolute;top:0;right:0;bottom:0;width:min(440px,100vw);display:flex;flex-direction:column;background:var(--site-bg);color:var(--site-fg);box-shadow:-20px 0 40px rgba(15,23,42,.2);animation:sc-in .2s ease-out}
@keyframes sc-in{from{transform:translateX(32px)}to{transform:none}}
.sc-drawer-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid var(--site-line)}.sc-drawer-header h2{margin:0;font-size:1.15em}
.sc-icon-button{display:grid;place-items:center;width:44px;height:44px;border-radius:999px;border:0;background:transparent;color:inherit;cursor:pointer}.sc-icon-button:hover{background:var(--site-soft)}
.sc-drawer-empty{flex:1;display:grid;place-content:center;justify-items:center;gap:12px;padding:24px;text-align:center}
.sc-cart-lines{flex:1;overflow:auto;list-style:none;margin:0;padding:8px 20px}.sc-cart-lines li{display:grid;grid-template-columns:72px 1fr;gap:14px;padding:14px 0;border-bottom:1px solid var(--site-line)}.sc-cart-lines li.is-unavailable{opacity:.85}
.sc-line-image{width:72px;height:72px;border-radius:calc(var(--site-radius)*.6);overflow:hidden;background:var(--site-surface);display:grid;place-items:center}.sc-line-image img{width:100%;height:100%;object-fit:cover}
.sc-line-copy{display:grid;gap:4px;min-width:0}.sc-line-copy a{font-weight:600;color:inherit;text-decoration:none;overflow-wrap:anywhere}.sc-line-copy span{font-size:.85em;opacity:.75}.sc-line-copy strong{font-variant-numeric:tabular-nums}.sc-line-copy em{font-size:.82em;color:#b42318;font-style:normal}
.sc-drawer-footer{display:grid;gap:10px;padding:16px 20px calc(16px + env(safe-area-inset-bottom));border-top:1px solid var(--site-line);background:var(--site-surface)}
.sc-subtotal{display:flex;justify-content:space-between;align-items:baseline;margin:0}.sc-subtotal strong{font-size:1.25em;font-variant-numeric:tabular-nums}.sc-drawer-footer small{opacity:.75;line-height:1.4}
.sc-sticky-cta{display:none}.sc-show-narrow{display:none}
@media(max-width:700px){
 .sc-sticky-cta{position:fixed;left:0;right:0;bottom:0;z-index:55;display:flex;align-items:center;gap:12px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:var(--site-bg);border-top:1px solid var(--site-line);box-shadow:0 -10px 30px rgba(15,23,42,.12);transform:translateY(110%);transition:transform .2s ease}
 .sc-sticky-cta.is-visible{transform:none}.sc-sticky-copy{display:grid;min-width:0;flex:1}.sc-sticky-copy strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.9em}.sc-sticky-copy span{font-size:.85em;font-variant-numeric:tabular-nums}
 .sc-sticky-cta .sc-action-row{flex:0 0 auto;flex-direction:row}.sc-sticky-cta .ts-button{flex:0 0 auto;width:auto;min-height:46px;padding:10px 16px}
 .tenant-site:has(.sc-sticky-cta.is-visible) .sc-cart-launcher{bottom:calc(84px + env(safe-area-inset-bottom))}
 .sc-action-row .ts-button{min-height:48px}.sc-hide-narrow{display:none}.sc-show-narrow{display:inline}
}
@media(max-width:380px){.sc-actions .sc-action-row{flex-direction:column}.sc-actions .sc-action-row .ts-button{width:100%;flex:0 0 auto}.sc-sticky-cta .ts-button{padding:10px 12px;font-size:.82em}}
@media(prefers-reduced-motion:reduce){.sc-drawer{animation:none}.sc-sticky-cta{transition:none}}
`;
