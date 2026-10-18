import {NextRequest,NextResponse} from "next/server";
import {getApiBaseUrl} from "@/lib/api-error";
export async function POST(request:NextRequest){
 try{
  const body=await request.text();if(body.length>12000)return NextResponse.json({ok:false,error:{message:"Mensagem muito longa."}},{status:413});
  const {slug,...input}=JSON.parse(body);if(typeof slug!=="string"||!/^[-a-z0-9]{3,80}$/.test(slug))return NextResponse.json({ok:false,error:{message:"Site inválido."}},{status:400});
  const response=await fetch(`${getApiBaseUrl()}/v1/public/sites/${encodeURIComponent(slug)}/inquiries`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),cache:"no-store",signal:AbortSignal.timeout(15000)});
  return NextResponse.json(await response.json(),{status:response.status,headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({ok:false,error:{message:"Não foi possível enviar. Tente novamente."}},{status:400});}
}
