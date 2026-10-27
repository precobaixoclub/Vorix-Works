import {salesIntentRedirect} from "@/features/sites/intent-redirect";
export const dynamic="force-dynamic";
// Domínio próprio/subdomínio: o proxy reescreve /i/:ref para cá; o "voltar" fica no mesmo host.
export async function GET(_request:Request,{params}:{params:Promise<{reference:string}>}){return salesIntentRedirect((await params).reference,"/");}
