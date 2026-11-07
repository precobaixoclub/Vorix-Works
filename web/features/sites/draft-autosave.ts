import type {SiteSnapshot,TenantSite} from "./types";

/** One writer per editor. An acknowledgement never replaces newer keystrokes. */
export class SiteDraftAutosave {
 private current:TenantSite;
 private pending:SiteSnapshot;
 private acknowledged:string;
 private running?:Promise<TenantSite>;
 constructor(site:TenantSite,private write:(site:TenantSite,draft:SiteSnapshot)=>Promise<TenantSite>,private saved:(site:TenantSite,sent:SiteSnapshot)=>void){
  this.current=site;this.pending=site.draft;this.acknowledged=JSON.stringify(site.draft);
 }
 update(draft:SiteSnapshot){this.pending=draft;}
 async flush():Promise<TenantSite>{
  if(this.running){await this.running;return this.flush();}
  this.running=this.drain();
  try{return await this.running;}finally{this.running=undefined;}
 }
 private async drain(){
  while(JSON.stringify(this.pending)!==this.acknowledged){
   const sent=this.pending,serialized=JSON.stringify(sent);
   const saved=await this.write(this.current,sent);
   this.current=saved;this.acknowledged=serialized;this.saved(saved,sent);
  }
  return this.current;
 }
 /** Publishing also advances the site's optimistic revision. */
 accept(site:TenantSite){this.current=site;this.acknowledged=JSON.stringify(site.draft);}
}
