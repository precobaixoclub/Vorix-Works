import {salesIntentRedirect} from "@/features/sites/intent-redirect";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{slug:string;reference:string}>}){const {slug,reference}=await params;return salesIntentRedirect(reference,`/s/${encodeURIComponent(slug)}`);}
