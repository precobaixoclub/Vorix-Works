import type {SiteSnapshot} from "./types";
import {captureTemplateConfig} from "./template-state";
export type SiteDraftHistory={past:SiteSnapshot[];present?:SiteSnapshot;future:SiteSnapshot[];baseline:string};
export const emptySiteDraft:SiteDraftHistory={past:[],future:[],baseline:""};
export function siteDraftReducer(state:SiteDraftHistory,action:{type:"reset"|"change";value:SiteSnapshot}|{type:"undo"|"redo"}):SiteDraftHistory{
 if(action.type==="reset")return {past:[],present:action.value,future:[],baseline:JSON.stringify(action.value)};
 if(action.type==="change"){if(JSON.stringify(action.value)===JSON.stringify(state.present))return state;action={...action,value:captureTemplateConfig(action.value)};if(JSON.stringify(action.value)===JSON.stringify(state.present))return state;return {...state,past:state.present?[...state.past,state.present].slice(-30):state.past,present:action.value,future:[]};}
 if(action.type==="undo"&&state.present&&state.past.length)return {...state,past:state.past.slice(0,-1),present:state.past.at(-1),future:[state.present,...state.future]};
 if(action.type==="redo"&&state.present&&state.future.length)return {...state,past:[...state.past,state.present].slice(-30),present:state.future[0],future:state.future.slice(1)};
 return state;
}
