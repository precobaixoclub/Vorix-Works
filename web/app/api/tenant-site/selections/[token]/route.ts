import {NextResponse} from "next/server";
import {getApiBaseUrl} from "@/lib/api-error";
async function proxy(request:Request,params:Promise<{token:string}>,method:"GET"|"POST"){
 const {token}=await params;
 if(!/^[a-f0-9]{64}$/.test(token))return NextResponse.json({error:{message:"Seleção não encontrada."}},{status:404});
 try{
  const body=method==="POST"?await request.text():undefined;
  if(body&&body.length>16000)return NextResponse.json({error:{message:"Seleção muito grande."}},{status:413});
  const response=await fetch(`${getApiBaseUrl()}/v1/public/site-selections/${token}`,{method,headers:{"Content-Type":"application/json"},body,cache:"no-store",signal:AbortSignal.timeout(30000)});
  return NextResponse.json(await response.json(),{status:response.status,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
 }catch{return NextResponse.json({error:{message:"Não foi possível acessar sua seleção. Tente novamente."}},{status:502});}
}
export const GET=(request:Request,{params}:{params:Promise<{token:string}>})=>proxy(request,params,"GET");
export const POST=(request:Request,{params}:{params:Promise<{token:string}>})=>proxy(request,params,"POST");
