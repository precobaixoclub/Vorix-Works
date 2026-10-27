import {NextRequest,NextResponse} from "next/server";
import {getApiBaseUrl} from "@/lib/api-error";
/** Próximas páginas do catálogo público (paginação no banco, sem carregar tudo de uma vez). */
export async function GET(request:NextRequest){
 const params=request.nextUrl.searchParams;const slug=params.get("slug")??"";
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>80)return NextResponse.json({ok:false,error:{message:"Site inválido."}},{status:400});
 const query=new URLSearchParams();for(const key of ["offset","limit","search","category","brand","sort"]){const value=params.get(key);if(value)query.set(key,value.slice(0,160));}
 try{
  const response=await fetch(`${getApiBaseUrl()}/v1/public/sites/${encodeURIComponent(slug)}/products?${query}`,{cache:"no-store",signal:AbortSignal.timeout(15000)});
  return NextResponse.json(await response.json(),{status:response.status,headers:{"Cache-Control":"public, max-age=30"}});
 }catch{return NextResponse.json({ok:false,error:{message:"Não foi possível carregar mais produtos."}},{status:503});}
}
