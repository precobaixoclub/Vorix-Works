import {describe,it,expect,vi} from "vitest";
import {SiteDraftAutosave} from "@/features/sites/draft-autosave";
import {initialSiteSnapshot} from "@/features/sites/customization";
import {emptySiteDraft,siteDraftReducer} from "@/features/sites/draft-history";
import type {TenantSite} from "@/features/sites/types";

const site=():TenantSite=>({id:"site-test",tenantId:"tenant",workspaceId:"workspace",slug:"test",revision:1,updatedAt:"",draft:initialSiteSnapshot("Original")});
describe("salvamento automático do rascunho",()=>{
 it("serializa gravações e publica somente depois de salvar a última digitação",async()=>{
  const original=site(),first={...original.draft,content:{...original.draft.content,name:"Primeira"}},last={...first,content:{...first.content,name:"Última"}};
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const writes:number[]=[],names:string[]=[],ack=vi.fn();
  const queue=new SiteDraftAutosave(original,async(current,draft)=>{writes.push(current.revision);names.push(draft.content.name);if(writes.length===1)await gate;return {...current,revision:current.revision+1,draft};},ack);
  queue.update(first);const pending=queue.flush();queue.update(last);const publishFlush=queue.flush();release();
  expect((await pending).draft.content.name).toBe("Última");expect((await publishFlush).revision).toBe(3);expect(writes).toEqual([1,2]);expect(names).toEqual(["Primeira","Última"]);expect(ack).toHaveBeenCalledTimes(2);
 });
 it("falhas mantêm a revisão e permitem nova tentativa sem apagar a edição",async()=>{
  const original=site(),changed={...original.draft,content:{...original.draft.content,name:"Alterado"}};
  const write=vi.fn().mockRejectedValueOnce(new Error("Sem conexão")).mockImplementation(async(current,draft)=>({...current,draft,revision:current.revision+1}));
  const queue=new SiteDraftAutosave(original,write,vi.fn());queue.update(changed);await expect(queue.flush()).rejects.toThrow("Sem conexão");expect((await queue.flush()).revision).toBe(2);expect(write.mock.calls[1][0].revision).toBe(1);
 });
 it("a confirmação de uma gravação preserva o texto mais recente e o histórico",()=>{
  const original=site().draft,first={...original,content:{...original.content,name:"Primeira"}},last={...first,content:{...first.content,name:"Última"}};
  let state=siteDraftReducer(emptySiteDraft,{type:"reset",value:original});state=siteDraftReducer(state,{type:"change",value:first});const sent=state.present!;state=siteDraftReducer(state,{type:"change",value:last});state=siteDraftReducer(state,{type:"acknowledge",value:sent});
  expect(state.present!.content.name).toBe("Última");expect(state.past).toHaveLength(2);expect(JSON.stringify(state.present)).not.toBe(state.baseline);
 });
 it("restaura a produção mesmo se outra sessão alterou o rascunho",async()=>{
  const original=site(),remote={...original,revision:8,draft:{...original.draft,content:{...original.draft.content,name:"Outra sessão"}}};
  const write=vi.fn(async(current:TenantSite,draft:TenantSite["draft"])=>({...current,draft,revision:current.revision+1}));
  const queue=new SiteDraftAutosave(original,write,vi.fn());queue.accept(remote);queue.update(original.draft);expect((await queue.flush()).draft.content.name).toBe("Original");expect(write.mock.calls[0][0].revision).toBe(8);
 });
});
