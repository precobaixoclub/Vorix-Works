import {NextRequest,NextResponse} from "next/server";
import {getApiBaseUrl} from "@/lib/api-error";
/** Proxy da vitrine pública para a API comercial do Site (mesmo padrão do formulário de contato). */
const ROUTES:Record<string,{method:"POST"|"PUT";path:(slug:string)=>string}>={
 "whatsapp-intents":{method:"POST",path:slug=>`/v1/public/sites/${slug}/whatsapp-intents`},
 cart:{method:"POST",path:slug=>`/v1/public/sites/${slug}/cart`},
 "cart-items":{method:"PUT",path:slug=>`/v1/public/sites/${slug}/cart/items`},
 checkout:{method:"POST",path:slug=>`/v1/public/sites/${slug}/cart/checkout`},
 events:{method:"POST",path:slug=>`/v1/public/sites/${slug}/events`},
 "checkout-quote":{method:"POST",path:slug=>`/v1/public/sites/${slug}/checkout/quote`},
 "checkout-orders":{method:"POST",path:slug=>`/v1/public/sites/${slug}/checkout/orders`},
};
export async function POST(request:NextRequest,{params}:{params:Promise<{action:string}>}){
 const route=ROUTES[(await params).action];
 if(!route)return NextResponse.json({ok:false,error:{message:"Ação inválida."}},{status:404});
 try{
  const body=await request.text();if(body.length>16000)return NextResponse.json({ok:false,error:{message:"Requisição muito grande."}},{status:413});
  const {slug,...input}=JSON.parse(body||"{}");
  if(typeof slug!=="string"||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>80)return NextResponse.json({ok:false,error:{message:"Site inválido."}},{status:400});
  const response=await fetch(`${getApiBaseUrl()}${route.path(encodeURIComponent(slug))}`,{method:route.method,headers:{"Content-Type":"application/json"},body:JSON.stringify(input),cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(response.status===204)return new NextResponse(null,{status:204,headers:{"Cache-Control":"no-store"}});
  return NextResponse.json(await response.json(),{status:response.status,headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({ok:false,error:{message:"Não foi possível concluir agora. Tente novamente."}},{status:400});}
}
