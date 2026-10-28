import { createHmac, timingSafeEqual } from "node:crypto";

/** Mercado Pago's payment webhook manifest; QR Code/Point integrations are a different contract. */
export function verifyMercadoPagoWebhook(input:{secret:string;signature?:string;requestId?:string;dataId?:string;nowMs?:number}):boolean{
 if(!input.secret||!input.signature||input.signature.length>1000||!input.requestId||input.requestId.length>200||!input.dataId||!/^\d{1,30}$/.test(input.dataId))return false;
 const parts=input.signature.split(",").map(value=>value.trim().split("="));
 const timestamps=parts.filter(([key])=>key==="ts"),signatures=parts.filter(([key])=>key==="v1");
 if(timestamps.length!==1||signatures.length!==1)return false;
 const ts=timestamps[0][1],signature=signatures[0][1];
 if(!/^(?:\d{10}|\d{13})$/.test(ts??"")||! /^[a-f0-9]{64}$/i.test(signature??""))return false;
 const timestamp=Number(ts)*(ts.length===10?1000:1);
 if(Math.abs((input.nowMs??Date.now())-timestamp)>300000)return false;
 const manifest=`id:${input.dataId};request-id:${input.requestId};ts:${ts};`;
 const expected=createHmac("sha256",input.secret).update(manifest).digest();
 return timingSafeEqual(expected,Buffer.from(signature,"hex"));
}
