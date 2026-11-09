import {NextRequest,NextResponse} from "next/server";
import {revalidateTag} from "next/cache";
import {getApiBaseUrl} from "@/lib/api-error";
import {publicSiteTag} from "@/features/sites/server";
/**
 * Public site pages are cached for a few seconds (ISR). After publishing, the editor calls this so
 * the merchant sees the new version on the next visit. Only someone who can read the site through
 * the API (same access token) can trigger it; the slug comes from the API, never from the caller.
 */
export async function POST(request:NextRequest){
 const authorization=request.headers.get("authorization")??"";
 const body=await request.json().catch(()=>({})) as {siteId?:unknown;workspaceId?:unknown};
 const siteId=typeof body.siteId==="string"?body.siteId:"",workspaceId=typeof body.workspaceId==="string"?body.workspaceId:"";
 if(!/^Bearer \S{10,4096}$/.test(authorization)||!siteId||!workspaceId||siteId.length>120||workspaceId.length>120)return NextResponse.json({ok:false},{status:400});
 try{
  const response=await fetch(`${getApiBaseUrl()}/v1/sites?workspaceId=${encodeURIComponent(workspaceId)}`,{headers:{authorization},cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(!response.ok)return NextResponse.json({ok:false},{status:response.status===401||response.status===403?response.status:502});
  const listing=(await response.json()).data as {sites?:{id:string;slug:string}[];publicBaseDomain?:string}|undefined;
  const site=listing?.sites?.find(item=>item.id===siteId);if(!site)return NextResponse.json({ok:false},{status:404});
  // Subdomain and custom domains render through /site-domain, keyed by hostname.
  const domains=await fetch(`${getApiBaseUrl()}/v1/sites/${encodeURIComponent(site.id)}/domains?workspaceId=${encodeURIComponent(workspaceId)}`,{headers:{authorization},cache:"no-store",signal:AbortSignal.timeout(10000)}).then(r=>r.ok?r.json():undefined).catch(()=>undefined) as {data?:{hostname:string}[]}|undefined;
  const hostnames=[...(listing?.publicBaseDomain?[`${site.slug}.${listing.publicBaseDomain}`]:[]),...(domains?.data??[]).map(domain=>domain.hostname)];
  // Immediate expiry: the next visit renders the new version instead of serving the old one once.
  for(const tag of [publicSiteTag({slug:site.slug}),...hostnames.map(hostname=>publicSiteTag({hostname}))])revalidateTag(tag,{expire:0});
  return NextResponse.json({ok:true});
 }catch{return NextResponse.json({ok:false},{status:503});}
}
