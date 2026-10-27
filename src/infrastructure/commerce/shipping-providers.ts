import type {ShippingProviderContext,ShippingProviderPort} from "../../application/ports/commerce-ports.js";
import {quoteOwnShipping,servesPostalCode,type ShippingOption,type ShippingQuoteRequest} from "../../domain/commerce/shipping.js";

/** Métodos próprios da loja: retirada, frete grátis, valor fixo e tabela por faixa de CEP. */
export class OwnShippingProvider implements ShippingProviderPort{
 readonly key="OWN";
 async quote(context:ShippingProviderContext,request:ShippingQuoteRequest){return quoteOwnShipping(context.settings,request);}
}

type FetchLike=(url:string,init?:RequestInit)=>Promise<Response>;
/**
 * Melhor Envio (cotação de transportadoras). Usa o token do lojista. Sem peso/medidas de algum
 * item, não cota (nunca inventa valor) — o checkout mostra só os métodos próprios configurados.
 */
export class MelhorEnvioShippingProvider implements ShippingProviderPort{
 readonly key="MELHOR_ENVIO";
 constructor(private readonly options:{fetch?:FetchLike;baseUrl?:string;userAgent?:string}={}){}
 async quote(context:ShippingProviderContext,request:ShippingQuoteRequest):Promise<ShippingOption[]>{
  const token=context.credentials?.accessToken,origin=context.settings.originPostalCode,destination=request.destinationPostalCode;
  if(!token||!origin||!destination||!servesPostalCode(context.settings,destination))return [];
  if(request.items.some(item=>!item.weightGrams||!item.heightCm||!item.widthCm||!item.lengthCm))return [];
  const body={from:{postal_code:origin},to:{postal_code:destination},products:request.items.map(item=>({id:item.productId,width:item.widthCm,height:item.heightCm,length:item.lengthCm,weight:item.weightGrams!/1000,insurance_value:item.unitPriceCents/100,quantity:item.quantity}))};
  const response=await (this.options.fetch??fetch)(`${this.options.baseUrl??"https://melhorenvio.com.br"}/api/v2/me/shipment/calculate`,{method:"POST",headers:{Authorization:`Bearer ${token}`,Accept:"application/json","Content-Type":"application/json","User-Agent":this.options.userAgent??"Vorix Commerce (suporte@vorixworks.com)"},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`SHIPPING_PROVIDER_ERROR: ${response.status}`);
  const services=(await response.json()) as {id:number|string;name:string;price?:string;custom_price?:string;delivery_time?:number;custom_delivery_time?:number;company?:{name?:string};error?:string}[];
  return services.filter(service=>!service.error&&(service.custom_price??service.price)).map(service=>({
   id:`me:${service.id}`,kind:"PROVIDER" as const,provider:"MELHOR_ENVIO",requiresAddress:true,
   label:[service.company?.name,service.name].filter(Boolean).join(" "),
   priceCents:Math.round(Number(service.custom_price??service.price)*100),
   days:(service.custom_delivery_time??service.delivery_time??0)+context.settings.handlingDays,
  }));
 }
}
