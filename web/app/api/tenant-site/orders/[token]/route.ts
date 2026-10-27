import {NextResponse} from "next/server";
import {getApiBaseUrl} from "@/lib/api-error";
/** Status público do pedido (o token é o acesso; nunca expõe dados internos). */
export async function GET(_request:Request,{params}:{params:Promise<{token:string}>}){
 const {token}=await params;
 if(!/^[A-Za-z0-9_-]{20,64}$/.test(token))return NextResponse.json({ok:false,error:{message:"Pedido não encontrado."}},{status:404});
 try{
  const response=await fetch(`${getApiBaseUrl()}/v1/public/orders/${encodeURIComponent(token)}`,{cache:"no-store",signal:AbortSignal.timeout(15000)});
  return NextResponse.json(await response.json(),{status:response.status,headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({ok:false,error:{message:"Não foi possível consultar o pedido agora."}},{status:503});}
}
