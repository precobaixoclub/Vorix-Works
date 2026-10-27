import {salesIntentRedirect} from "@/features/sites/intent-redirect";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{reference:string}>}){return salesIntentRedirect((await params).reference,"/");}
